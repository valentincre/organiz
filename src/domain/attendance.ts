import { todayIso } from './dates'
import type { AppEvent, IsoDate, PersonId, Reply } from './types'

// Read helpers for attendance: every screen goes through them, so none reads
// the four id lists of an event (yes, no, present, absent) directly.

const has = (ids: PersonId[] | undefined, id: PersonId): boolean => ids?.includes(id) ?? false

export const isCalled = (event: AppEvent): boolean => event.calledAt !== undefined

/** Whether a roll call may be started: the day of the event or later, never before. */
export const canCall = (event: AppEvent, today: IsoDate): boolean => event.date <= today

/** Whether the event has begun: it is past, or it is today and its start time is reached (an all-day event begins with the day). */
export function hasStarted(event: AppEvent, now: Date): boolean {
  const today = todayIso(now)
  if (event.date !== today) return event.date < today
  // "HH:MM" in local time, the format of event times.
  return event.start === undefined || event.start <= now.toTimeString().slice(0, 5)
}

export function replyOf(event: AppEvent, id: PersonId): Reply | undefined {
  if (has(event.yes, id)) return 'yes'
  return has(event.no, id) ? 'no' : undefined
}

/** Real presence after a call; undefined when not called or left out of every call. */
export function presenceOf(event: AppEvent, id: PersonId): boolean | undefined {
  if (!isCalled(event)) return undefined
  if (has(event.present, id)) return true
  return has(event.absent, id) ? false : undefined
}

/** The counting rule: real presence when the person was called, else a "yes". */
export function isCounted(event: AppEvent, id: PersonId): boolean {
  return presenceOf(event, id) ?? has(event.yes, id)
}

/** Ids counted as present, sorted: present ∪ (yes − absent) once called, the "yes" before. */
export function countedIds(event: AppEvent): PersonId[] {
  const yes = event.yes ?? []
  if (!isCalled(event)) return yes
  const absent = new Set(event.absent)
  return [...new Set([...(event.present ?? []), ...yes.filter((id) => !absent.has(id))])].sort()
}

export const countedCount = (event: AppEvent): number => countedIds(event).length

/** What a list row or counter shows for an event. */
export type EventTally =
  /** Upcoming: the replies so far. */
  | { kind: 'replies'; yes: number; no: number }
  /** Today or past, no call yet: the "yes" stand in for presence. */
  | { kind: 'expected'; count: number }
  /** After a call: `count` follows the counting rule, `called` is present + absent. */
  | { kind: 'present'; count: number; called: number }

export function eventTally(event: AppEvent, today: IsoDate): EventTally {
  if (isCalled(event)) {
    const called = new Set([...(event.present ?? []), ...(event.absent ?? [])]).size
    return { kind: 'present', count: countedCount(event), called }
  }
  return canCall(event, today)
    ? { kind: 'expected', count: countedCount(event) }
    : { kind: 'replies', yes: event.yes?.length ?? 0, no: event.no?.length ?? 0 }
}

/** The single choice of an event page's status filter: a reply, or (after a call) a real presence. */
export type StatusFilter = 'yes' | 'no' | 'noReply' | 'present' | 'absent'

const idSet = (ids: PersonId[] | undefined): Set<PersonId> => new Set(ids)

/** Whether a person is in the given status; the sets are built once, so it can run over a whole list. */
export function statusMatcher(event: AppEvent, status: StatusFilter): (id: PersonId) => boolean {
  const yes = idSet(event.yes)
  const no = idSet(event.no)
  const called = isCalled(event)
  const present = idSet(called ? event.present : undefined)
  const absent = idSet(called ? event.absent : undefined)
  switch (status) {
    case 'yes':
      return (id) => yes.has(id)
    case 'no':
      return (id) => no.has(id) && !yes.has(id)
    case 'noReply':
      return (id) => !yes.has(id) && !no.has(id)
    case 'present':
      return (id) => present.has(id)
    case 'absent':
      return (id) => absent.has(id) && !present.has(id)
  }
}

const STATUSES: StatusFilter[] = ['yes', 'no', 'noReply', 'present', 'absent']

/** How many of the people are in each status. Real presence only: people left out of a call are in neither present nor absent. */
export function statusCounts(event: AppEvent, ids: PersonId[]): Record<StatusFilter, number> {
  return Object.fromEntries(
    STATUSES.map((status) => {
      const matches = statusMatcher(event, status)
      return [status, ids.filter(matches).length]
    }),
  ) as Record<StatusFilter, number>
}
