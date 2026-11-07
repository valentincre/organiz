import { describe, expect, it } from 'vitest'
import { LIMITS } from './limits'
import {
  addEvent,
  addPerson,
  compose,
  deleteEvent,
  deletePerson,
  deleteSeriesFrom,
  emptyState,
  inSeriesScope,
  moveEvent,
  recordCall,
  recordFullCall,
  repeatEvent,
  renameDashboard,
  renamePerson,
  repeatDates,
  setEventName,
  setEventTime,
  setLeftOn,
  setPresence,
  setPresences,
  setReplies,
  setReply,
  updateSeriesFrom,
} from './mutations'
import { forgetShare } from './shares'
import type { DashboardState } from './types'

const base = compose(
  addPerson('a', 'Alice Martin', 1),
  addPerson('b', 'Bob Durand', 2),
  addPerson('c', 'Chloé Petit', 3),
  addEvent('e1', '2026-10-10', {}, 10),
)(emptyState('Club'))

describe('mutations', () => {
  it('creates and renames', () => {
    expect(emptyState('  Club  ')).toEqual({
      v: 3,
      name: 'Club',
      people: {},
      events: {},
      personProperties: {},
      eventProperties: {},
    })
    expect(renameDashboard('Team')(base).name).toBe('Team')
    expect(renameDashboard('  ')(base)).toBe(base)
    expect(renamePerson('a', ' Alice M. ')(base).people.a).toEqual({ name: 'Alice M.', createdAt: 1 })
    expect(renamePerson('zz', 'Nobody')(base)).toBe(base)
  })

  it('does not overwrite an existing person or add an empty name', () => {
    expect(addPerson('a', 'Other')(base)).toBe(base)
    expect(addPerson('d', '   ')(base)).toBe(base)
  })

  it('creates events with optional name, times and series', () => {
    expect(base.events.e1).toEqual({ date: '2026-10-10', name: '', createdAt: 10 })
    const timed = addEvent('e2', '2026-10-10', { name: ' Training ', start: '18:00', end: '19:30', seriesId: 's' }, 11)(base)
    expect(timed.events.e2).toEqual({
      date: '2026-10-10',
      name: 'Training',
      start: '18:00',
      end: '19:30',
      seriesId: 's',
      createdAt: 11,
    })
    expect(addEvent('e1', '2026-10-11')(base)).toBe(base)
    expect(addEvent('e3', 'not-a-date')(base)).toBe(base)
    expect(addEvent('e3', '2026-10-10', { end: '10:00' })(base)).toBe(base)
    expect(addEvent('e3', '2026-10-10', { start: '10:00', end: '09:00' })(base)).toBe(base)
  })

  it('edits one event field at a time', () => {
    const named = setEventName('e1', 'Match')(base)
    expect(named.events.e1.name).toBe('Match')
    const timed = setEventTime('e1', '09:00', '10:00')(named)
    expect(timed.events.e1).toMatchObject({ name: 'Match', start: '09:00', end: '10:00' })
    const allDay = setEventTime('e1')(timed)
    expect('start' in allDay.events.e1 || 'end' in allDay.events.e1).toBe(false)
    expect(setEventTime('e1', '10:00', '09:00')(base)).toBe(base)
    expect(moveEvent('e1', '2026-10-12')(base).events.e1.date).toBe('2026-10-12')
    expect(moveEvent('e1', 'bad')(base)).toBe(base)
    expect(deleteEvent('e1')(base).events).toEqual({})
    expect(deleteEvent('nope')(base)).toBe(base)
  })

  it('sets replies as an intent, keeps the lists sorted and disjoint, and omits empty ones', () => {
    const replied = compose(setReply('e1', 'c', 'yes'), setReply('e1', 'a', 'yes'), setReply('e1', 'b', 'no'))(base)
    expect(replied.events.e1).toMatchObject({ yes: ['a', 'c'], no: ['b'] })
    expect(setReply('e1', 'a', 'yes')(replied)).toBe(replied)
    const switched = setReply('e1', 'a', 'no')(replied)
    expect(switched.events.e1).toMatchObject({ yes: ['c'], no: ['a', 'b'] })
    const cleared = compose(setReply('e1', 'c', null), setReply('e1', 'a', null))(switched)
    expect(cleared.events.e1.yes).toBeUndefined()
    expect('yes' in cleared.events.e1).toBe(false)
    expect(setReply('e1', 'c', null)(cleared)).toBe(cleared)
    expect(setReply('e1', 'zz', 'yes')(base)).toBe(base)
    expect(setReply('nope', 'a', 'yes')(base)).toBe(base)
  })

  it('sets replies in bulk, ignoring unknown and repeated ids', () => {
    const once = setReplies('e1', ['b', 'a', 'a', 'zz'], 'yes')(base)
    expect(once.events.e1.yes).toEqual(['a', 'b'])
    expect(setReplies('e1', ['a'], 'yes')(once)).toBe(once)
    expect(setReplies('e1', ['a', 'b'], null)(once).events.e1.yes).toBeUndefined()
    expect(setReplies('e1', [], 'yes')(base)).toBe(base)
  })

  it('only sets presence once the event has been called', () => {
    expect(setPresence('e1', 'a', true)(base)).toBe(base)
    expect(setPresences('e1', ['a', 'b'], false)(base)).toBe(base)
    const called = recordCall('e1', ['b'], [], 100)(base)
    const marked = compose(setPresence('e1', 'c', true), setPresence('e1', 'a', true))(called)
    expect(marked.events.e1.present).toEqual(['a', 'b', 'c'])
    expect(setPresence('e1', 'a', true)(marked)).toBe(marked)
    const flipped = setPresences('e1', ['a', 'b'], false)(marked)
    expect(flipped.events.e1).toMatchObject({ present: ['c'], absent: ['a', 'b'] })
    expect(setPresence('e1', 'zz', true)(called)).toBe(called)
    expect(setPresence('nope', 'a', true)(called)).toBe(called)
  })

  it('does not touch replies when presence changes, and the reverse', () => {
    const state = compose(setReply('e1', 'a', 'yes'), recordCall('e1', [], ['a'], 100), setPresence('e1', 'a', true))(base)
    expect(state.events.e1).toMatchObject({ yes: ['a'], present: ['a'] })
    expect(setReply('e1', 'a', 'no')(state).events.e1).toMatchObject({ no: ['a'], present: ['a'] })
  })

  it('records a roll call without touching the people left out', () => {
    const called = recordCall('e1', ['a'], ['b'], 100)(base)
    expect(called.events.e1).toMatchObject({ calledAt: 100, present: ['a'], absent: ['b'] })
    expect(called.events.e1.present).not.toContain('c')
    // A new call replaces the presence of its people only.
    const redone = recordCall('e1', ['b'], ['c'], 200)(called)
    expect(redone.events.e1).toMatchObject({ calledAt: 200, present: ['a', 'b'], absent: ['c'] })
  })

  it('merges two calls with different scopes, the last one winning for a shared person', () => {
    const first = recordCall('e1', ['a', 'b'], [], 100)
    const second = recordCall('e1', [], ['b', 'c'], 200)
    const merged = compose(first, second)(base)
    expect(merged.events.e1).toMatchObject({ calledAt: 200, present: ['a'], absent: ['b', 'c'] })
    // The order of arrival decides who wins, but the time of the call only moves forward.
    const reversed = compose(second, first)(base)
    expect(reversed.events.e1).toMatchObject({ calledAt: 200, present: ['a', 'b'], absent: ['c'] })
  })

  it('records a call idempotently, ignoring unknown ids and the absence of someone marked present', () => {
    const call = recordCall('e1', ['a', 'zz'], ['b', 'a'], 100)
    const once = call(base)
    expect(once.events.e1).toMatchObject({ present: ['a'], absent: ['b'] })
    expect(call(once)).toBe(once)
    expect(recordCall('nope', ['a'], [], 100)(base)).toBe(base)
  })

  it('records a call on the whole dashboard: the given people present, everybody else absent', () => {
    const call = recordFullCall('e1', ['a', 'zz'], 300)
    const once = call(base)
    expect(once.events.e1).toMatchObject({ calledAt: 300, present: ['a'], absent: ['b', 'c'] })
    expect(call(once)).toBe(once)
    // People who joined before it applies are covered too.
    const later = compose(addPerson('d', 'Dora'), call)(base)
    expect(later.events.e1.absent).toEqual(['b', 'c', 'd'])
    expect(recordFullCall('nope', ['a'], 300)(base)).toBe(base)
  })

  it('leaves the people who left before the event out of a call on the whole dashboard', () => {
    const left = compose(setLeftOn('b', '2026-10-09'), setLeftOn('c', '2026-10-10'))(base)
    expect(recordFullCall('e1', ['a'], 300)(left).events.e1).toMatchObject({ present: ['a'], absent: ['c'] })
  })

  it('marks absent a person who left but was marked present, when a new call on the whole dashboard leaves them out', () => {
    const left = compose(setLeftOn('b', '2026-10-09'), recordCall('e1', ['b'], [], 100))(base)
    expect(recordFullCall('e1', ['a'], 300)(left).events.e1).toMatchObject({ present: ['a'], absent: ['b', 'c'] })
  })

  it('removes a deleted person from replies and presence of every event', () => {
    const marked = compose(setReplies('e1', ['a', 'b'], 'yes'), setReply('e1', 'c', 'no'), recordCall('e1', ['a'], ['b', 'c'], 5))(base)
    const removed = deletePerson('a')(marked)
    expect(removed.people.a).toBeUndefined()
    expect(removed.events.e1).toMatchObject({ yes: ['b'], no: ['c'], absent: ['b', 'c'], calledAt: 5 })
    expect(removed.events.e1.present).toBeUndefined()
  })

  it('merges concurrent edits when replayed on a newer state', () => {
    const mine = setReply('e1', 'a', 'yes')
    const theirs = compose(setReply('e1', 'b', 'yes'), setEventName('e1', 'Training'))(base)
    const merged = mine(theirs)
    expect(merged.events.e1.yes).toEqual(['a', 'b'])
    expect(merged.events.e1.name).toBe('Training')
    // Replaying an edit the server already has changes nothing.
    expect(mine(merged)).toBe(merged)
  })

  it('cuts names to the limits', () => {
    const long = 'x'.repeat(LIMITS.personName + 10)
    expect(addPerson('d', long)(base).people.d.name).toHaveLength(LIMITS.personName)
    expect(renameDashboard('y'.repeat(200))(base).name).toHaveLength(LIMITS.dashboardName)
    expect(setEventName('e1', 'z'.repeat(200))(base).events.e1.name).toHaveLength(LIMITS.eventName)
  })

  it('stops adding people and events at the limits', () => {
    const people = Object.fromEntries(Array.from({ length: LIMITS.people }, (_, i) => [`p${i}`, { name: 'X', createdAt: 0 }]))
    const full = { ...base, people }
    expect(addPerson('new', 'New')(full)).toBe(full)
    const events = Object.fromEntries(
      Array.from({ length: LIMITS.events }, (_, i) => [`e${i}`, { date: '2026-01-01', name: '', createdAt: 0 }]),
    )
    const busy = { ...base, events }
    expect(addEvent('new', '2030-01-01')(busy)).toBe(busy)
  })

  it('ignores ids inherited from Object.prototype', () => {
    expect(setReply('e1', 'constructor', 'yes')(base)).toBe(base)
    expect(renamePerson('toString', 'X')(base)).toBe(base)
    expect(deleteEvent('constructor')(base)).toBe(base)
    expect(setEventName('toString', 'X')(base)).toBe(base)
  })
})

describe('leave date', () => {
  it('sets, replaces and removes the date', () => {
    const left = setLeftOn('a', '2027-01-15')(base)
    expect(left.people.a.leftOn).toBe('2027-01-15')
    expect(setLeftOn('a', '2027-02-01')(left).people.a.leftOn).toBe('2027-02-01')
    const back = setLeftOn('a', null)(left)
    expect(back.people.a).toEqual({ name: 'Alice Martin', createdAt: 1 })
    expect('leftOn' in back.people.a).toBe(false)
  })

  it('returns the same state when nothing changes', () => {
    const left = setLeftOn('a', '2027-01-15')(base)
    expect(setLeftOn('a', '2027-01-15')(left)).toBe(left)
    expect(setLeftOn('a', null)(base)).toBe(base)
    expect(setLeftOn('zz', '2027-01-15')(base)).toBe(base)
    expect(setLeftOn('a', 'not-a-date')(base)).toBe(base)
  })
})

describe('weekly repetition', () => {
  it('lists the chosen weekdays up to the end date', () => {
    // 2026-10-05 is a Monday.
    expect(repeatDates('2026-10-05', '2026-10-18', [0, 2])).toEqual(['2026-10-05', '2026-10-07', '2026-10-12', '2026-10-14'])
    expect(repeatDates('2026-10-06', '2026-10-05', [0])).toEqual([])
    expect(repeatDates('2026-01-01', '2030-12-31', [0, 1, 2, 3, 4, 5, 6])).toHaveLength(LIMITS.series)
  })

  it('changes or deletes this and the following events of a series', () => {
    const series = compose(
      addEvent('w1', '2026-10-07', { name: 'Training', seriesId: 's' }),
      addEvent('w2', '2026-10-14', { name: 'Training', seriesId: 's' }),
      addEvent('w3', '2026-10-21', { name: 'Training', seriesId: 's' }),
    )(base)
    const renamed = updateSeriesFrom('s', '2026-10-14', (id) => setEventName(id, 'Practice'))(series)
    expect(['w1', 'w2', 'w3'].map((id) => renamed.events[id].name)).toEqual(['Training', 'Practice', 'Practice'])
    const cut = deleteSeriesFrom('s', '2026-10-14')(series)
    expect(Object.keys(cut.events).sort()).toEqual(['e1', 'w1'])
  })

  it('applies a change to one event or to the following ones of its series', () => {
    const series = compose(
      addEvent('w1', '2026-10-07', { name: 'Training', start: '18:00', seriesId: 's' }),
      addEvent('w2', '2026-10-14', { name: 'Training', start: '18:00', seriesId: 's' }),
      addEvent('w3', '2026-10-21', { name: 'Training', start: '18:00', seriesId: 's' }),
    )(base)
    const w2 = { id: 'w2', ...series.events.w2 }
    const later = (scope: 'one' | 'following') => inSeriesScope(w2, scope, (id) => setEventTime(id, '19:00'))(series)
    expect(['w1', 'w2', 'w3'].map((id) => later('one').events[id].start)).toEqual(['18:00', '19:00', '18:00'])
    expect(['w1', 'w2', 'w3'].map((id) => later('following').events[id].start)).toEqual(['18:00', '19:00', '19:00'])
    // An event outside a series is changed alone, whatever the scope.
    const single = inSeriesScope({ id: 'e1', date: '2026-10-10' }, 'following', (id) => setEventName(id, 'Match'))(series)
    expect(single.events.e1.name).toBe('Match')
    expect(single.events.w3.name).toBe('Training')
  })

  it('turns a lone event into a weekly series without copying replies or presence', () => {
    const one = compose(
      addEvent('w1', '2026-10-07', { name: 'Training', start: '18:00', end: '19:30', values: { type: 'training', tags: ['a'] } }),
      setReply('w1', 'a', 'yes'),
    )(base)
    const copies = [
      { id: 'w0', date: '2026-10-07' },
      { id: 'w2', date: '2026-10-14' },
      { id: 'w3', date: '2026-10-21' },
    ]
    const series = repeatEvent('w1', 's', copies, 5)(one)
    expect(series.events.w1.seriesId).toBe('s')
    expect(series.events.w1.yes).toEqual(['a'])
    expect(series.events.w0).toBeUndefined()
    expect(series.events.w2).toEqual({
      date: '2026-10-14',
      name: 'Training',
      start: '18:00',
      end: '19:30',
      seriesId: 's',
      values: { type: 'training', tags: ['a'] },
      createdAt: 5,
    })
    expect(series.events.w3.values).not.toBe(series.events.w2.values)
    // An event already in a series is left alone.
    expect(repeatEvent('w2', 't', [{ id: 'x', date: '2026-11-01' }])(series)).toBe(series)
  })
})

describe('draft event', () => {
  it('is created together with its first change', () => {
    const state = compose(addEvent('d1', '2026-10-14'), setReply('d1', 'a', 'yes'))(base)
    expect(state.events.d1.yes).toEqual(['a'])
  })

  it('stays a draft when the change does nothing', () => {
    const created = addEvent('d1', '2026-10-14')(base)
    expect(setReply('d1', 'a', null)(created)).toBe(created)
  })
})

const e1Base = compose(addPerson('p1', 'Alice', 1), addEvent('e1', '2026-10-23', { start: '18:00', end: '19:30' }, 1))(emptyState('Club'))
const e1WithShare: DashboardState = {
  ...e1Base,
  shares: { s1: { eventId: 'e1', kind: 'presence', key: 'k', visibility: 'public', autoClose: false, closesAt: null, closed: false, createdAt: 1, mergedUpTo: 0 } },
}

describe('hand-edit traces', () => {
  it('traces hand edits only on events with a link', () => {
    expect(setReply('e1', 'p1', 'yes', 5)(e1Base).events.e1.replyLog).toBeUndefined()
    expect(setReply('e1', 'p1', 'yes', 5)(e1WithShare).events.e1.replyLog).toEqual({ p1: { via: 'hand', at: 5 } })
  })
  it('keeps tracing a person whose link was forgotten', () => {
    const traced = setReply('e1', 'p1', 'yes', 5)(e1WithShare)
    expect(setReply('e1', 'p1', 'no', 6)(forgetShare('s1')(traced)).events.e1.replyLog).toEqual({ p1: { via: 'hand', at: 6 } })
  })
  it('forgets the trace of a deleted person', () => {
    const traced = setReply('e1', 'p1', 'yes', 5)(e1WithShare)
    expect(deletePerson('p1')(traced).events.e1.replyLog).toBeUndefined()
  })
})
