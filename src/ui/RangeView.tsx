import type { ReactNode } from 'react'
import { isInRange, monthOf, monthsBetween, type YearMonth } from '../domain/dates'
import type { EventEntry } from '../domain/selectors'
import type { IsoDate } from '../domain/types'
import { useI18n } from '../i18n/context'
import { input } from './components/styles'
import { MiniMonth } from './MiniMonth'

/** Beyond this, drawing every month is more noise than help. */
const MAX_MONTHS = 24

interface Props {
  from?: IsoDate
  to?: IsoDate
  onChange: (from?: IsoDate, to?: IsoDate) => void
  /** First and last day to draw when a bound is left open. */
  shownFrom: IsoDate
  shownTo: IsoDate
  eventsByDate: Map<IsoDate, EventEntry[]>
  selected?: IsoDate
  onSelect: (date: IsoDate) => void
  onOpenMonth: (month: YearMonth) => void
  /** The view picker, before the dates. */
  viewSelect?: ReactNode
}

export function RangeView({ from, to, onChange, shownFrom, shownTo, eventsByDate, selected, onSelect, onOpenMonth, viewSelect }: Props) {
  const { t } = useI18n()
  const invalid = Boolean(from && to && from > to)
  const months = invalid ? [] : monthsBetween(monthOf(shownFrom), monthOf(shownTo))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        {viewSelect}
        <label className="grid w-44 gap-1 text-sm font-medium">
          {t('range.from')}
          <input
            type="date"
            className={input}
            value={from ?? ''}
            onChange={(e) => onChange(e.target.value || undefined, to)}
          />
        </label>
        <label className="grid w-44 gap-1 text-sm font-medium">
          {t('range.to')}
          <input
            type="date"
            className={input}
            value={to ?? ''}
            min={from}
            onChange={(e) => onChange(from, e.target.value || undefined)}
          />
        </label>
        <p className="pb-2 text-sm text-muted">{t('range.toHint')}</p>
      </div>

      {invalid ? (
        <p className="font-medium text-danger" role="alert">
          {t('range.invalid')}
        </p>
      ) : months.length > MAX_MONTHS ? (
        <p className="text-sm text-muted">{t('range.tooLong', { max: MAX_MONTHS })}</p>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3">
          {months.map((month) => (
            <MiniMonth
              key={`${month.year}-${month.month}`}
              month={month}
              eventsByDate={eventsByDate}
              selected={selected}
              onSelect={onSelect}
              onOpenMonth={onOpenMonth}
              isActive={(date) => isInRange(date, from, to)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
