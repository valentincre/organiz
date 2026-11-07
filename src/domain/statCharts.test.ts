import { describe, expect, it } from 'vitest'
import { encodeFilter } from './filters'
import { LIMITS } from './limits'
import { addEvent, addPerson, compose, emptyState, recordCall, setReplies } from './mutations'
import { addProperty, deleteOption, setValue } from './properties'
import {
  addChart,
  chartData,
  defaultChartName,
  filtersTooLong,
  isChartValid,
  moveChart,
  parseSplit,
  removeChart,
  sortedCharts,
  splitKey,
  updateChart,
  type ChartBar,
} from './statCharts'
import { bigState } from './bigState.testing'
import { arrivals, cells, type StatPeriod, type StatScope } from './stats'
import type { DashboardState, StatChart } from './types'

/** Local noon of a day, so the local date of `createdAt` is that day in any time zone. */
const at = (date: string): number => {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day, 12).getTime()
}

const EVERYONE: StatScope = { people: [], events: [] }
const YEAR: StatPeriod = { from: '2026-01-01', to: '2026-12-31' }
const TODAY = '2026-11-07'

/** Person properties: sport (choice: foot, judo), level (multi: a, b), note (text). Event property: kind (choice: match, training). */
const base = compose(
  addProperty('person', 'sport', 'choice', 'Sport', [
    { id: 'foot', label: 'Foot', color: 'blue' },
    { id: 'judo', label: 'Judo', color: 'green' },
  ], 1),
  addProperty('person', 'level', 'multi', 'Level', [
    { id: 'a', label: 'A', color: 'red' },
    { id: 'b', label: 'B', color: 'amber' },
  ], 2),
  addProperty('person', 'note', 'text', 'Note', [], 3),
  addProperty('event', 'kind', 'choice', 'Kind', [
    { id: 'match', label: 'Match', color: 'purple' },
    { id: 'training', label: 'Training', color: 'gray' },
  ], 1),
)(emptyState('Club'))

const chart = (show: StatChart['show'], split: StatChart['split'], extra: Partial<StatChart> = {}): StatChart => ({
  show,
  split,
  order: 0,
  ...extra,
})

const bars = (data: ReturnType<typeof chartData>): ChartBar[] => {
  if (data.kind !== 'bars') throw new Error('expected bars')
  return data.bars
}

describe('statCharts: validity and name', () => {
  it('rejects events by a person property, newcomers by an event property, text and deleted properties', () => {
    expect(isChartValid(base, chart('rate', { person: 'sport' }))).toBe(true)
    expect(isChartValid(base, chart('rate', { event: 'kind' }))).toBe(true)
    expect(isChartValid(base, chart('events', 'month'))).toBe(true)
    expect(isChartValid(base, chart('events', { person: 'sport' }))).toBe(false)
    expect(isChartValid(base, chart('newcomers', { event: 'kind' }))).toBe(false)
    expect(isChartValid(base, chart('rate', { person: 'note' }))).toBe(false)
    expect(isChartValid(base, chart('rate', { person: 'gone' }))).toBe(false)
    expect(isChartValid(base, chart('rate', { event: 'sport' }))).toBe(false)
  })

  it('names a chart from its measure and split', () => {
    expect(defaultChartName(base, chart('rate', 'none'))).toEqual({ key: 'chart.rate', params: {} })
    expect(defaultChartName(base, chart('present', 'month'))).toEqual({ key: 'chart.presentByMonth', params: {} })
    expect(defaultChartName(base, chart('events', 'week'))).toEqual({ key: 'chart.eventsByWeek', params: {} })
    expect(defaultChartName(base, chart('rate', { person: 'sport' }))).toEqual({ key: 'chart.rateBy', params: { property: 'Sport' } })
    expect(defaultChartName(base, chart('rate', { person: 'gone' }))).toEqual({ key: 'chart.rate', params: {} })
  })
})

describe('statCharts: data', () => {
  // a: foot, level a+b; b: judo, level b; c: no sport, no level. One called event, a and c present.
  const club = compose(
    addPerson('a', 'A', at('2026-01-01')),
    addPerson('b', 'B', at('2026-01-01')),
    addPerson('c', 'C', at('2026-01-01')),
    setValue('person', 'a', 'sport', 'foot'),
    setValue('person', 'b', 'sport', 'judo'),
    setValue('person', 'a', 'level', ['a', 'b']),
    setValue('person', 'b', 'level', ['b']),
    addEvent('e1', '2026-10-10', { values: { kind: 'match' } }, 1),
    recordCall('e1', ['a', 'c'], ['b'], 2),
  )(base)

  it('splits a rate by a person property in option order, with a no-value bar', () => {
    expect(bars(chartData(club, chart('rate', { person: 'sport' }), YEAR, EVERYONE, TODAY))).toEqual([
      { key: 'foot', value: 1, count: 1, color: 'blue' },
      { key: 'judo', value: 0, count: 1, color: 'green' },
      { key: '', value: 1, count: 1 },
    ])
  })

  it('counts a multi value under each of its options and hides an empty no-value bar', () => {
    const data = chartData(club, chart('present', { person: 'level' }), YEAR, { people: [{ type: 'filled', propertyId: 'sport' }], events: [] }, TODAY)
    expect(bars(data)).toEqual([
      { key: 'a', value: 1, count: 1, color: 'red' },
      { key: 'b', value: 1, count: 2, color: 'amber' },
    ])
  })

  it('gives one column per month of the period, empty ones with no value', () => {
    const data = chartData(club, chart('rate', 'month'), { from: '2026-09-01', to: '2026-11-30' }, EVERYONE, TODAY)
    expect(data).toEqual({
      kind: 'bars',
      axis: 'time',
      bars: [
        { key: '2026-09-01', value: null, count: 0 },
        { key: '2026-10-01', value: 2 / 3, count: 1 },
        { key: '2026-11-01', value: null, count: 0 },
      ],
    })
  })

  it('gives one number with its fraction when not split', () => {
    expect(chartData(club, chart('rate', 'none'), YEAR, EVERYONE, TODAY)).toEqual({ kind: 'number', value: 2 / 3, num: 2, den: 3 })
    expect(chartData(club, chart('absent', 'none'), YEAR, EVERYONE, TODAY)).toMatchObject({ value: 1, num: 1, den: 3 })
  })

  it('counts every event of the period for events, recorded or not, past and upcoming', () => {
    const state = compose(
      addEvent('e2', '2026-10-20', { values: { kind: 'training' } }, 3),
      addEvent('e3', '2026-12-01', {}, 4),
    )(club)
    expect(chartData(state, chart('events', 'none'), YEAR, EVERYONE, TODAY)).toMatchObject({ kind: 'number', value: 3 })
    expect(bars(chartData(state, chart('events', { event: 'kind' }), YEAR, EVERYONE, TODAY))).toEqual([
      { key: 'match', value: 1, count: 1, color: 'purple' },
      { key: 'training', value: 1, count: 1, color: 'gray' },
      { key: '', value: 1, count: 1 },
    ])
  })

  it('counts the people for a rate split by person and the events for a rate split by event', () => {
    const state = compose(
      addEvent('e2', '2026-10-20', { values: { kind: 'match' } }, 3),
      setReplies('e2', ['a'], 'yes'),
    )(club)
    // e2 has no call: a (yes) is present, b and c are expected and absent.
    const byKind = bars(chartData(state, chart('rate', { event: 'kind' }), YEAR, EVERYONE, TODAY))
    expect(byKind[0]).toEqual({ key: 'match', value: 3 / 6, count: 2, color: 'purple' })
    const bySport = bars(chartData(state, chart('replyRate', { person: 'sport' }), YEAR, EVERYONE, TODAY))
    expect(bySport[0]).toEqual({ key: 'foot', value: 1 / 2, count: 1, color: 'blue' })
  })

  it('counts newcomers by arrival, ignoring the event filters', () => {
    const state = compose(addPerson('n', 'N', at('2026-03-15')), setValue('person', 'n', 'sport', 'judo'))(club)
    const scope: StatScope = { people: [], events: [{ type: 'empty', propertyId: 'kind' }] }
    const period: StatPeriod = { from: '2026-02-01', to: '2026-04-30' }
    expect(chartData(state, chart('newcomers', 'none'), period, scope, TODAY)).toMatchObject({ value: 1 })
    expect(bars(chartData(state, chart('newcomers', 'month'), period, scope, TODAY)).map((bar) => bar.value)).toEqual([null, 1, null])
    expect(bars(chartData(state, chart('newcomers', { person: 'sport' }), period, scope, TODAY))).toEqual([
      { key: 'foot', value: null, count: 0, color: 'blue' },
      { key: 'judo', value: 1, count: 1, color: 'green' },
    ])
  })

  it('applies the chart filters on top of the page scope, ignoring a condition on a deleted option', () => {
    const judo = chart('present', 'none', { people: encodeFilter([{ type: 'options', propertyId: 'sport', optionIds: ['judo'] }]) })
    const absentOnly = chartData(club, judo, YEAR, EVERYONE, TODAY)
    expect(absentOnly).toMatchObject({ value: 0, den: 1 })
    const deleted = deleteOption('person', 'sport', 'judo')(club)
    expect(chartData(deleted, judo, YEAR, EVERYONE, TODAY)).toMatchObject({ value: 2, den: 3 })
  })
})

describe('statCharts: shared page cells', () => {
  const period: StatPeriod = { from: '2025-01-01', to: '2026-12-31' }
  const judo = encodeFilter([{ type: 'options', propertyId: 'sport', optionIds: ['judo'] }])
  const matches = encodeFilter([{ type: 'options', propertyId: 'kind', optionIds: ['match'] }])
  const levelA = encodeFilter([{ type: 'options', propertyId: 'level', optionIds: ['a'] }])
  const pageOf = (state: DashboardState, scope: StatScope) => {
    const arrival = arrivals(state)
    return { cells: cells(state, period, scope, TODAY, arrival), arrival }
  }

  it('gives the same data from the page cells as computed alone', () => {
    const state = bigState(40, 60)
    const shows: StatChart['show'][] = ['rate', 'present', 'absent', 'replyRate', 'events', 'newcomers']
    const splits: StatChart['split'][] = ['none', 'month', 'week', { person: 'sport' }, { person: 'level' }, { event: 'kind' }]
    const owns: Partial<StatChart>[] = [{}, { people: judo }, { events: matches }, { people: levelA, events: matches }]
    const scopes: StatScope[] = [
      EVERYONE,
      { people: [{ type: 'filled', propertyId: 'level' }], events: [{ type: 'options', propertyId: 'kind', optionIds: ['match', 'training'] }] },
    ]
    let compared = 0
    for (const scope of scopes) {
      const page = pageOf(state, scope)
      for (const show of shows)
        for (const split of splits)
          for (const own of owns) {
            const composed = chart(show, split, own)
            expect(chartData(state, composed, period, scope, TODAY, page)).toEqual(chartData(state, composed, period, scope, TODAY))
            compared++
          }
    }
    expect(compared).toBe(2 * 6 * 6 * 4)
  })

  it('draws ten charts of 200 people × 300 events quickly from the page cells', () => {
    const state = bigState()
    const page = pageOf(state, EVERYONE)
    const ten = [
      chart('rate', { person: 'sport' }),
      chart('rate', 'week'),
      chart('present', 'month'),
      chart('absent', { person: 'level' }),
      chart('replyRate', 'week'),
      chart('rate', 'none'),
      chart('events', { event: 'kind' }),
      chart('newcomers', 'month'),
      chart('rate', 'month', { people: judo, events: matches }),
      chart('replyRate', { event: 'kind' }),
    ]
    const start = performance.now()
    for (const composed of ten) chartData(state, composed, period, EVERYONE, TODAY, page)
    expect(performance.now() - start).toBeLessThan(300)
    expect(page.cells.length).toBeGreaterThan(30_000)
  })
})

describe('statCharts: mutations', () => {
  const rate = { show: 'rate', split: 'none' } as const

  it('appends charts last and stops at the limit', () => {
    let state: DashboardState = base
    for (let i = 0; i < LIMITS.statCharts; i++) state = addChart(`c${i}`, rate)(state)
    expect(sortedCharts(state).map((entry) => entry.id).slice(0, 3)).toEqual(['c0', 'c1', 'c2'])
    expect(sortedCharts(state).at(-1)?.id).toBe(`c${LIMITS.statCharts - 1}`)
    expect(addChart('extra', rate)(state)).toBe(state)
  })

  it('ignores an invalid or duplicate chart, and an update that changes nothing', () => {
    expect(addChart('c', { show: 'events', split: { person: 'sport' } })(base)).toBe(base)
    const state = addChart('c', { ...rate, name: '  Mine  ' })(base)
    expect(state.statCharts?.c).toEqual({ ...rate, name: 'Mine', order: 0 })
    expect(addChart('c', rate)(state)).toBe(state)
    expect(updateChart('c', { ...rate, name: 'Mine' })(state)).toBe(state)
    expect(updateChart('c', { show: 'newcomers', split: { event: 'kind' } })(state)).toBe(state)
    expect(updateChart('missing', rate)(state)).toBe(state)
    expect(updateChart('c', { show: 'present', split: 'month' })(state).statCharts?.c).toEqual({ show: 'present', split: 'month', order: 0 })
  })

  it('refuses filters whose encoding is over the limit, except an events filter on newcomers, which is dropped', () => {
    const long = 'x'.repeat(LIMITS.encodedFilter + 1)
    expect(filtersTooLong({ ...rate, people: long })).toBe(true)
    expect(filtersTooLong({ ...rate, events: long })).toBe(true)
    expect(filtersTooLong({ show: 'newcomers', split: 'none', events: long })).toBe(false)
    expect(filtersTooLong({ ...rate, people: 'x'.repeat(LIMITS.encodedFilter) })).toBe(false)
    expect(addChart('c', { ...rate, people: long })(base)).toBe(base)
  })

  it('turns a split into a key and back', () => {
    for (const split of ['none', 'month', 'week', { person: 'sport' }, { event: 'kind' }] as const) {
      expect(parseSplit(splitKey(split))).toEqual(split)
    }
    expect(splitKey({ person: 'sport' })).toBe('person:sport')
    expect(parseSplit('anything')).toBe('none')
  })

  it('moves a chart by swapping orders with its neighbor, and not past the ends', () => {
    const state = compose(addChart('x', rate), addChart('y', rate), addChart('z', rate))(base)
    const moved = moveChart('z', -1)(state)
    expect(sortedCharts(moved).map((entry) => entry.id)).toEqual(['x', 'z', 'y'])
    expect(moved.statCharts?.z.order).toBe(state.statCharts?.y.order)
    expect(moveChart('x', -1)(state)).toBe(state)
    expect(moveChart('z', 1)(state)).toBe(state)
  })

  it('removes the chart record with its last chart', () => {
    const state = compose(addChart('x', rate), addChart('y', rate))(base)
    expect(Object.keys(removeChart('x')(state).statCharts ?? {})).toEqual(['y'])
    expect('statCharts' in removeChart('y')(removeChart('x')(state))).toBe(false)
    expect(removeChart('missing')(state)).toBe(state)
  })
})
