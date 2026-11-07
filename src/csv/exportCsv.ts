import { countedCount, countedIds } from '../domain/attendance'
import { slugify } from '../domain/matching'
import { sortedProperties, valueText } from '../domain/properties'
import { attendanceCounts, compareEvents, sortedEvents, sortedPeople, type EventEntry } from '../domain/selectors'
import type { DashboardState, IsoDate, PropertyScope, PropertyValues } from '../domain/types'

export interface ExportHeaders {
  name: string
  total: string
  date: string
  start: string
  end: string
  event: string
  yes: string
  no: string
  /** When the roll call was done. */
  called: string
  present: string
}

interface ExportOptions {
  locale: string
  /** Excel expects ";" in locales that use a decimal comma, such as French. */
  delimiter: ',' | ';'
  headers: ExportHeaders
  /** Optional period (inclusive); an empty bound means no limit on that side. */
  from?: IsoDate
  to?: IsoDate
}

/**
 * Spreadsheets run a cell that starts with = + - @ (or a tab or carriage
 * return before one) as a formula; a leading apostrophe keeps it as text.
 */
export function neutralizeFormula(cell: string): string {
  return /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell
}

/** Joins rows into CSV; cells with quotes, delimiters or line breaks are quoted, line breaks inside a cell become "\n". */
function toCsv(rows: string[][], delimiter: string): string {
  const escape = (raw: string) => {
    const cell = neutralizeFormula(raw.replace(/\r\n?/g, '\n'))
    return /["\n]/.test(cell) || cell.includes(delimiter) ? `"${cell.replace(/"/g, '""')}"` : cell
  }
  return rows.map((row) => row.map(escape).join(delimiter)).join('\r\n') + '\r\n'
}

const propertyColumns = (state: DashboardState, scope: PropertyScope, locale: string) =>
  sortedProperties(state, scope).map((def) => ({
    header: def.name,
    cell: (values?: PropertyValues) => valueText(def, values, def.id, locale),
  }))

const eventsInPeriod = (state: DashboardState, { from, to }: ExportOptions): EventEntry[] =>
  sortedEvents(state, from, to).sort(compareEvents)

/** Header of an event column: date, start time and name, e.g. "2026-10-11 18:00 Training". */
const eventHeader = (event: EventEntry) => [event.date, event.start, event.name].filter(Boolean).join(' ')

/** People × events table, oldest event first, "1" when present. */
export function buildAttendanceCsv(state: DashboardState, options: ExportOptions): string {
  const { locale, delimiter, headers } = options
  const events = eventsInPeriod(state, options)
  const counted = events.map((event) => new Set(countedIds(event)))
  const rows = [[headers.name, headers.total, ...events.map(eventHeader)]]
  for (const person of sortedPeople(state, locale)) {
    const marks = counted.map((ids) => (ids.has(person.id) ? '1' : ''))
    rows.push([person.name, String(marks.filter(Boolean).length), ...marks])
  }
  return toCsv(rows, delimiter)
}

/** "2026-10-10 18:05" in the local time zone, empty when the event was never called. */
function formatCalledAt(calledAt: number | undefined): string {
  if (calledAt === undefined) return ''
  const d = new Date(calledAt)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** One row per event: date, times, name, replies, roll call time, number present (counted), then its properties. */
export function buildEventsCsv(state: DashboardState, options: ExportOptions): string {
  const { locale, delimiter, headers } = options
  const columns = propertyColumns(state, 'event', locale)
  const rows = [[headers.date, headers.start, headers.end, headers.event, headers.yes, headers.no, headers.called, headers.present, ...columns.map((c) => c.header)]]
  for (const event of eventsInPeriod(state, options)) {
    rows.push([
      event.date,
      event.start ?? '',
      event.end ?? '',
      event.name,
      String(event.yes?.length ?? 0),
      String(event.no?.length ?? 0),
      formatCalledAt(event.calledAt),
      String(countedCount(event)),
      ...columns.map((column) => column.cell(event.values)),
    ])
  }
  return toCsv(rows, delimiter)
}

/** One row per person: name, events attended in the period, then their properties. */
export function buildPeopleCsv(state: DashboardState, options: ExportOptions): string {
  const { locale, delimiter, headers } = options
  const columns = propertyColumns(state, 'person', locale)
  const counts = attendanceCounts(state, eventsInPeriod(state, options))
  const rows = [[headers.name, headers.total, ...columns.map((c) => c.header)]]
  for (const person of sortedPeople(state, locale)) {
    rows.push([person.name, String(counts.get(person.id) ?? 0), ...columns.map((column) => column.cell(person.values))])
  }
  return toCsv(rows, delimiter)
}

export function exportFileName(dashboardName: string, kind: string, today: string): string {
  return `organiz-${slugify(dashboardName) || 'dashboard'}-${slugify(kind)}-${today}.csv`
}
