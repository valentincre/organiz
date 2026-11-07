import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react'
import { eventTally } from '../domain/attendance'
import { addDays, todayIso } from '../domain/dates'
import { firstHourToShow, layoutDay, type DayItem } from '../domain/dayLayout'
import type { EventEntry } from '../domain/selectors'
import type { DashboardState, EventId, IsoDate, Time } from '../domain/types'
import { useI18n } from '../i18n/context'
import { useCanEdit } from './canEdit'
import { useTallyLabel } from './useTallyLabel'
import { ChevronIcon, PlusIcon } from './components/icons'
import { button, cx, optionChip } from './components/styles'
import { eventTime, eventTitle } from './eventFormat'
import { useEventColor } from './useEventColor'

/** Pixels per minute: one hour is 48 px. */
const SCALE = 0.8
const HOURS = Array.from({ length: 24 }, (_, hour) => hour)

interface Props {
  state: DashboardState
  date: IsoDate
  /** Events of the day (already filtered), in chronological order. */
  events: EventEntry[]
  selectedEvent?: EventId
  onDateChange: (date: IsoDate) => void
  onSelectEvent: (id: EventId) => void
  onCreate: (start?: Time) => void
  /** The view picker, next to the title. */
  viewSelect?: ReactNode
}

export function DayView({ state, date, events, selectedEvent, onDateChange, onSelectEvent, onCreate, viewSelect }: Props) {
  const i18n = useI18n()
  const { t, lang, formatDate } = i18n
  const canEdit = useCanEdit()
  const tallyLabel = useTallyLabel()
  const today = todayIso()
  const scroller = useRef<HTMLDivElement>(null)
  const colorOf = useEventColor(state)
  const allDay = events.filter((event) => !event.start)
  const timed = events.filter((event) => event.start)
  const items: DayItem[] = timed.map((event) => ({ id: event.id, start: event.start!, end: event.end }))
  const placed = layoutDay(items)
  const byId = new Map(timed.map((event) => [event.id, event]))
  const firstHour = firstHourToShow(items)
  const hourLabel = (hour: number) =>
    new Intl.DateTimeFormat(lang, { hour: 'numeric', timeZone: 'UTC' }).format(Date.UTC(2000, 0, 1, hour))

  // Show the morning, or the first event, when the day changes.
  useEffect(() => {
    // A few pixels above the hour line so its label is not cut.
    scroller.current?.scrollTo({ top: Math.max(0, firstHour * 60 * SCALE - 10) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date])

  const createAt = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    const minutes = (event.nativeEvent.offsetY / SCALE) | 0
    const half = Math.min(23 * 60 + 30, Math.floor(minutes / 30) * 30)
    onCreate(`${String(Math.floor(half / 60)).padStart(2, '0')}:${String(half % 60).padStart(2, '0')}`)
  }

  const block = (event: EventEntry) => {
    const color = colorOf(event)
    return cx(
      'cursor-pointer overflow-hidden rounded-md border px-2 py-1 text-left text-sm',
      color ? cx(optionChip[color], 'border-transparent') : 'border-accent/40 bg-accent-soft text-text',
      event.id === selectedEvent && 'ring-2 ring-accent',
    )
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold first-letter:uppercase">{formatDate(date, { dateStyle: 'full' })}</h2>
        {viewSelect}
        <div className="ml-auto flex flex-wrap justify-end gap-2">
          <button type="button" className={cx(button(), 'min-h-9 px-3 text-sm')} onClick={() => onDateChange(todayIso())}>
            {t('calendar.today')}
          </button>
          <button type="button" className={cx(button(), 'min-h-9 w-9 px-0')} aria-label={t('calendar.prevDay')} onClick={() => onDateChange(addDays(date, -1))}>
            <ChevronIcon direction="left" />
          </button>
          <button type="button" className={cx(button(), 'min-h-9 w-9 px-0')} aria-label={t('calendar.nextDay')} onClick={() => onDateChange(addDays(date, 1))}>
            <ChevronIcon direction="right" />
          </button>
          {canEdit && (
            <button type="button" className={cx(button('primary'), 'min-h-9 px-3 text-sm')} onClick={() => onCreate()}>
              <PlusIcon small />
              {t('day.addEvent')}
            </button>
          )}
        </div>
      </div>

      {allDay.length > 0 && (
        <ul className="mb-2 space-y-1 border-b border-line pb-2 pl-12" aria-label={t('event.allDay')}>
          {allDay.map((event) => (
            <li key={event.id}>
              <button type="button" className={cx(block(event), 'flex w-full items-center gap-2')} onClick={() => onSelectEvent(event.id)}>
                <span className="font-medium">{eventTitle(event, i18n)}</span>
                <span className="ml-auto text-xs opacity-80">{tallyLabel(eventTally(event, today))}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div ref={scroller} className="relative max-h-[30rem] overflow-y-auto">
        <div className="relative flex" style={{ height: 24 * 60 * SCALE }}>
          <div className="w-12 shrink-0" aria-hidden="true">
            {HOURS.map((hour) => (
              <div key={hour} className="relative text-right text-xs text-muted" style={{ height: 60 * SCALE }}>
                {hour > 0 && <span className="absolute -top-2 right-2">{hourLabel(hour)}</span>}
              </div>
            ))}
          </div>
          {/* Editors click an empty slot to create an event there. */}
          <div
            className={cx('relative flex-1 border-l border-line', canEdit && 'cursor-copy')}
            title={canEdit ? t('day.clickToCreate') : undefined}
            onClick={canEdit ? createAt : undefined}
          >
            {HOURS.slice(1).map((hour) => (
              <div key={hour} className="pointer-events-none absolute inset-x-0 border-t border-line" style={{ top: hour * 60 * SCALE }} />
            ))}
            {placed.map((item) => {
              const event = byId.get(item.id)!
              return (
                <button
                  key={item.id}
                  type="button"
                  className={cx(block(event), 'absolute')}
                  style={{
                    top: item.top * SCALE,
                    height: item.height * SCALE - 2,
                    left: `calc(${(item.column / item.columns) * 100}% + 2px)`,
                    width: `calc(${100 / item.columns}% - 4px)`,
                  }}
                  onClick={() => onSelectEvent(event.id)}
                >
                  <span className="block truncate font-medium">{eventTitle(event, i18n)}</span>
                  <span className="block truncate text-xs opacity-80">
                    {eventTime(event, i18n)} · {tallyLabel(eventTally(event, today))}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
      {events.length === 0 && <p className="mt-2 text-sm text-muted">{t(canEdit ? 'day.noEventHint' : 'day.noEvent')}</p>}
    </div>
  )
}
