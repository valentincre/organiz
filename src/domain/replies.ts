import { hasKey, LIMITS } from './limits'
import { setPresences, setReplyLists, setReply } from './mutations'
import type { Answer, AppEvent, DashboardState, EventId, IsoDate, Mutation, PersonId, Reply, ReplyTrace, ShareId } from './types'

/** A decrypted, validated reply as organizer apps and respondent pages see it. */
export interface IncomingReply {
  /** Firestore document id; breaks ties between replies created in the same millisecond (the lowest id is applied first, so it wins for one person). */
  id: string
  shareId: ShareId
  /** Server time (ms). */
  createdAt: number
  personId: PersonId
  /** 'here' and 'notHere' are roll-call check-ins: a call draft takes them, and the fold once the call link is finished. */
  answer: Answer | 'here' | 'notHere'
  device: string
  via: 'shared' | 'personal'
  /**
   * The person secret this reply's MAC was verified against, set only for a personal reply whose
   * MAC checks out and whose `sentAt` is within a day of `createdAt`.
   */
  signedWith?: string
  /** The device time the reply was signed with; set along with `signedWith`. */
  sentAt?: number
}

export const byCreation = (a: IncomingReply, b: IncomingReply): number => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

const answerOf = (event: AppEvent, id: PersonId): Answer => (event.yes?.includes(id) ? 'yes' : event.no?.includes(id) ? 'no' : 'none')

/**
 * Folds the replies of every link in one global (createdAt, id) order, so the
 * result does not depend on how they are grouped or in which order they arrive:
 * the most recent reply or hand edit of each person wins. Idempotent. Each
 * share keeps its own mergedUpTo and replied; replies of unknown shares are ignored.
 * An unfinished call link of an existing event is left untouched, so its check-ins wait for a call
 * draft; once the link is finished, later check-ins become presence on a called event. One whose
 * event was deleted skips its replies, so it can clean up.
 * On presence links, a person with a personal link answers only through it, signed with its
 * current secret, and sent after the last personal reply taken (its trace keeps that `sentAt`, even
 * after a hand edit), so a signed reply added again later is ignored; a personal reply for anyone
 * else never counts. Ignored replies still move mergedUpTo.
 */
export const foldAllReplies =
  (replies: IncomingReply[]): Mutation =>
  (state) => {
    const shares = state.shares
    if (!shares) return state
    const newest = new Map<ShareId, number>()
    const events = { ...state.events }
    let changed = false
    for (const reply of [...replies].sort(byCreation)) {
      if (!hasKey(shares, reply.shareId)) continue
      const share = shares[reply.shareId]
      const eventId = share.eventId
      const event = hasKey(events, eventId) ? events[eventId] : undefined
      // An unfinished call link keeps everything for the call draft: nothing folded, mergedUpTo and replied unmoved.
      // Once its event is deleted there is no call to wait for: its replies are skipped, so the link can clean up.
      if (share.kind === 'call' && !share.finished && event) continue
      newest.set(reply.shareId, reply.createdAt)
      if (share.kind === 'call') {
        // After Finish, a late check-in is presence; those up to mergedUpTo are already in the call.
        const checkIn = reply.answer === 'here' || reply.answer === 'notHere'
        if (event?.calledAt !== undefined && checkIn && reply.via === 'shared' && reply.createdAt > share.mergedUpTo && hasKey(state.people, reply.personId)) {
          const placed = setPresences(eventId, [reply.personId], reply.answer === 'here')({ ...state, events })
          if (placed.events[eventId] !== event) {
            events[eventId] = placed.events[eventId]
            changed = true
          }
        }
        continue
      }
      if (!event || reply.answer === 'here' || reply.answer === 'notHere' || !hasKey(state.people, reply.personId)) continue
      const link = state.personalLinks && hasKey(state.personalLinks, reply.personId) ? state.personalLinks[reply.personId] : undefined
      if (link ? reply.via !== 'personal' || reply.signedWith !== link.secret : reply.via === 'personal') continue
      const trace = event.replyLog && hasKey(event.replyLog, reply.personId) ? event.replyLog[reply.personId] : undefined
      if (trace && (trace.at ?? 0) >= reply.createdAt) continue
      // A signed reply copied and added again: not sent after the last personal reply taken.
      if (reply.via === 'personal' && trace?.sentAt !== undefined && !((reply.sentAt ?? -Infinity) > trace.sentAt)) continue
      const previous = answerOf(event, reply.personId)
      // A trimmed trace has no device left to disagree with.
      const disagrees = trace?.via === 'shared' && trace.device !== undefined && trace.device !== reply.device && previous !== reply.answer
      const others = disagrees
        ? [{ answer: previous, at: trace.at ?? 0, device: trace.device! }, ...(trace.others ?? [])].slice(0, LIMITS.traceOthers)
        : trace?.others
      const sentAt = reply.via === 'personal' ? reply.sentAt : trace?.sentAt
      const next: ReplyTrace = {
        via: reply.via,
        at: reply.createdAt,
        device: reply.device,
        ...(others && others.length > 0 && { others }),
        ...(sentAt !== undefined && { sentAt }),
      }
      const placed = setReplyLists(event, [reply.personId], reply.answer === 'none' ? null : reply.answer)
      events[eventId] = { ...placed, replyLog: { ...placed.replyLog, [reply.personId]: next } }
      changed = true
    }
    let nextShares = shares
    for (const [shareId, createdAt] of newest) {
      const share = shares[shareId]
      const mergedUpTo = Math.max(share.mergedUpTo, createdAt)
      if (mergedUpTo !== share.mergedUpTo || !share.replied) nextShares = { ...nextShares, [shareId]: { ...share, mergedUpTo, replied: true } }
    }
    if (!changed && nextShares === shares) return state
    return { ...state, ...(changed && { events }), shares: nextShares }
  }

/** Folds the replies of one link; replies of other links are ignored. */
export const foldReplies = (shareId: ShareId, replies: IncomingReply[]): Mutation =>
  foldAllReplies(replies.filter((reply) => reply.shareId === shareId))

/** The state readers see: every link's replies folded in. */
export const foldAll = (state: DashboardState, replies: IncomingReply[]): DashboardState => foldAllReplies(replies)(state)

/**
 * The conflict sheet's "Keep": the organizer settles on a reply, traced as a
 * hand edit with no leftover disagreement. Idempotent: replayed on a state
 * where it is already settled, it changes nothing.
 */
export const keepReply =
  (eventId: EventId, personId: PersonId, reply: Reply, at = Date.now()): Mutation =>
  (state) => {
    if (!hasKey(state.events, eventId)) return state
    const current = state.events[eventId]
    const before = current.replyLog && hasKey(current.replyLog, personId) ? current.replyLog[personId] : undefined
    if (before?.via === 'hand' && !before.others && answerOf(current, personId) === reply) return state
    // Later than the trace it settles, so a skewed device clock cannot let a re-fold undo "Keep".
    const when = before ? Math.max(at, (before.at ?? 0) + 1) : at
    const set = setReply(eventId, personId, reply, when)(state)
    if (!hasKey(set.people, personId)) return set
    const event = set.events[eventId]
    const trace = event.replyLog && hasKey(event.replyLog, personId) ? event.replyLog[personId] : undefined
    if (!trace || answerOf(event, personId) !== reply || (trace.via === 'hand' && trace.at === when && !trace.others)) return set
    const kept: ReplyTrace = { via: 'hand', at: when, ...(trace.sentAt !== undefined && { sentAt: trace.sentAt }) }
    return { ...set, events: { ...set.events, [eventId]: { ...event, replyLog: { ...event.replyLog, [personId]: kept } } } }
  }

/** The time a "Keep" must carry to stay later than every reply the conflict sheet showed, including those not folded yet. */
export const keepTime = (trace: ReplyTrace, now = Date.now()): number =>
  Math.max(now, (trace.at ?? 0) + 1, ...(trace.others ?? []).map((other) => other.at + 1))

/** Marks the replies up to `at` as seen; never moves backwards. */
export const markRepliesSeen =
  (eventId: EventId, at = Date.now()): Mutation =>
  (state) => {
    if (!hasKey(state.events, eventId)) return state
    const event = state.events[eventId]
    const seen = Math.max(event.repliesSeenAt ?? 0, at)
    return seen === event.repliesSeenAt ? state : { ...state, events: { ...state.events, [eventId]: { ...event, repliesSeenAt: seen } } }
  }

/** People whose latest reply came from a link and arrived after the organizer last looked. */
export const newReplies = (event: AppEvent): PersonId[] =>
  Object.entries(event.replyLog ?? {})
    .filter(([, trace]) => trace.via !== 'hand' && (trace.at ?? 0) > (event.repliesSeenAt ?? 0))
    .map(([id]) => id)

export const hasConflict = (trace: ReplyTrace | undefined): boolean => (trace?.others?.length ?? 0) > 0

/** Phone 1, 2… for the conflict sheet: devices numbered by their first reply, oldest first, among the trace and its `others`. */
export function deviceNumbers(trace: ReplyTrace): Map<string, number> {
  const entries = [...(trace.others ?? []), ...(trace.device ? [{ at: trace.at ?? 0, device: trace.device }] : [])]
  const numbers = new Map<string, number>()
  for (const { device } of entries.sort((a, b) => a.at - b.at)) {
    if (device && !numbers.has(device)) numbers.set(device, numbers.size + 1)
  }
  return numbers
}

/**
 * Keeps only where each reply came from on the events that are over and have no link left: the
 * time, the device, the disagreements, the replay guard and the "seen" mark serve only while
 * replies can still arrive, and they weigh most of a dashboard with links (gzip cannot shrink them).
 */
export const trimTraces =
  (today: IsoDate): Mutation =>
  (state) => {
    const linked = new Set(Object.values(state.shares ?? {}).map((share) => share.eventId))
    let events: DashboardState['events'] | null = null
    for (const [eventId, event] of Object.entries(state.events)) {
      if (event.date >= today || linked.has(eventId)) continue
      const log = event.replyLog ?? {}
      if (event.repliesSeenAt === undefined && Object.values(log).every((trace) => Object.keys(trace).length === 1)) continue
      const { repliesSeenAt: _seen, ...rest } = event
      const replyLog = Object.fromEntries(Object.entries(log).map(([id, trace]) => [id, { via: trace.via }]))
      events ??= { ...state.events }
      events[eventId] = event.replyLog ? { ...rest, replyLog } : rest
    }
    return events ? { ...state, events } : state
  }
