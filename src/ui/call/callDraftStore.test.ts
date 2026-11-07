import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startCall } from '../../domain/call'
import { addEvent, addPerson, compose, emptyState } from '../../domain/mutations'
import { readCallDraft, removeCallDraft, saveCallDraft } from './callDraftStore'

const DOC = 'A'.repeat(22)
const state = compose(addPerson('a', 'Alice'), addPerson('b', 'Bob'), addEvent('e1', '2026-10-10'))(emptyState('Club'))
const draft = startCall(state, 'e1', ['a', 'b'], 100)

class FakeStorage {
  values = new Map<string, string>()
  broken = false
  get length() {
    return this.values.size
  }
  key = (index: number) => [...this.values.keys()][index] ?? null
  getItem = (key: string) => this.values.get(key) ?? null
  setItem = (key: string, value: string) => {
    if (this.broken) throw new Error('quota')
    this.values.set(key, value)
  }
  removeItem = (key: string) => void this.values.delete(key)
}

let storage: FakeStorage

beforeEach(() => {
  storage = new FakeStorage()
  vi.stubGlobal('localStorage', storage)
})

afterEach(() => {
  removeCallDraft(DOC, 'e1')
  removeCallDraft('demo', 'e1')
  vi.unstubAllGlobals()
})

describe('call draft store', () => {
  it('stores a draft under the document id and event id, and reads it back', () => {
    saveCallDraft(DOC, draft)
    expect([...storage.values.keys()]).toEqual([`organiz.call.${DOC}.e1`])
    expect(readCallDraft(DOC, 'e1')).toEqual(draft)
    // Nothing identifying the people beyond their ids.
    expect(storage.getItem(`organiz.call.${DOC}.e1`)).not.toContain('Alice')
    removeCallDraft(DOC, 'e1')
    expect(readCallDraft(DOC, 'e1')).toBeNull()
    expect(storage.values.size).toBe(0)
  })

  it('reads the same object twice', () => {
    saveCallDraft(DOC, draft)
    expect(readCallDraft(DOC, 'e1')).toBe(readCallDraft(DOC, 'e1'))
  })

  it('ignores what is not a draft', () => {
    storage.setItem(`organiz.call.${DOC}.e1`, '{"v":1}')
    expect(readCallDraft(DOC, 'e1')).toBeNull()
    storage.setItem(`organiz.call.${DOC}.e1`, 'not json')
    expect(readCallDraft(DOC, 'e1')).toBeNull()
  })

  it('keeps the draft in memory when the storage refuses it', () => {
    storage.broken = true
    saveCallDraft(DOC, draft)
    expect(storage.values.size).toBe(0)
    expect(readCallDraft(DOC, 'e1')).toEqual(draft)
    removeCallDraft(DOC, 'e1')
    expect(readCallDraft(DOC, 'e1')).toBeNull()
  })

  it('keeps working without any storage', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    })
    saveCallDraft(DOC, draft)
    expect(readCallDraft(DOC, 'e1')).toEqual(draft)
  })

  it('never stores the demo draft on the device', () => {
    saveCallDraft('demo', draft)
    expect(storage.values.size).toBe(0)
    expect(readCallDraft('demo', 'e1')).toEqual(draft)
  })
})
