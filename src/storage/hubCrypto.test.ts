import { beforeAll, describe, expect, it } from 'vitest'
import type { HubContent } from '../domain/hub'
import { decodeBase64Url, encodeBase64Url } from './base64url'
import { DecryptError, generateKeyString } from './crypto'
import { sealJson, TooLargeError } from './envelope'
import { openHub, openHubPerson, sealHub } from './hubCrypto'
import { importShareKey } from './shareCrypto'

const HUB_ID = 'H'.repeat(22)
const SECRETS = { p1: 'A'.repeat(43), p2: 'B'.repeat(43) }
const content: HubContent = {
  v: 1,
  shares: [
    { shareId: 's1', key: 'K'.repeat(43) },
    { shareId: 's2', key: 'L'.repeat(43) },
  ],
  people: {
    p1: { name: 'Alice', replies: { s1: { answer: 'yes', at: 10 } } },
    p2: { name: 'Bob', replies: { s1: { answer: 'no', at: 11 }, s2: { answer: 'yes', at: 0 } } },
  },
}

let hubKey: CryptoKey
beforeAll(async () => {
  hubKey = await importShareKey(generateKeyString())
})

/** Seals an arbitrary outer value the way `sealHub` does, to build what a modified client could store. */
const sealOuter = (value: unknown) => sealJson(hubKey, `organiz/hub/v1:${HUB_ID}`, value, 2_000_000)

describe('hub sealing', () => {
  it('seals and opens a hub, one person at a time', async () => {
    const sealed = await sealHub(hubKey, HUB_ID, content, SECRETS)
    const { shares, sealedPeople } = await openHub(hubKey, HUB_ID, sealed)
    expect(shares).toEqual(content.shares)
    expect(Object.keys(sealedPeople).sort()).toEqual(['p1', 'p2'])
    expect(await openHubPerson(SECRETS.p1, HUB_ID, 'p1', sealedPeople.p1!)).toEqual(content.people.p1)
    expect(await openHubPerson(SECRETS.p2, HUB_ID, 'p2', sealedPeople.p2!)).toEqual(content.people.p2)
    // The holder of p2's link cannot read p1's entry, under either id.
    await expect(openHubPerson(SECRETS.p2, HUB_ID, 'p1', sealedPeople.p1!)).rejects.toBeInstanceOf(DecryptError)
    await expect(openHubPerson(SECRETS.p2, HUB_ID, 'p2', sealedPeople.p1!)).rejects.toBeInstanceOf(DecryptError)
    // p1's own secret does not open p1's entry presented as another person's.
    await expect(openHubPerson(SECRETS.p1, HUB_ID, 'p2', sealedPeople.p1!)).rejects.toBeInstanceOf(DecryptError)
  })

  it('does not put names or replies in the outer layer', async () => {
    const sealed = await sealHub(hubKey, HUB_ID, content, SECRETS)
    const opened = await openHub(hubKey, HUB_ID, sealed)
    expect(JSON.stringify(opened)).not.toContain('Alice')
    expect(JSON.stringify(opened)).not.toContain('"answer"')
  })

  it('refuses another hub id, another key or a tampered ciphertext', async () => {
    const sealed = await sealHub(hubKey, HUB_ID, content, SECRETS)
    await expect(openHub(hubKey, 'I'.repeat(22), sealed)).rejects.toBeInstanceOf(DecryptError)
    await expect(openHub(await importShareKey(generateKeyString()), HUB_ID, sealed)).rejects.toBeInstanceOf(DecryptError)
    const ct = new Uint8Array(sealed.ct)
    ct[0]! ^= 1
    await expect(openHub(hubKey, HUB_ID, { ...sealed, ct })).rejects.toBeInstanceOf(DecryptError)
    const { sealedPeople } = await openHub(hubKey, HUB_ID, sealed)
    await expect(openHubPerson(SECRETS.p1, 'I'.repeat(22), 'p1', sealedPeople.p1!)).rejects.toBeInstanceOf(DecryptError)
  })

  it('refuses a malformed secret or entry', async () => {
    const { sealedPeople } = await openHub(hubKey, HUB_ID, await sealHub(hubKey, HUB_ID, content, SECRETS))
    const entry = sealedPeople.p1!
    for (const secret of ['short', '***', encodeBase64Url(new Uint8Array(16))]) {
      await expect(openHubPerson(secret, HUB_ID, 'p1', entry)).rejects.toBeInstanceOf(DecryptError)
    }
    await expect(openHubPerson(SECRETS.p1, HUB_ID, 'p1', { ...entry, ct: '***' })).rejects.toBeInstanceOf(DecryptError)
    await expect(openHubPerson(SECRETS.p1, HUB_ID, 'p1', { ...entry, iv: 'short' })).rejects.toBeInstanceOf(DecryptError)
  })

  it('refuses a person missing a secret', async () => {
    await expect(sealHub(hubKey, HUB_ID, content, { p1: SECRETS.p1 })).rejects.toThrow()
  })

  it('refuses a hub too large for the rules', async () => {
    // Each entry is ciphertext, which does not compress: the outer ciphertext ends up over the rules' limit.
    const people: HubContent['people'] = {}
    const secrets: Record<string, string> = {}
    for (let i = 0; i < 2000; i++) {
      const replies: HubContent['people'][string]['replies'] = {}
      for (let s = 0; s < 20; s++) replies[`s${s}`] = { answer: 'yes', at: Math.floor(Math.random() * 1e12) }
      people[`p${i}`] = { name: encodeBase64Url(crypto.getRandomValues(new Uint8Array(75))), replies }
      secrets[`p${i}`] = SECRETS.p1
    }
    await expect(sealHub(hubKey, HUB_ID, { ...content, people }, secrets)).rejects.toBeInstanceOf(TooLargeError)
  })
})

describe('hub shape checks', () => {
  const entry = async () => (await openHub(hubKey, HUB_ID, await sealHub(hubKey, HUB_ID, content, SECRETS))).sealedPeople.p1!
  const good = async () => ({ v: 1, shares: content.shares, people: { p1: await entry() } })

  it('accepts what sealHub writes, and copies only known fields', async () => {
    const p1 = await entry()
    const outer = { v: 1, extra: 1, shares: content.shares.map((share) => ({ ...share, extra: 2 })), people: { p1: { ...p1, extra: 3 } } }
    const opened = await openHub(hubKey, HUB_ID, await sealOuter(outer))
    expect(opened).toEqual({ shares: content.shares, sealedPeople: { p1 } })
  })

  it.each([
    ['a wrong version', { v: 2 }],
    ['shares that are not a list', { shares: {} }],
    ['a share with a bad key', { shares: [{ shareId: 's1', key: 'short' }] }],
    ['a share with a bad id', { shares: [{ shareId: 'constructor', key: 'K'.repeat(43) }] }],
    ['a share listed twice', { shares: [content.shares[0], content.shares[0]] }],
    ['people that are a list', { people: [] }],
    ['a person with a bad id', { people: { '__proto__x!': { iv: 'abcdefghijklmnop', ct: 'AAAA' } } }],
    ['an entry without ct', { people: { p1: { iv: 'abcdefghijklmnop' } } }],
    ['an entry with a bad iv', { people: { p1: { iv: 12, ct: 'AAAA' } } }],
  ])('refuses an outer layer with %s', async (_, overrides) => {
    await expect(openHub(hubKey, HUB_ID, await sealOuter({ ...(await good()), ...overrides }))).rejects.toBeInstanceOf(DecryptError)
  })

  /** Seals a person entry as `sealHub` does, from any value. */
  const personEntry = async (value: unknown) => {
    const master = await crypto.subtle.importKey('raw', decodeBase64Url(SECRETS.p1), 'HKDF', false, ['deriveKey'])
    const key = await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode(HUB_ID), info: new TextEncoder().encode('organiz/hub/person/v1') },
      master,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt'],
    )
    const sealed = await sealJson(key, `organiz/hub/person/v1:${HUB_ID}:p1`, value, 100_000)
    return { iv: sealed.iv, ct: encodeBase64Url(sealed.ct) }
  }

  it('derives the person key as specified', async () => {
    const opened = await openHubPerson(SECRETS.p1, HUB_ID, 'p1', await personEntry(content.people.p1))
    expect(opened).toEqual(content.people.p1)
  })

  it.each([
    ['an empty name', { name: '', replies: {} }],
    ['a name too long', { name: 'x'.repeat(101), replies: {} }],
    ['replies that are a list', { name: 'Alice', replies: [] }],
    ['a reply with a bad answer', { name: 'Alice', replies: { s1: { answer: 'none', at: 1 } } }],
    ['a reply without a time', { name: 'Alice', replies: { s1: { answer: 'yes' } } }],
    ['a reply to a bad share id', { name: 'Alice', replies: { 'a b': { answer: 'yes', at: 1 } } }],
  ])('refuses a person entry with %s', async (_, value) => {
    await expect(openHubPerson(SECRETS.p1, HUB_ID, 'p1', await personEntry(value))).rejects.toBeInstanceOf(DecryptError)
  })

  it('copies only known fields of a person entry', async () => {
    const value = { name: 'Alice', extra: 1, replies: { s1: { answer: 'yes', at: 1, extra: 2 } } }
    expect(await openHubPerson(SECRETS.p1, HUB_ID, 'p1', await personEntry(value))).toEqual({ name: 'Alice', replies: { s1: { answer: 'yes', at: 1 } } })
  })
})
