import { isValidIso, toIso } from '../domain/dates'
import { foldText } from '../domain/matching'
import type { IsoDate, OptionId, PropertyKind, PropertyOption } from '../domain/types'
import type { Lang } from '../i18n/translate'

const pad = (n: number) => String(n).padStart(2, '0')

/** Regular, non-breaking and narrow no-break spaces all count as a space. */
const SPACES = /[\s  ]+/g

/**
 * Reads a number written the way a spreadsheet in that language exports it.
 * Thousands separators must group digits by three, so "1,2" is not 12 in English.
 */
export function parseNumber(cell: string, lang: Lang): number | null {
  const text = cell.replace(SPACES, ' ').trim()
  if (!text) return null
  const sign = /^[+-]/.test(text) ? text[0] : ''
  const body = text.slice(sign.length).trim()

  const frenchComma = lang === 'fr' && body.includes(',')
  const decimal = frenchComma ? ',' : '.'
  const groups = lang === 'en' ? ' ,' : frenchComma ? ' .' : ' '

  const parts = body.split(decimal)
  if (parts.length > 2) return null
  const [whole, fraction] = parts
  if (fraction !== undefined && !/^\d+$/.test(fraction)) return null
  if (whole === '' && fraction === undefined) return null
  const grouped = new RegExp(`^\\d{1,3}(?:[${groups}]\\d{3})+$`)
  if (whole !== '' && !/^\d+$/.test(whole) && !grouped.test(whole)) return null

  const digits = whole.replace(/\D/g, '') || '0'
  const value = Number(`${sign}${digits}${fraction === undefined ? '' : `.${fraction}`}`)
  return Number.isFinite(value) ? value : null
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30)
const DAY_MS = 86_400_000
const YEAR_FIRST = /^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})$/
const YEAR_LAST = /^(\d{1,2})([-/.])(\d{1,2})\2(\d{2}|\d{4})$/
/** A time after the date ("18:30", "18h30", "T18:30:00Z") is ignored. */
const TRAILING_TIME = /^(\S+?)(?:(?:\s+|T)\d{1,2}[:h]\d{2}\S*(?:\s*[ap]\.?m\.?)?)?$/i

function isoOf(year: number, month: number, day: number): IsoDate | null {
  const iso = `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`
  return isValidIso(iso) ? iso : null
}

/**
 * Reads ISO dates, day-month-year (fr) or month-day-year (en) dates and Excel
 * serial numbers. Any time of day after the date is dropped.
 */
export function parseDate(cell: string, lang: Lang): IsoDate | null {
  const text = cell.trim()
  if (/^\d+$/.test(text)) {
    const serial = Number(text)
    return serial >= 1 && serial <= 80_000 ? toIso(new Date(EXCEL_EPOCH + serial * DAY_MS)) : null
  }

  const date = TRAILING_TIME.exec(text)?.[1]
  if (!date) return null

  const yearFirst = YEAR_FIRST.exec(date)
  if (yearFirst) return isoOf(Number(yearFirst[1]), Number(yearFirst[3]), Number(yearFirst[4]))

  const yearLast = YEAR_LAST.exec(date)
  if (!yearLast) return null
  const [first, second] = [Number(yearLast[1]), Number(yearLast[3])]
  let year = Number(yearLast[4])
  if (yearLast[4].length === 2) year += year < 50 ? 2000 : 1900
  return lang === 'fr' ? isoOf(year, second, first) : isoOf(year, first, second)
}

/** Splits a cell holding several values, without duplicates (first spelling kept). */
export function splitMulti(cell: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const part of cell.split(/[,;|/\r\n]+/)) {
    const value = part.trim()
    const key = foldText(value)
    if (!value || seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }
  return result
}

/** Option whose label matches, ignoring case, accents and punctuation. */
export function matchOption(label: string, options: Record<OptionId, PropertyOption>): OptionId | null {
  const key = foldText(label)
  return Object.entries(options).find(([, option]) => foldText(option.label) === key)?.[0] ?? null
}

const MAX_OPTIONS = 20
const MAX_OPTION_LENGTH = 50

/** Best property kind for a column, from its non-empty cells. */
export function guessKind(cells: string[], lang: Lang): PropertyKind {
  const values = cells.map((cell) => cell.trim()).filter(Boolean)
  if (values.length === 0) return 'text'
  if (values.every((value) => parseNumber(value, lang) !== null)) return 'number'
  if (values.every((value) => parseDate(value, lang) !== null) && !values.every((value) => /^\d+$/.test(value))) {
    return 'date'
  }

  const lists = values.map(splitMulti)
  const parts = new Set(lists.flat().map(foldText))
  if (lists.some((list) => list.length >= 2) && parts.size <= MAX_OPTIONS) return 'multi'

  // A column of all-different values (emails, phone numbers) is text, not a choice.
  const distinct = new Set(values.map(foldText))
  const repeats = distinct.size < values.length || values.length <= 3
  if (repeats && distinct.size <= MAX_OPTIONS && values.every((value) => value.length <= MAX_OPTION_LENGTH)) return 'choice'
  return 'text'
}
