import { describe, expect, it } from 'vitest'
import { canCall, hasStarted, countedCount, countedIds, eventTally, isCalled, isCounted, presenceOf, replyOf, statusCounts, statusMatcher } from './attendance'
import type { AppEvent } from './types'

const event = (patch: Partial<AppEvent> = {}): AppEvent => ({ date: '2026-10-10', name: '', createdAt: 0, ...patch })

describe('replyOf', () => {
  it('reads the reply of a person', () => {
    const e = event({ yes: ['a'], no: ['b'] })
    expect(replyOf(e, 'a')).toBe('yes')
    expect(replyOf(e, 'b')).toBe('no')
    expect(replyOf(e, 'c')).toBeUndefined()
    expect(replyOf(event(), 'a')).toBeUndefined()
  })
})

describe('presenceOf', () => {
  it('is only defined for people of a called event', () => {
    const called = event({ calledAt: 1, present: ['a'], absent: ['b'] })
    expect(presenceOf(called, 'a')).toBe(true)
    expect(presenceOf(called, 'b')).toBe(false)
    expect(presenceOf(called, 'c')).toBeUndefined()
    expect(presenceOf(event({ present: ['a'] }), 'a')).toBeUndefined()
    expect(isCalled(called)).toBe(true)
    expect(isCalled(event({ yes: ['a'] }))).toBe(false)
  })

  it('gives present precedence over absent if both lists hold a person', () => {
    expect(presenceOf(event({ calledAt: 1, present: ['a'], absent: ['a'] }), 'a')).toBe(true)
  })
})

describe('counting rule', () => {
  it('counts the "yes" before any call', () => {
    const e = event({ yes: ['a', 'b'], no: ['c'] })
    expect(countedIds(e)).toEqual(['a', 'b'])
    expect(countedCount(e)).toBe(2)
    expect(isCounted(e, 'a')).toBe(true)
    expect(isCounted(e, 'c')).toBe(false)
  })

  it('counts real presence after a call, whatever the reply', () => {
    // a said yes but is absent, c said no but came, d said nothing and came.
    const e = event({ yes: ['a', 'b'], no: ['c'], calledAt: 1, present: ['b', 'c', 'd'], absent: ['a'] })
    expect(countedIds(e)).toEqual(['b', 'c', 'd'])
    expect(['a', 'b', 'c', 'd', 'e'].map((id) => isCounted(e, id))).toEqual([false, true, true, true, false])
  })

  it('falls back to the reply for people left out of a filtered call', () => {
    const e = event({ yes: ['a', 'b', 'c'], calledAt: 1, present: ['a'], absent: ['b'] })
    expect(countedIds(e)).toEqual(['a', 'c'])
    expect(isCounted(e, 'c')).toBe(true)
  })

  it('agrees with isCounted for every person', () => {
    const e = event({ yes: ['a', 'b', 'f'], no: ['c'], calledAt: 1, present: ['c', 'd', 'a'], absent: ['b', 'e'] })
    const everyone = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    expect(everyone.filter((id) => isCounted(e, id))).toEqual(countedIds(e))
  })
})

describe('eventTally', () => {
  const today = '2026-10-10'

  it('shows the replies of an upcoming event', () => {
    expect(eventTally(event({ date: '2026-10-11', yes: ['a', 'b'], no: ['c'] }), today)).toEqual({ kind: 'replies', yes: 2, no: 1 })
    expect(eventTally(event({ date: '2026-10-11' }), today)).toEqual({ kind: 'replies', yes: 0, no: 0 })
  })

  it('shows the expected count from the day of the event until it is called', () => {
    expect(eventTally(event({ yes: ['a', 'b'], no: ['c'] }), today)).toEqual({ kind: 'expected', count: 2 })
    expect(eventTally(event({ date: '2026-09-01', yes: ['a'] }), today)).toEqual({ kind: 'expected', count: 1 })
  })

  it('shows the presence once called', () => {
    const e = event({ yes: ['a', 'b', 'e'], calledAt: 1, present: ['b', 'c'], absent: ['a', 'd'] })
    expect(eventTally(e, today)).toEqual({ kind: 'present', count: 3, called: 4 })
  })
})

describe('canCall', () => {
  it('opens on the day of the event, never before', () => {
    expect(canCall(event({ date: '2026-10-11' }), '2026-10-10')).toBe(false)
    expect(canCall(event({ date: '2026-10-10' }), '2026-10-10')).toBe(true)
    expect(canCall(event({ date: '2026-10-09' }), '2026-10-10')).toBe(true)
  })
})

describe('status filter', () => {
  const people = ['a', 'b', 'c', 'd', 'e']
  const before = event({ yes: ['a', 'b'], no: ['c'] })
  // a and b said yes (b is absent), c said no and came, d said nothing and came, e is left out of the call.
  const after = event({ yes: ['a', 'b'], no: ['c'], calledAt: 1, present: ['a', 'c', 'd'], absent: ['b'] })
  const matching = (e: AppEvent, status: Parameters<typeof statusMatcher>[1]) => people.filter(statusMatcher(e, status))

  it('filters on replies', () => {
    expect(matching(before, 'yes')).toEqual(['a', 'b'])
    expect(matching(before, 'no')).toEqual(['c'])
    expect(matching(before, 'noReply')).toEqual(['d', 'e'])
  })

  it('filters on real presence once called, and finds nobody present before', () => {
    expect(matching(after, 'present')).toEqual(['a', 'c', 'd'])
    expect(matching(after, 'absent')).toEqual(['b'])
    expect(matching(before, 'present')).toEqual([])
    expect(matching(before, 'absent')).toEqual([])
    // Replies stay filterable after the call.
    expect(matching(after, 'yes')).toEqual(['a', 'b'])
  })

  it('counts every status', () => {
    expect(statusCounts(before, people)).toEqual({ yes: 2, no: 1, noReply: 2, present: 0, absent: 0 })
    expect(statusCounts(after, people)).toEqual({ yes: 2, no: 1, noReply: 2, present: 3, absent: 1 })
    expect(statusCounts(after, ['a', 'e'])).toEqual({ yes: 1, no: 0, noReply: 1, present: 1, absent: 0 })
  })

  it('gives yes precedence over no, as replyOf does', () => {
    const both = event({ yes: ['a'], no: ['a'] })
    expect(replyOf(both, 'a')).toBe('yes')
    expect(statusMatcher(both, 'no')('a')).toBe(false)
  })
})

describe('hasStarted', () => {
  // Local time: 2026-10-10 at 18:30.
  const now = new Date(2026, 9, 10, 18, 30)

  it('is true for a past event and false for an upcoming one', () => {
    expect(hasStarted(event({ date: '2026-10-09', start: '23:00' }), now)).toBe(true)
    expect(hasStarted(event({ date: '2026-10-11', start: '00:00' }), now)).toBe(false)
  })

  it('compares the start time on the day of the event, and counts an all-day event as started', () => {
    expect(hasStarted(event({ start: '18:30' }), now)).toBe(true)
    expect(hasStarted(event({ start: '18:00' }), now)).toBe(true)
    expect(hasStarted(event({ start: '18:31' }), now)).toBe(false)
    expect(hasStarted(event(), now)).toBe(true)
  })
})
