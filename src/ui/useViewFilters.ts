import { useMemo } from 'react'
import { decodeFilter, encodeFilter, type Filter } from '../domain/filters'
import type { DashboardState } from '../domain/types'
import { navigate, viewPath, type DashboardView, type ViewFilters } from '../router'
import type { DashboardRef } from '../storage/link'

/** People and event filters of the current view, kept in the URL so they survive reloads and follow navigation. */
export function useViewFilters(state: DashboardState, dashboardRef: DashboardRef, view: DashboardView) {
  const encoded = view.filters
  const peopleFilter = useMemo(() => decodeFilter(encoded?.people, state.personProperties), [encoded?.people, state.personProperties])
  const eventFilter = useMemo(() => decodeFilter(encoded?.events, state.eventProperties), [encoded?.events, state.eventProperties])

  const update = (next: ViewFilters) => {
    const filters: ViewFilters = {
      ...(next.people && { people: next.people }),
      ...(next.events && { events: next.events }),
    }
    // Filters change at every click or keystroke: keep one history entry.
    navigate(viewPath(dashboardRef, { ...view, filters: Object.keys(filters).length ? filters : undefined } as DashboardView), { replace: true })
  }

  return {
    peopleFilter,
    eventFilter,
    setPeopleFilter: (filter: Filter) => update({ ...encoded, people: encodeFilter(filter) }),
    setEventFilter: (filter: Filter) => update({ ...encoded, events: encodeFilter(filter) }),
  }
}
