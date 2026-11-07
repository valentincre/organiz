import type { ReactNode } from 'react'
import { countedCount } from '../domain/attendance'
import { addMonths, monthGrid, monthOf, todayIso, type YearMonth } from '../domain/dates'
import type { EventEntry } from '../domain/selectors'
import type { ColorKey, IsoDate } from '../domain/types'
import { useI18n } from '../i18n/context'
import { eventTitle } from './eventFormat'
import { ChevronIcon } from './components/icons'
import { button, cx, optionChip, optionDot } from './components/styles'
import { useDateFocus } from './components/useDateFocus'
import { useDayLabel } from './useDayLabel'

interface Props {
  month: YearMonth
  onMonthChange: (month: YearMonth) => void
  /** Events of each day, in chronological order. */
  eventsByDate: Map<IsoDate, EventEntry[]>
  colorOf: (event: EventEntry) => ColorKey | undefined
  selected?: IsoDate
  onSelect: (date: IsoDate) => void
  /** The view picker, next to the title. */
  viewSelect?: ReactNode
}

/** Chips per day on wide screens; more events show as "+n". */
const MAX_CHIPS = 2

export function MonthGrid({ month, onMonthChange, eventsByDate, colorOf, selected, onSelect, viewSelect }: Props) {
  const i18n = useI18n()
  const { t, formatMonth, weekdays } = i18n
  const dayLabel = useDayLabel()
  const today = todayIso()
  const { container, focusDate } = useDateFocus<HTMLDivElement>(month, selected)

  const goToToday = () => {
    onMonthChange(monthOf(today))
    onSelect(today)
    focusDate(today)
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold whitespace-nowrap capitalize">{formatMonth(month)}</h2>
        {viewSelect}
        <div className="ml-auto flex gap-2">
          <button type="button" className={cx(button(), 'min-h-9 px-3 text-sm')} onClick={goToToday}>
            {t('calendar.today')}
          </button>
          <button
            type="button"
            className={cx(button(), 'min-h-9 w-9 px-0')}
            aria-label={t('calendar.prev')}
            onClick={() => onMonthChange(addMonths(month, -1))}
          >
            <ChevronIcon direction="left" />
          </button>
          <button
            type="button"
            className={cx(button(), 'min-h-9 w-9 px-0')}
            aria-label={t('calendar.next')}
            onClick={() => onMonthChange(addMonths(month, 1))}
          >
            <ChevronIcon direction="right" />
          </button>
        </div>
      </div>

      <div ref={container} className="grid grid-cols-7 gap-1">
        {weekdays.map((day) => (
          <div key={day} className="pb-1 text-center text-xs font-medium text-muted capitalize" aria-hidden="true">
            {day}
          </div>
        ))}
        {monthGrid(month).map(({ date, inMonth }) => {
          const events = eventsByDate.get(date)
          const isSelected = date === selected
          const label = dayLabel(date, events)
          return (
            <button
              key={date}
              type="button"
              aria-label={label}
              aria-pressed={isSelected}
              aria-current={date === today ? 'date' : undefined}
              data-date={date}
              onClick={() => onSelect(date)}
              className={cx(
                'flex h-14 min-w-0 cursor-pointer flex-col items-center justify-start gap-1 rounded-lg border bg-surface p-1 text-sm sm:h-20 sm:items-stretch sm:p-1',
                isSelected ? 'border-accent ring-1 ring-accent' : 'border-transparent hover:border-line',
                !inMonth && 'opacity-40',
              )}
            >
              <span
                className={cx(
                  'inline-flex size-6 shrink-0 items-center justify-center rounded-full',
                  date === today && 'bg-warning font-semibold text-bg',
                )}
              >
                {Number(date.slice(8))}
              </span>
              {events && (
                <>
                  {/* Phones: one dot per event. */}
                  <span className="flex gap-0.5 sm:hidden" aria-hidden="true">
                    {events.slice(0, 3).map((event) => {
                      const color = colorOf(event)
                      return <span key={event.id} className={cx('size-1.5 rounded-full', color ? optionDot[color] : 'bg-accent')} />
                    })}
                  </span>
                  {/* Wider screens: the title and the number present. */}
                  <span className="flex min-w-0 flex-col gap-0.5 max-sm:hidden" aria-hidden="true">
                    {events.slice(0, events.length > MAX_CHIPS ? MAX_CHIPS - 1 : MAX_CHIPS).map((event) => {
                      const color = colorOf(event)
                      return (
                        <span
                          key={event.id}
                          className={cx('flex min-w-0 items-center gap-1 rounded px-1 text-xs leading-5', color ? optionChip[color] : 'bg-accent-soft text-text')}
                        >
                          <span className="min-w-0 flex-1 truncate">{eventTitle(event, i18n)}</span>
                          {date <= today && <span className="font-semibold tabular-nums">{countedCount(event)}</span>}
                        </span>
                      )
                    })}
                    {events.length > MAX_CHIPS && (
                      <span className="px-1 text-xs text-muted">{t('calendar.moreEvents', { count: events.length - MAX_CHIPS + 1 })}</span>
                    )}
                  </span>
                </>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
