import { isCalled, isCounted, presenceOf, replyOf } from './attendance'
import { addDays, addMonths, isValidIso, monthOf, monthsBetween, parseIso, todayIso, weekdayOf, type YearMonth } from './dates'
import { matchesFilter, type Filter } from './filters'
import { hasLeftBy } from './leave'
import { hasKey } from './limits'
import { compareEvents, eventEntries, type EventEntry } from './selectors'
import type { AppEvent, DashboardState, EventId, IsoDate, Person, PersonId, Reply } from './types'

// The numbers of the Statistics tab.
// Rates are built from "cells": one per person expected at a recorded past event.

/** Both dates included. */
export interface StatPeriod {
  from: IsoDate
  to: IsoDate
}

/** The page filters, decoded: people conditions and event conditions. */
export interface StatScope {
  people: Filter
  events: Filter
}

/** Something was noted on the event: a roll call or at least one reply. */
export const isRecorded = (event: AppEvent): boolean =>
  isCalled(event) || (event.yes?.length ?? 0) > 0 || (event.no?.length ?? 0) > 0

/** Per person: the earlier of the local day of createdAt and the first event date where they were present or replied yes/no. */
export function arrivals(state: DashboardState): Map<PersonId, IsoDate> {
  const arrival = new Map<PersonId, IsoDate>(
    Object.entries(state.people).map(([id, person]) => [id, todayIso(new Date(person.createdAt))]),
  )
  for (const event of Object.values(state.events)) {
    // An absent mark does not count: finishing a call marks everyone left unmarked absent.
    const seen = [...(event.yes ?? []), ...(event.no ?? []), ...(isCalled(event) ? (event.present ?? []) : [])]
    for (const id of seen) {
      const current = arrival.get(id)
      if (current !== undefined && event.date < current) arrival.set(id, event.date)
    }
  }
  return arrival
}

/** Arrived on or before the date and not left before it. */
function isActive(person: Person, arrival: IsoDate | undefined, date: IsoDate): boolean {
  return arrival !== undefined && arrival <= date && !hasLeftBy(person, date)
}

/** Expected people at one past event (existing people only); an absent mark outside the person's stay is ignored. */
export function expectedAt(state: DashboardState, event: AppEvent, arrival: Map<PersonId, IsoDate>): Set<PersonId> {
  const expected = new Set<PersonId>()
  if (!isRecorded(event)) return expected
  // Anyone with a reply or a presence is expected, whatever their arrival or leave date.
  const noted = [...(event.yes ?? []), ...(event.no ?? [])]
  if (isCalled(event)) noted.push(...(event.present ?? []))
  for (const id of noted) if (hasKey(state.people, id)) expected.add(id)
  if (isCalled(event)) {
    // An absent mark alone counts from the arrival to the leave date: finishing a call marks everyone
    // left unmarked absent, including people added later to a dashboard whose past calls are back-entered,
    // and people whose leave date was set after the call.
    for (const id of event.absent ?? []) {
      if (hasKey(state.people, id) && isActive(state.people[id], arrival.get(id), event.date)) expected.add(id)
    }
  }
  // Without a call there is no list of who was there: every active person is expected.
  if (!isCalled(event)) {
    for (const [id, person] of Object.entries(state.people)) {
      if (isActive(person, arrival.get(id), event.date)) expected.add(id)
    }
  }
  return expected
}

/** Whether one person is expected at one past event: the rule of `expectedAt`, for a single person. */
export function isExpectedAt(state: DashboardState, event: AppEvent, id: PersonId, arrival: IsoDate | undefined): boolean {
  if (!isRecorded(event) || !hasKey(state.people, id)) return false
  if (replyOf(event, id) !== undefined) return true
  const active = isActive(state.people[id], arrival, event.date)
  if (!isCalled(event)) return active
  const presence = presenceOf(event, id)
  return presence === true || (presence === false && active)
}

/** One (person, event) pair the rates are built from. */
export interface Cell {
  personId: PersonId
  eventId: EventId
  date: IsoDate
  present: boolean
  replied: boolean
  reply?: Reply
  called: boolean
}

export const inPeriod = (date: IsoDate, period: StatPeriod): boolean => period.from <= date && date <= period.to

/** Events of the period that match the event conditions, in chronological order. */
export const scopedEvents = (state: DashboardState, period: StatPeriod, scope: StatScope): EventEntry[] =>
  eventEntries(state)
    .filter((event) => inPeriod(event.date, period) && matchesFilter(state.eventProperties, event.values, scope.events))
    .sort(compareEvents)

/** Ids of the people matching the people conditions. */
export const scopedPeople = (state: DashboardState, scope: StatScope): Set<PersonId> =>
  new Set(
    Object.entries(state.people)
      .filter(([, person]) => matchesFilter(state.personProperties, person.values, scope.people))
      .map(([id]) => id),
  )

/** Every expected pair of the recorded past events in the period that match the scope, in chronological order. */
export function cells(state: DashboardState, period: StatPeriod, scope: StatScope, today: IsoDate, arrival = arrivals(state)): Cell[] {
  const scoped = scopedPeople(state, scope)
  const result: Cell[] = []
  for (const event of scopedEvents(state, period, scope)) {
    if (event.date > today || !isRecorded(event)) continue
    for (const personId of expectedAt(state, event, arrival)) {
      if (scoped.has(personId)) result.push(cellOf(event, personId))
    }
  }
  return result
}

/** One person's cells over every past event (the person page), without computing everyone's. */
export function personCells(state: DashboardState, personId: PersonId, today: IsoDate): Cell[] {
  const arrival = arrivals(state).get(personId)
  return eventEntries(state)
    .filter((event) => event.date <= today && isExpectedAt(state, event, personId, arrival))
    .sort(compareEvents)
    .map((event) => cellOf(event, personId))
}

function cellOf(event: EventEntry, personId: PersonId): Cell {
  const reply = replyOf(event, personId)
  return {
    personId,
    eventId: event.id,
    date: event.date,
    present: isCounted(event, personId),
    replied: reply !== undefined,
    ...(reply !== undefined && { reply }),
    called: isCalled(event),
  }
}

export interface PersonStats {
  personId: PersonId
  expected: number
  present: number
  absent: number
  replied: number
  /** Called events where they said yes, and among those, the ones they were present at. */
  yesCalled: number
  keptWord: number
  yesThenAbsent: number
  cameWithoutReply: number
  /** Their expected events in date order. */
  strip: { eventId: EventId; date: IsoDate; present: boolean }[]
}

/** Per person with at least one cell; cells keep their order in the strip. */
export function peopleStats(state: DashboardState, cells: Cell[]): Map<PersonId, PersonStats> {
  const stats = new Map<PersonId, PersonStats>()
  for (const cell of cells) {
    if (!hasKey(state.people, cell.personId)) continue
    let entry = stats.get(cell.personId)
    if (!entry) {
      entry = {
        personId: cell.personId,
        expected: 0,
        present: 0,
        absent: 0,
        replied: 0,
        yesCalled: 0,
        keptWord: 0,
        yesThenAbsent: 0,
        cameWithoutReply: 0,
        strip: [],
      }
      stats.set(cell.personId, entry)
    }
    entry.expected++
    if (cell.present) entry.present++
    else entry.absent++
    if (cell.replied) entry.replied++
    // On uncalled events a "yes" is presence by definition, so these use called events only.
    if (cell.called && cell.reply === 'yes') {
      entry.yesCalled++
      if (cell.present) entry.keptWord++
      else entry.yesThenAbsent++
    }
    if (cell.called && cell.present && !cell.replied) entry.cameWithoutReply++
    entry.strip.push({ eventId: cell.eventId, date: cell.date, present: cell.present })
  }
  return stats
}

export interface Overview {
  expected: number
  present: number
  absences: number
  rate: number | null
  pastEvents: number
  upcomingEvents: number
  newcomers: number
  total: number
}

/** The four fixed numbers of the tab, from the cells (and arrivals) of the same state, period and scope. */
export function overview(
  state: DashboardState,
  period: StatPeriod,
  scope: StatScope,
  today: IsoDate,
  cells: Cell[],
  arrival = arrivals(state),
): Overview {
  const present = cells.filter((cell) => cell.present).length
  // Every event counts here, recorded or not.
  const events = scopedEvents(state, period, scope)
  const pastEvents = events.filter((event) => event.date <= today).length
  const scoped = [...scopedPeople(state, scope)]
  const newcomers = scoped.filter((id) => {
    const date = arrival.get(id)
    return date !== undefined && inPeriod(date, period)
  }).length
  // Without cells, the people present in the dashboard at the end of the period (today at the latest).
  const end = period.to < today ? period.to : today
  const total =
    cells.length > 0
      ? new Set(cells.map((cell) => cell.personId)).size
      : scoped.filter((id) => isActive(state.people[id], arrival.get(id), end)).length
  return {
    expected: cells.length,
    present,
    absences: cells.length - present,
    rate: cells.length > 0 ? present / cells.length : null,
    pastEvents,
    upcomingEvents: events.length - pastEvents,
    newcomers,
    total,
  }
}

export type TimeUnit = 'month' | 'week'

const DAY_MS = 86_400_000

/** Month columns, or week columns (Monday first) when the period is 31 days or less. */
export const seriesUnit = (period: StatPeriod): TimeUnit => (period.to <= addDays(period.from, 30) ? 'week' : 'month')

export function bucketOf(date: IsoDate, unit: TimeUnit): IsoDate {
  return unit === 'month' ? `${date.slice(0, 7)}-01` : addDays(date, -weekdayOf(date))
}

/** The longest period, in calendar months: ten years, so time charts have at most 120 month or about 520 week columns. */
export const MAX_PERIOD_MONTHS = 120

const firstDayOf = ({ year, month }: YearMonth): IsoDate => `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-01`

/** A period over MAX_PERIOD_MONTHS calendar months keeps its last ones: `from` moves to the first day of the earliest month kept. */
export function capPeriod(period: StatPeriod): StatPeriod {
  const start = firstDayOf(addMonths(monthOf(period.to), 1 - MAX_PERIOD_MONTHS))
  return period.from < start ? { from: start, to: period.to } : period
}

/** One bucket per month or week overlapping the period (capped, see capPeriod), empty ones included, in order; `start` is its first day. */
export function bucketsOf(period: StatPeriod, unit: TimeUnit): IsoDate[] {
  if (period.to < period.from) return []
  const { from, to } = capPeriod(period)
  if (unit === 'month') return monthsBetween(monthOf(from), monthOf(to)).map(firstDayOf)
  // Counted, not compared as text: past 9999-12-31 or before 1000-01-01 a day has no four-digit
  // ISO date, so a week starting before year 1000 (only around that bound) is left out.
  const back = weekdayOf(from)
  const count = Math.floor(((parseIso(to).getTime() - parseIso(from).getTime()) / DAY_MS + back) / 7) + 1
  return Array.from({ length: count }, (_, i) => addDays(from, 7 * i - back)).filter(isValidIso)
}

/** The short note under a name; at most one, the first that applies. */
export type PersonNote =
  | { kind: 'left'; date: IsoDate }
  | { kind: 'arrived'; date: IsoDate }
  | { kind: 'yesThenAbsent'; count: number }
  | { kind: 'rarelyReplies' }
  | { kind: 'neverAbsent' }

export function noteFor(person: Person, arrival: IsoDate, stats: PersonStats, period: StatPeriod): PersonNote | null {
  if (person.leftOn !== undefined && inPeriod(person.leftOn, period)) return { kind: 'left', date: person.leftOn }
  if (inPeriod(arrival, period)) return { kind: 'arrived', date: arrival }
  if (stats.yesThenAbsent >= 3) return { kind: 'yesThenAbsent', count: stats.yesThenAbsent }
  if (stats.expected > 0 && stats.replied / stats.expected < 0.5) return { kind: 'rarelyReplies' }
  if (stats.absent === 0 && stats.expected > 0) return { kind: 'neverAbsent' }
  return null
}
