import type { IsoDate, Time } from './types'

const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 86_400_000

export interface YearMonth {
  year: number
  /** 0 = January */
  month: number
}

export interface DayCell {
  date: IsoDate
  inMonth: boolean
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Dates are handled as UTC midnight so DST never shifts a day. */
export function parseIso(date: IsoDate): Date {
  const match = ISO_PATTERN.exec(date)
  if (!match) throw new Error(`Invalid date: ${date}`)
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
}

export function toIso(date: Date): IsoDate {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

export function isValidIso(value: string): boolean {
  if (!ISO_PATTERN.test(value)) return false
  return toIso(parseIso(value)) === value
}

/** Today in the user's local time zone. */
export function todayIso(now = new Date()): IsoDate {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function monthOf(date: IsoDate): YearMonth {
  const d = parseIso(date)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() }
}

export function addMonths({ year, month }: YearMonth, delta: number): YearMonth {
  const total = year * 12 + month + delta
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 }
}

/** 6 weeks × 7 days, weeks starting on Monday. */
export function monthGrid({ year, month }: YearMonth): DayCell[] {
  const first = Date.UTC(year, month, 1)
  const offset = (new Date(first).getUTCDay() + 6) % 7
  const cells: DayCell[] = []
  for (let i = 0; i < 42; i++) {
    const day = new Date(first + (i - offset) * DAY_MS)
    cells.push({ date: toIso(day), inMonth: day.getUTCMonth() === month })
  }
  return cells
}

export function compareMonths(a: YearMonth, b: YearMonth): number {
  return a.year * 12 + a.month - (b.year * 12 + b.month)
}

/** Every month from `from` to `to`, both included; empty when `to` is before `from`. */
export function monthsBetween(from: YearMonth, to: YearMonth): YearMonth[] {
  const count = compareMonths(to, from) + 1
  return Array.from({ length: Math.max(0, count) }, (_, i) => addMonths(from, i))
}

/** Inclusive range test; a missing bound is open. ISO dates compare as strings. */
export function isInRange(date: IsoDate, from?: IsoDate, to?: IsoDate): boolean {
  return (!from || date >= from) && (!to || date <= to)
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

export function isValidTime(value: string): boolean {
  return TIME_PATTERN.test(value)
}

/** One hour later, clamped to 23:xx; the default end of an event started at `time`. */
export function plusHour(time: Time): Time {
  const hours = Math.min(23, Number(time.slice(0, 2)) + 1)
  return `${String(hours).padStart(2, '0')}:${time.slice(3)}`
}

/**
 * Reads a typed time: "18", "18h", "18h30", "18:30", "18.30", "1830", "930",
 * or with am / pm ("6pm", "6:30 PM"). Returns "HH:MM", or null when it is not
 * a time of day.
 */
export function parseTime(text: string): Time | null {
  const match = /^(\d{1,2})(?:\s*[:h.]\s*(\d{2})?|(\d{2}))?\s*(?:([ap])\.?\s*m?\.?)?$/i.exec(text.trim())
  if (!match) return null
  let hours = Number(match[1])
  const minutes = Number(match[2] ?? match[3] ?? 0)
  const meridiem = match[4]?.toLowerCase()
  if (meridiem) {
    if (hours < 1 || hours > 12) return null
    hours = (hours % 12) + (meridiem === 'p' ? 12 : 0)
  }
  if (hours > 23 || minutes > 59) return null
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

/** No times (all day), a start only, or a start and a later end on the same day. */
export function isValidTimeRange(start?: string, end?: string): boolean {
  if (start === undefined) return end === undefined
  if (!isValidTime(start)) return false
  return end === undefined || (isValidTime(end) && end > start)
}

/** Day of the week, 0 = Monday … 6 = Sunday. */
export const weekdayOf = (date: IsoDate): number => (parseIso(date).getUTCDay() + 6) % 7

export function addDays(date: IsoDate, days: number): IsoDate {
  return toIso(new Date(parseIso(date).getTime() + days * DAY_MS))
}
