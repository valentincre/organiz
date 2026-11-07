import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildDemoState } from '../demo/demoData'
import { emptyState } from '../domain/mutations'
import type { DashboardState } from '../domain/types'
import { encodeBase64Url } from './base64url'
import { DecryptError, NewerVersionError } from './crypto'
import { MAX_PLAINTEXT_BYTES, openState, sealRawForTest, sealState, TooLargeError } from './envelope'
import { deriveEditKeys, importReadKey, type EditKeys } from './keys'

const S = encodeBase64Url(new Uint8Array(32).fill(7))
const DOC = 'AAAAAAAAAAAAAAAAAAAAAA'
const OTHER_DOC = 'BBBBBBBBBBBBBBBBBBBBBB'

let keys: EditKeys
beforeAll(async () => {
  keys = await deriveEditKeys(S, DOC)
})

afterEach(() => vi.restoreAllMocks())

/** A valid state whose JSON is exactly `bytes` long: people carrying long text values. */
function stateOfSize(bytes: number): DashboardState {
  const count = 1500
  const people: DashboardState['people'] = {}
  for (let i = 0; i < count; i++) people[`p${String(i).padStart(4, '0')}`] = { name: 'P', createdAt: 0, values: { a: '', b: '' } }
  const state = { ...emptyState('Club'), people }
  // Characters left to spread over the empty values, each within LIMITS.textValue.
  const text = bytes - JSON.stringify(state).length
  Object.values(people).forEach((person, i) => {
    const own = Math.floor(text / count) + (i < text % count ? 1 : 0)
    const half = Math.ceil(own / 2)
    person.values = { a: 'x'.repeat(half), b: 'x'.repeat(own - half) }
  })
  return state
}

describe('envelope', () => {
  it('round-trips a state', async () => {
    const state = buildDemoState('Club', '2026-10-20', 'en')
    expect(await openState(keys.encKey, DOC, await sealState(keys.encKey, DOC, state))).toEqual(state)
  })

  it('compresses the demo to less than a fifth of its JSON', async () => {
    const state = buildDemoState('Club', '2026-10-20', 'en')
    const { ct } = await sealState(keys.encKey, DOC, state)
    expect(ct.byteLength).toBeLessThan(JSON.stringify(state).length / 5)
  })

  it('refuses data moved to another dashboard', async () => {
    const sealed = await sealState(keys.encKey, DOC, emptyState('Club'))
    await expect(openState(keys.encKey, OTHER_DOC, sealed)).rejects.toBeInstanceOf(DecryptError)
  })

  it('opens with the read key derived for readers', async () => {
    const sealed = await sealState(keys.encKey, DOC, emptyState('Club'))
    const readKey = await importReadKey(keys.encKeyString)
    expect((await openState(readKey, DOC, sealed)).name).toBe('Club')
  })

  it('rejects data that is not valid JSON or not a dashboard', async () => {
    for (const plaintext of ['not json', JSON.stringify({ v: 3 })]) {
      const sealed = await sealRawForTest(keys.encKey, DOC, plaintext)
      await expect(openState(keys.encKey, DOC, sealed)).rejects.toBeInstanceOf(DecryptError)
    }
  })

  it('rejects a tampered ciphertext', async () => {
    const sealed = await sealState(keys.encKey, DOC, emptyState('Club'))
    sealed.ct[0] ^= 1
    await expect(openState(keys.encKey, DOC, sealed)).rejects.toBeInstanceOf(DecryptError)
  })

  it('rejects data that expands beyond 5 MB', async () => {
    // A valid ciphertext of gzip(6 MB of spaces), built with the module's own helpers:
    // `sealState` would refuse it, but a modified client could store it.
    const bomb = await sealRawForTest(keys.encKey, DOC, ' '.repeat(6_000_000))
    expect(bomb.ct.byteLength).toBeLessThan(100_000)
    const cancel = vi.spyOn(ReadableStreamDefaultReader.prototype, 'cancel')
    await expect(openState(keys.encKey, DOC, bomb)).rejects.toBeInstanceOf(DecryptError)
    // The decompression stream was abandoned, not read to the end.
    expect(cancel).toHaveBeenCalled()
  })

  it('seals a state up to the readers\' decompression cap, and refuses one byte more', async () => {
    const atCap = stateOfSize(MAX_PLAINTEXT_BYTES)
    expect(new TextEncoder().encode(JSON.stringify(atCap)).byteLength).toBe(MAX_PLAINTEXT_BYTES)
    const sealed = await sealState(keys.encKey, DOC, atCap)
    // Far below the ciphertext limit: only the plaintext cap can refuse the next one.
    expect(sealed.ct.byteLength).toBeLessThan(100_000)
    expect(await openState(keys.encKey, DOC, sealed)).toEqual(atCap)

    await expect(sealState(keys.encKey, DOC, stateOfSize(MAX_PLAINTEXT_BYTES + 1))).rejects.toBeInstanceOf(TooLargeError)
  })

  it('counts the cap in UTF-8 bytes, not characters', async () => {
    const state = stateOfSize(MAX_PLAINTEXT_BYTES)
    const [first] = Object.values(state.people)
    // Same length in characters, one byte more in UTF-8.
    first.values = { ...first.values, a: `é${String(first.values!.a).slice(1)}` }
    await expect(sealState(keys.encKey, DOC, state)).rejects.toBeInstanceOf(TooLargeError)
  })

  it('reports a newer state version', async () => {
    const sealed = await sealRawForTest(keys.encKey, DOC, JSON.stringify({ v: 99 }))
    await expect(openState(keys.encKey, DOC, sealed)).rejects.toBeInstanceOf(NewerVersionError)
  })
})
