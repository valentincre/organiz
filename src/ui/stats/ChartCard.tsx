import { useMemo } from 'react'
import { chartData, type PageStats } from '../../domain/statCharts'
import type { StatPeriod, StatScope } from '../../domain/stats'
import type { DashboardState, IsoDate, StatChart } from '../../domain/types'
import { useI18n } from '../../i18n/context'
import { Menu, type MenuItem } from '../components/Menu'
import { MoreIcon } from '../components/icons'
import { cardFrame, cx } from '../components/styles'
import { OptionBars } from './OptionBars'
import { chartTitle, valueKindOf } from './statsView'
import { TimeChart } from './TimeChart'
import { useStatFormat } from './useStats'

type ChartChoices = Omit<StatChart, 'order'>

interface BodyProps {
  state: DashboardState
  chart: ChartChoices
  period: StatPeriod
  /** The page filters, applied on top of the chart's own. */
  scope: StatScope
  today: IsoDate
  /** The page's cells and arrivals for the same period and scope, narrowed by the chart instead of computed again. */
  page: PageStats
  title: string
  /** Shown instead of the chart when the period has no event (newcomers do not depend on events). */
  emptyText: string | null
}

/** What a chart draws: one large number, columns over time, or one bar per option. Also the sheet's live preview. */
export function ChartBody({ state, chart, period, scope, today, page, title, emptyText }: BodyProps) {
  const { t } = useI18n()
  const format = useStatFormat()
  const { from, to } = period
  const { people, events } = scope
  // The name does not change the data: typing it in the sheet does not recompute the preview.
  const { show, split: chartSplit, people: chartPeople, events: chartEvents } = chart
  const data = useMemo(
    () => chartData(state, { show, split: chartSplit, people: chartPeople, events: chartEvents, order: 0 }, { from, to }, { people, events }, today, page),
    [state, show, chartSplit, chartPeople, chartEvents, from, to, people, events, today, page],
  )
  const kind = valueKindOf(chart.show)

  if (emptyText && chart.show !== 'newcomers') return <p className="text-sm text-muted">{emptyText}</p>

  // Drawn from the data, never from chart.split: a split that no longer makes sense comes back as one number.
  if (data.kind === 'number') {
    const value = kind === 'rate' ? format.rate(data.value) : format.number(data.value ?? 0)
    const context =
      kind === 'rate'
        ? data.value === null
          ? t('statsPage.numbers.noRecord')
          : t('statsPage.sheet.of', { count: format.number(data.num), total: format.number(data.den) })
        : chart.show === 'present' || chart.show === 'absent'
          ? data.den > 0
            ? t('statsPage.numbers.absencesDetail', { expected: format.number(data.den) })
            : t('statsPage.numbers.noRecord')
          : null
    return (
      <p>
        <span className="block text-3xl font-semibold tabular-nums">{value}</span>
        {context && <span className="block text-sm text-muted">{context}</span>}
      </p>
    )
  }

  if (data.axis === 'time') {
    return (
      <TimeChart
        bars={data.bars.map((bar) => ({ start: bar.key, value: bar.value, count: bar.count }))}
        // Time bars only come from a month or week split.
        unit={chart.split === 'week' ? 'week' : 'month'}
        label={title}
        kind={kind}
      />
    )
  }

  // Option bars only come from a valid property split, so the property exists.
  const split = chart.split as { person: string } | { event: string }
  const def = 'person' in split ? state.personProperties[split.person] : state.eventProperties[split.event]
  return <OptionBars bars={data.bars} def={def} kind={kind} counted={'person' in split ? 'people' : 'events'} label={title} />
}

interface CardProps extends Omit<BodyProps, 'title'> {
  /** Editors get the ⋯ menu. */
  onEdit?: () => void
  onMove?: (direction: -1 | 1) => void
  onRemove?: () => void
  first: boolean
  last: boolean
}

/** A composed chart of the Statistics tab, with its title and, for editors, its menu. */
export function ChartCard({ onEdit, onMove, onRemove, first, last, ...body }: CardProps) {
  const { t } = useI18n()
  const title = chartTitle(t, body.state, body.chart)
  const items: MenuItem[] | null =
    onEdit && onMove && onRemove
      ? [
          { label: t('statsPage.chart.edit'), onSelect: onEdit },
          { label: t('statsPage.chart.moveUp'), onSelect: () => onMove(-1), disabled: first },
          { label: t('statsPage.chart.moveDown'), onSelect: () => onMove(1), disabled: last },
          { label: t('statsPage.chart.remove'), onSelect: onRemove, separated: true },
        ]
      : null

  return (
    <section className={cx(cardFrame, 'p-4')}>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="mr-auto min-w-0 font-semibold [overflow-wrap:anywhere]">{title}</h2>
        {items && <Menu label={t('statsPage.chart.menu', { name: title })} icon={<MoreIcon />} items={items} />}
      </div>
      <ChartBody {...body} title={title} />
    </section>
  )
}
