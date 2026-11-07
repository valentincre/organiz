import type { ChartBar } from '../../domain/statCharts'
import type { PropertyDef } from '../../domain/types'
import { useI18n } from '../../i18n/context'
import { cx, optionDot } from '../components/styles'
import { barScale, type ValueKind } from './statsView'
import { useStatFormat } from './useStats'

interface Props {
  /** One bar per option of `def`, in its order, then '' for "no value". */
  bars: ChartBar[]
  def: PropertyDef
  kind: ValueKind
  /** What `count` counts behind a rate: the people (split by a person property) or the events. */
  counted: 'people' | 'events'
  /** The chart's title, the list's accessible name. */
  label: string
}

/** One horizontal bar per option, in the option's color, with its value written out (and what it is computed on, for rates). */
export function OptionBars({ bars, def, kind, counted, label }: Props) {
  const { t } = useI18n()
  const format = useStatFormat()
  const scale = barScale(
    bars.map((bar) => bar.value),
    kind,
  )

  return (
    // From sm, the rows share their columns (subgrid), so every bar starts and ends at the same place.
    <ul aria-label={label} className="space-y-2.5 sm:grid sm:grid-cols-[fit-content(12rem)_minmax(0,1fr)_auto] sm:gap-x-3 sm:gap-y-2.5 sm:space-y-0">
      {bars.map((bar) => {
        const option = bar.key === '' ? undefined : def.options?.[bar.key]
        const fill = bar.color ? optionDot[bar.color] : 'bg-muted'
        return (
          <li
            key={bar.key}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:col-span-3 sm:grid-cols-subgrid"
          >
            <span className="flex min-w-0 items-center gap-1.5 text-sm">
              <span className={cx('size-2.5 shrink-0 rounded-full', fill)} aria-hidden="true" />
              <span className={cx('min-w-0 [overflow-wrap:anywhere]', !option && 'text-muted')}>{option?.label ?? t('statsPage.chart.noValue')}</span>
            </span>
            <span className="text-right text-sm whitespace-nowrap sm:col-start-3 sm:row-start-1">
              <span className={cx('font-semibold tabular-nums', bar.value === null && 'text-muted')}>
                {kind === 'rate' || bar.value === null ? format.rate(bar.value) : format.number(bar.value)}
              </span>
              {kind === 'rate' && bar.count > 0 && (
                <span className="text-xs text-muted" title={counted === 'events' ? t('statsPage.chart.countedHint') : undefined}>
                  {' · '}
                  {t(counted === 'people' ? 'statsPage.chart.people' : 'statsPage.chart.events', { count: bar.count })}
                </span>
              )}
            </span>
            <span className="col-span-2 h-2 overflow-hidden rounded-full bg-line sm:col-span-1 sm:col-start-2 sm:row-start-1" aria-hidden="true">
              {bar.value !== null && <span className={cx('block h-full rounded-full', fill)} style={{ width: `${(bar.value / scale) * 100}%` }} />}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
