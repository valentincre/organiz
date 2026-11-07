import { createContext, useContext } from 'react'
import type { CalendarPeriod, DashboardView, ViewFilters } from '../router'

/**
 * False on a dashboard opened with its read-only link: components then show
 * values as text and leave out every control that would change the dashboard.
 */
export const CanEditContext = createContext(true)

export const useCanEdit = (): boolean => useContext(CanEditContext)

const keptContext = ({ period, filters }: { period?: CalendarPeriod; filters?: ViewFilters }) => ({
  ...(period && { period }),
  ...(filters && { filters }),
})

/**
 * The view a reader gets for `view`: the roll call and a new event only exist
 * to edit, so they show the event's sheet (read-only) or the day in the events
 * tab instead. Other views are returned as they are.
 */
export function readerView(view: DashboardView): DashboardView {
  switch (view.tab) {
    case 'call':
      return { tab: 'sheet', eventId: view.eventId, ...keptContext(view) }
    case 'draft':
      return { tab: 'calendar', date: view.date, ...keptContext(view) }
    default:
      return view
  }
}
