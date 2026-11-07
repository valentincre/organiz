import { describe, expect, it } from 'vitest'
import {
  addToCall,
  applyCheckIns,
  callScope,
  callSummary,
  finishMutation,
  isCallDraft,
  isUntouched,
  jumpTo,
  mark,
  previous,
  progress,
  pruneDraft,
  startCall,
  type CallDraft,
} from './call'
import { addEvent, addPerson, compose, deletePerson, emptyState, recordCall, setLeftOn, setReplies, setReply } from './mutations'
import { addProperty, setValue } from './properties'
import type { IncomingReply } from './replies'
import type { ShareEntry } from './types'

const people = ['a', 'b', 'c', 'd']
const base = compose(
  ...people.map((id, i) => addPerson(id, `Person ${id}`, i)),
  addPerson('z', 'Zoe', 9),
  addEvent('e1', '2026-10-10', {}, 1),
)(emptyState('Club'))

const fresh = () => startCall(base, 'e1', people, 100)

describe('callScope', () => {
  const withCategory = compose(
    addProperty('person', 'cat', 'choice', 'Category', [
      { id: 'u13', label: 'U13', color: 'blue' },
      { id: 'u15', label: 'U15', color: 'green' },
    ]),
    setValue('person', 'c', 'cat', 'u13'),
    setValue('person', 'a', 'cat', 'u13'),
    setValue('person', 'b', 'cat', 'u15'),
  )(base)

  it('lists everybody alphabetically without a filter', () => {
    expect(callScope(withCategory, 'en', [], withCategory.events.e1)).toEqual(['a', 'b', 'c', 'd', 'z'])
  })

  it('keeps the people matching the filter', () => {
    expect(callScope(withCategory, 'en', [{ type: 'options', propertyId: 'cat', optionIds: ['u13'] }], withCategory.events.e1)).toEqual(['a', 'c'])
  })

  it('leaves out the people who left before the event and keeps those who left that day', () => {
    const left = compose(setLeftOn('a', '2026-10-09'), setLeftOn('b', '2026-10-10'), setLeftOn('c', '2026-10-11'))(withCategory)
    expect(callScope(left, 'en', [], left.events.e1)).toEqual(['b', 'c', 'd', 'z'])
  })

  it('keeps a person who left but has a reply or a presence on the event, like the attendance sheet', () => {
    const left = compose(
      setLeftOn('a', '2026-10-01'),
      setLeftOn('b', '2026-10-01'),
      setLeftOn('c', '2026-10-01'),
      recordCall('e1', ['a'], [], 5),
      setReply('e1', 'b', 'no'),
    )(withCategory)
    expect(callScope(left, 'en', [], left.events.e1)).toEqual(['a', 'b', 'd', 'z'])
    // Covering everybody listed at the event is no filter.
    expect(startCall(left, 'e1', ['a', 'b', 'd', 'z'], 1).filtered).toBe(false)
  })
})

describe('startCall', () => {
  it('starts blank on the first person', () => {
    expect(fresh()).toEqual({
      v: 1,
      eventId: 'e1',
      scope: people,
      filtered: true,
      marks: {},
      history: [],
      current: 'a',
      startedAt: 100,
    })
  })

  it('is not filtered when it covers everybody, and ignores unknown or repeated ids', () => {
    const draft = startCall(base, 'e1', ['z', 'a', 'a', 'nope', 'b', 'c', 'd'], 1)
    expect(draft.scope).toEqual(['z', 'a', 'b', 'c', 'd'])
    expect(draft.filtered).toBe(false)
  })

  it('is not filtered when it covers everybody who had not left by the event', () => {
    const left = setLeftOn('z', '2026-10-01')(base)
    expect(startCall(left, 'e1', people, 1).filtered).toBe(false)
    // Left on the day of the event: still part of the group then.
    expect(startCall(setLeftOn('z', '2026-10-10')(base), 'e1', people, 1).filtered).toBe(true)
  })

  it('starts a redo from the presence already recorded', () => {
    const called = recordCall('e1', ['a', 'c'], ['b'], 50)(base)
    const draft = startCall(called, 'e1', people, 100)
    expect(draft.marks).toEqual({ a: 'present', b: 'absent', c: 'present' })
    // The first person without a mark is shown.
    expect(draft.current).toBe('d')
    expect(draft.history).toEqual([])
  })

  it('shows nobody when a redo starts with everybody marked', () => {
    const called = recordCall('e1', ['a', 'b'], ['c', 'd'], 50)(base)
    expect(startCall(called, 'e1', people, 100).current).toBeNull()
  })
})

describe('mark', () => {
  it('marks the shown person and moves on to the next one without a mark', () => {
    const one = mark(fresh(), 'a', 'present')
    expect(one).toMatchObject({ marks: { a: 'present' }, history: ['a'], current: 'b' })
    const two = mark(one, 'b', 'absent')
    expect(two).toMatchObject({ marks: { a: 'present', b: 'absent' }, history: ['a', 'b'], current: 'c' })
  })

  it('skips people already marked and wraps around', () => {
    let draft = mark(fresh(), 'c', 'present')
    // c was not the shown person: still on a.
    expect(draft.current).toBe('a')
    draft = jumpTo(draft, 'd')
    draft = mark(draft, 'd', 'absent')
    // After d, wrapping to the start: a is the first without a mark.
    expect(draft.current).toBe('a')
    draft = mark(draft, 'a', 'present')
    expect(draft.current).toBe('b')
    draft = mark(draft, 'b', 'present')
    expect(draft.current).toBeNull()
  })

  it('does not move the shown person when somebody else is marked, as from a list or a search', () => {
    const draft = mark(fresh(), 'c', 'absent')
    expect(draft.current).toBe('a')
    expect(draft.marks).toEqual({ c: 'absent' })
  })

  it('changes and clears a mark, keeping the history in marking order', () => {
    let draft = compose2(fresh(), ['a', 'present'], ['b', 'present'], ['a', 'absent'])
    expect(draft.marks).toEqual({ a: 'absent', b: 'present' })
    expect(draft.history).toEqual(['b', 'a'])
    draft = mark(draft, 'b', null)
    expect(draft.marks).toEqual({ a: 'absent' })
    expect(draft.history).toEqual(['a'])
  })

  it('shows somebody again when they are unmarked while everybody was marked', () => {
    let draft = compose2(fresh(), ['a', 'present'], ['b', 'present'], ['c', 'absent'], ['d', 'absent'])
    expect(draft.current).toBeNull()
    draft = mark(draft, 'c', null)
    expect(draft.current).toBe('c')
  })

  it('ignores people outside the call and identical marks', () => {
    const draft = fresh()
    expect(mark(draft, 'z', 'present')).toBe(draft)
    expect(mark(draft, 'b', null)).toBe(draft)
    const marked = mark(draft, 'b', 'present')
    expect(mark(marked, 'b', 'present')).toBe(marked)
  })

  it('moves on when the shown person, reached by jumping back, is marked again', () => {
    let draft = compose2(fresh(), ['a', 'present'], ['b', 'present'])
    draft = previous(draft)
    expect(draft.current).toBe('b')
    draft = mark(draft, 'b', 'present')
    expect(draft.current).toBe('c')
  })
})

function compose2(draft: CallDraft, ...steps: [string, 'present' | 'absent'][]): CallDraft {
  return steps.reduce((acc, [id, value]) => mark(acc, id, value), draft)
}

describe('previous and jumpTo', () => {
  it('goes back through the marking order', () => {
    let draft = compose2(fresh(), ['a', 'present'], ['b', 'absent'], ['c', 'present'])
    expect(draft.current).toBe('d')
    draft = previous(draft)
    expect(draft).toMatchObject({ current: 'c', history: ['a', 'b'] })
    // The mark stays until the person is marked again.
    expect(draft.marks.c).toBe('present')
    draft = previous(previous(draft))
    expect(draft).toMatchObject({ current: 'a', history: [] })
    expect(previous(draft)).toBe(draft)
  })

  it('jumps to anybody of the call', () => {
    const draft = fresh()
    expect(jumpTo(draft, 'c').current).toBe('c')
    expect(jumpTo(draft, 'a')).toBe(draft)
    expect(jumpTo(draft, 'z')).toBe(draft)
  })
})

describe('addToCall', () => {
  it('adds a newcomer at the end, present, without moving the shown person', () => {
    const draft = addToCall(fresh(), 'z')
    expect(draft).toMatchObject({ scope: [...people, 'z'], marks: { z: 'present' }, history: ['z'], current: 'a' })
  })

  it('marks present somebody already in the call', () => {
    const draft = addToCall(fresh(), 'c')
    expect(draft.scope).toEqual(people)
    expect(draft.marks).toEqual({ c: 'present' })
  })
})

describe('isUntouched', () => {
  it('is true for a blank call and a redo nobody changed, even after moving around', () => {
    expect(isUntouched(base, fresh())).toBe(true)
    expect(isUntouched(base, jumpTo(fresh(), 'c'))).toBe(true)
    const called = recordCall('e1', ['a', 'c'], ['b'], 50)(base)
    const redo = startCall(called, 'e1', people, 100)
    expect(isUntouched(called, redo)).toBe(true)
    expect(isUntouched(called, previous(jumpTo(redo, 'd')))).toBe(true)
  })

  it('is false once a mark differs from what is recorded, or somebody is added', () => {
    expect(isUntouched(base, mark(fresh(), 'a', 'present'))).toBe(false)
    expect(isUntouched(base, addToCall(fresh(), 'z'))).toBe(false)
    const called = recordCall('e1', ['a', 'c'], ['b'], 50)(base)
    const redo = startCall(called, 'e1', people, 100)
    expect(isUntouched(called, mark(redo, 'a', 'absent'))).toBe(false)
    expect(isUntouched(called, mark(redo, 'a', null))).toBe(false)
  })
})

describe('progress', () => {
  it('counts marks over the people of the call', () => {
    const draft = compose2(fresh(), ['a', 'present'], ['b', 'absent'], ['c', 'present'])
    expect(progress(draft)).toEqual({ marked: 3, present: 2, absent: 1, total: 4 })
    expect(progress(fresh())).toEqual({ marked: 0, present: 0, absent: 0, total: 4 })
  })
})

describe('callSummary', () => {
  const state = compose(setReplies('e1', ['a', 'b', 'c'], 'yes'), setReply('e1', 'd', 'no'))(base)

  it('counts the unmarked as absent and lists the gaps with the replies', () => {
    // a said yes and came; b said yes and is absent; c said yes and was not marked; d said no and came; z came and said nothing.
    let draft = startCall(state, 'e1', people, 1)
    draft = compose2(draft, ['a', 'present'], ['b', 'absent'], ['d', 'present'])
    draft = addToCall(draft, 'z')
    expect(callSummary(state, draft)).toEqual({
      present: 3,
      absent: 2,
      unmarked: 1,
      unannounced: ['d', 'z'],
      saidYesAbsent: ['b', 'c'],
    })
  })
})

describe('finishMutation', () => {
  it('records the marked as present and every other person of the call as absent', () => {
    const draft = compose2(fresh(), ['a', 'present'], ['b', 'absent'])
    const state = finishMutation(draft, 500)(base)
    expect(state.events.e1).toMatchObject({ calledAt: 500, present: ['a'], absent: ['b', 'c', 'd'] })
    // People outside the call are left alone.
    expect(state.events.e1.present).not.toContain('z')
    expect(state.events.e1.absent).not.toContain('z')
  })

  it('can be applied again, and merges with a concurrent call on other people', () => {
    const mine = finishMutation(compose2(fresh(), ['a', 'present']), 500)
    const theirs = recordCall('e1', ['z'], [], 400)
    const merged = mine(theirs(base))
    expect(merged.events.e1).toMatchObject({ calledAt: 500, present: ['a', 'z'], absent: ['b', 'c', 'd'] })
    expect(mine(merged)).toBe(merged)
  })
})

describe('pruneDraft', () => {
  it('returns the same draft when everybody still exists', () => {
    const draft = compose2(fresh(), ['a', 'present'])
    expect(pruneDraft(base, draft)).toBe(draft)
  })

  it('drops people who were deleted meanwhile and repairs the shown person', () => {
    const draft = compose2(fresh(), ['a', 'present'], ['b', 'absent'])
    expect(draft.current).toBe('c')
    const pruned = pruneDraft(deletePerson('c')(deletePerson('a')(base)), draft)
    expect(pruned).toMatchObject({ scope: ['b', 'd'], marks: { b: 'absent' }, history: ['b'], current: 'd' })
  })
})

describe('isCallDraft', () => {
  it('accepts a draft and rejects any other shape', () => {
    const draft = compose2(fresh(), ['a', 'present'])
    expect(isCallDraft(draft)).toBe(true)
    expect(isCallDraft({ ...draft, finishedAt: 5 })).toBe(true)
    expect(isCallDraft({ ...draft, checkedInUpTo: 12 })).toBe(true)
    expect(isCallDraft(JSON.parse(JSON.stringify(draft)))).toBe(true)
    for (const bad of [
      null,
      'draft',
      [],
      { ...draft, v: 2 },
      { ...draft, eventId: 'bad id' },
      { ...draft, scope: ['a', 3] },
      { ...draft, filtered: 'yes' },
      { ...draft, marks: { a: 'late' } },
      { ...draft, marks: { constructor: 'present' } },
      { ...draft, marks: ['present'] },
      { ...draft, current: 4 },
      { ...draft, startedAt: 'now' },
      { ...draft, finishedAt: Number.NaN },
      { ...draft, checkedInUpTo: 'x' },
    ]) {
      expect(isCallDraft(bad)).toBe(false)
    }
  })
})

describe('check-ins', () => {
  const checkIn = (id: string, createdAt: number, personId: string, answer: 'here' | 'notHere', via: 'shared' | 'personal' = 'shared'): IncomingReply => ({
    id,
    shareId: 's1',
    createdAt,
    personId,
    answer,
    device: 'd1',
    via,
  })
  it('applies check-ins newer than the draft', () => {
    const next = applyCheckIns(fresh(), [checkIn('a', 10, 'a', 'here'), checkIn('b', 20, 'b', 'here'), checkIn('c', 30, 'a', 'notHere')])
    expect(next.marks).toEqual({ b: 'present' })
    expect(next.checkedInUpTo).toBe(30)
    expect(applyCheckIns(next, [checkIn('a', 10, 'a', 'here')])).toBe(next)
  })
  it('applies in (createdAt, id) order whatever the input order', () => {
    const next = applyCheckIns(fresh(), [checkIn('c', 30, 'a', 'notHere'), checkIn('a', 10, 'a', 'here')])
    expect(next.marks).toEqual({})
  })
  it('does not re-apply a check-in after a hand mark', () => {
    const checked = applyCheckIns(fresh(), [checkIn('a', 10, 'a', 'here')])
    const corrected = mark(checked, 'a', 'absent')
    expect(applyCheckIns(corrected, [checkIn('a', 10, 'a', 'here')])).toBe(corrected)
    expect(applyCheckIns(corrected, [checkIn('a', 10, 'a', 'here'), checkIn('b', 40, 'a', 'here')]).marks.a).toBe('present')
  })
  it('adds a person outside the call scope who checks in', () => {
    const next = applyCheckIns(startCall(base, 'e1', ['a'], 100), [checkIn('a', 10, 'z', 'here')])
    expect(next.scope).toEqual(['a', 'z'])
    expect(next.marks).toEqual({ z: 'present' })
  })
  it('ignores a "not here" from outside the scope, and personal check-ins', () => {
    const next = applyCheckIns(startCall(base, 'e1', ['a'], 100), [checkIn('a', 10, 'z', 'notHere'), checkIn('b', 20, 'a', 'here', 'personal')])
    expect(next.scope).toEqual(['a'])
    expect(next.marks).toEqual({})
  })
  it('finishing settles the call link with the check-ins it applied', () => {
    const callShare: ShareEntry = { eventId: 'e1', kind: 'call', key: 'k', visibility: 'public', autoClose: false, closesAt: null, closed: false, createdAt: 1, mergedUpTo: 0 }
    const state = { ...base, shares: { s1: callShare } }
    const draft = { ...fresh(), checkedInUpTo: 30 }
    const done = finishMutation(draft, 100)(state)
    expect(done.shares!.s1).toMatchObject({ finished: true, closed: true, mergedUpTo: 30 })
    expect(finishMutation(draft, 100)(done)).toBe(done)
  })
})
