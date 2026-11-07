import { useEffect, useRef } from 'react'
import { eventTally } from '../domain/attendance'
import { todayIso } from '../domain/dates'
import { sortedProperties } from '../domain/properties'
import type { EventEntry } from '../domain/selectors'
import type { ColorKey, DashboardState, EventId, IsoDate } from '../domain/types'
import { useI18n } from '../i18n/context'
import { AttendanceBar } from './AttendanceBar'
import { useCanEdit } from './canEdit'
import { ChevronIcon, PlusIcon } from './components/icons'
import { button, card, cx, optionDot } from './components/styles'
import { eventTime, eventTitle } from './eventFormat'
import { ValueView } from './properties/ValueView'

/** Property values shown on a card; the event page has them all. */
const MAX_VALUES = 3

interface Props {
  state: DashboardState
  date: IsoDate
  /** Events of the day, in chronological order. */
  events: EventEntry[]
  selectedEvent?: EventId
  colorOf: (event: EventEntry) => ColorKey | undefined
  /** Link to an event's page. */
  eventHref: (id: EventId) => string
  onCreate: () => void
}

/** The chosen day next to the calendar (today by default): one card per event, each opening its page. */
export function DayPanel({ state, date, events, selectedEvent, colorOf, eventHref, onCreate }: Props) {
  const i18n = useI18n()
  const { t, formatDate } = i18n
  const canEdit = useCanEdit()
  const panel = useRef<HTMLElement>(null)
  const eventProperties = sortedProperties(state, 'event')
  const total = Object.keys(state.people).length
  const today = todayIso()
  const isToday = date === today

  // On small screens the panel sits below the calendar: bring it into view.
  useEffect(() => {
    const rect = panel.current?.getBoundingClientRect()
    if (rect && rect.top > window.innerHeight) panel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [date, selectedEvent])

  return (
    <section ref={panel} className={cx(card, 'scroll-mt-4 space-y-3 p-4')} aria-live="polite">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold first-letter:uppercase">{formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
          {isToday && <span className="rounded-full bg-today px-2 py-0.5 text-xs font-semibold text-warning">{t('calendar.today')}</span>}
        </div>
        {events.length > 0 && <p className="text-sm text-muted">{t('calendar.events', { count: events.length })}</p>}
      </div>

      {events.length === 0 && <p className="text-muted">{t(isToday ? 'day.nothingToday' : 'day.noEvent')}</p>}

      {events.length > 0 && (
        <ul className="space-y-2">
          {events.map((event) => {
            const color = colorOf(event)
            const shown = eventProperties.filter((p) => event.values?.[p.id] !== undefined).slice(0, MAX_VALUES)
            return (
              <li key={event.id}>
                <a
                  href={eventHref(event.id)}
                  aria-current={event.id === selectedEvent ? 'true' : undefined}
                  className={cx(
                    'block space-y-1.5 rounded-lg border bg-surface-muted/50 p-3 text-text no-underline hover:border-accent',
                    event.id === selectedEvent ? 'border-accent' : 'border-line',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className={cx('size-2.5 shrink-0 rounded-full', color ? optionDot[color] : 'bg-accent')} aria-hidden="true" />
                    <span className="min-w-0 flex-1 font-semibold [overflow-wrap:anywhere]">{eventTitle(event, i18n)}</span>
                    <ChevronIcon direction="right" small className="text-muted" />
                  </span>
                  <span className="block text-sm text-muted">{eventTime(event, i18n)}</span>
                  {shown.length > 0 && (
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                      {shown.map((p) => (
                        <ValueView key={p.id} defs={state.eventProperties} propertyId={p.id} values={event.values} compact />
                      ))}
                    </span>
                  )}
                  <AttendanceBar tally={eventTally(event, today)} total={total} className="pt-1" />
                </a>
              </li>
            )
          })}
        </ul>
      )}

      {canEdit &&
        (events.length === 0 ? (
          <button type="button" className={cx(button('primary'), 'w-full')} onClick={onCreate}>
            <PlusIcon />
            {t(isToday ? 'todayCard.create' : 'day.createEvent')}
          </button>
        ) : (
          <button type="button" className="inline-flex min-h-10 w-full cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-line px-3.5 font-medium text-muted hover:bg-surface-muted hover:text-text" onClick={onCreate}>
            <PlusIcon />
            {t('day.addOn', { date: formatDate(date, { day: 'numeric', month: 'short' }) })}
          </button>
        ))}
    </section>
  )
}
