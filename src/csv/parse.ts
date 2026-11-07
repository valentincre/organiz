import Papa from 'papaparse'
import { foldText } from '../domain/matching'

export type Table = string[][]

/** Parses CSV or a plain list of names; the delimiter (, ; tab) is auto-detected. */
export function parseTable(text: string): Table {
  const { data } = Papa.parse<string[]>(text.trim(), { skipEmptyLines: 'greedy' })
  const rows = data.map((row) => row.map((cell) => (cell ?? '').trim())).filter((row) => row.some(Boolean))
  const width = Math.max(0, ...rows.map((row) => row.length))
  return rows.map((row) => [...row, ...Array<string>(width - row.length).fill('')])
}

const FULL_NAME = ['name', 'full name', 'nom complet', 'nom et prenom', 'prenom nom', 'nom prenom', 'participant', 'participants', 'personne', 'membre', 'member', 'attendee']
const FIRST_NAME = ['prenom', 'first name', 'firstname', 'given name']
const LAST_NAME = ['nom', 'nom de famille', 'last name', 'lastname', 'surname', 'family name']
const OTHER = ['email', 'e mail', 'mail', 'telephone', 'tel', 'phone', 'date', 'age', 'id', 'statut', 'status']
const HEADER_WORDS = new Set([...FULL_NAME, ...FIRST_NAME, ...LAST_NAME, ...OTHER])

const headerKeys = (table: Table) => (table[0] ?? []).map(foldText)

/** True when the first row looks like column titles rather than data. */
export function guessHasHeader(table: Table): boolean {
  return headerKeys(table).some((key) => HEADER_WORDS.has(key))
}

/** Best guess of the columns holding the name, in the order to join them. */
export function guessNameColumns(table: Table, hasHeader: boolean): number[] {
  if (!hasHeader) return table.length > 0 ? [0] : []
  const keys = headerKeys(table)
  const find = (words: string[]) => keys.findIndex((key) => words.includes(key))
  const full = find(FULL_NAME)
  if (full >= 0) return [full]
  const first = find(FIRST_NAME)
  const last = find(LAST_NAME)
  if (first >= 0 && last >= 0) return [first, last]
  if (first >= 0) return [first]
  if (last >= 0) return [last]
  return [0]
}

export interface ImportRecord {
  name: string
  /** The whole data row, to read the other mapped columns from. */
  row: string[]
}

/** Data rows that have a name, with their cells. */
export function extractRecords(table: Table, columns: number[], hasHeader: boolean): ImportRecord[] {
  return table
    .slice(hasHeader ? 1 : 0)
    .map((row) => ({ name: columns.map((index) => row[index] ?? '').filter(Boolean).join(' '), row }))
    .filter((record) => record.name)
}

/** One name per data row, joining the chosen columns with a space. */
export function extractNames(table: Table, columns: number[], hasHeader: boolean): string[] {
  return table
    .slice(hasHeader ? 1 : 0)
    .map((row) => columns.map((index) => row[index] ?? '').filter(Boolean).join(' '))
    .filter(Boolean)
}
