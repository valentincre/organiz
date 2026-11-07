import { compose } from '../../domain/mutations'
import { addShare, setOrganizerKeys, setShareVisibility } from '../../domain/shares'
import type { DashboardState, EventId, Mutation, ShareId, Visibility } from '../../domain/types'

export interface ReplyChoice {
  visibility: Visibility
  autoClose: boolean
}

export type OrganizerKeys = { publicKey: string; privateKey: string }

/** Private replies are sealed to the organizers' keys: the first private link creates them. */
export const needsOrganizerKeys = (state: DashboardState, visibility: Visibility): boolean =>
  visibility === 'private' && !state.organizerKeys

/** `mutation`, preceded by saving `keys` when `visibility` is the dashboard's first use of private replies. */
function withKeysIfNeeded(state: DashboardState, visibility: Visibility, keys: OrganizerKeys | undefined, mutation: Mutation): Mutation {
  if (!needsOrganizerKeys(state, visibility)) return mutation
  if (!keys) throw new Error('A first private link needs organizer keys')
  return compose(setOrganizerKeys(keys), mutation)
}

/**
 * Opens the event's presence link. `ids` are drawn by the caller (the link is
 * built from them at once); `keys` are required for a first private link and
 * saved with it. Replayed on a newer state, the keys another organizer saved
 * first are kept.
 */
export function openRepliesMutation(
  state: DashboardState,
  eventId: EventId,
  choice: ReplyChoice,
  ids: { shareId: ShareId; key: string },
  keys?: OrganizerKeys,
): Mutation {
  return withKeysIfNeeded(state, choice.visibility, keys, addShare(ids.shareId, { eventId, kind: 'presence', key: ids.key, ...choice }))
}

/**
 * Opens the event's roll-call link, the QR code people scan to check in. Like
 * `openRepliesMutation`, with the same rules for `ids` and `keys`.
 */
export function openCallLinkMutation(
  state: DashboardState,
  eventId: EventId,
  choice: ReplyChoice,
  ids: { shareId: ShareId; key: string },
  keys?: OrganizerKeys,
): Mutation {
  return withKeysIfNeeded(state, choice.visibility, keys, addShare(ids.shareId, { eventId, kind: 'call', key: ids.key, ...choice }))
}

/** Changes a link's visibility; like a new link, a first private one needs organizer keys. */
export const setVisibilityMutation = (state: DashboardState, shareId: ShareId, visibility: Visibility, keys?: OrganizerKeys): Mutation =>
  withKeysIfNeeded(state, visibility, keys, setShareVisibility(shareId, visibility))
