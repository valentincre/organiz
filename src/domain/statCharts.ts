import { decodeFilter, matchesFilter, readValue } from './filters'
import { clampName, hasKey, LIMITS } from './limits'
import { sortedOptions } from './properties'
import { arrivals, bucketOf, bucketsOf, cells, inPeriod, scopedEvents, scopedPeople, type Cell, type StatPeriod, type StatScope } from './stats'
import type {
  ChartId,
  ChartShow,
  ChartSplit,
  ColorKey,
  DashboardState,
  EventId,
  IsoDate,
  Mutation,
  PersonId,
  PropertyDef,
  PropertyId,
  PropertyScope,
  PropertyValues,
  StatChart,
} from './types'

// The composed charts of the Statistics tab:
// a measure, a split and the chart's own filters, on top of the page's period and scope.

type ChartChoice = Pick<StatChart, 'show' | 'split'>

/** The property a chart is split by, when it still exists. */
function splitProperty(state: DashboardState, split: ChartSplit): { scope: PropertyScope; id: PropertyId; def: PropertyDef } | null {
  if (typeof split === 'string') return null
  const [scope, id, defs] =
    'person' in split
      ? (['person', split.person, state.personProperties] as const)
      : (['event', split.event, state.eventProperties] as const)
  return hasKey(defs, id) ? { scope, id, def: defs[id] } : null
}

/** Whether a show/split pair makes sense: 'events' cannot split by a person property, 'newcomers' cannot split by an event property. Split properties must exist and be choice or multi. */
export function isChartValid(state: DashboardState, { show, split }: ChartChoice): boolean {
  if (typeof split === 'string') return true
  const property = splitProperty(state, split)
  if (!property || (property.def.kind !== 'choice' && property.def.kind !== 'multi')) return false
  return property.scope === 'person' ? show !== 'events' : show !== 'newcomers'
}

/** "Attendance rate by Sport" — returns i18n key and params, the UI translates. */
export function defaultChartName(state: DashboardState, { show, split }: ChartChoice): { key: string; params: Record<string, string> } {
  if (split === 'month') return { key: `chart.${show}ByMonth`, params: {} }
  if (split === 'week') return { key: `chart.${show}ByWeek`, params: {} }
  const property = splitProperty(state, split)
  return property ? { key: `chart.${show}By`, params: { property: property.def.name } } : { key: `chart.${show}`, params: {} }
}

export interface ChartBar {
  /** Bucket start, option id, or '' for "no value". */
  key: string
  /** Null when nothing is behind the bar. */
  value: number | null
  /** Events or people behind it. */
  count: number
  color?: ColorKey
}

export type ChartData =
  | { kind: 'number'; value: number | null; num: number; den: number }
  | { kind: 'bars'; axis: 'time' | 'options'; bars: ChartBar[] }

const RATES: ReadonlySet<ChartShow> = new Set(['rate', 'replyRate'])

/** One thing the measure is summed over: a cell, an event or a newcomer. */
interface Item {
  date: IsoDate
  /** The event or person counted behind a bar. */
  countId: string
  values: PropertyValues | undefined
  /** 1 when it counts in the numerator; the denominator is the number of items. */
  num: number
}

const cellNum = (show: ChartShow, cell: Cell): number =>
  (show === 'absent' ? !cell.present : show === 'replyRate' ? cell.replied : cell.present) ? 1 : 0

/**
 * What the page already computed for its period and scope (useStats): its cells and the arrivals.
 * Shared by its charts so each one only narrows them instead of computing everything again.
 */
export interface PageStats {
  cells: Cell[]
  arrival: Map<PersonId, IsoDate>
}

/**
 * The page's cells that also match the chart's own conditions. Conditions all have to match
 * (matchesFilter), so these are the cells computed with the page's and the chart's conditions together.
 */
function narrowCells(state: DashboardState, pageCells: Cell[], own: StatScope): Cell[] {
  if (own.people.length === 0 && own.events.length === 0) return pageCells
  const people = scopedPeople(state, own)
  const events = new Set<EventId>(
    Object.entries(state.events)
      .filter(([, event]) => matchesFilter(state.eventProperties, event.values, own.events))
      .map(([id]) => id),
  )
  return pageCells.filter((cell) => people.has(cell.personId) && events.has(cell.eventId))
}

function itemsOf(
  state: DashboardState,
  show: ChartShow,
  splitScope: PropertyScope | null,
  period: StatPeriod,
  scope: StatScope,
  today: IsoDate,
  shared?: { page: PageStats; own: StatScope },
): Item[] {
  if (show === 'events') {
    return scopedEvents(state, period, scope).map((event) => ({ date: event.date, countId: event.id, values: event.values, num: 1 }))
  }
  if (show === 'newcomers') {
    const arrival = shared?.page.arrival ?? arrivals(state)
    return [...scopedPeople(state, scope)].flatMap((id) => {
      const date = arrival.get(id)
      return date !== undefined && inPeriod(date, period) ? [{ date, countId: id, values: state.people[id].values, num: 1 }] : []
    })
  }
  const list = shared ? narrowCells(state, shared.page.cells, shared.own) : cells(state, period, scope, today)
  // Rates count the people behind a bar split by a person property, the events otherwise.
  return list.map((cell) =>
    splitScope === 'person'
      ? { date: cell.date, countId: cell.personId, values: state.people[cell.personId].values, num: cellNum(show, cell) }
      : { date: cell.date, countId: cell.eventId, values: state.events[cell.eventId].values, num: cellNum(show, cell) },
  )
}

interface Total {
  num: number
  den: number
  ids: Set<string>
}

const valueOf = (show: ChartShow, total: Total): number | null =>
  RATES.has(show) ? (total.den > 0 ? total.num / total.den : null) : total.ids.size > 0 ? total.num : null

/**
 * Page scope and the chart's own filters both apply (conditions concatenated).
 * `page`, when given, must come from the same state, period, scope and today: the chart then narrows
 * the page's cells instead of computing them again. The result is the same with or without it.
 */
export function chartData(
  state: DashboardState,
  chart: StatChart,
  period: StatPeriod,
  scope: StatScope,
  today: IsoDate,
  page?: PageStats,
): ChartData {
  // Stale conditions (deleted property or option) are dropped by decodeFilter.
  const own: StatScope = {
    people: decodeFilter(chart.people, state.personProperties),
    // Newcomers are people: no event condition applies to them.
    events: chart.show === 'newcomers' ? [] : decodeFilter(chart.events, state.eventProperties),
  }
  const combined: StatScope = {
    people: [...scope.people, ...own.people],
    events: chart.show === 'newcomers' ? [] : [...scope.events, ...own.events],
  }
  // A chart that no longer makes sense (e.g. its property was deleted) is shown unsplit.
  const split = isChartValid(state, chart) ? chart.split : 'none'
  const property = splitProperty(state, split)
  const items = itemsOf(state, chart.show, property?.scope ?? null, period, combined, today, page && { page, own })

  if (split === 'none') {
    const num = items.reduce((sum, item) => sum + item.num, 0)
    const value = RATES.has(chart.show) ? (items.length > 0 ? num / items.length : null) : num
    return { kind: 'number', value, num, den: items.length }
  }

  const totals = new Map<string, Total>()
  const add = (key: string, item: Item) => {
    let total = totals.get(key)
    if (!total) {
      total = { num: 0, den: 0, ids: new Set() }
      totals.set(key, total)
    }
    total.num += item.num
    total.den++
    total.ids.add(item.countId)
  }
  const barOf = (key: string, color?: ColorKey): ChartBar => {
    const total = totals.get(key) ?? { num: 0, den: 0, ids: new Set() }
    return { key, value: valueOf(chart.show, total), count: total.ids.size, ...(color && { color }) }
  }

  if (split === 'month' || split === 'week') {
    // Many items share a date: find each date's bucket once.
    const bucketByDate = new Map<IsoDate, IsoDate>()
    for (const item of items) {
      let bucket = bucketByDate.get(item.date)
      if (bucket === undefined) {
        bucket = bucketOf(item.date, split)
        bucketByDate.set(item.date, bucket)
      }
      add(bucket, item)
    }
    return { kind: 'bars', axis: 'time', bars: bucketsOf(period, split).map((bucket) => barOf(bucket)) }
  }

  // A valid property split: the property exists.
  const { scope: propertyScope, id, def } = property!
  const defs = propertyScope === 'person' ? state.personProperties : state.eventProperties
  // A multi value counts under each of its options. An item's values are those of the person or
  // event it counts, so they are read once per id.
  const keysById = new Map<string, string[]>()
  for (const item of items) {
    let keys = keysById.get(item.countId)
    if (keys === undefined) {
      const value = readValue(defs, item.values, id)
      keys = value === undefined ? [''] : Array.isArray(value) ? value : [value as string]
      keysById.set(item.countId, keys)
    }
    for (const key of keys) add(key, item)
  }
  const bars = sortedOptions(def).map((option) => barOf(option.id, option.color))
  if (totals.has('')) bars.push(barOf(''))
  return { kind: 'bars', axis: 'options', bars }
}

// Mutations

/** A split as one string (a <select> value, an equality check). */
export const splitKey = (split: ChartSplit): string =>
  typeof split === 'string' ? split : 'person' in split ? `person:${split.person}` : `event:${split.event}`

/** The split behind a key; 'none' for anything else. */
export function parseSplit(key: string): ChartSplit {
  if (key === 'month' || key === 'week') return key
  if (key.startsWith('person:')) return { person: key.slice('person:'.length) }
  if (key.startsWith('event:')) return { event: key.slice('event:'.length) }
  return 'none'
}

/** Whether a filter of the chart is too long to store; an events filter on newcomers does not count, it is dropped. */
export const filtersTooLong = (chart: Omit<StatChart, 'order'>): boolean =>
  (chart.people?.length ?? 0) > LIMITS.encodedFilter || (chart.show !== 'newcomers' && (chart.events?.length ?? 0) > LIMITS.encodedFilter)

/** The stored form: trimmed name, a clean split, no empty filter and no event filter for newcomers; null when invalid. */
function storedChart(state: DashboardState, chart: Omit<StatChart, 'order'>): Omit<StatChart, 'order'> | null {
  if (!isChartValid(state, chart) || filtersTooLong(chart)) return null
  const events = chart.show === 'newcomers' ? undefined : chart.events
  const name = clampName(chart.name ?? '', LIMITS.chartName)
  const split = chart.split
  return {
    ...(name && { name }),
    show: chart.show,
    split: typeof split === 'string' ? split : 'person' in split ? { person: split.person } : { event: split.event },
    ...(chart.people && { people: chart.people }),
    ...(events && { events }),
  }
}

const sameChart = (a: Omit<StatChart, 'order'>, b: Omit<StatChart, 'order'>): boolean =>
  a.name === b.name && a.show === b.show && splitKey(a.split) === splitKey(b.split) && a.people === b.people && a.events === b.events

/** Appended last; ignored past LIMITS.statCharts or when invalid. */
export const addChart =
  (id: ChartId, chart: Omit<StatChart, 'order'>): Mutation =>
  (state) => {
    const charts = state.statCharts ?? {}
    const stored = storedChart(state, chart)
    if (!stored || hasKey(charts, id) || Object.keys(charts).length >= LIMITS.statCharts) return state
    const order = Math.max(-1, ...Object.values(charts).map((existing) => existing.order)) + 1
    return { ...state, statCharts: { ...charts, [id]: { ...stored, order } } }
  }

/** Replaces the choices and name of a chart; keeps its place. */
export const updateChart =
  (id: ChartId, chart: Omit<StatChart, 'order'>): Mutation =>
  (state) => {
    if (!state.statCharts || !hasKey(state.statCharts, id)) return state
    const current = state.statCharts[id]
    const stored = storedChart(state, chart)
    if (!stored || sameChart(current, stored)) return state
    return { ...state, statCharts: { ...state.statCharts, [id]: { ...stored, order: current.order } } }
  }

/** Swaps the chart's order with its neighbor's; nothing at the ends. */
export const moveChart =
  (id: ChartId, direction: -1 | 1): Mutation =>
  (state) => {
    const sorted = sortedCharts(state)
    const index = sorted.findIndex((chart) => chart.id === id)
    if (index < 0 || !state.statCharts) return state
    const other = sorted[index + direction]
    if (!other) return state
    const charts = state.statCharts
    return {
      ...state,
      statCharts: {
        ...charts,
        [id]: { ...charts[id], order: other.order },
        [other.id]: { ...charts[other.id], order: sorted[index].order },
      },
    }
  }

/** Deletes the chart, and the record once it is empty. */
export const removeChart =
  (id: ChartId): Mutation =>
  (state) => {
    if (!state.statCharts || !hasKey(state.statCharts, id)) return state
    const charts = { ...state.statCharts }
    delete charts[id]
    if (Object.keys(charts).length > 0) return { ...state, statCharts: charts }
    const rest = { ...state }
    delete rest.statCharts
    return rest
  }

/** Charts in display order. */
export function sortedCharts(state: DashboardState): (StatChart & { id: ChartId })[] {
  return Object.entries(state.statCharts ?? {})
    .map(([id, chart]) => ({ id, ...chart }))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}
