import { describe, expect, it } from 'vitest'
import type { HubContent } from '../domain/hub'
import type { ShareSnapshot } from '../domain/shareSnapshot'
import { DecryptError, generateKeyString } from '../storage/crypto'
import { sealHub } from '../storage/hubCrypto'
import { MemoryShareBackend } from '../storage/memoryShares'
import { verifyReply } from '../storage/personalCrypto'
import { ShareClosedError, type StoredReply } from '../storage/shareBackend'
import { generateOrganizerKeys, importOrganizerKey, importShareKey, openReply, sealSnapshot } from '../storage/shareCrypto'
import { loadPersonalShare, openPersonalHub, personalAnswer, sendPersonalReply } from './personal'

const HUB = 'H'.repeat(22)
const NOW = 1_800_000_000_000
const DEVICE = 'D'.repeat(22)

const snapshot: ShareSnapshot = {
  v: 1,
  kind: 'presence',
  visibility: 'public',
  dashboard: 'Club',
  event: { name: 'Training', date: '2026-11-02', properties: [] },
  people: [
    { id: 'p1', name: 'Ann', locked: true },
    { id: 'p2', name: 'Bob' },
  ],
  answers: { p2: 'yes' },
  at: 0,
}

const write = (sealed: Awaited<ReturnType<typeof sealSnapshot>>, extra: { closesAt?: number | null; closed?: boolean } = {}) => ({
  sealed,
  closesAt: extra.closesAt ?? null,
  closed: extra.closed ?? false,
  foldedUpTo: null,
})

/** A share in a memory backend, with its key string. */
async function share(backend: MemoryShareBackend, shareId: string, value: ShareSnapshot = snapshot, extra: { closesAt?: number | null } = {}) {
  const key = generateKeyString()
  await backend.createShare(shareId, write(await sealSnapshot(await importShareKey(key), shareId, value), extra), { nonce: '', next: '' })
  return key
}

const repliesOf = (backend: MemoryShareBackend, shareId: string): StoredReply[] => {
  let list: StoredReply[] = []
  backend.watchReplies(shareId, 0, (replies) => (list = replies))()
  return list
}

describe('personal page', () => {
  describe('openPersonalHub', () => {
    const content: HubContent = {
      v: 1,
      shares: [{ shareId: 's1', key: 'K'.repeat(43) }],
      people: { p1: { name: 'Ann', replies: { s1: { answer: 'yes', at: 5 } } } },
    }

    it("opens the person's entry and the listed links", async () => {
      const hubKey = await importShareKey(generateKeyString())
      const secret = generateKeyString()
      const sealed = await sealHub(hubKey, HUB, content, { p1: secret })
      expect(await openPersonalHub(hubKey, HUB, 'p1', secret, sealed)).toEqual({
        status: 'ready',
        person: { name: 'Ann', replies: { s1: { answer: 'yes', at: 5 } } },
        shares: content.shares,
      })
    })

    it('says revoked without an entry for the person, or with another secret', async () => {
      const hubKey = await importShareKey(generateKeyString())
      const secret = generateKeyString()
      const sealed = await sealHub(hubKey, HUB, content, { p1: secret })
      expect(await openPersonalHub(hubKey, HUB, 'p2', secret, sealed)).toEqual({ status: 'revoked' })
      expect(await openPersonalHub(hubKey, HUB, 'p1', generateKeyString(), sealed)).toEqual({ status: 'revoked' })
    })

    it('rejects a hub that the hub key does not open', async () => {
      const secret = generateKeyString()
      const sealed = await sealHub(await importShareKey(generateKeyString()), HUB, content, { p1: secret })
      await expect(openPersonalHub(await importShareKey(generateKeyString()), HUB, 'p1', secret, sealed)).rejects.toBeInstanceOf(DecryptError)
    })
  })

  describe('loadPersonalShare', () => {
    it('reads and opens an open presence link', async () => {
      const backend = new MemoryShareBackend({ now: () => NOW })
      const key = await share(backend, 's1', snapshot, { closesAt: NOW + 1000 })
      const loaded = await loadPersonalShare(backend, 's1', key, NOW)
      expect(loaded).toMatchObject({ shareId: 's1', snapshot, closesAt: NOW + 1000 })
    })

    it('leaves out missing, closed, past, unreadable and roll-call links', async () => {
      const backend = new MemoryShareBackend({ now: () => NOW })
      expect(await loadPersonalShare(backend, 'nope', generateKeyString(), NOW)).toBeNull()

      const closedKey = await share(backend, 'closed')
      const stored = (await backend.readShare('closed'))!
      await backend.updateShare('closed', write(stored.sealed, { closed: true }), { rev: 2, proof: '', next: '' })
      expect(await loadPersonalShare(backend, 'closed', closedKey, NOW)).toBeNull()

      const pastKey = await share(backend, 'past', snapshot, { closesAt: NOW })
      expect(await loadPersonalShare(backend, 'past', pastKey, NOW)).toBeNull()

      await share(backend, 'other')
      expect(await loadPersonalShare(backend, 'other', generateKeyString(), NOW)).toBeNull()

      const callKey = await share(backend, 'call', { ...snapshot, kind: 'call', present: [] })
      expect(await loadPersonalShare(backend, 'call', callKey, NOW)).toBeNull()
    })
  })

  describe('personalAnswer', () => {
    it("takes this device's answer when newer than the hub's, else the hub's", () => {
      const hub = { answer: 'yes' as const, at: 100 }
      expect(personalAnswer(undefined, undefined)).toBeNull()
      expect(personalAnswer(hub, undefined)).toBe('yes')
      expect(personalAnswer(hub, { personId: 'p1', answer: 'no', at: 101 })).toBe('no')
      expect(personalAnswer(hub, { personId: 'p1', answer: 'no', at: 100 })).toBe('yes')
      expect(personalAnswer(hub, { personId: 'p1', answer: 'none', at: 101 })).toBeNull()
      expect(personalAnswer(undefined, { personId: 'p1', answer: 'no', at: 1 })).toBe('no')
      // Check-ins are not answers to a presence link.
      expect(personalAnswer(hub, { personId: 'p1', answer: 'here', at: 101 })).toBe('yes')
    })
  })

  describe('sendPersonalReply', () => {
    it('seals a signed reply with the share key on a public link', async () => {
      const backend = new MemoryShareBackend({ now: () => NOW })
      const key = await share(backend, 's1')
      const secret = generateKeyString()
      const loaded = (await loadPersonalShare(backend, 's1', key, NOW))!
      await sendPersonalReply(backend, loaded, 'p1', secret, 'no', DEVICE, NOW - 5)

      const [stored] = repliesOf(backend, 's1')
      expect(stored.sealed.epk).toBeUndefined()
      const payload = await openReply({ shareKey: loaded.shareKey }, 's1', stored.sealed)
      expect(payload).toMatchObject({ personId: 'p1', answer: 'no', device: DEVICE, via: 'personal', sentAt: NOW - 5 })
      const fields = { shareId: 's1', personId: 'p1', answer: 'no' as const, device: DEVICE, sentAt: NOW - 5 }
      expect(await verifyReply(secret, fields, payload.mac!)).toBe(true)
    })

    it("seals to the organizers' public key on a private link", async () => {
      const backend = new MemoryShareBackend({ now: () => NOW })
      const keys = await generateOrganizerKeys()
      const { answers: _answers, ...rest } = snapshot
      const key = await share(backend, 's1', { ...rest, visibility: 'private', publicKey: keys.publicKey })
      const secret = generateKeyString()
      const loaded = (await loadPersonalShare(backend, 's1', key, NOW))!
      await sendPersonalReply(backend, loaded, 'p1', secret, 'yes', DEVICE, NOW)

      const [stored] = repliesOf(backend, 's1')
      expect(stored.sealed.epk).toBeDefined()
      const payload = await openReply({ shareKey: loaded.shareKey, privateKey: await importOrganizerKey(keys.privateKey) }, 's1', stored.sealed)
      expect(payload).toMatchObject({ personId: 'p1', answer: 'yes', via: 'personal', sentAt: NOW })
      expect(await verifyReply(secret, { shareId: 's1', personId: 'p1', answer: 'yes', device: DEVICE, sentAt: NOW }, payload.mac!)).toBe(true)
    })

    it('rejects with ShareClosedError once the link closed', async () => {
      const backend = new MemoryShareBackend({ now: () => NOW })
      const key = await share(backend, 's1', snapshot, { closesAt: NOW + 10 })
      const loaded = (await loadPersonalShare(backend, 's1', key, NOW))!
      const late = new MemoryShareBackend({ now: () => NOW + 10 })
      await late.createShare('s1', write((await backend.readShare('s1'))!.sealed, { closesAt: NOW + 10 }), { nonce: '', next: '' })
      await expect(sendPersonalReply(late, loaded, 'p1', generateKeyString(), 'yes', DEVICE, NOW)).rejects.toBeInstanceOf(ShareClosedError)
    })
  })
})
