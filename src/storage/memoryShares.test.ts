import { describe, expect, it } from 'vitest'
import { MemoryShareBackend } from './memoryShares'
import { ShareClosedError, type ShareWrite } from './shareBackend'
import { describeShareBackend } from './shareBackendContract'

const sealed = { iv: 'abcdefghijklmnop', ct: new Uint8Array([1, 2, 3]) }
const open: ShareWrite = { sealed, closesAt: null, closed: false, foldedUpTo: null }
const auth = (rev: number) => ({ rev, proof: 'p', next: 'n' })

describeShareBackend(() => {
  let t = 1_000
  return new MemoryShareBackend({ now: () => t++ })
})

describe('MemoryShareBackend rules', () => {
  it('refuses replies once closesAt has passed', async () => {
    let t = 1_000
    const backend = new MemoryShareBackend({ now: () => t })
    await backend.createShare('s', { ...open, closesAt: 2_000 }, { nonce: 'n', next: 'n' })
    await backend.addReply('s', sealed)
    t = 2_000
    await expect(backend.addReply('s', sealed)).rejects.toBeInstanceOf(ShareClosedError)
  })

  it('never reopens a closed share', async () => {
    const backend = new MemoryShareBackend({ now: () => 1 })
    await backend.createShare('s', open, { nonce: 'n', next: 'n' })
    await backend.updateShare('s', { ...open, closed: true }, auth(2))
    await expect(backend.updateShare('s', open, auth(3))).rejects.toThrow()
  })

  it('refuses a share created closed', async () => {
    const backend = new MemoryShareBackend({ now: () => 1 })
    await expect(backend.createShare('s', { ...open, closed: true }, { nonce: 'n', next: 'n' })).rejects.toThrow()
  })

  it('calls listeners synchronously after each change', async () => {
    const backend = new MemoryShareBackend({ now: () => 5 })
    await backend.createShare('s', open, { nonce: 'n', next: 'n' })
    const counts: number[] = []
    backend.watchReplies('s', 0, (replies) => counts.push(replies.length), () => {})
    expect(counts).toEqual([0])
    const pending = backend.addReply('s', sealed)
    expect(counts).toEqual([0, 1])
    await pending
  })
})
