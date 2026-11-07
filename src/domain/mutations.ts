import { addDays, isValidIso, isValidTimeRange, weekdayOf } from './dates'
import { clampName, hasKey, LIMITS } from './limits'
import { isCalled } from './attendance'
import { isListedAt } from './leave'
import { closesAtFor, isShareOpen, sharesOf } from './shares'
import type { AppEvent, DashboardState, EventId, IsoDate, Mutation, PersonId, PropertyValues, Reply, SeriesId, Time } from './types'

// Mutations express intents ("mark present", not "toggle") so that replaying
// them on a newer state, after a concurrent edit, still gives the right result.

export function emptyState(name: string): DashboardState {
  return {
    v: 3,
    name: clampName(name, LIMITS.dashboardName),
    people: {},
    events: {},
    personProperties: {},
    eventProperties: {},
  }
}

export const compose =
  (...mutations: Mutation[]): Mutation =>
  (state) =>
    mutations.reduce((acc, mutation) => mutation(acc), state)

export const renameDashboard =
  (name: string): Mutation =>
  (state) => {
    const trimmed = clampName(name, LIMITS.dashboardName)
    return !trimmed || trimmed === state.name ? state : { ...state, name: trimmed }
  }

// People

export const addPerson =
  (id: PersonId, name: string, createdAt = Date.now()): Mutation =>
  (state) => {
    const trimmed = clampName(name, LIMITS.personName)
    if (!trimmed || hasKey(state.people, id) || Object.keys(state.people).length >= LIMITS.people) return state
    return { ...state, people: { ...state.people, [id]: { name: trimmed, createdAt } } }
  }

export const renamePerson =
  (id: PersonId, name: string): Mutation =>
  (state) => {
    if (!hasKey(state.people, id)) return state
    const person = state.people[id]
    const trimmed = clampName(name, LIMITS.personName)
    if (!trimmed || trimmed === person.name) return state
    return { ...state, people: { ...state.people, [id]: { ...person, name: trimmed } } }
  }

/** Sets or clears (null) the day a person left the group. */
export const setLeftOn =
  (id: PersonId, date: IsoDate | null): Mutation =>
  (state) => {
    if (!hasKey(state.people, id)) return state
    const { leftOn, ...person } = state.people[id]
    if (date === null) {
      if (leftOn === undefined) return state
      return { ...state, people: { ...state.people, [id]: person } }
    }
    if (!isValidIso(date) || date === leftOn) return state
    return { ...state, people: { ...state.people, [id]: { ...person, leftOn: date } } }
  }

/** Removes the person and their replies and presence at every event. */
export const deletePerson =
  (id: PersonId): Mutation =>
  (state) => {
    if (!hasKey(state.people, id)) return state
    const people = { ...state.people }
    delete people[id]
    const events: DashboardState['events'] = {}
    for (const [eventId, event] of Object.entries(state.events)) {
      events[eventId] = withoutTrace(withoutPerson(event, id), id)
    }
    const { personalLinks, ...rest } = state
    if (personalLinks && hasKey(personalLinks, id)) {
      const remaining = { ...personalLinks }
      delete remaining[id]
      return Object.keys(remaining).length > 0 ? { ...rest, people, events, personalLinks: remaining } : { ...rest, people, events }
    }
    return { ...state, people, events }
  }

// Events

export interface EventFields {
  name?: string
  start?: Time
  end?: Time
  seriesId?: SeriesId
  values?: PropertyValues
}

/** Creates an event; nothing happens if the id exists, the date or times are invalid, or the limit is reached. */
export const addEvent =
  (id: EventId, date: IsoDate, fields: EventFields = {}, createdAt = Date.now()): Mutation =>
  (state) => {
    const { name = '', start, end, seriesId, values } = fields
    if (hasKey(state.events, id) || !isValidIso(date) || !isValidTimeRange(start, end)) return state
    if (Object.keys(state.events).length >= LIMITS.events) return state
    const event: AppEvent = {
      date,
      name: clampName(name, LIMITS.eventName),
      createdAt,
      ...(start !== undefined && { start }),
      ...(end !== undefined && { end }),
      ...(seriesId !== undefined && { seriesId }),
      ...(values && Object.keys(values).length > 0 && { values }),
    }
    return { ...state, events: { ...state.events, [id]: event } }
  }

/**
 * Makes a lone event the first of a weekly series: copies its name, times and
 * properties (not its attendance) to the given dates after it.
 */
export const repeatEvent =
  (id: EventId, seriesId: SeriesId, copies: { id: EventId; date: IsoDate }[], createdAt = Date.now()): Mutation =>
  (state) => {
    if (!hasKey(state.events, id) || state.events[id].seriesId) return state
    const source = state.events[id]
    const { name, start, end, values } = source
    return compose(
      (current) => ({ ...current, events: { ...current.events, [id]: { ...source, seriesId } } }),
      ...copies
        .filter((copy) => copy.date > source.date)
        .map((copy) => addEvent(copy.id, copy.date, { name, start, end, seriesId, values: values && structuredClone(values) }, createdAt)),
    )(state)
  }

/** Dates of a weekly repetition: the chosen weekdays (0 = Monday) from `from` to `until`, at most LIMITS.series. */
export function repeatDates(from: IsoDate, until: IsoDate, weekdays: number[]): IsoDate[] {
  const dates: IsoDate[] = []
  if (!isValidIso(from) || !isValidIso(until)) return dates
  for (let date = from; date <= until && dates.length < LIMITS.series; date = addDays(date, 1)) {
    if (weekdays.includes(weekdayOf(date))) dates.push(date)
  }
  return dates
}

const withEvent = (state: DashboardState, id: EventId, update: (event: AppEvent) => AppEvent | null): DashboardState => {
  if (!hasKey(state.events, id)) return state
  const event = state.events[id]
  const next = update(event)
  return next === null || next === event ? state : { ...state, events: { ...state.events, [id]: next } }
}

export const setEventName =
  (id: EventId, name: string): Mutation =>
  (state) =>
    withEvent(state, id, (event) => {
      const trimmed = clampName(name, LIMITS.eventName)
      return trimmed === event.name ? null : { ...event, name: trimmed }
    })

/** Sets both times at once (undefined = all day), since they are only valid together. */
export const setEventTime =
  (id: EventId, start?: Time, end?: Time, now = Date.now()): Mutation =>
  (state) =>
    withEventShares(
      withEvent(state, id, (event) => {
        if (!isValidTimeRange(start, end) || (event.start === start && event.end === end)) return null
        const next = { ...event, start, end }
        if (start === undefined) delete next.start
        if (end === undefined) delete next.end
        return next
      }),
      id,
      now,
    )

export const moveEvent =
  (id: EventId, date: IsoDate, now = Date.now()): Mutation =>
  (state) =>
    withEventShares(
      withEvent(state, id, (event) => (!isValidIso(date) || date === event.date ? null : { ...event, date })),
      id,
      now,
    )

/** Closes the links of a deleted event; the share sync then closes their documents and forgets them. */
export const deleteEvent =
  (id: EventId): Mutation =>
  (state) => {
    if (!hasKey(state.events, id)) return state
    const events = { ...state.events }
    delete events[id]
    const shares = state.shares && { ...state.shares }
    for (const [shareId] of sharesOf(state, id)) shares![shareId] = { ...shares![shareId], closed: true }
    return { ...state, events, ...(shares && { shares }) }
  }

/** Recomputes the closing time of the event's still-open links that close by themselves. */
function withEventShares(state: DashboardState, eventId: EventId, now: number): DashboardState {
  if (!hasKey(state.events, eventId)) return state
  let shares = state.shares
  for (const [shareId, share] of sharesOf(state, eventId)) {
    if (!share.autoClose || !isShareOpen(share, now)) continue
    const closesAt = closesAtFor(share.kind, state.events[eventId])
    if (closesAt !== share.closesAt) shares = { ...shares, [shareId]: { ...share, closesAt } }
  }
  return shares === state.shares ? state : { ...state, shares }
}

/** Events of a series on or after a date ("this and following events"), read from the state the mutation applies to. */
const seriesFrom = (state: DashboardState, seriesId: SeriesId, date: IsoDate): EventId[] =>
  Object.entries(state.events)
    .filter(([, event]) => event.seriesId === seriesId && event.date >= date)
    .map(([id]) => id)

export const deleteSeriesFrom =
  (seriesId: SeriesId, date: IsoDate): Mutation =>
  (state) =>
    compose(...seriesFrom(state, seriesId, date).map(deleteEvent))(state)

/** Applies an event mutation to this event and the following ones of its series. */
export const updateSeriesFrom =
  (seriesId: SeriesId, date: IsoDate, change: (id: EventId) => Mutation): Mutation =>
  (state) =>
    compose(...seriesFrom(state, seriesId, date).map(change))(state)

export type SeriesScope = 'one' | 'following'

/** An event change applied to this event only, or to it and the following events of its series. */
export const inSeriesScope =
  (event: { id: EventId; date: IsoDate; seriesId?: SeriesId }, scope: SeriesScope, change: (id: EventId) => Mutation): Mutation =>
    event.seriesId && scope === 'following' ? updateSeriesFrom(event.seriesId, event.date, change) : change(event.id)

// Attendance

type ListKey = 'yes' | 'no' | 'present' | 'absent'

const REPLY_LISTS = ['yes', 'no'] as const
const PRESENCE_LISTS = ['present', 'absent'] as const

/** Sets one id list of an event, deleting the key when it becomes empty; same event when nothing changes. */
function withList(event: AppEvent, key: ListKey, list: PersonId[]): AppEvent {
  const current = event[key] ?? []
  if (list.length === current.length && list.every((id, i) => id === current[i])) return event
  const next = { ...event, [key]: list }
  if (list.length === 0) delete next[key]
  return next
}

/**
 * Moves people into `destination`, and out of the other list of the pair; with
 * no destination they leave both. Lists stay sorted and disjoint.
 */
function place(event: AppEvent, pair: readonly [ListKey, ListKey], ids: PersonId[], destination: ListKey | null): AppEvent {
  const moved = new Set(ids)
  return pair.reduce((acc, key) => {
    const kept = (event[key] ?? []).filter((id) => !moved.has(id))
    return withList(acc, key, key === destination ? [...new Set([...kept, ...ids])].sort() : kept)
  }, event)
}

/** Puts people in the yes or no list (null = neither), without touching their traces. */
export const setReplyLists = (event: AppEvent, ids: PersonId[], reply: Reply | null): AppEvent => place(event, REPLY_LISTS, ids, reply)

const withoutPerson = (event: AppEvent, id: PersonId): AppEvent =>
  place(place(event, REPLY_LISTS, [id], null), PRESENCE_LISTS, [id], null)

const knownIds = (state: DashboardState, ids: PersonId[]): PersonId[] => [...new Set(ids)].filter((id) => hasKey(state.people, id))

/** Drops the reply trace of a person, deleting the record when it becomes empty. */
function withoutTrace(event: AppEvent, id: PersonId): AppEvent {
  if (!event.replyLog || !hasKey(event.replyLog, id)) return event
  const { [id]: _dropped, ...rest } = event.replyLog
  const { replyLog: _log, ...others } = event
  return Object.keys(rest).length === 0 ? others : { ...event, replyLog: rest }
}

/**
 * Sets what the people said before the event; null clears the reply. Unknown ids are ignored.
 * A change is traced as a hand edit when the event has a link or the person already has a trace.
 */
export const setReplies =
  (eventId: EventId, ids: PersonId[], reply: Reply | null, at = Date.now()): Mutation =>
  (state) =>
    withEvent(state, eventId, (event) => {
      const known = knownIds(state, ids)
      if (known.length === 0) return null
      const placed = place(event, REPLY_LISTS, known, reply)
      if (placed === event) return null
      const linked = sharesOf(state, eventId).length > 0
      const traced = known.filter((id) => {
        const before = REPLY_LISTS.find((key) => event[key]?.includes(id))
        const after = REPLY_LISTS.find((key) => placed[key]?.includes(id))
        return before !== after && (linked || (placed.replyLog && hasKey(placed.replyLog, id)))
      })
      if (traced.length === 0) return placed
      const replyLog = { ...placed.replyLog }
      for (const id of traced) {
        // The last personal reply's sentAt stays, so a replay of it cannot undo the hand edit.
        const sentAt = hasKey(replyLog, id) ? replyLog[id].sentAt : undefined
        replyLog[id] = { via: 'hand', at, ...(sentAt !== undefined && { sentAt }) }
      }
      return { ...placed, replyLog }
    })

export const setReply = (eventId: EventId, personId: PersonId, reply: Reply | null, at = Date.now()): Mutation =>
  setReplies(eventId, [personId], reply, at)

/**
 * Sets the real presence of people at an event that has had a roll call (a
 * correction or a late addition); no-op otherwise, so presence always implies a call.
 */
export const setPresences =
  (eventId: EventId, ids: PersonId[], present: boolean): Mutation =>
  (state) =>
    withEvent(state, eventId, (event) => {
      const known = knownIds(state, ids)
      return !isCalled(event) || known.length === 0 ? null : place(event, PRESENCE_LISTS, known, present ? 'present' : 'absent')
    })

export const setPresence = (eventId: EventId, personId: PersonId, present: boolean): Mutation => setPresences(eventId, [personId], present)

/**
 * Records a roll call: the listed people move to present or absent, everyone
 * else is left as is, so calls with different scopes merge. Idempotent, so it
 * can be re-applied on a retry or a reload. A person in both lists counts as present.
 */
export const recordCall =
  (eventId: EventId, present: PersonId[], absent: PersonId[], calledAt: number): Mutation =>
  (state) =>
    withEvent(state, eventId, (event) => {
      const presentIds = knownIds(state, present)
      const presentSet = new Set(presentIds)
      const absentIds = knownIds(state, absent).filter((id) => !presentSet.has(id))
      const called = place(place(event, PRESENCE_LISTS, presentIds, 'present'), PRESENCE_LISTS, absentIds, 'absent')
      const latest = Math.max(event.calledAt ?? calledAt, calledAt)
      return latest === called.calledAt ? called : { ...called, calledAt: latest }
    })

/**
 * A call that covers the whole dashboard, e.g. from a file of the people who came: the given
 * people are present, everybody else listed at the event (see `isListedAt`) is absent, whoever
 * they are when the mutation applies.
 */
export const recordFullCall =
  (eventId: EventId, present: PersonId[], calledAt: number): Mutation =>
  (state) => {
    if (!hasKey(state.events, eventId)) return state
    const event = state.events[eventId]
    const here = new Set(present)
    const absent = Object.keys(state.people).filter((id) => !here.has(id) && isListedAt(state, event, id))
    return recordCall(eventId, present, absent, calledAt)(state)
  }
