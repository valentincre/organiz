import { describe, expect, it } from 'vitest'
import { bigState } from './bigState.testing'
import { chartData } from './statCharts'
import { presetOf, presetPeriod, resolvePeriod, type PeriodPreset } from './statPeriod'
import { arrivals, bucketsOf, cells, overview, seriesUnit, type StatScope } from './stats'

const TODAY = '2026-11-07'

describe('presetPeriod', () => {
  it('covers whole calendar months', () => {
    expect(presetPeriod('thisMonth', TODAY)).toEqual({ from: '2026-11-01', to: '2026-11-30' })
    expect(presetPeriod('lastMonth', TODAY)).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(presetPeriod('thisYear', TODAY)).toEqual({ from: '2026-01-01', to: '2026-12-31' })
    expect(presetPeriod('last12Months', TODAY)).toEqual({ from: '2025-12-01', to: '2026-11-30' })
  })

  it('crosses the year boundary and leap years', () => {
    expect(presetPeriod('lastMonth', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' })
    expect(presetPeriod('thisMonth', '2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
    expect(presetPeriod('last12Months', '2026-01-15')).toEqual({ from: '2025-02-01', to: '2026-01-31' })
  })
})

describe('resolvePeriod', () => {
  it('defaults to the last 12 months', () => {
    expect(resolvePeriod(undefined, undefined, TODAY)).toEqual({ from: '2025-12-01', to: '2026-11-30' })
  })

  it('keeps URL dates', () => {
    expect(resolvePeriod('2026-02-03', '2026-04-05', TODAY)).toEqual({ from: '2026-02-03', to: '2026-04-05' })
  })

  it('takes a missing bound from the default', () => {
    expect(resolvePeriod('2026-02-03', undefined, TODAY)).toEqual({ from: '2026-02-03', to: '2026-11-30' })
    expect(resolvePeriod(undefined, '2026-04-05', TODAY)).toEqual({ from: '2025-12-01', to: '2026-04-05' })
  })

  it('swaps an inverted period, never empty', () => {
    expect(resolvePeriod('2027-06-30', '2026-09-01', TODAY)).toEqual({ from: '2026-09-01', to: '2027-06-30' })
    // A lone bound past the default's other end is swapped too.
    expect(resolvePeriod('2027-06-30', undefined, TODAY)).toEqual({ from: '2026-11-30', to: '2027-06-30' })
    expect(resolvePeriod(undefined, '2025-01-01', TODAY)).toEqual({ from: '2025-01-01', to: '2025-12-01' })
  })
})

describe('resolvePeriod: long periods', () => {
  it('keeps the last ten years of a longer period', () => {
    expect(resolvePeriod('1000-01-01', '9999-12-31', TODAY)).toEqual({ from: '9990-01-01', to: '9999-12-31' })
    expect(resolvePeriod('2000-05-10', undefined, TODAY)).toEqual({ from: '2016-12-01', to: '2026-11-30' })
    // Swapped first, then capped.
    expect(resolvePeriod('9999-12-31', '1000-01-01', TODAY)).toEqual({ from: '9990-01-01', to: '9999-12-31' })
  })

  it('keeps the page computable for a hand-edited URL period', () => {
    const state = bigState(20, 30)
    const scope: StatScope = { people: [], events: [] }
    const period = resolvePeriod('1000-01-01', '2026-12-31', TODAY)
    expect(period).toEqual({ from: '2017-01-01', to: '2026-12-31' })
    const arrival = arrivals(state)
    const list = cells(state, period, scope, TODAY, arrival)
    expect(list.length).toBeGreaterThan(0)
    expect(overview(state, period, scope, TODAY, list, arrival).pastEvents).toBe(30)
    expect(bucketsOf(period, seriesUnit(period))).toHaveLength(120)
    const byWeek = chartData(state, { show: 'rate', split: 'week', order: 0 }, period, scope, TODAY, { cells: list, arrival })
    expect(byWeek.kind === 'bars' && byWeek.bars.length).toBeLessThanOrEqual(523)
  })
})

describe('presetOf', () => {
  it('names the preset a period matches', () => {
    const presets: PeriodPreset[] = ['thisMonth', 'lastMonth', 'thisYear', 'last12Months']
    for (const preset of presets) expect(presetOf(presetPeriod(preset, TODAY), TODAY)).toBe(preset)
  })

  it('is null for anything else', () => {
    expect(presetOf({ from: '2026-11-02', to: '2026-11-30' }, TODAY)).toBeNull()
  })
})
