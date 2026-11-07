import { beforeAll, describe, expect, it } from 'vitest'
import type { ShareSnapshot } from '../domain/shareSnapshot'
import { encodeBase64Url } from './base64url'
import { DecryptError, generateKeyString } from './crypto'
import { sealJson, TooLargeError } from './envelope'
import { generateOrganizerKeys, MAX_SHARE_CIPHERTEXT_BYTES, importOrganizerKey, importShareKey, openReply, openSnapshot, sealReply, sealSnapshot, type ReplyPayload } from './shareCrypto'

const snapshot: ShareSnapshot = {
  v: 1,
  kind: 'presence',
  visibility: 'public',
  dashboard: 'Club',
  event: { name: 'Training', date: '2026-10-23', properties: [{ name: 'Place', value: 'Gym' }] },
  people: [{ id: 'p1', name: 'Alice' }],
  answers: { p1: 'yes' },
  at: 5,
}
const payload: ReplyPayload = { personId: 'p1', answer: 'yes', device: 'd1', via: 'shared' }

let shareKey: CryptoKey
beforeAll(async () => {
  shareKey = await importShareKey(generateKeyString())
})

describe('share keys', () => {
  it('rejects a key that is not 32 bytes', async () => {
    await expect(importShareKey(encodeBase64Url(new Uint8Array(16)))).rejects.toBeInstanceOf(DecryptError)
    await expect(importShareKey('***')).rejects.toBeInstanceOf(DecryptError)
  })
})

describe('snapshots', () => {
  it('round-trips a snapshot and refuses it under another share id', async () => {
    const sealed = await sealSnapshot(shareKey, 's1', snapshot)
    expect(await openSnapshot(shareKey, 's1', sealed)).toEqual(snapshot)
    await expect(openSnapshot(shareKey, 's2', sealed)).rejects.toBeInstanceOf(DecryptError)
  })

  it('refuses another key', async () => {
    const sealed = await sealSnapshot(shareKey, 's1', snapshot)
    await expect(openSnapshot(await importShareKey(generateKeyString()), 's1', sealed)).rejects.toBeInstanceOf(DecryptError)
  })

  it('refuses a snapshot whose ciphertext exceeds the share limit', async () => {
    // Incompressible names; sealSnapshot does not validate, so the cap is a last safeguard beyond LIMITS.
    const random = () => encodeBase64Url(crypto.getRandomValues(new Uint8Array(75)))
    const people = Array.from({ length: 8000 }, (_, i) => ({ id: `p${i}`, name: random().slice(0, 100) }))
    await expect(sealSnapshot(shareKey, 's1', { ...snapshot, people, answers: {} })).rejects.toBeInstanceOf(TooLargeError)
    expect(MAX_SHARE_CIPHERTEXT_BYTES).toBe(500_000)
  })

  it('rejects a payload that is not a snapshot', async () => {
    const sealed = await sealJson(shareKey, 'organiz/share/v1:s1', { v: 1 }, 1000)
    await expect(openSnapshot(shareKey, 's1', sealed)).rejects.toBeInstanceOf(DecryptError)
  })
})

describe('replies', () => {
  it('round-trips a public reply and refuses another share id', async () => {
    const sealed = await sealReply({ shareKey }, 's1', payload)
    expect(sealed.epk).toBeUndefined()
    expect(await openReply({ shareKey }, 's1', sealed)).toEqual(payload)
    await expect(openReply({ shareKey }, 's2', sealed)).rejects.toBeInstanceOf(DecryptError)
  })

  it('seals a private reply that the share key cannot open', async () => {
    const organizer = await generateOrganizerKeys()
    const sealed = await sealReply({ publicKey: organizer.publicKey }, 's1', payload)
    expect(sealed.epk).toMatch(/^[A-Za-z0-9_-]{87}$/)
    await expect(openReply({ shareKey }, 's1', sealed)).rejects.toBeInstanceOf(DecryptError)
    const privateKey = await importOrganizerKey(organizer.privateKey)
    expect(await openReply({ shareKey, privateKey }, 's1', sealed)).toEqual(payload)
    await expect(openReply({ shareKey, privateKey }, 's2', sealed)).rejects.toBeInstanceOf(DecryptError)
  })

  it('does not open a private reply with another organizer key', async () => {
    const organizer = await generateOrganizerKeys()
    const other = await importOrganizerKey((await generateOrganizerKeys()).privateKey)
    const sealed = await sealReply({ publicKey: organizer.publicKey }, 's1', payload)
    await expect(openReply({ shareKey, privateKey: other }, 's1', sealed)).rejects.toBeInstanceOf(DecryptError)
  })

  it('uses a fresh ephemeral key for each private reply', async () => {
    const organizer = await generateOrganizerKeys()
    const a = await sealReply({ publicKey: organizer.publicKey }, 's1', payload)
    const b = await sealReply({ publicKey: organizer.publicKey }, 's1', payload)
    expect(a.epk).not.toBe(b.epk)
  })

  it('rejects a payload that is not a reply', async () => {
    const sealed = await sealJson(shareKey, 'organiz/reply/v1:s1', { personId: 1 }, 1000)
    await expect(openReply({ shareKey }, 's1', sealed)).rejects.toBeInstanceOf(DecryptError)
  })

  it('refuses to seal a reply over the size cap', async () => {
    await expect(sealReply({ shareKey }, 's1', { ...payload, device: 'x'.repeat(2000) })).rejects.toBeInstanceOf(TooLargeError)
  })

  it('returns only the known reply fields', async () => {
    const sealed = await sealJson(shareKey, 'organiz/reply/v1:s1', { ...payload, extra: 'x' }, 1000)
    expect(await openReply({ shareKey }, 's1', sealed)).toEqual(payload)
  })

  it('round-trips the signed fields of a personal reply and checks sentAt', async () => {
    const personal: ReplyPayload = { ...payload, via: 'personal', mac: 'm'.repeat(43), sentAt: 1_700_000_000_000 }
    expect(await openReply({ shareKey }, 's1', await sealReply({ shareKey }, 's1', personal))).toEqual(personal)
    const bad = await sealJson(shareKey, 'organiz/reply/v1:s1', { ...personal, sentAt: '5' }, 1000)
    await expect(openReply({ shareKey }, 's1', bad)).rejects.toBeInstanceOf(DecryptError)
  })

  it('rejects a bad ephemeral key and a bad organizer public key', async () => {
    const sealed = await sealReply({ shareKey }, 's1', payload)
    const organizer = await importOrganizerKey((await generateOrganizerKeys()).privateKey)
    await expect(openReply({ shareKey, privateKey: organizer }, 's1', { ...sealed, epk: 'AAAA' })).rejects.toBeInstanceOf(DecryptError)
    await expect(sealReply({ publicKey: 'not json' }, 's1', payload)).rejects.toBeInstanceOf(DecryptError)
  })
})
