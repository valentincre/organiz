import { isValidIso, isValidTimeRange } from './dates'
import { isListedAt } from './leave'
import { hasKey, LIMITS } from './limits'
import { sortedProperties, valueText } from './properties'
import { isLocked } from './personalLinks'
import { byCreation, type IncomingReply } from './replies'
import { sortedPeople } from './selectors'
import { isId } from './validate'
import type { DashboardState, IsoDate, PersonId, Reply, ShareId, ShareKind, Time, Visibility } from './types'

/** What a reply link shows; encrypted with the share key. */
export interface ShareSnapshot {
  v: 1
  kind: ShareKind
  visibility: Visibility
  dashboard: string
  event: { name: string; date: IsoDate; start?: Time; end?: Time; properties: { name: string; value: string }[] }
  /** Names only, sorted by name in the organizer's locale. `locked`: the person has a personal link, so only replies through it count. */
  people: { id: PersonId; name: string; locked?: true }[]
  /** Public only: every current answer, from links or hand edits. */
  answers?: Record<PersonId, Reply>
  /** Private only: the organizers' public key (JWK JSON). */
  publicKey?: string
  /** Public call links only: the people present. Check-ins up to `at` are included; pages add newer ones. */
  present?: PersonId[]
  /** Replies created up to this time (the share's mergedUpTo) are included; pages add newer ones. */
  at: number
}

/**
 * Null when the share or its event is missing, or a private share has no organizer keys yet.
 * `checkIns` (roll-call replies of this link) feed the presence of an unfinished public call link.
 */
export function buildSnapshot(state: DashboardState, shareId: ShareId, locale: string, checkIns: IncomingReply[] = []): ShareSnapshot | null {
  if (!state.shares || !hasKey(state.shares, shareId)) return null
  const share = state.shares[shareId]
  if (!hasKey(state.events, share.eventId)) return null
  const event = state.events[share.eventId]
  if (share.visibility === 'private' && !state.organizerKeys) return null
  const properties = sortedProperties(state, 'event')
    .map((def) => ({ name: def.name, value: valueText(def, event.values, def.id, locale) }))
    .filter((property) => property.value !== '')
  // Call links never lock: a personal link only replaces the name for presence replies.
  const lock = share.kind === 'presence'
  // People who left before the event are not offered, unless they already replied or were called there.
  const people = sortedPeople(state, locale)
    .filter(({ id }) => isListedAt(state, event, id))
    .map(({ id, name }) => ({ id, name, ...(lock && isLocked(state, id) && { locked: true as const }) }))
  const answers: Record<PersonId, Reply> = {}
  for (const { id } of people) {
    if (event.yes?.includes(id)) answers[id] = 'yes'
    else if (event.no?.includes(id)) answers[id] = 'no'
  }
  const call = share.kind === 'call' && share.visibility === 'public'
  let present: PersonId[] | undefined
  let at = share.mergedUpTo
  if (call && share.finished) {
    present = [...(event.present ?? [])]
  } else if (call) {
    const here = new Set<PersonId>()
    const known = new Set(people.map((person) => person.id))
    for (const reply of [...checkIns].sort(byCreation)) {
      if (!known.has(reply.personId) || (reply.answer !== 'here' && reply.answer !== 'notHere')) continue
      if (reply.answer === 'here') here.add(reply.personId)
      else here.delete(reply.personId)
      at = Math.max(at, reply.createdAt)
    }
    present = people.filter((person) => here.has(person.id)).map((person) => person.id)
  }
  return {
    v: 1,
    kind: share.kind,
    visibility: share.visibility,
    dashboard: state.name,
    event: { name: event.name, date: event.date, ...(event.start && { start: event.start }), ...(event.end && { end: event.end }), properties },
    people,
    ...(share.visibility === 'public' ? { answers } : { publicKey: state.organizerKeys!.publicKey }),
    ...(present && { present }),
    at,
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value: unknown, max: number, min = 0): value is string => typeof value === 'string' && value.length >= min && value.length <= max
// A multiple choice value joins up to LIMITS.options labels.
const MAX_VALUE_TEXT = Math.max(LIMITS.textValue, LIMITS.options * (LIMITS.label + 2))

const isEvent = (event: unknown): boolean =>
  isObject(event) &&
  isText(event.name, LIMITS.eventName) &&
  typeof event.date === 'string' &&
  isValidIso(event.date) &&
  isValidTimeRange(event.start as string | undefined, event.end as string | undefined) &&
  Array.isArray(event.properties) &&
  event.properties.length <= LIMITS.eventProperties &&
  event.properties.every((p) => isObject(p) && isText(p.name, LIMITS.label, 1) && isText(p.value, MAX_VALUE_TEXT))

/** Shape and size checks for a decrypted snapshot, like `isDashboardState` for a state. */
export function isShareSnapshot(value: unknown): value is ShareSnapshot {
  if (!isObject(value) || value.v !== 1) return false
  if (value.kind !== 'presence' && value.kind !== 'call') return false
  if (value.visibility !== 'public' && value.visibility !== 'private') return false
  if (!isText(value.dashboard, LIMITS.dashboardName, 1) || !isEvent(value.event) || !Number.isFinite(value.at)) return false
  if (
    !Array.isArray(value.people) ||
    value.people.length > LIMITS.people ||
    !value.people.every((p) => isObject(p) && isId(p.id) && isText(p.name, LIMITS.personName, 1) && (p.locked === undefined || p.locked === true)) ||
    new Set(value.people.map((p) => p.id)).size !== value.people.length
  ) {
    return false
  }
  const listed = new Set(value.people.map((p) => p.id))
  if (value.answers !== undefined) {
    const answers = value.answers
    const ok =
      isObject(answers) &&
      Object.keys(answers).length <= LIMITS.people &&
      Object.entries(answers).every(([id, answer]) => listed.has(id) && (answer === 'yes' || answer === 'no'))
    if (!ok) return false
  }
  // Presence belongs to public call snapshots only; ids are known and unique.
  if (value.present !== undefined) {
    const present = value.present
    const ok =
      value.kind === 'call' &&
      value.visibility === 'public' &&
      Array.isArray(present) &&
      present.every((id) => typeof id === 'string' && listed.has(id)) &&
      new Set(present).size === present.length
    if (!ok) return false
  }
  // A public snapshot carries the answers and no key; a private one the key and no answers.
  if (value.visibility === 'private') return value.answers === undefined && isText(value.publicKey, LIMITS.jwk, 1)
  return value.publicKey === undefined
}

/**
 * The answers of a snapshot plus the replies newer than it: latest per person, 'none' removes, unknown people are ignored.
 * A locked name takes only replies through its personal link, as the organizers' fold does.
 */
export function snapshotAnswers(snapshot: ShareSnapshot, replies: IncomingReply[]): Record<PersonId, Reply> {
  const known = new Set(snapshot.people.map((person) => person.id))
  const locked = new Set(snapshot.people.filter((person) => person.locked).map((person) => person.id))
  const answers: Record<PersonId, Reply> = { ...snapshot.answers }
  const newer = replies
    .filter((reply) => reply.createdAt > snapshot.at)
    // Same millisecond: the lowest id is applied last, so it wins, as in `foldAllReplies`.
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
  for (const reply of newer) {
    if (!known.has(reply.personId) || reply.answer === 'here' || reply.answer === 'notHere') continue
    if (locked.has(reply.personId) && reply.via !== 'personal') continue
    if (reply.answer === 'none') delete answers[reply.personId]
    else answers[reply.personId] = reply.answer
  }
  return answers
}

/** The people present on a call link: the snapshot's presence plus the check-ins newer than it ('here' adds, 'notHere' removes). */
export function snapshotPresent(snapshot: ShareSnapshot, replies: IncomingReply[]): Set<PersonId> {
  const known = new Set(snapshot.people.map((person) => person.id))
  const present = new Set(snapshot.present)
  for (const reply of replies.filter((r) => r.createdAt > snapshot.at).sort(byCreation)) {
    if (!known.has(reply.personId)) continue
    if (reply.answer === 'here') present.add(reply.personId)
    else if (reply.answer === 'notHere') present.delete(reply.personId)
  }
  return present
}
