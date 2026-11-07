import { beforeEach, expect, it, vi } from 'vitest'

// The emulator cannot make a listener fail, so Firestore is replaced here: each
// `onSnapshot` call is recorded with its error callback.
const listeners = vi.hoisted(() => [] as { onError: (error: unknown) => void }[])

vi.mock('firebase/firestore', () => ({
  Bytes: { fromUint8Array: (bytes: Uint8Array) => bytes },
  doc: () => ({}),
  getDocFromServer: vi.fn(),
  onSnapshot: (_ref: unknown, _onNext: unknown, onError: (error: unknown) => void) => {
    listeners.push({ onError })
    return () => {}
  },
  serverTimestamp: () => null,
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
}))

const { DashboardSession } = await import('./dashboardStore')
const { generateKeyString } = await import('./crypto')

beforeEach(() => {
  listeners.length = 0
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
