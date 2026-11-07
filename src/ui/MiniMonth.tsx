import type { ReactNode } from 'react'
import { monthGrid, todayIso, type YearMonth } from '../domain/dates'
import type { EventEntry } from '../domain/selectors'
import type { IsoDate } from '../domain/types'
import { useI18n } from '../i18n/context'
import { cx } from './components/styles'
import { useDayLabel } from './useDayLabel'

interface Props {
  month: YearMonth
  eventsByDate: Map<IsoDate, EventEntry[]>
  selected?: IsoDate
  onSelect: (date: IsoDate) => void
  onOpenMonth: (month: YearMonth) => void
  /** Days for which this returns false are shown faded (outside a period). */
  isActive?: (date: IsoDate) => boolean
  /** Buttons on the right of the month name. */
  nav?: ReactNode
}

/** Compact month for the year and period views: event days are filled. */
export function MiniMonth({ month, eventsByDate, selected, onSelect, onOpenMonth, isActive = () => true, nav }: Props) {
  const { t, formatMonth, weekdays } = useI18n()
  const dayLabel = useDayLabel()
  const today = todayIso()
  const label = formatMonth(month)

  return (
    <div>
      <div className="mb-1 flex items-center gap-1">
        <button
          type="button"
          className="mr-auto cursor-pointer rounded px-1 text-sm font-semibold capitalize hover:bg-surface-muted"
          title={t('calendar.openMonth', { month: label })}
          onClick={() => onOpenMonth(month)}
        >
          {label}
        </button>
        {nav}
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-xs">
        {weekdays.map((day) => (
          <span key={day} className="text-[0.65rem] text-muted" aria-hidden="true">
            {day.charAt(0).toUpperCase()}
          </span>
        ))}
        {monthGrid(month).map(({ date, inMonth }) => {
          if (!inMonth) return <span key={date} />
          const dayEvents = eventsByDate.get(date)
          const active = isActive(date)
          return (
            <button
              key={date}
              type="button"
              aria-pressed={date === selected}
              aria-current={date === today ? 'date' : undefined}
              data-date={date}
              aria-label={dayLabel(date, dayEvents)}
              title={dayEvents ? dayLabel(date, dayEvents) : undefined}
              onClick={() => onSelect(date)}
              className={cx(
                'aspect-square cursor-pointer rounded tabular-nums',
                dayEvents && active ? 'bg-accent font-semibold text-on-accent' : 'hover:bg-surface-muted',
                dayEvents && !active && 'bg-accent-soft',
                !active && 'opacity-35',
                date === selected && 'ring-2 ring-text',
                date === today && (dayEvents ? 'ring-2 ring-warning ring-offset-1 ring-offset-surface' : 'bg-today font-bold text-accent'),
              )}
            >
              {Number(date.slice(8))}
            </button>
          )
        })}
      </div>
    </div>
  )
}
