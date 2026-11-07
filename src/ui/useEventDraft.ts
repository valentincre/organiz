import { useState } from 'react'
import { plusHour } from '../domain/dates'
import { randomId } from '../domain/ids'
import { hasKey } from '../domain/limits'
import { addEvent, compose } from '../domain/mutations'
import type { EventEntry } from '../domain/selectors'
import type { DashboardState, EventId, Mutation } from '../domain/types'
import { useI18n } from '../i18n/context'
import { navigate, viewPath, type DashboardView } from '../router'
import type { DashboardRef } from '../storage/link'
import { useToast } from './components/toast'

/**
 * The event shown by the attendance page: a saved one, or a draft that is saved by its first
 * change. Returns undefined on other views.
 */
export function useEventDraft(
  dashboardRef: DashboardRef,
  view: DashboardView,
  state: DashboardState | undefined,
  mutate: (mutation: Mutation) => void,
): { eventId: EventId; draft?: EventEntry; mutate: (mutation: Mutation) => void } | undefined {
  const { t } = useI18n()
  const toast = useToast()
  const [draftId, setDraftId] = useState(randomId)
  // A saved draft keeps its id: the next one starts with a fresh id.
  if (view.tab === 'draft' && state && hasKey(state.events, draftId)) setDraftId(randomId())

  if (view.tab === 'sheet') return { eventId: view.eventId, mutate }
  if (view.tab !== 'draft') return undefined

  const { date, start, period, filters } = view
  const times = start ? { start, end: plusHour(start) } : {}
  const draft: EventEntry = { id: draftId, date, name: '', createdAt: 0, ...times }

  const saveWith = (change: Mutation) => {
    if (!state) return
    const add = addEvent(draftId, date, times)
    const created = add(state)
    // The event limit is reached, or the change does nothing: stay a draft.
    if (created === state || change(created) === created) return
    mutate(compose(add, change))
    navigate(viewPath(dashboardRef, { tab: 'sheet', eventId: draftId, period, filters }), { replace: true })
    toast(t('draft.created'))
  }
  return { eventId: draftId, draft, mutate: saveWith }
}
