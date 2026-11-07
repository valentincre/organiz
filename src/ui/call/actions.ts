import { callScope, startCall } from '../../domain/call'
import { decodeFilter } from '../../domain/filters'
import { hasKey } from '../../domain/limits'
import type { AppEvent, DashboardState, EventId } from '../../domain/types'
import { navigate, viewPath, type CalendarPeriod, type ViewFilters } from '../../router'
import type { DashboardRef } from '../../storage/link'
import { saveCallDraft } from './callDraftStore'

/** What a view passes on to the call screen, so leaving it returns to the same list. */
export interface CallContext {
  period?: CalendarPeriod
  filters?: ViewFilters
}

const callPath = (ref: DashboardRef, eventId: EventId, { period, filters }: CallContext) =>
  viewPath(ref, { tab: 'call', eventId, period, filters })

/** The people a call on the event covers; it can start only with somebody to call. */
export const callScopeOf = (state: DashboardState, lang: string, { filters }: CallContext, event: AppEvent) =>
  callScope(state, lang, decodeFilter(filters?.people, state.personProperties), event)

/**
 * Starts the call of an event on the people of the active people filter, kept
 * on this device, and opens it. Redoing a call starts from the presence recorded.
 */
export function beginCall(ref: DashboardRef, state: DashboardState, eventId: EventId, lang: string, context: CallContext): void {
  if (!hasKey(state.events, eventId)) return
  const scope = callScopeOf(state, lang, context, state.events[eventId])
  if (scope.length === 0) return
  saveCallDraft(ref.docId, startCall(state, eventId, scope, Date.now()))
  navigate(callPath(ref, eventId, context))
}

/** Opens the call in progress where it stopped. */
export const resumeCall = (ref: DashboardRef, eventId: EventId, context: CallContext): void => navigate(callPath(ref, eventId, context))
