import { useMemo, useState } from 'react'
import { todayIso } from '../../domain/dates'
import { randomId } from '../../domain/ids'
import { LIMITS } from '../../domain/limits'
import { addChart, moveChart, removeChart, sortedCharts, updateChart } from '../../domain/statCharts'
import { resolvePeriod } from '../../domain/statPeriod'
import { seriesUnit } from '../../domain/stats'
import type { ChartId, DashboardState, IsoDate, Mutation, PersonId } from '../../domain/types'
import { useI18n } from '../../i18n/context'
import { navigate, viewPath, type DashboardView } from '../../router'
import type { DashboardRef } from '../../storage/link'
import { PlusIcon } from '../components/icons'
import { cardFrame, cx } from '../components/styles'
import { useViewFilters } from '../useViewFilters'
import { ChartCard } from './ChartCard'
import { ChartSheet } from './ChartSheet'
import { PeoplePreview } from './PeoplePreview'
import { PersonStatsSheet } from './PersonStatsSheet'
import { StatsControls } from './StatsControls'
import { StatsPeoplePage } from './StatsPeoplePage'
import { StatNumbers } from './StatNumbers'
import { attendanceBars, listedPeople } from './statsView'
import { TimeChart } from './TimeChart'
import { useStats } from './useStats'

type StatsView = Extract<DashboardView, { tab: 'stats' }>

interface Props {
  dashboardRef: DashboardRef
  state: DashboardState
  view: StatsView
  mutate: (mutation: Mutation) => void
  canEdit: boolean
}

export function StatsPage({ dashboardRef, state, view, mutate, canEdit }: Props) {
  const { t } = useI18n()
  // Read on every render, like the rest of the app: the memos below only recompute when the day changes.
  const today = todayIso()
  const { peopleFilter, eventFilter, setPeopleFilter, setEventFilter } = useViewFilters(state, dashboardRef, view)
  // An inverted, half-typed or over-long period is shown swapped, completed or cut to its last ten years, never empty.
  const period = useMemo(() => resolvePeriod(view.from, view.to, today), [view.from, view.to, today])
  const stats = useStats(state, period, { people: peopleFilter, events: eventFilter }, today)
  const { overview } = stats
  const unit = seriesUnit(period)
  const bars = useMemo(() => attendanceBars(stats.cells, period), [stats.cells, period])
  const rows = useMemo(() => listedPeople(stats.people), [stats.people])
  // The person whose sheet is open, while they still have numbers in the period.
  const [openId, setOpenId] = useState<PersonId | null>(null)
  const open = openId === null ? undefined : stats.people.get(openId)
  const scope = useMemo(() => ({ people: peopleFilter, events: eventFilter }), [peopleFilter, eventFilter])
  const charts = useMemo(() => sortedCharts(state), [state])
  // The chart sheet: null when closed, an id when editing, 'new' when adding.
  const [sheet, setSheet] = useState<ChartId | 'new' | null>(null)
  const editing = sheet === null || sheet === 'new' ? undefined : charts.find((chart) => chart.id === sheet)

  // Spec 5.5: no event in the period, or nothing recorded on the past ones.
  const emptyText =
    overview.pastEvents + overview.upcomingEvents === 0
      ? t('statsPage.noEvents')
      : stats.cells.length === 0
        ? t('statsPage.noRecord')
        : null
  // Charts other than newcomers say so when the period has no event (spec 5.5).
  const chartsEmptyText = overview.pastEvents + overview.upcomingEvents === 0 ? t('statsPage.noEvents') : null
  const chartTitle = t(unit === 'week' ? 'statsPage.byWeek' : 'statsPage.byMonth')
  // The resolved period goes along, so the people page shows the same one even without dates in this URL.
  const seeAllHref = `#${viewPath(dashboardRef, { ...view, page: 'people', from: period.from, to: period.to })}`

  // Dates change at every keystroke: keep one history entry, like the filters.
  const setDates = (from: IsoDate | undefined, to: IsoDate | undefined) =>
    navigate(viewPath(dashboardRef, { ...view, from, to }), { replace: true })

  // The same period and filters on both pages, so the people page shows (and changes) what it was opened with.
  const controls = (
    <StatsControls
      state={state}
      period={period}
      today={today}
      onDates={setDates}
      people={{ filter: peopleFilter, onChange: setPeopleFilter }}
      events={{ filter: eventFilter, onChange: setEventFilter }}
    />
  )

  if (view.page === 'people') {
    return (
      <StatsPeoplePage
        dashboardRef={dashboardRef}
        state={state}
        view={view}
        period={period}
        rows={rows}
        stats={stats.people}
        arrival={stats.arrival}
        controls={controls}
        emptyText={emptyText ?? t('statsPage.noRecord')}
      />
    )
  }

  return (
    <div className="space-y-4">
      {controls}

      <StatNumbers overview={overview} />

      <section className={cx(cardFrame, 'p-4')}>
        <h2 className="mb-3 font-semibold">{chartTitle}</h2>
        {emptyText ? <p className="text-sm text-muted">{emptyText}</p> : <TimeChart bars={bars} unit={unit} label={chartTitle} />}
      </section>

      <PeoplePreview
        state={state}
        rows={rows}
        arrival={stats.arrival}
        period={period}
        seeAllHref={seeAllHref}
        emptyText={emptyText ?? t('statsPage.noRecord')}
        onOpen={setOpenId}
      />

      {charts.map((chart, index) => (
        <ChartCard
          key={chart.id}
          state={state}
          chart={chart}
          period={period}
          scope={scope}
          today={today}
          page={stats}
          emptyText={chartsEmptyText}
          first={index === 0}
          last={index === charts.length - 1}
          {...(canEdit && {
            onEdit: () => setSheet(chart.id),
            onMove: (direction: -1 | 1) => mutate(moveChart(chart.id, direction)),
            onRemove: () => mutate(removeChart(chart.id)),
          })}
        />
      ))}
      {canEdit && charts.length < LIMITS.statCharts && (
        <button
          type="button"
          className="inline-flex min-h-touch w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-dashed border-line px-3.5 font-medium text-muted hover:bg-surface-muted hover:text-text"
          onClick={() => setSheet('new')}
        >
          <PlusIcon />
          {t('statsPage.chart.add')}
        </button>
      )}

      {canEdit && (sheet === 'new' || editing) && (
        <ChartSheet
          key={sheet}
          state={state}
          chart={editing}
          period={period}
          scope={scope}
          today={today}
          page={stats}
          emptyText={chartsEmptyText}
          onSave={(chart) => {
            mutate(editing ? updateChart(editing.id, chart) : addChart(randomId(), chart))
            setSheet(null)
          }}
          onClose={() => setSheet(null)}
        />
      )}

      {open && (
        <PersonStatsSheet
          state={state}
          personId={open.personId}
          stats={open}
          arrival={stats.arrival.get(open.personId) ?? period.from}
          period={period}
          dashboardRef={dashboardRef}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  )
}
