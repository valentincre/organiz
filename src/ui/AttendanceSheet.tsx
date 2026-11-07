import { useState } from 'react'
import { LIMITS } from '../domain/limits'
import { inSeriesScope, setEventName, type SeriesScope } from '../domain/mutations'
import { sortedProperties } from '../domain/properties'
import { eventEntry, type EventEntry } from '../domain/selectors'
import type { DashboardState, EventId, Mutation } from '../domain/types'
import { useI18n } from '../i18n/context'
import { navigate, viewPath, type DashboardView } from '../router'
import type { DashboardRef } from '../storage/link'
import { EditableTitle } from './components/EditableTitle'
import { EventAttendance } from './EventAttendance'
import { EventDetails } from './EventDetails'
import { eventTime, eventTitle } from './eventFormat'
import { PropertiesDialog } from './properties/PropertiesDialog'
import { RequestReplies } from './replies/RequestReplies'
import { ValueView } from './properties/ValueView'
import { BackLink, SplitPage } from './SplitPage'

interface Props {
  dashboardRef: DashboardRef
  state: DashboardState
  view: Extract<DashboardView, { tab: 'sheet' | 'draft' }>
  eventId: EventId
  /** The event when it is a new one, not saved yet; its first change saves it. */
  draft?: EventEntry
  mutate: (mutation: Mutation) => void
  onImport: () => void
}

export function AttendanceSheet({ dashboardRef, state, view, eventId, draft, mutate, onImport }: Props) {
  const i18n = useI18n()
  const { t, formatDate } = i18n
  const { period, filters } = view
  const event = draft ?? eventEntry(state, eventId)
  // Whether name and time changes also apply to the following events of the series.
  const [scope, setScope] = useState<SeriesScope>('one')
  const [scopeEvent, setScopeEvent] = useState(eventId)
  // Another event starts with "this event only" again.
  if (scopeEvent !== eventId) {
    setScopeEvent(eventId)
    setScope('one')
  }
  const eventProperties = sortedProperties(state, 'event')
  // Here rather than in the details: on phones they are folded, and the dialog must survive the switch.
  const [propertiesOpen, setPropertiesOpen] = useState(false)

  const backHref = `#${viewPath(dashboardRef, draft ? { tab: 'calendar', date: draft.date, period, filters } : { tab: 'calendar', eventId, period, filters })}`
  const back = { href: backHref, label: t('sheet.back') }

  if (draft && Object.keys(state.events).length >= LIMITS.events) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <BackLink {...back} />
        <p className="py-6 text-center text-muted">{t('event.limit', { count: LIMITS.events })}</p>
      </div>
    )
  }

  if (!event) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <BackLink {...back} />
        <p className="py-6 text-center text-muted">{t('sheet.notFound')}</p>
      </div>
    )
  }

  const details = (
    <EventDetails
      key={event.id}
      state={state}
      event={event}
      draft={Boolean(draft)}
      mutate={mutate}
      scope={scope}
      onScopeChange={setScope}
      onManageProperties={() => setPropertiesOpen(true)}
      onDeleted={() => navigate(viewPath(dashboardRef, { tab: 'calendar', date: event.date, period, filters }))}
    />
  )

  return (
    <>
      <SplitPage
        back={back}
        expanded={propertiesOpen || Boolean(draft)}
        header={
          <div>
            <EditableTitle
              as="h2"
              value={event.name}
              onChange={(name) => mutate(inSeriesScope(event, scope, (id) => setEventName(id, name)))}
              label={t('event.name')}
              editLabel={t('event.rename')}
              maxLength={LIMITS.eventName}
              placeholder={eventTitle({ name: '', date: event.date }, i18n)}
              allowEmpty
            />
            <p className="text-muted first-letter:uppercase">
              {formatDate(event.date, { dateStyle: 'full' })} · {eventTime(event, i18n)}
            </p>
            {!draft && <RequestReplies key={event.id} dashboardRef={dashboardRef} state={state} event={event} mutate={mutate} />}
          </div>
        }
        details={details}
        summary={
          <>
            {t('event.editTitle')}
            {eventProperties.map((p) => (
              <ValueView key={p.id} defs={state.eventProperties} propertyId={p.id} values={event.values} compact withName />
            ))}
          </>
        }
      >
        <EventAttendance dashboardRef={dashboardRef} state={state} view={view} event={event} mutate={mutate} onImport={onImport} />
      </SplitPage>
      <PropertiesDialog open={propertiesOpen} onClose={() => setPropertiesOpen(false)} scope="event" state={state} mutate={mutate} />
    </>
  )
}
