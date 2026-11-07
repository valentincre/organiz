import { afterEach, describe, expect, it, vi } from 'vitest'
import { isValidPow } from './pow'
import { startPow } from './powClient'

const DOC = 'AAAAAAAAAAAAAAAAAAAAAA'

/** Settles pending timers' promise callbacks, then tells whether `promise` has settled. */
const hasSettled = async (promise: Promise<unknown>) => {
  let settled = false
  promise.then(
    () => (settled = true),
    () => (settled = true),
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  return settled
}

/** A worker whose script fails to load, as on a network error. */
class FailingWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Partial<ErrorEvent>) => void) | null = null
  terminate = vi.fn()
  postMessage() {
    queueMicrotask(() => this.onerror?.({ message: 'Failed to load the worker' }))
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('startPow without workers', () => {
  it('finds a valid nonce on the main thread', async () => {
    expect(typeof Worker).toBe('undefined')
    expect(isValidPow(DOC, await startPow(DOC).result)).toBe(true)
  })

  it('never settles once cancelled', async () => {
    vi.useFakeTimers()
    const task = startPow(DOC)
    task.cancel()
    vi.runAllTimers()
    vi.useRealTimers()
    expect(await hasSettled(task.result)).toBe(false)
  })

  it('falls back to the main thread when a worker cannot be created', async () => {
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new DOMException('Workers are blocked', 'SecurityError')
        }
      },
    )
    expect(isValidPow(DOC, await startPow(DOC).result)).toBe(true)
  })
})

describe('startPow with a worker', () => {
  it('rejects when the worker fails, without an unhandled rejection before anyone awaits', async () => {
    vi.stubGlobal('Worker', FailingWorker)
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const task = startPow(DOC)
      // Node reports an unhandled rejection once the microtasks have run; leave it a few turns.
      for (let turn = 0; turn < 3; turn++) await new Promise((resolve) => setTimeout(resolve, 0))
      expect(unhandled).not.toHaveBeenCalled()
      await expect(task.result).rejects.toThrow('Failed to load the worker')
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })
})
