import { describe, expect, it, vi } from 'vitest'
import type { PowTask } from '../storage/powClient'
import { createPreparation } from './usePreparedDashboard'

/** A proof of work the test settles by hand. */
function fakePow() {
  const tasks: { docId: string; resolve(nonce: string): void; reject(error: Error): void; cancel: () => void }[] = []
  const startPow = vi.fn((docId: string): PowTask => {
    const cancel = vi.fn()
    const result = new Promise<string>((resolve, reject) => tasks.push({ docId, resolve, reject, cancel }))
    return { result, cancel }
  })
  return { startPow, tasks }
}

const ids = () => {
  let count = 0
  return vi.fn(async () => `doc-${++count}`)
}

const turn = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createPreparation', () => {
  it('prepares one id and one proof of work, however often it is asked', async () => {
    const newDocId = ids()
    const { startPow, tasks } = fakePow()
    const preparation = createPreparation(newDocId, startPow)
    const first = preparation.prepare()
    preparation.prepare()
    await turn()
    tasks[0].resolve('n1')
    expect(await first).toEqual({ docId: 'doc-1', nonce: 'n1' })
    expect(await preparation.prepare()).toEqual({ docId: 'doc-1', nonce: 'n1' })
    expect(newDocId).toHaveBeenCalledTimes(1)
    expect(startPow).toHaveBeenCalledTimes(1)
  })

  it('starts over after a failed proof of work, without an unhandled rejection meanwhile', async () => {
    const { startPow, tasks } = fakePow()
    const preparation = createPreparation(ids(), startPow)
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      preparation.prepare()
      await turn()
      tasks[0].reject(new Error('worker crashed'))
      for (let i = 0; i < 3; i++) await turn()
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }

    const retry = preparation.prepare()
    await turn()
    tasks[1].resolve('n2')
    expect(await retry).toEqual({ docId: 'doc-2', nonce: 'n2' })
  })

  it('forgets a finished preparation when cancelled, so a failed create is retried with a new id', async () => {
    const { startPow, tasks } = fakePow()
    const preparation = createPreparation(ids(), startPow)
    preparation.prepare()
    await turn()
    tasks[0].resolve('n1')
    expect(await preparation.prepare()).toEqual({ docId: 'doc-1', nonce: 'n1' })
    preparation.cancel()

    const retry = preparation.prepare()
    await turn()
    tasks[1].resolve('n2')
    expect(await retry).toEqual({ docId: 'doc-2', nonce: 'n2' })
  })

  it('never starts the work when cancelled before the id is known', async () => {
    const { startPow } = fakePow()
    const preparation = createPreparation(ids(), startPow)
    preparation.prepare()
    preparation.cancel()
    await turn()
    expect(startPow).not.toHaveBeenCalled()
  })

  it('cancels the running work, and prepares afresh when asked again', async () => {
    const { startPow, tasks } = fakePow()
    const preparation = createPreparation(ids(), startPow)
    preparation.prepare()
    await turn()
    preparation.cancel()
    expect(tasks[0].cancel).toHaveBeenCalled()

    const again = preparation.prepare()
    await turn()
    tasks[1].resolve('n2')
    expect(await again).toEqual({ docId: 'doc-2', nonce: 'n2' })
  })
})
