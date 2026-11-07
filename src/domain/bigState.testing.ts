import { addDays } from './dates'
import { compose, emptyState } from './mutations'
import { addProperty } from './properties'
import type { AppEvent, DashboardState, PersonId, PropertyValues } from './types'

// A large dashboard for the volume and equivalence tests of the Statistics tab. Test-only: nothing in the app imports it.

/**
 * `people` people created on 2025-01-01 and `events` daily events from 2025-12-01, every other one
 * called, all built without randomness. People have a choice "sport" (foot, judo, or none) and a
 * multi "level" (a, b); events a choice "kind" (match, training, or none). Every 25th person left
 * on 2026-06-01.
 */
export function bigState(people = 200, events = 300): DashboardState {
  const state = compose(
    addProperty('person', 'sport', 'choice', 'Sport', [
      { id: 'foot', label: 'Foot', color: 'blue' },
      { id: 'judo', label: 'Judo', color: 'green' },
    ], 1),
    addProperty('person', 'level', 'multi', 'Level', [
      { id: 'a', label: 'A', color: 'red' },
      { id: 'b', label: 'B', color: 'amber' },
    ], 2),
    addProperty('event', 'kind', 'choice', 'Kind', [
      { id: 'match', label: 'Match', color: 'purple' },
      { id: 'training', label: 'Training', color: 'gray' },
    ], 1),
  )(emptyState('Big'))
  // Local noon, so the local date of `createdAt` is 2025-01-01 in any time zone.
  const created = new Date(2025, 0, 1, 12).getTime()
  const personIds: PersonId[] = Array.from({ length: people }, (_, i) => `p${i}`)
  for (const [i, id] of personIds.entries()) {
    const values: PropertyValues = {}
    if (i % 3 !== 2) values.sport = i % 3 === 0 ? 'foot' : 'judo'
    if (i % 4 !== 3) values.level = i % 4 === 0 ? ['a', 'b'] : i % 4 === 1 ? ['a'] : ['b']
    state.people[id] = { name: id, createdAt: created + i, values, ...(i % 25 === 24 && { leftOn: '2026-06-01' }) }
  }
  for (let e = 0; e < events; e++) {
    const pick = (k: number) => personIds.filter((_, p) => (p * 7 + e * 3) % 5 === k)
    const values: PropertyValues = e % 3 === 2 ? {} : { kind: e % 3 === 0 ? 'match' : 'training' }
    const event: AppEvent = { date: addDays('2025-12-01', e), name: '', createdAt: e, values, yes: pick(0), no: pick(1) }
    state.events[`e${e}`] = e % 2 === 0 ? { ...event, calledAt: e, present: pick(2), absent: pick(3) } : event
  }
  return state
}
