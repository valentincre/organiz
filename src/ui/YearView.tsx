import type { ReactNode } from 'react'
import { todayIso, type YearMonth } from '../domain/dates'
import type { EventEntry } from '../domain/selectors'
import type { IsoDate } from '../domain/types'
import { useI18n } from '../i18n/context'
import { ChevronIcon } from './components/icons'
import { button, cx } from './components/styles'
import { useDateFocus } from './components/useDateFocus'
import { MiniMonth } from './MiniMonth'

interface Props {
  year: number
  onYearChange: (year: number) => void
  eventsByDate: Map<IsoDate, EventEntry[]>
  selected?: IsoDate
  onSelect: (date: IsoDate) => void
  onOpenMonth: (month: YearMonth) => void
  /** The view picker, next to the title. */
  viewSelect?: ReactNode
}

export function YearView({ year, onYearChange, eventsByDate, selected, onSelect, onOpenMonth, viewSelect }: Props) {
  const { t } = useI18n()
  const navButton = cx(button(), 'min-h-9 w-9 px-0')
  const { container, focusDate } = useDateFocus<HTMLDivElement>(year, selected)

  const goToToday = () => {
    const today = todayIso()
    onYearChange(Number(today.slice(0, 4)))
    onSelect(today)
    focusDate(today)
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold tabular-nums">{year}</h2>
        {viewSelect}
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            className={cx(button(), 'min-h-9 px-3 text-sm')}
            onClick={goToToday}
          >
            {t('calendar.thisYear')}
          </button>
          <button type="button" className={navButton} aria-label={t('calendar.prevYear')} onClick={() => onYearChange(year - 1)}>
            <ChevronIcon direction="left" />
          </button>
          <button type="button" className={navButton} aria-label={t('calendar.nextYear')} onClick={() => onYearChange(year + 1)}>
            <ChevronIcon direction="right" />
          </button>
        </div>
      </div>
      <div ref={container} className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3">
        {Array.from({ length: 12 }, (_, month) => (
          <MiniMonth
            key={month}
            month={{ year, month }}
            eventsByDate={eventsByDate}
            selected={selected}
            onSelect={onSelect}
            onOpenMonth={onOpenMonth}
          />
        ))}
      </div>
    </div>
  )
}
