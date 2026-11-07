import { isValidIso } from './dates'
import { hasKey } from './limits'
import { foldText } from './matching'
import { normalizeValue, sortedOptions } from './properties'
import type { OptionId, PropertyDef, PropertyId, PropertyValue, PropertyValues } from './types'

/** One condition on a property; a filter keeps what matches all of them. */
export type Condition =
  /** choice or multi: has any of these options. */
  | { type: 'options'; propertyId: PropertyId; optionIds: OptionId[] }
  /** text: contains, ignoring case and accents. */
  | { type: 'text'; propertyId: PropertyId; query: string }
  /** number or date: within bounds (inclusive); a missing bound is open. */
  | { type: 'range'; propertyId: PropertyId; min?: string; max?: string }
  | { type: 'empty'; propertyId: PropertyId }
  | { type: 'filled'; propertyId: PropertyId }

export type Filter = Condition[]

type Defs = Record<PropertyId, PropertyDef>

/** The value of a property, or undefined when missing or no longer valid for it. */
export function readValue(defs: Defs, values: PropertyValues | undefined, propertyId: PropertyId): PropertyValue | undefined {
  if (!values || !hasKey(values, propertyId) || !hasKey(defs, propertyId)) return undefined
  return normalizeValue(defs[propertyId], values[propertyId]) ?? undefined
}

const bound = (def: PropertyDef, text: string | undefined): number | string | undefined => {
  if (text === undefined || text === '') return undefined
  if (def.kind === 'number') {
    const number = Number(text)
    return Number.isFinite(number) ? number : undefined
  }
  return isValidIso(text) ? text : undefined
}

export function matchesCondition(defs: Defs, values: PropertyValues | undefined, condition: Condition): boolean {
  if (!hasKey(defs, condition.propertyId)) return true
  const def = defs[condition.propertyId]
  const value = readValue(defs, values, condition.propertyId)
  switch (condition.type) {
    case 'empty':
      return value === undefined
    case 'filled':
      return value !== undefined
    case 'options':
      if (value === undefined) return false
      return (Array.isArray(value) ? value : [value as string]).some((id) => condition.optionIds.includes(id))
    case 'text':
      return value !== undefined && foldText(String(value)).includes(foldText(condition.query))
    case 'range': {
      if (value === undefined) return false
      const min = bound(def, condition.min)
      const max = bound(def, condition.max)
      return (min === undefined || value >= min) && (max === undefined || value <= max)
    }
  }
}

export const matchesFilter = (defs: Defs, values: PropertyValues | undefined, filter: Filter): boolean =>
  filter.every((condition) => matchesCondition(defs, values, condition))

// URL encoding: conditions joined by ",", e.g. "p1:o1|o2,p2~mar,p3>=1<=5,p4!,p5*".
// Ids are base64url and the text query is URI-encoded, so separators never clash.

export function encodeFilter(filter: Filter): string {
  return filter
    .map((condition) => {
      const id = condition.propertyId
      switch (condition.type) {
        case 'options':
          return `${id}:${condition.optionIds.join('|')}`
        case 'text':
          return `${id}~${encodeURIComponent(condition.query)}`
        case 'range':
          return `${id}${condition.min ? `>=${condition.min}` : ''}${condition.max ? `<=${condition.max}` : ''}`
        case 'empty':
          return `${id}!`
        case 'filled':
          return `${id}*`
      }
    })
    .join(',')
}

const ID = '[A-Za-z0-9_-]+'
const PATTERNS = {
  options: new RegExp(`^(${ID}):(${ID}(?:\\|${ID})*)$`),
  text: new RegExp(`^(${ID})~(.*)$`),
  range: new RegExp(`^(${ID})(?:>=([^<]+))?(?:<=(.+))?$`),
  empty: new RegExp(`^(${ID})!$`),
  filled: new RegExp(`^(${ID})\\*$`),
}

/** Lenient: conditions on unknown properties or options, or of the wrong kind, are dropped. */
export function decodeFilter(encoded: string | null | undefined, defs: Defs): Filter {
  if (!encoded) return []
  const filter: Filter = []
  for (const part of encoded.split(',')) {
    let match: RegExpExecArray | null
    if ((match = PATTERNS.empty.exec(part)) && hasKey(defs, match[1])) {
      filter.push({ type: 'empty', propertyId: match[1] })
    } else if ((match = PATTERNS.filled.exec(part)) && hasKey(defs, match[1])) {
      filter.push({ type: 'filled', propertyId: match[1] })
    } else if ((match = PATTERNS.options.exec(part)) && hasKey(defs, match[1])) {
      const options = defs[match[1]].options ?? {}
      const optionIds = match[2].split('|').filter((id) => hasKey(options, id))
      if (optionIds.length > 0) filter.push({ type: 'options', propertyId: match[1], optionIds })
    } else if ((match = PATTERNS.text.exec(part)) && hasKey(defs, match[1]) && defs[match[1]].kind === 'text') {
      try {
        filter.push({ type: 'text', propertyId: match[1], query: decodeURIComponent(match[2]) })
      } catch {
        // Malformed escape: drop the condition.
      }
    } else if ((match = PATTERNS.range.exec(part)) && hasKey(defs, match[1]) && (match[2] || match[3])) {
      const def = defs[match[1]]
      if (def.kind !== 'number' && def.kind !== 'date') continue
      const min = bound(def, match[2]) === undefined ? undefined : match[2]
      const max = bound(def, match[3]) === undefined ? undefined : match[3]
      if (min || max) filter.push({ type: 'range', propertyId: match[1], ...(min && { min }), ...(max && { max }) })
    }
  }
  return filter
}

// Sorting and breakdowns

/** Orders by a property's value, empty values last; returns 0 on ties so a stable sort keeps the previous order. */
export function compareByProperty(def: PropertyDef, collator: Intl.Collator) {
  const rank = new Map(sortedOptions(def).map((option, index) => [option.id, index]))
  const key = (value: PropertyValue | undefined): number | string | undefined => {
    if (value === undefined) return undefined
    if (def.kind === 'choice') return rank.get(value as string)
    if (def.kind === 'multi') return Math.min(...(value as OptionId[]).map((id) => rank.get(id) ?? Infinity))
    return value as number | string
  }
  return (a: PropertyValue | undefined, b: PropertyValue | undefined): number => {
    const ka = key(a)
    const kb = key(b)
    if (ka === undefined || kb === undefined) return ka === kb ? 0 : ka === undefined ? 1 : -1
    if (typeof ka === 'number' && typeof kb === 'number') return ka - kb
    return def.kind === 'text' ? collator.compare(String(ka), String(kb)) : String(ka).localeCompare(String(kb))
  }
}

export type Breakdown =
  | { type: 'options'; counts: { optionId: OptionId; count: number }[]; empty: number }
  | { type: 'number'; count: number; min: number; max: number; average: number; empty: number }

/** Counts per option (choice, multi) or min/average/max (number) over a group, e.g. the attendees of an event. */
export function breakdown(defs: Defs, propertyId: PropertyId, items: (PropertyValues | undefined)[]): Breakdown | null {
  if (!hasKey(defs, propertyId)) return null
  const def = defs[propertyId]
  const values = items.map((values) => readValue(defs, values, propertyId))
  const empty = values.filter((value) => value === undefined).length
  if (def.kind === 'choice' || def.kind === 'multi') {
    const counts = sortedOptions(def).map((option) => ({
      optionId: option.id,
      count: values.filter((value) => value === option.id || (Array.isArray(value) && value.includes(option.id))).length,
    }))
    return { type: 'options', counts, empty }
  }
  if (def.kind === 'number') {
    const numbers = values.filter((value): value is number => typeof value === 'number')
    if (numbers.length === 0) return { type: 'number', count: 0, min: 0, max: 0, average: 0, empty }
    const sum = numbers.reduce((total, n) => total + n, 0)
    return { type: 'number', count: numbers.length, min: Math.min(...numbers), max: Math.max(...numbers), average: sum / numbers.length, empty }
  }
  return null
}
