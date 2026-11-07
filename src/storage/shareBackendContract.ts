import { beforeAll, describe, expect, it } from 'vitest'
import { solvePow } from './pow'
import { commitmentOf, deriveEditKeys, shareProofFor, type EditKeys } from './keys'
import {
  ShareClosedError,
  ShareExistsError,
  type ShareBackend,
  type ShareWrite,
  type StoredReply,
} from './shareBackend'
import type { SealedReply } from './shareCrypto'

const SHARE_ID = 'CCCCCCCCCCCCCCCCCCCCCC'
const SECRET = 'A'.repeat(43)

const sealed = (byte: number) => ({ iv: 'abcdefghijklmnop', ct: new Uint8Array([byte, 2, 3]) })
const reply = (byte: number): SealedReply => sealed(byte)
const write = (overrides: Partial<ShareWrite> = {}): ShareWrite => ({
  sealed: sealed(1),
  closesAt: null,
  closed: false,
  foldedUpTo: null,
  ...overrides,
})
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Waits for the first page of a replies listener that comes from the server. */
function repliesSince(backend: ShareBackend, since: number): Promise<StoredReply[]> {
  return new Promise((resolve, reject) => {
    // Some backends call back before returning the unsubscribe function.
    let stop: (() => void) | undefined
    let first: StoredReply[] | undefined
    stop = backend.watchReplies(SHARE_ID, since, (replies, { fromServer }) => {
      if (first || !fromServer) return
      first = replies
      stop?.()
      resolve(replies)
    }, reject)
    if (first) stop()
  })
}

/** Runs `check` on the replies each time they change, until it stops throwing. */
async function eventually<T>(read: () => Promise<T>, check: (value: T) => void): Promise<void> {
  const deadline = Date.now() + 4000
  for (;;) {
    const value = await read()
    try {
      check(value)
      return
    } catch (error) {
      if (Date.now() > deadline) throw error
      await sleep(50)
    }
  }
}

/** The behavior every share backend must have, whether it is Firestore or in memory. */
export function describeShareBackend(make: () => ShareBackend): void {
  describe('share backend', () => {
    let keys: EditKeys
    let nonce: string
    const create = async (backend: ShareBackend, overrides: Partial<ShareWrite> = {}) =>
      backend.createShare(SHARE_ID, write(overrides), {
        nonce,
        next: await commitmentOf(await shareProofFor(keys.writeKey, SHARE_ID, 2)),
      })
    /** Revision `rev`: reveals its proof and commits to the next one. */
    const update = async (backend: ShareBackend, rev: number, overrides: Partial<ShareWrite> = {}) =>
      backend.updateShare(SHARE_ID, write(overrides), {
        rev,
        proof: await shareProofFor(keys.writeKey, SHARE_ID, rev),
        next: await commitmentOf(await shareProofFor(keys.writeKey, SHARE_ID, rev + 1)),
      })

    beforeAll(async () => {
      keys = await deriveEditKeys(SECRET, SHARE_ID)
      nonce = solvePow(SHARE_ID)
    })

    it('creates, reads and updates a share', async () => {
      const backend = make()
      expect(await backend.readShare(SHARE_ID)).toBeNull()
      await create(backend)
      const first = await backend.readShare(SHARE_ID)
      expect(first).toMatchObject({ rev: 1, closesAt: null, closed: false, foldedUpTo: null })
      expect(first!.sealed.iv).toBe('abcdefghijklmnop')
      expect([...first!.sealed.ct]).toEqual([1, 2, 3])
      expect(await update(backend, 2, { sealed: sealed(9), closesAt: Date.now() + 60_000 })).toBe('ok')
      const second = await backend.readShare(SHARE_ID)
      expect(second!.rev).toBe(2)
      expect([...second!.sealed.ct]).toEqual([9, 2, 3])
      expect(second!.closesAt).toBeGreaterThan(Date.now())
    })

    it('reports a conflict on a stale revision', async () => {
      const backend = make()
      await create(backend)
      expect(await update(backend, 2)).toBe('ok')
      expect(await update(backend, 2, { sealed: sealed(7) })).toBe('conflict')
      expect((await backend.readShare(SHARE_ID))!.rev).toBe(2)
    })

    it('refuses a second create', async () => {
      const backend = make()
      await create(backend)
      await expect(create(backend)).rejects.toBeInstanceOf(ShareExistsError)
    })

    it('delivers share changes to a watcher', async () => {
      const backend = make()
      await create(backend)
      const seen: (number | null)[] = []
      const stop = backend.watchShare(SHARE_ID, (share) => seen.push(share?.rev ?? null), (error) => { throw error })
      await update(backend, 2)
      await eventually(async () => seen, (revs) => expect(revs.at(-1)).toBe(2))
      stop()
    })

    it('delivers replies since a time, oldest first', async () => {
      const backend = make()
      await create(backend)
      for (const byte of [1, 2, 3]) {
        await backend.addReply(SHARE_ID, byte === 2 ? { ...reply(byte), epk: 'B'.repeat(87) } : reply(byte))
        await sleep(5)
      }
      const all = await repliesSince(backend, 0)
      expect(all.map((r) => r.sealed.ct[0])).toEqual([1, 2, 3])
      expect(all[1]!.sealed.epk).toBe('B'.repeat(87))
      expect(all[0]!.sealed.epk).toBeUndefined()
      const fromSecond = await repliesSince(backend, all[1]!.createdAt)
      expect(fromSecond.map((r) => r.sealed.ct[0])).toEqual([2, 3])
    })

    it('rejects a reply once closed', async () => {
      const backend = make()
      await create(backend)
      await backend.addReply(SHARE_ID, reply(1))
      expect(await update(backend, 2, { closed: true })).toBe('ok')
      await expect(backend.addReply(SHARE_ID, reply(2))).rejects.toBeInstanceOf(ShareClosedError)
    })

    it('rejects a reply to a missing share', async () => {
      await expect(make().addReply(SHARE_ID, reply(1))).rejects.toBeInstanceOf(ShareClosedError)
    })

    it('deletes folded replies only, and ignores the rest', async () => {
      const backend = make()
      await create(backend)
      for (const byte of [1, 2]) {
        await backend.addReply(SHARE_ID, reply(byte))
        await sleep(5)
      }
      const [r1, r2] = await repliesSince(backend, 0)
      // Open share: nothing is folded, and the refusal is ignored.
      await backend.deleteReplies(SHARE_ID, [r1!.id, r2!.id])
      expect(await repliesSince(backend, 0)).toHaveLength(2)
      // Closed but not folded yet.
      await update(backend, 2, { closed: true })
      await backend.deleteReplies(SHARE_ID, [r1!.id])
      expect(await repliesSince(backend, 0)).toHaveLength(2)
      // Folded up to the first reply: only it goes, the other stays.
      await update(backend, 3, { closed: true, foldedUpTo: r1!.createdAt })
      await backend.deleteReplies(SHARE_ID, [r1!.id, r2!.id])
      expect((await repliesSince(backend, 0)).map((r) => r.id)).toEqual([r2!.id])
      // Deleting a reply that is already gone is ignored.
      await backend.deleteReplies(SHARE_ID, [r1!.id])
      // Folded up to the second one: the second goes too.
      await update(backend, 4, { closed: true, foldedUpTo: r2!.createdAt })
      await backend.deleteReplies(SHARE_ID, [r2!.id])
      expect(await repliesSince(backend, 0)).toEqual([])
    })
  })
}
