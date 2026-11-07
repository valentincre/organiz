import { presenceOf, replyOf } from './attendance'
import { matchesFilter, type Filter } from './filters'
import { isListedAt } from './leave'
import { hasKey, LIMITS } from './limits'
import { compose, recordCall } from './mutations'
import { byCreation, type IncomingReply } from './replies'
import { sortedPeople } from './selectors'
import { settleCallLinks } from './shares'
import type { AppEvent, DashboardState, EventId, Mutation, PersonId } from './types'
import { isId } from './validate'

// The roll call in progress: a local draft of marks that only becomes data
// (one recordCall) when the call is finished.

export type Mark = 'present' | 'absent'

export interface CallDraft {
  v: 1
  eventId: EventId
  /** People of the call, in call order; people added during the call are appended. */
  scope: PersonId[]
  /** Whether the call started on a subset of the people (a people filter), to say so on the call screen. */
  filtered: boolean
  marks: Record<PersonId, Mark>
  /** Marking order, for "Previous". */
  history: PersonId[]
  /** Person shown by "one by one"; null once everybody is marked. */
  current: PersonId | null
  startedAt: number
  /** Set when the call is finished; the draft is deleted once the server has this call. */
  finishedAt?: number
  /** `createdAt` of the newest check-in applied to this draft. */
  checkedInUpTo?: number
}

const isMark = (value: unknown): value is Mark => value === 'present' || value === 'absent'

/** Shape of a draft read back from the device, which anything could have written. */
export function isCallDraft(value: unknown): value is CallDraft {
  if (typeof value !== 'object' || value === null) return false
  const d = value as Record<string, unknown>
  const ids = (list: unknown) => Array.isArray(list) && list.length <= LIMITS.people && list.every(isId)
  return (
    d.v === 1 &&
    isId(d.eventId) &&
    ids(d.scope) &&
    typeof d.filtered === 'boolean' &&
    typeof d.marks === 'object' &&
    d.marks !== null &&
    !Array.isArray(d.marks) &&
    Object.keys(d.marks).length <= LIMITS.people &&
    Object.entries(d.marks).every(([id, mark]) => isId(id) && isMark(mark)) &&
    ids(d.history) &&
    (d.current === null || isId(d.current)) &&
    Number.isFinite(d.startedAt) &&
    (d.finishedAt === undefined || Number.isFinite(d.finishedAt)) &&
    (d.checkedInUpTo === undefined || Number.isFinite(d.checkedInUpTo))
  )
}

export const markOf = (draft: CallDraft, id: PersonId): Mark | undefined => (hasKey(draft.marks, id) ? draft.marks[id] : undefined)

/** First person without a mark after position `after` (-1 = from the start), wrapping around; null when everybody is marked. */
function nextUnmarked(draft: CallDraft, after: number): PersonId | null {
  const { scope } = draft
  for (let step = 1; step <= scope.length; step++) {
    const id = scope[(after + step) % scope.length]
    if (markOf(draft, id) === undefined) return id
  }
  return null
}

/**
 * The people a call on the event covers: those listed at it (as on the attendance sheet) and matching
 * the people filter, in alphabetical order (the order of the call).
 */
export const callScope = (state: DashboardState, locale: string, filter: Filter, event: AppEvent): PersonId[] =>
  sortedPeople(state, locale)
    .filter((person) => isListedAt(state, event, person.id) && matchesFilter(state.personProperties, person.values, filter))
    .map((person) => person.id)

/**
 * Starts a call on the given people, in the given order. Redoing a call starts
 * from the presence already recorded; the first call starts blank.
 */
export function startCall(state: DashboardState, eventId: EventId, scope: PersonId[], now: number): CallDraft {
  const ids = [...new Set(scope)].filter((id) => hasKey(state.people, id))
  const event = hasKey(state.events, eventId) ? state.events[eventId] : undefined
  const marks: Record<PersonId, Mark> = {}
  if (event) {
    for (const id of ids) {
      const present = presenceOf(event, id)
      if (present !== undefined) marks[id] = present ? 'present' : 'absent'
    }
  }
  // People who left before the event, with nothing on it, are not part of the group then: leaving them out is no filter.
  const group = Object.keys(state.people).filter((id) => !event || isListedAt(state, event, id)).length
  const draft: CallDraft = {
    v: 1,
    eventId,
    scope: ids,
    filtered: ids.length < group,
    marks,
    history: [],
    current: null,
    startedAt: now,
  }
  return { ...draft, current: nextUnmarked(draft, -1) }
}

/**
 * Marks a person present or absent, or clears the mark with null. Marking the
 * person shown moves on to the next one without a mark; marking anybody else
 * leaves the shown person as is.
 */
export function mark(draft: CallDraft, id: PersonId, value: Mark | null): CallDraft {
  if (!draft.scope.includes(id)) return draft
  if (markOf(draft, id) === (value ?? undefined) && (value === null || id !== draft.current)) return draft
  const marks = { ...draft.marks }
  if (value === null) delete marks[id]
  else marks[id] = value
  const history = draft.history.filter((other) => other !== id)
  if (value !== null) history.push(id)
  const next = { ...draft, marks, history }
  if (value !== null && id === draft.current) return { ...next, current: nextUnmarked(next, draft.scope.indexOf(id)) }
  // Somebody is unmarked while everybody was marked: the card shows them again.
  if (value === null && draft.current === null) return { ...next, current: id }
  return next
}

/** Goes back to the person marked last, to correct them; their mark stays until they are marked again. */
export function previous(draft: CallDraft): CallDraft {
  const last = draft.history.at(-1)
  return last === undefined ? draft : { ...draft, history: draft.history.slice(0, -1), current: last }
}

export const jumpTo = (draft: CallDraft, id: PersonId): CallDraft =>
  draft.scope.includes(id) && draft.current !== id ? { ...draft, current: id } : draft

/** A late arrival, or someone outside the filter: joins the call, marked present. */
export function addToCall(draft: CallDraft, id: PersonId): CallDraft {
  const scope = draft.scope.includes(id) ? draft.scope : [...draft.scope, id]
  return mark({ ...draft, scope }, id, 'present')
}

/**
 * Puts the roll-call check-ins newer than the draft's `checkedInUpTo` into the draft, oldest first:
 * "here" marks the person present (joining the call when outside it), "not here" clears the mark of
 * a person of the call. Personal links never take part. Because `checkedInUpTo` only moves forward,
 * an old check-in never overrides a hand mark. Same draft when nothing is newer.
 */
export function applyCheckIns(draft: CallDraft, checkIns: IncomingReply[]): CallDraft {
  const after = draft.checkedInUpTo ?? 0
  const fresh = checkIns
    .filter((c) => (c.answer === 'here' || c.answer === 'notHere') && c.via !== 'personal' && c.createdAt > after)
    .sort(byCreation)
  if (fresh.length === 0) return draft
  let next = draft
  for (const c of fresh) next = c.answer === 'here' ? addToCall(next, c.personId) : mark(next, c.personId, null)
  return { ...next, checkedInUpTo: fresh[fresh.length - 1].createdAt }
}

/**
 * Whether the draft holds nothing worth keeping: every mark is the presence already recorded (none for
 * a first call). Quitting such a call, e.g. right after "Redo", leaves no call in progress behind.
 */
export function isUntouched(state: DashboardState, draft: CallDraft): boolean {
  const event = hasKey(state.events, draft.eventId) ? state.events[draft.eventId] : undefined
  const recorded = (id: PersonId): Mark | undefined => {
    const present = event ? presenceOf(event, id) : undefined
    return present === undefined ? undefined : present ? 'present' : 'absent'
  }
  const inScope = new Set(draft.scope)
  return draft.scope.every((id) => markOf(draft, id) === recorded(id)) && Object.keys(draft.marks).every((id) => inScope.has(id))
}

export function progress(draft: CallDraft): { marked: number; present: number; absent: number; total: number } {
  let present = 0
  let absent = 0
  for (const id of draft.scope) {
    const value = markOf(draft, id)
    if (value === 'present') present++
    else if (value === 'absent') absent++
  }
  return { marked: present + absent, present, absent, total: draft.scope.length }
}

/** What finishing would record, with the gaps against what people said (ids in call order). */
export function callSummary(
  state: DashboardState,
  draft: CallDraft,
): { present: number; absent: number; unmarked: number; unannounced: PersonId[]; saidYesAbsent: PersonId[] } {
  const event = hasKey(state.events, draft.eventId) ? state.events[draft.eventId] : undefined
  const summary = { present: 0, absent: 0, unmarked: 0, unannounced: [] as PersonId[], saidYesAbsent: [] as PersonId[] }
  for (const id of draft.scope) {
    const value = markOf(draft, id)
    const saidYes = event !== undefined && replyOf(event, id) === 'yes'
    if (value === 'present') {
      summary.present++
      if (!saidYes) summary.unannounced.push(id)
    } else {
      // The people left unmarked are recorded absent.
      summary.absent++
      if (value === undefined) summary.unmarked++
      if (saidYes) summary.saidYesAbsent.push(id)
    }
  }
  return summary
}

/**
 * The one write of a call: marked present, everybody else of the call absent, and the event's call link
 * settled with the check-ins the draft applied. Idempotent, like recordCall.
 */
export function finishMutation(draft: CallDraft, now: number): Mutation {
  const present = draft.scope.filter((id) => markOf(draft, id) === 'present')
  const absent = draft.scope.filter((id) => markOf(draft, id) !== 'present')
  return compose(recordCall(draft.eventId, present, absent, now), settleCallLinks(draft.eventId, draft.checkedInUpTo ?? 0, now))
}

/** Drops people who no longer exist (deleted meanwhile) from a draft read back; same object when there are none. */
export function pruneDraft(state: DashboardState, draft: CallDraft): CallDraft {
  const known = (id: PersonId) => hasKey(state.people, id)
  const inScope = new Set(draft.scope)
  const kept = (id: PersonId) => known(id) && inScope.has(id)
  const clean =
    draft.scope.every(known) &&
    Object.keys(draft.marks).every(kept) &&
    draft.history.every(kept) &&
    (draft.current === null || kept(draft.current))
  if (clean) return draft
  const scope = draft.scope.filter(known)
  const remaining = new Set(scope)
  const pruned: CallDraft = {
    ...draft,
    scope,
    marks: Object.fromEntries(Object.entries(draft.marks).filter(([id]) => remaining.has(id))),
    history: draft.history.filter((id) => remaining.has(id)),
  }
  return { ...pruned, current: draft.current !== null && remaining.has(draft.current) ? draft.current : nextUnmarked(pruned, -1) }
}
