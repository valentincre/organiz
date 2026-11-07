import { hasKey, LIMITS } from './limits'
import type { AppEvent, DashboardState, EventId, Mutation, ShareEntry, ShareId, ShareKind, Visibility } from './types'

/** Local time of the device for a date and an optional "HH:MM". */
function localTime(date: string, time: string | undefined, fallback: string): number {
  const [y, m, d] = date.split('-').map(Number)
  const [h, min] = (time ?? fallback).split(':').map(Number)
  return new Date(y, m - 1, d, h, min).getTime()
}

/** When a link closes by itself: a presence link at the start of the event, a roll-call link at its end. */
export function closesAtFor(kind: ShareKind, event: Pick<AppEvent, 'date' | 'start' | 'end'>): number {
  return kind === 'presence' ? localTime(event.date, event.start, '00:00') : localTime(event.date, event.end, '23:59')
}

export const isShareOpen = (share: ShareEntry, now: number): boolean => !share.closed && (share.closesAt === null || now < share.closesAt)

/** Every share of the event still in the state, open or not. */
export const sharesOf = (state: DashboardState, eventId: EventId): [ShareId, ShareEntry][] =>
  Object.entries(state.shares ?? {}).filter(([, share]) => share.eventId === eventId)

export const openShareOf = (state: DashboardState, eventId: EventId, kind: ShareKind, now: number): [ShareId, ShareEntry] | undefined =>
  sharesOf(state, eventId).find(([, share]) => share.kind === kind && isShareOpen(share, now))

const withShare = (state: DashboardState, id: ShareId, update: (share: ShareEntry) => ShareEntry | null): DashboardState => {
  if (!state.shares || !hasKey(state.shares, id)) return state
  const next = update(state.shares[id])
  return next === null ? state : { ...state, shares: { ...state.shares, [id]: next } }
}

/** Opens a link; nothing happens if the event is missing, already has an open link of that kind, or the limit is reached. */
export const addShare =
  (
    id: ShareId,
    init: { eventId: EventId; kind: ShareKind; key: string; visibility: Visibility; autoClose: boolean },
    now = Date.now(),
  ): Mutation =>
  (state) => {
    const { eventId, kind, key, visibility, autoClose } = init
    if (!hasKey(state.events, eventId) || (state.shares && hasKey(state.shares, id))) return state
    if (Object.keys(state.shares ?? {}).length >= LIMITS.shares || openShareOf(state, eventId, kind, now)) return state
    const share: ShareEntry = {
      eventId,
      kind,
      key,
      visibility,
      autoClose,
      closesAt: autoClose ? closesAtFor(kind, state.events[eventId]) : null,
      closed: false,
      createdAt: now,
      mergedUpTo: 0,
    }
    return { ...state, shares: { ...state.shares, [id]: share } }
  }

/** A private link cannot become public once someone replied, since they replied in private. */
export const setShareVisibility =
  (id: ShareId, visibility: Visibility): Mutation =>
  (state) =>
    withShare(state, id, (share) =>
      share.visibility === visibility || (visibility === 'public' && share.replied) ? null : { ...share, visibility },
    )

export const closeShare =
  (id: ShareId): Mutation =>
  (state) =>
    withShare(state, id, (share) => (share.closed ? null : { ...share, closed: true }))

/** Drops the share from the state, deleting the record when it becomes empty. */
export const forgetShare =
  (id: ShareId): Mutation =>
  (state) => {
    if (!state.shares || !hasKey(state.shares, id)) return state
    const { [id]: _forgotten, ...rest } = state.shares
    const { shares: _shares, ...others } = state
    return Object.keys(rest).length === 0 ? others : { ...state, shares: rest }
  }

/** Keeps the first keys saved, so two organizers creating keys at once end up with the same pair. */
export const setOrganizerKeys =
  (keys: { publicKey: string; privateKey: string }): Mutation =>
  (state) =>
    state.organizerKeys ? state : { ...state, organizerKeys: keys }

/** The visibility of the event's latest presence link, or null when it has none (the sheet then asks). */
export const callVisibilityFor = (state: DashboardState, eventId: EventId): Visibility | null => {
  const latest = sharesOf(state, eventId)
    .map(([, share]) => share)
    .filter((share) => share.kind === 'presence')
    .sort((a, b) => b.createdAt - a.createdAt)[0]
  return latest ? latest.visibility : null
}

/**
 * Finishing a call settles the event's roll-call links created up to then: closed and finished, with
 * the check-ins up to `upTo` counted as merged. Later check-ins fold into presence. Idempotent.
 */
export const settleCallLinks =
  (eventId: EventId, upTo: number, finishedAt: number): Mutation =>
  (state) => {
    if (!state.shares) return state
    let shares = state.shares
    for (const [id, share] of sharesOf(state, eventId)) {
      if (share.kind !== 'call' || share.finished || share.createdAt > finishedAt) continue
      shares = { ...shares, [id]: { ...share, finished: true, closed: true, mergedUpTo: Math.max(share.mergedUpTo, upTo) } }
    }
    return shares === state.shares ? state : { ...state, shares }
  }
