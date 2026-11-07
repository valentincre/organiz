import { useMemo } from 'react'
import { arrivals, cells, overview, peopleStats, type StatPeriod, type StatScope } from '../../domain/stats'
import type { DashboardState, IsoDate } from '../../domain/types'
import { useI18n } from '../../i18n/context'

/**
 * The numbers of the Statistics tab for a period and the page filters. The
 * decoded filters keep their identity while their URL encoding and the
 * properties stay the same (useViewFilters), so this recomputes only when the
 * state, the period, the encoded filters or `today` change. `today` comes from
 * the page, so its presets, numbers and charts all agree on it.
 */
export function useStats(state: DashboardState, period: StatPeriod, scope: StatScope, today: IsoDate) {
  const { from, to } = period
  const { people: peopleFilter, events: eventFilter } = scope
  return useMemo(() => {
    const range = { from, to }
    const filters = { people: peopleFilter, events: eventFilter }
    // Computed once: cells, the four numbers and the charts (statCharts' PageStats) all use it.
    const arrival = arrivals(state)
    const list = cells(state, range, filters, today, arrival)
    return {
      cells: list,
      arrival,
      people: peopleStats(state, list),
      overview: overview(state, range, filters, today, list, arrival),
    }
  }, [state, from, to, peopleFilter, eventFilter, today])
}

/** Number formats of the tab, in the page's language. */
export function useStatFormat() {
  const { lang } = useI18n()
  return useMemo(() => {
    const percent = new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: 0 })
    const number = new Intl.NumberFormat(lang)
    const signed = new Intl.NumberFormat(lang, { signDisplay: 'exceptZero' })
    return {
      /** "–" when there is nothing to divide by. */
      rate: (value: number | null) => (value === null ? '–' : percent.format(value)),
      number: (value: number) => number.format(value),
      signed: (value: number) => signed.format(value),
    }
  }, [lang])
}
