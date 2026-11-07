import { describe, expect, it } from 'vitest'
import { describeHubBackend } from './hubBackendContract'
import { MemoryHubBackend } from './memoryHubs'

const sealed = { iv: 'abcdefghijklmnop', ct: new Uint8Array([1, 2, 3]) }

describeHubBackend(() => new MemoryHubBackend())

describe('MemoryHubBackend', () => {
  it('calls watchers synchronously, once when they start and after each change', async () => {
    const backend = new MemoryHubBackend()
    const revs: (number | null)[] = []
    const stop = backend.watchHub('h', (hub) => revs.push(hub?.rev ?? null), () => {})
    expect(revs).toEqual([null])
    const pending = backend.createHub('h', sealed, { nonce: 'n', next: 'n' })
    expect(revs).toEqual([null, 1])
    await pending
    stop()
    await backend.updateHub('h', sealed, { rev: 2, proof: 'p', next: 'n' })
    expect(revs).toEqual([null, 1])
  })

  it('refuses to update a missing hub', async () => {
    await expect(new MemoryHubBackend().updateHub('h', sealed, { rev: 2, proof: 'p', next: 'n' })).rejects.toThrow()
  })
})
