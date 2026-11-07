import { describe, expect, it } from 'vitest'
import { startCall } from '../../domain/call'
import { addEvent, addPerson, compose, emptyState } from '../../domain/mutations'
import { draftSyncSteps } from './useCallDraftSync'

const state = compose(addPerson('a', 'Alice'), addEvent('e1', '2026-10-10'))(emptyState('Club'))
const open = startCall(state, 'e1', ['a'], 100)
const finished = { ...open, finishedAt: 200 }
const editor = { canEdit: true, written: new Set<string>(), settled: true }

describe('draftSyncSteps', () => {
  it('writes a finished call once, then deletes its draft when the save is settled', () => {
    const entries = [{ eventId: 'e1', draft: finished }]
    expect(draftSyncSteps(entries, state, editor)).toEqual([{ kind: 'finish', key: 'e1:200', draft: finished, finishedAt: 200 }])
    const written = new Set(['e1:200'])
    expect(draftSyncSteps(entries, state, { ...editor, written, settled: false })).toEqual([])
    expect(draftSyncSteps(entries, state, { ...editor, written })).toEqual([{ kind: 'remove', eventId: 'e1' }])
  })

  it('deletes unreadable drafts and drafts of missing events, and keeps calls in progress', () => {
    const entries = [
      { eventId: 'e1', draft: open },
      { eventId: 'gone', draft: { ...open, eventId: 'gone' } },
      { eventId: 'bad', draft: null },
    ]
    expect(draftSyncSteps(entries, state, editor)).toEqual([
      { kind: 'remove', eventId: 'gone' },
      { kind: 'remove', eventId: 'bad' },
    ])
  })

  it('leaves the device drafts alone on a read link or before the state is known', () => {
    const entries = [
      { eventId: 'e1', draft: finished },
      { eventId: 'gone', draft: { ...open, eventId: 'gone' } },
      { eventId: 'bad', draft: null },
    ]
    expect(draftSyncSteps(entries, state, { ...editor, canEdit: false })).toEqual([])
    expect(draftSyncSteps(entries, state, { ...editor, canEdit: false, written: new Set(['e1:200']) })).toEqual([])
    expect(draftSyncSteps(entries, null, editor)).toEqual([])
  })
})
