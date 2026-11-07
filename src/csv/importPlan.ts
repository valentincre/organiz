import { hasKey, LIMITS } from '../domain/limits'
import { addOption, addProperty, setValue } from '../domain/properties'
import { COLOR_KEYS, type DashboardState, type Mutation, type OptionId, type PersonId, type PropertyId, type PropertyKind, type PropertyValue } from '../domain/types'
import type { Lang } from '../i18n/translate'
import type { ImportRecord } from './parse'
import { matchOption, parseDate, parseNumber, splitMulti } from './values'

/** Where an extra CSV column goes: an existing person property, or a new one. */
export type ColumnTarget = { type: 'existing'; propertyId: PropertyId } | { type: 'new'; name: string; kind: PropertyKind }

export interface ColumnMapping {
  column: number
  target: ColumnTarget
}

export interface ParsedColumn {
  mapping: ColumnMapping
  propertyId: PropertyId
  kind: PropertyKind
  /** Options to create, in order of first appearance. */
  newOptions: { id: OptionId; label: string }[]
  /** One value per record; null when the cell is empty or unreadable. */
  values: (PropertyValue | null)[]
  /** Distinct cells that could not be read as a number or a date. */
  unreadable: string[]
}

/** Reads one mapped column; `makeId` gives ids to the new property and options. */
export function parseColumn(
  state: DashboardState,
  mapping: ColumnMapping,
  records: ImportRecord[],
  lang: Lang,
  makeId: () => string,
): ParsedColumn {
  const { target } = mapping
  const existing = target.type === 'existing' && hasKey(state.personProperties, target.propertyId) ? state.personProperties[target.propertyId] : undefined
  const propertyId = target.type === 'existing' ? target.propertyId : makeId()
  const kind = existing?.kind ?? (target.type === 'new' ? target.kind : 'text')
  const options = { ...(existing?.options ?? {}) }
  const newOptions: ParsedColumn['newOptions'] = []
  const unreadable = new Set<string>()

  const optionFor = (label: string): OptionId | null => {
    const found = matchOption(label, options)
    if (found) return found
    if (Object.keys(options).length >= LIMITS.options) return null
    const id = makeId()
    const trimmed = label.slice(0, LIMITS.label)
    options[id] = { label: trimmed, order: Object.keys(options).length, color: 'gray' }
    newOptions.push({ id, label: trimmed })
    return id
  }

  const values = records.map(({ row }): PropertyValue | null => {
    const cell = (row[mapping.column] ?? '').trim()
    if (!cell) return null
    switch (kind) {
      case 'choice':
        return optionFor(cell)
      case 'multi': {
        const ids = splitMulti(cell)
          .map(optionFor)
          .filter((id): id is OptionId => id !== null)
        return ids.length > 0 ? [...new Set(ids)].sort() : null
      }
      case 'number':
      case 'date': {
        const value = kind === 'number' ? parseNumber(cell, lang) : parseDate(cell, lang)
        if (value === null) unreadable.add(cell)
        return value
      }
      case 'text':
        return cell.slice(0, LIMITS.textValue)
    }
  })

  return { mapping, propertyId, kind, newOptions, values, unreadable: [...unreadable] }
}

/**
 * Creates the new properties and options, then sets each record's values on
 * its person (`people[i]`, null when the row is ignored). Without `overwrite`,
 * only empty values are filled, so a re-import never erases manual edits.
 */
export function valueMutations(
  state: DashboardState,
  columns: ParsedColumn[],
  people: (PersonId | null)[],
  overwrite: boolean,
): Mutation[] {
  const mutations: Mutation[] = []
  for (const column of columns) {
    const { target } = column.mapping
    const color = (index: number) => COLOR_KEYS[index % COLOR_KEYS.length]
    if (target.type === 'new') {
      const options = column.newOptions.map((option, index) => ({ ...option, color: color(index) }))
      mutations.push(addProperty('person', column.propertyId, target.kind, target.name, options))
    } else {
      const start = Object.keys(state.personProperties[column.propertyId]?.options ?? {}).length
      column.newOptions.forEach((option, index) =>
        mutations.push(addOption('person', column.propertyId, option.id, option.label, color(start + index), start + index)),
      )
    }
    column.values.forEach((value, index) => {
      const personId = people[index]
      if (value === null || !personId) return
      const current = hasKey(state.people, personId) ? state.people[personId].values?.[column.propertyId] : undefined
      if (current !== undefined && !overwrite) return
      mutations.push(setValue('person', personId, column.propertyId, value))
    })
  }
  return mutations
}
