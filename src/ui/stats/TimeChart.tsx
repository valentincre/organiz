import type { TimeUnit } from '../../domain/stats'
import type { IsoDate } from '../../domain/types'
import { useI18n } from '../../i18n/context'
import { cx } from '../components/styles'
import { barScale, type ValueKind } from './statsView'
import { useStatFormat } from './useStats'

interface Props {
  /** One column per month or week; `value` is null when nothing is behind it. */
  bars: { start: IsoDate; value: number | null; count: number }[]
  unit: TimeUnit
  /** The chart's title, which starts its text alternative. */
  label: string
  /** Rates (the default) fill a column at 100 %; counts fill it at the largest value. */
  kind?: ValueKind
}

/** Columns over time with their value above and the month or week below; scrolls sideways when they do not fit. */
export function TimeChart({ bars, unit, label, kind = 'rate' }: Props) {
  const { t, formatDate } = useI18n()
  const format = useStatFormat()
  const scale = barScale(
    bars.map((bar) => bar.value),
    kind,
  )
  const valueText = (value: number | null) => (kind === 'rate' || value === null ? format.rate(value) : format.number(value))
  // The year under the first column and the first one of each year, when the columns cross a year.
  const years = new Set(bars.map((bar) => bar.start.slice(0, 4))).size > 1
  const shortLabel = (start: IsoDate) =>
    unit === 'month' ? formatDate(start, { month: 'short' }) : formatDate(start, { day: 'numeric', month: 'short' })
  const longLabel = (start: IsoDate) =>
    unit === 'month'
      ? formatDate(start, { month: 'long', year: 'numeric' })
      : t('statsPage.weekOf', { date: formatDate(start, { dateStyle: 'medium' }) })
  const description = bars
    .map((bar) => `${longLabel(bar.start)} ${bar.value === null ? t('statsPage.noValue') : valueText(bar.value)}`)
    .join(', ')

  return (
    <div className="overflow-x-auto">
      <div role="img" aria-label={t('statsPage.chartAlt', { label, values: description })} className="flex h-40 min-w-fit gap-1.5">
        {bars.map((bar, index) => (
          <div key={bar.start} className="flex min-w-10 flex-1 flex-col items-center">
            {/* The top padding keeps room for the value above a full bar. */}
            <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-end pt-5">
              <span className={cx('text-xs leading-5 tabular-nums', bar.value === null && 'text-muted')}>{valueText(bar.value)}</span>
              {bar.value !== null && (
                <span className="block min-h-0.5 w-full shrink-0 rounded-t-md rounded-b-sm bg-accent" style={{ height: `${(bar.value / scale) * 100}%` }} />
              )}
            </div>
            <span className="mt-1 text-xs whitespace-nowrap text-muted">{shortLabel(bar.start)}</span>
            {years && (
              <span className="text-xs text-muted tabular-nums">
                {index === 0 || bar.start.slice(0, 4) !== bars[index - 1].start.slice(0, 4) ? bar.start.slice(0, 4) : ' '}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
