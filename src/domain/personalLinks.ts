import { hasKey } from './limits'
import type { DashboardState, Mutation, PersonId } from './types'

/** Records the dashboard's hub; nothing happens if it already has one. */
export const setHub =
  (hub: { id: string; key: string }): Mutation =>
  (state) =>
    state.hub ? state : { ...state, hub: { id: hub.id, key: hub.key } }

/** Gives a person their own link; nothing happens for an unknown person or one who already has a link. */
export const createPersonalLink =
  (personId: PersonId, secret: string, now = Date.now()): Mutation =>
  (state) => {
    if (!hasKey(state.people, personId) || (state.personalLinks && hasKey(state.personalLinks, personId))) return state
    return { ...state, personalLinks: { ...state.personalLinks, [personId]: { secret, createdAt: now } } }
  }

/** Removes a person's link; `personalLinks` is dropped when it becomes empty. */
export const revokePersonalLink =
  (personId: PersonId): Mutation =>
  (state) => {
    if (!state.personalLinks || !hasKey(state.personalLinks, personId)) return state
    const { personalLinks, ...rest } = state
    const remaining = { ...personalLinks }
    delete remaining[personId]
    return Object.keys(remaining).length > 0 ? { ...rest, personalLinks: remaining } : rest
  }

/** Whether the person has a personal link, which locks their replies against hand edits. */
export const isLocked = (state: DashboardState, personId: PersonId): boolean => !!state.personalLinks && hasKey(state.personalLinks, personId)
