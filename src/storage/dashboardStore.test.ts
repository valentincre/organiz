import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { addPerson, emptyState } from '../domain/mutations'
import type { DashboardState } from '../domain/types'

// The emulator cannot make a listener fail, so Firestore is replaced here: each
// `onSnapshot` call is recorded with its error callback.
const listeners = vi.hoisted(() => [] as { onNext: (snap: unknown) => void; onError: (error: unknown) => void }[])

vi.mock('firebase/firestore', () => ({
  Bytes: { fromUint8Array: (bytes: Uint8Array) => bytes },
  doc: () => ({}),
  getDocFromServer: vi.fn(),
  onSnapshot: (_ref: unknown, onNext: (snap: unknown) => void, onError: (error: unknown) => void) => {
    listeners.push({ onNext, onError })
    return () => {}
  },
  serverTimestamp: () => null,
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
}))

const { getDocFromServer, updateDoc } = await import('firebase/firestore')
const { DashboardSession } = await import('./dashboardStore')
const { generateKeyString } = await import('./crypto')
const { sealState } = await import('./envelope')
const { deriveEditKeys } = await import('./keys')

beforeEach(() => {
  listeners.length = 0
  vi.mocked(getDocFromServer).mockReset()
  vi.mocked(updateDoc).mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('listens again on resume after the listener failed', async () => {
  const session = new DashboardSession({} as never, { docId: 'AAAAAAAAAAAAAAAAAAAAAA', key: generateKeyString(), access: 'edit' })
  await session.start()
  expect(listeners).toHaveLength(1)

  listeners[0].onError(new Error('unavailable'))
  expect(session.getSnapshot().loadError).toBe('network')

  session.resume()
  expect(listeners).toHaveLength(2)
  session.stop()
})

const DOC_ID = 'AAAAAAAAAAAAAAAAAAAAAA'

/** A server document at `rev`, sealed like the session does. */
async function serverDoc(key: string, state: DashboardState, rev: number) {
  const { encKey } = await deriveEditKeys(key, DOC_ID)
  const { iv, ct } = await sealState(encKey, DOC_ID, state)
  const data = { v: 2, iv, ct: { toUint8Array: () => ct }, rev }
  return { exists: () => true, data: () => data, metadata: { hasPendingWrites: false, fromCache: false } }
}

const denied = () => Object.assign(new Error('denied'), { code: 'permission-denied' })

/**
 * A session loaded at revision 3 saves an edit while another organizer takes revision 4:
 * the write is denied, then the server reads return `serverReads` (revision numbers) in turn.
 */
async function lostRace(serverReads: number[]) {
  const key = generateKeyString()
  const session = new DashboardSession({} as never, { docId: DOC_ID, key, access: 'edit' })
  await session.start()
  listeners[0].onNext(await serverDoc(key, emptyState('Club'), 3))
  await vi.waitFor(() => expect(session.getSnapshot().confirmed).toBe(true))

  const other = addPerson('bob', 'Bob')(emptyState('Club'))
  vi.mocked(updateDoc).mockRejectedValueOnce(denied()).mockResolvedValue(undefined)
  for (const rev of serverReads) {
    vi.mocked(getDocFromServer).mockResolvedValueOnce((await serverDoc(key, rev === 3 ? emptyState('Club') : other, rev)) as never)
  }
  vi.spyOn(console, 'error').mockImplementation(() => {})

  session.mutate(addPerson('alice', 'Alice'), { now: true })
  return session
}

const writtenRevs = () => vi.mocked(updateDoc).mock.calls.map(([, data]) => (data as unknown as { rev: number }).rev)

it('rebases a save that lost the revision race even when the first server read is stale', async () => {
  // The denial can arrive before the other organizer's revision 4 reaches the read.
  const session = await lostRace([3, 4])
  await vi.waitFor(() => expect(session.getSnapshot().saving).toBe(false))
  expect(session.getSnapshot().saveError).toBeNull()
  expect(writtenRevs()).toEqual([4, 5])
  expect(Object.values(session.getSnapshot().state!.people).map((p) => p.name).sort()).toEqual(['Alice', 'Bob'])
  session.stop()
})

it('still fails the save when the server keeps showing the revision before the denied one', async () => {
  vi.useFakeTimers()
  const session = await lostRace(Array(10).fill(3))
  await vi.waitFor(() => expect(session.getSnapshot().saveError).toBe('failed'), { timeout: 10_000 })
  expect(writtenRevs()).toEqual([4])
  session.stop()
})
