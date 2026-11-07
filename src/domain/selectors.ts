import { countedIds } from './attendance'
import { isInRange } from './dates'
import { hasKey } from './limits'
import type { AppEvent, DashboardState, EventId, IsoDate, PersonId, PropertyValues } from './types'

export interface PersonEntry {
  id: PersonId
  name: string
  values?: PropertyValues
}

export interface EventEntry extends AppEvent {
  id: EventId
}

export function sortedPeople(state: DashboardState, locale: string): PersonEntry[] {
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true })
  return Object.entries(state.people)
    .map(([id, person]) => ({ id, name: person.name, values: person.values }))
    .sort((a, b) => collator.compare(a.name, b.name))
}

/** Chronological order: by date, all-day events first, then by start time, name and creation. */
export function compareEvents(a: EventEntry, b: EventEntry): number {
  return (
    a.date.localeCompare(b.date) ||
    (a.start ?? '').localeCompare(b.start ?? '') ||
    a.name.localeCompare(b.name) ||
    a.createdAt - b.createdAt ||
    a.id.localeCompare(b.id)
  )
}

export const eventEntries = (state: DashboardState): EventEntry[] =>
  Object.entries(state.events).map(([id, event]) => ({ id, ...event }))

export const eventEntry = (state: DashboardState, id: EventId): EventEntry | undefined =>
  hasKey(state.events, id) ? { id, ...state.events[id] } : undefined

/** Events newest first (latest date, and latest time within a day). */
export function sortedEvents(state: DashboardState, from?: IsoDate, to?: IsoDate): EventEntry[] {
  return eventEntries(state)
    .filter((event) => isInRange(event.date, from, to))
    .sort(compareEvents)
    .reverse()
}

/** Events of each date, in chronological order within the day. */
export function eventsByDate(events: EventEntry[]): Map<IsoDate, EventEntry[]> {
  const index = new Map<IsoDate, EventEntry[]>()
  for (const event of [...events].sort(compareEvents)) {
    const day = index.get(event.date)
    if (day) day.push(event)
    else index.set(event.date, [event])
  }
  return index
}

export function attendeesOf(state: DashboardState, eventId: EventId, locale: string): PersonEntry[] {
  const ids = new Set(hasKey(state.events, eventId) ? countedIds(state.events[eventId]) : [])
  return sortedPeople(state, locale).filter((p) => ids.has(p.id))
}

/** Events attended (counted) by each person, newest first. Every person has an entry. */
export function eventsByPerson(state: DashboardState): Map<PersonId, EventEntry[]> {
  const index = new Map<PersonId, EventEntry[]>(Object.keys(state.people).map((id) => [id, []]))
  for (const event of sortedEvents(state)) {
    for (const id of countedIds(event)) index.get(id)?.push(event)
  }
  return index
}

/** Number of the given events each person attended (counted) (people with none get 0). */
export function attendanceCounts(state: DashboardState, events: EventEntry[]): Map<PersonId, number> {
  const counts = new Map<PersonId, number>(Object.keys(state.people).map((id) => [id, 0]))
  for (const event of events) {
    for (const id of countedIds(event)) {
      const count = counts.get(id)
      if (count !== undefined) counts.set(id, count + 1)
    }
  }
  return counts
}
