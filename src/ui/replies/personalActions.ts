import { compose } from '../../domain/mutations'
import { createPersonalLink, setHub } from '../../domain/personalLinks'
import { hasKey } from '../../domain/limits'
import type { DashboardState, Mutation, PersonId } from '../../domain/types'
import { buildPersonalLink } from '../../storage/link'

/** The ids a new personal link is built from, drawn by the caller. */
export interface PersonalIds {
  hubId: string
  hubKey: string
  secret: string
}

/**
 * Gives the person a link; the first one also creates the dashboard's hub.
 * Replayed on a newer state, the hub and the secret another organizer saved first are kept.
 */
export const createPersonalLinkMutation = (_state: DashboardState, personId: PersonId, ids: PersonalIds): Mutation =>
  compose(setHub({ id: ids.hubId, key: ids.hubKey }), createPersonalLink(personId, ids.secret))

/** The person's link as the state has it, i.e. the one that works now; null without one. */
export function personalLinkOf(state: DashboardState, personId: PersonId, origin: string): string | null {
  const link = state.personalLinks && hasKey(state.personalLinks, personId) ? state.personalLinks[personId] : undefined
  if (!state.hub || !link) return null
  return buildPersonalLink({ hubId: state.hub.id, hubKey: state.hub.key, personId, secret: link.secret }, origin)
}
