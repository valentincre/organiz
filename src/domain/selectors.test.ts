import { describe, expect, it } from 'vitest'
import { addEvent, addPerson, compose, emptyState, recordCall, setReplies } from './mutations'
import {
  attendanceCounts,
  attendeesOf,
  eventsByDate,
  eventsByPerson,
  eventEntries,
  sortedEvents,
  sortedPeople,
} from './selectors'

const state = compose(
  addPerson('z', 'Zoé Roux'),
  addPerson('e', 'émile Blanc'),
  addPerson('a', 'Arthur Moreau'),
  addEvent('jan', '2026-01-10', {}, 1),
  addEvent('mar', '2026-03-01', {}, 2),
  addEvent('feb', '2026-02-14', {}, 3),
  addEvent('marEvening', '2026-03-01', { name: 'Meal', start: '19:00' }, 4),
  addEvent('marMorning', '2026-03-01', { start: '09:00', end: '10:00' }, 5),
  setReplies('jan', ['z', 'a'], 'yes'),
  setReplies('mar', ['z'], 'yes'),
)(emptyState('Club'))

describe('selectors', () => {
  it('sorts people by locale, ignoring accents and case', () => {
    expect(sortedPeople(state, 'fr').map((p) => p.id)).toEqual(['a', 'e', 'z'])
  })

  it('sorts events newest first, all-day events before timed ones within a day', () => {
    expect(sortedEvents(state).map((e) => e.id)).toEqual(['marEvening', 'marMorning', 'mar', 'feb', 'jan'])
    expect(sortedEvents(state, '2026-02-01', '2026-02-28').map((e) => e.id)).toEqual(['feb'])
  })

  it('groups events by date in chronological order', () => {
    const byDate = eventsByDate(eventEntries(state))
    expect(byDate.get('2026-03-01')?.map((e) => e.id)).toEqual(['mar', 'marMorning', 'marEvening'])
    expect(byDate.get('2026-04-01')).toBeUndefined()
  })

  it('lists attendees of an event', () => {
    expect(attendeesOf(state, 'jan', 'fr').map((p) => p.name)).toEqual(['Arthur Moreau', 'Zoé Roux'])
    expect(attendeesOf(state, 'nope', 'fr')).toEqual([])
  })

  it('indexes attended events by person', () => {
    const index = eventsByPerson(state)
    expect(index.get('z')?.map((e) => e.id)).toEqual(['mar', 'jan'])
    expect(index.get('e')).toEqual([])
  })

  it('counts attendance over the given events only', () => {
    const counts = attendanceCounts(state, eventEntries(state))
    expect(Object.fromEntries(counts)).toEqual({ z: 2, e: 0, a: 1 })
    const march = sortedEvents(state, '2026-03-01', '2026-03-01')
    expect(Object.fromEntries(attendanceCounts(state, march))).toEqual({ z: 1, e: 0, a: 0 })
  })

  it('follows the counting rule: real presence after a call, the reply before', () => {
    // On March 1st, Zoé said yes but was absent and Arthur came without a reply.
    const called = recordCall('mar', ['a'], ['z'], 100)(state)
    expect(eventsByPerson(called).get('z')?.map((e) => e.id)).toEqual(['jan'])
    expect(eventsByPerson(called).get('a')?.map((e) => e.id)).toEqual(['mar', 'jan'])
    expect(Object.fromEntries(attendanceCounts(called, eventEntries(called)))).toEqual({ z: 1, e: 0, a: 2 })
    expect(attendeesOf(called, 'mar', 'fr').map((p) => p.id)).toEqual(['a'])
  })
})
