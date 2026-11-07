import { compareByProperty, readValue } from '../../domain/filters'
import { hasKey } from '../../domain/limits'
import { defaultChartName } from '../../domain/statCharts'
import { bucketOf, bucketsOf, seriesUnit, type Cell, type PersonStats, type StatPeriod } from '../../domain/stats'
import type { ChartShow, DashboardState, IsoDate, PersonId, StatChart } from '../../domain/types'
import type { I18n } from '../../i18n/context'
import type { MessageKey } from '../../i18n/en'

// What the Statistics tab shows, derived from the stats module: who is listed,
// in which order, and the columns of the attendance chart.

/** A column of a time chart: its first day, the value (null when nothing is behind it) and how many items are behind it. */
export interface TimeBar {
  start: IsoDate
  value: number | null
  count: number
}

/** How a chart's values read: shares from 0 to 1, or counts. */
export type ValueKind = 'rate' | 'count'

/** The measures a composed chart can show, in the order they are offered. */
export const CHART_SHOWS: ChartShow[] = ['rate', 'present', 'absent', 'replyRate', 'events', 'newcomers']

export const valueKindOf = (show: ChartShow): ValueKind => (show === 'rate' || show === 'replyRate' ? 'rate' : 'count')

/** The value a full bar stands for: 100 % for rates, the largest value (at least 1) for counts. */
export const barScale = (values: (number | null)[], kind: ValueKind): number =>
  kind === 'rate' ? 1 : values.reduce<number>((max, value) => Math.max(max, value ?? 0), 1)

/** The chart's own name, or the one built from its choices ("Attendance rate by Sport"). */
export function chartTitle(t: I18n['t'], state: DashboardState, chart: Omit<StatChart, 'order'>): string {
  if (chart.name) return chart.name
  const { key, params } = defaultChartName(state, chart)
  return t(key as MessageKey, params)
}

/** Rows are only built for people with at least one expected event. */
export const rateOf = (stats: PersonStats): number => stats.present / stats.expected

/** How a rate reads at a glance; the rate is always written next to it. */
export const rateTone = (rate: number): 'low' | 'mid' | 'high' => (rate < 0.4 ? 'low' : rate < 0.7 ? 'mid' : 'high')

/**
 * The people listed for a period: everyone with an expected event in it (spec 5.2). Someone who left
 * before the period has one only when they replied or were present after leaving; that record counts
 * in every number and chart, so they are listed too, and everyone else who left before is not.
 */
export const listedPeople = (people: Map<PersonId, PersonStats>): PersonStats[] => [...people.values()]

/** The `count` most present, in the people page's default order: highest rate first, equal rates by name. */
export const mostPresent = (state: DashboardState, rows: PersonStats[], collator: Intl.Collator, count = 4): PersonStats[] =>
  sortPeopleRows(state, rows, 'rate', collator).slice(0, count)

/**
 * The rows in the order of the people page: `rate` (highest first), `name`, or a person property id.
 * Equal keys stay by name, so the order is the same on every render.
 */
export function sortPeopleRows(state: DashboardState, rows: PersonStats[], sort: string, collator: Intl.Collator): PersonStats[] {
  const nameOf = (stats: PersonStats) => state.people[stats.personId].name
  const byName = (a: PersonStats, b: PersonStats) => collator.compare(nameOf(a), nameOf(b))
  const def = sort === 'rate' || sort === 'name' || !hasKey(state.personProperties, sort) ? undefined : state.personProperties[sort]
  const compare = def
    ? (() => {
        const byValue = compareByProperty(def, collator)
        return (a: PersonStats, b: PersonStats) =>
          byValue(readValue(state.personProperties, state.people[a.personId].values, sort), readValue(state.personProperties, state.people[b.personId].values, sort))
      })()
    : sort === 'name'
      ? () => 0
      : (a: PersonStats, b: PersonStats) => rateOf(b) - rateOf(a)
  return [...rows].sort((a, b) => compare(a, b) || byName(a, b))
}

/** Attendance per month (per week for short periods), every column of the period included. */
export function attendanceBars(cells: Cell[], period: StatPeriod): TimeBar[] {
  const unit = seriesUnit(period)
  const totals = new Map<IsoDate, { present: number; expected: number; events: Set<string> }>()
  for (const cell of cells) {
    const start = bucketOf(cell.date, unit)
    let total = totals.get(start)
    if (!total) {
      total = { present: 0, expected: 0, events: new Set() }
      totals.set(start, total)
    }
    total.expected++
    if (cell.present) total.present++
    total.events.add(cell.eventId)
  }
  return bucketsOf(period, unit).map((start) => {
    const total = totals.get(start)
    return total ? { start, value: total.present / total.expected, count: total.events.size } : { start, value: null, count: 0 }
  })
}
