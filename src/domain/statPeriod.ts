import { addMonths, monthOf, parseIso, toIso } from './dates'
import { capPeriod, type StatPeriod } from './stats'
import type { IsoDate } from './types'

export type PeriodPreset = 'thisMonth' | 'lastMonth' | 'thisYear' | 'last12Months'

export const PERIOD_PRESETS: PeriodPreset[] = ['thisMonth', 'lastMonth', 'thisYear', 'last12Months']

const firstOfMonth = (year: number, month: number): IsoDate => toIso(new Date(Date.UTC(year, month, 1)))

/** Day 0 of the next month is the last day of this one. */
const lastOfMonth = (year: number, month: number): IsoDate => toIso(new Date(Date.UTC(year, month + 1, 0)))

/** Whole calendar months, ending with the month of `today` (or the one before for "last month"). */
const months = (today: IsoDate, back: number, length: number): StatPeriod => {
  const first = addMonths(monthOf(today), -back)
  const last = addMonths(first, length - 1)
  return { from: firstOfMonth(first.year, first.month), to: lastOfMonth(last.year, last.month) }
}

export function presetPeriod(preset: PeriodPreset, today: IsoDate): StatPeriod {
  switch (preset) {
    case 'thisMonth':
      return months(today, 0, 1)
    case 'lastMonth':
      return months(today, 1, 1)
    case 'last12Months':
      return months(today, 11, 12)
    case 'thisYear': {
      const year = parseIso(today).getUTCFullYear()
      return { from: firstOfMonth(year, 0), to: lastOfMonth(year, 11) }
    }
  }
}

/**
 * URL dates or the default (last 12 months); swaps from/to when inverted; one missing bound is taken from the default.
 * A period longer than ten years keeps its last ten (capPeriod), so a hand-edited URL cannot ask for thousands of columns.
 */
export function resolvePeriod(from: IsoDate | undefined, to: IsoDate | undefined, today: IsoDate): StatPeriod {
  const fallback = presetPeriod('last12Months', today)
  const start = from ?? fallback.from
  const end = to ?? fallback.to
  return capPeriod(start <= end ? { from: start, to: end } : { from: end, to: start })
}

/** The preset a period matches exactly, to highlight its pill. */
export function presetOf(period: StatPeriod, today: IsoDate): PeriodPreset | null {
  return (
    PERIOD_PRESETS.find((preset) => {
      const candidate = presetPeriod(preset, today)
      return candidate.from === period.from && candidate.to === period.to
    }) ?? null
  )
}
