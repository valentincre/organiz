import { isValidIso } from './dates'
import { clampName, hasKey, LIMITS } from './limits'
import type {
  ChartId,
  ColorKey,
  DashboardState,
  Mutation,
  OptionId,
  PropertyDef,
  PropertyId,
  PropertyKind,
  PropertyScope,
  PropertyValue,
  PropertyValues,
} from './types'

// Custom properties of people and events. Every mutation takes the scope, so
// both share the same rules; like the other mutations they express intents.

const DEFS = { person: 'personProperties', event: 'eventProperties' } as const
const TARGETS = { person: 'people', event: 'events' } as const
const MAX_PROPERTIES = { person: LIMITS.personProperties, event: LIMITS.eventProperties }

export const propertiesOf = (state: DashboardState, scope: PropertyScope): Record<PropertyId, PropertyDef> =>
  state[DEFS[scope]]

const hasOptions = (kind: PropertyKind) => kind === 'choice' || kind === 'multi'

/** Properties of a scope in display order. */
export function sortedProperties(state: DashboardState, scope: PropertyScope): (PropertyDef & { id: PropertyId })[] {
  return Object.entries(propertiesOf(state, scope))
    .map(([id, def]) => ({ id, ...def }))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}

/** Options of a property in display order. */
export function sortedOptions(def: PropertyDef): { id: OptionId; label: string; color: ColorKey }[] {
  return Object.entries(def.options ?? {})
    .map(([id, option]) => ({ id, label: option.label, color: option.color, order: option.order }))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}

function withDefs(
  state: DashboardState,
  scope: PropertyScope,
  update: (defs: Record<PropertyId, PropertyDef>) => Record<PropertyId, PropertyDef> | null,
): DashboardState {
  const defs = propertiesOf(state, scope)
  const next = update(defs)
  return next === null ? state : { ...state, [DEFS[scope]]: next }
}

const withDef = (
  state: DashboardState,
  scope: PropertyScope,
  id: PropertyId,
  update: (def: PropertyDef) => PropertyDef | null,
): DashboardState =>
  withDefs(state, scope, (defs) => {
    if (!hasKey(defs, id)) return null
    const next = update(defs[id])
    return next === null ? null : { ...defs, [id]: next }
  })

/** Rewrites the values of every person or event; `update` returns the same object when nothing changes. */
function mapValues(
  state: DashboardState,
  scope: PropertyScope,
  update: (values: PropertyValues) => PropertyValues,
): DashboardState {
  const key = TARGETS[scope]
  let changed = false
  const targets: Record<string, { values?: PropertyValues }> = {}
  for (const [id, target] of Object.entries(state[key] as Record<string, { values?: PropertyValues }>)) {
    const values = target.values && update(target.values)
    if (values !== target.values) {
      changed = true
      const next = { ...target, values }
      if (!values || Object.keys(values).length === 0) delete next.values
      targets[id] = next
    } else {
      targets[id] = target
    }
  }
  return changed ? { ...state, [key]: targets } : state
}

const without = (values: PropertyValues, propertyId: PropertyId): PropertyValues => {
  if (!hasKey(values, propertyId)) return values
  const next = { ...values }
  delete next[propertyId]
  return next
}

// Definitions

export interface NewOption {
  id: OptionId
  label: string
  color: ColorKey
}

export const addProperty =
  (scope: PropertyScope, id: PropertyId, kind: PropertyKind, name: string, options: NewOption[] = [], order = Date.now()): Mutation =>
  (state) =>
    withDefs(state, scope, (defs) => {
      const trimmed = clampName(name, LIMITS.label)
      if (!trimmed || hasKey(defs, id) || Object.keys(defs).length >= MAX_PROPERTIES[scope]) return null
      const def: PropertyDef = { kind, name: trimmed, order }
      if (hasOptions(kind)) {
        def.options = {}
        options.slice(0, LIMITS.options).forEach((option, index) => {
          const label = clampName(option.label, LIMITS.label)
          if (label && !hasKey(def.options!, option.id)) def.options![option.id] = { label, color: option.color, order: index }
        })
      }
      return { ...defs, [id]: def }
    })

export const renameProperty =
  (scope: PropertyScope, id: PropertyId, name: string): Mutation =>
  (state) =>
    withDef(state, scope, id, (def) => {
      const trimmed = clampName(name, LIMITS.label)
      return !trimmed || trimmed === def.name ? null : { ...def, name: trimmed }
    })

export const moveProperty =
  (scope: PropertyScope, id: PropertyId, order: number): Mutation =>
  (state) =>
    withDef(state, scope, id, (def) => (def.order === order ? null : { ...def, order }))

/** Removes the property and its value from every person or event. */
export const deleteProperty =
  (scope: PropertyScope, id: PropertyId): Mutation =>
  (state) => {
    const removed = withDefs(state, scope, (defs) => {
      if (!hasKey(defs, id)) return null
      const next = { ...defs }
      delete next[id]
      return next
    })
    return removed === state ? state : withoutSplitCharts(mapValues(removed, scope, (values) => without(values, id)), scope, id)
  }

/** The charts split by the property, which deleting it drops, in their order on the page. */
export const chartsSplitBy = (state: DashboardState, scope: PropertyScope, id: PropertyId): ChartId[] =>
  Object.entries(state.statCharts ?? {})
    .filter(([, { split }]) => typeof split !== 'string' && (scope === 'person' ? 'person' in split && split.person : 'event' in split && split.event) === id)
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([chartId]) => chartId)

/** Drops the charts split by a deleted property, and the record once it is empty. */
function withoutSplitCharts(state: DashboardState, scope: PropertyScope, id: PropertyId): DashboardState {
  if (!state.statCharts) return state
  const dropped = new Set(chartsSplitBy(state, scope, id))
  if (dropped.size === 0) return state
  const kept = Object.entries(state.statCharts).filter(([chartId]) => !dropped.has(chartId))
  if (kept.length > 0) return { ...state, statCharts: Object.fromEntries(kept) }
  const rest = { ...state }
  delete rest.statCharts
  return rest
}

/** A single choice becomes a multiple choice: each value becomes a one-item list. */
export const convertToMulti =
  (scope: PropertyScope, id: PropertyId): Mutation =>
  (state) => {
    const converted = withDef(state, scope, id, (def) => (def.kind === 'choice' ? { ...def, kind: 'multi' } : null))
    if (converted === state) return state
    return mapValues(converted, scope, (values) =>
      typeof values[id] === 'string' ? { ...values, [id]: [values[id] as string] } : values,
    )
  }

// Options

const withOptions = (
  state: DashboardState,
  scope: PropertyScope,
  propertyId: PropertyId,
  update: (options: NonNullable<PropertyDef['options']>) => PropertyDef['options'] | null,
): DashboardState =>
  withDef(state, scope, propertyId, (def) => {
    if (!def.options) return null
    const options = update(def.options)
    return options ? { ...def, options } : null
  })

export const addOption =
  (scope: PropertyScope, propertyId: PropertyId, id: OptionId, label: string, color: ColorKey, order = Date.now()): Mutation =>
  (state) =>
    withOptions(state, scope, propertyId, (options) => {
      const trimmed = clampName(label, LIMITS.label)
      if (!trimmed || hasKey(options, id) || Object.keys(options).length >= LIMITS.options) return null
      return { ...options, [id]: { label: trimmed, color, order } }
    })

export const renameOption =
  (scope: PropertyScope, propertyId: PropertyId, id: OptionId, label: string): Mutation =>
  (state) =>
    withOptions(state, scope, propertyId, (options) => {
      const trimmed = clampName(label, LIMITS.label)
      if (!hasKey(options, id) || !trimmed || options[id].label === trimmed) return null
      return { ...options, [id]: { ...options[id], label: trimmed } }
    })

export const setOptionColor =
  (scope: PropertyScope, propertyId: PropertyId, id: OptionId, color: ColorKey): Mutation =>
  (state) =>
    withOptions(state, scope, propertyId, (options) =>
      !hasKey(options, id) || options[id].color === color ? null : { ...options, [id]: { ...options[id], color } },
    )

export const moveOption =
  (scope: PropertyScope, propertyId: PropertyId, id: OptionId, order: number): Mutation =>
  (state) =>
    withOptions(state, scope, propertyId, (options) =>
      !hasKey(options, id) || options[id].order === order ? null : { ...options, [id]: { ...options[id], order } },
    )

/** Removes the option and every value that used it. */
export const deleteOption =
  (scope: PropertyScope, propertyId: PropertyId, id: OptionId): Mutation =>
  (state) => {
    const removed = withOptions(state, scope, propertyId, (options) => {
      if (!hasKey(options, id)) return null
      const next = { ...options }
      delete next[id]
      return next
    })
    if (removed === state) return state
    return mapValues(removed, scope, (values) => {
      const value = values[propertyId]
      if (value === id) return without(values, propertyId)
      if (!Array.isArray(value) || !value.includes(id)) return values
      const rest = value.filter((option) => option !== id)
      return rest.length > 0 ? { ...values, [propertyId]: rest } : without(values, propertyId)
    })
  }

// Values

/** A property value as text: option labels, a number in the locale's format, an ISO date; empty when there is no valid value. */
export function valueText(def: PropertyDef, values: PropertyValues | undefined, propertyId: string, locale: string): string {
  const value = values && hasKey(values, propertyId) ? normalizeValue(def, values[propertyId]) : null
  if (value === null) return ''
  if (def.kind === 'choice' || def.kind === 'multi') {
    const ids = new Set(Array.isArray(value) ? value : [value as string])
    return sortedOptions(def)
      .filter((option) => ids.has(option.id))
      .map((option) => option.label)
      .join(', ')
  }
  if (def.kind === 'number') return new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: 10 }).format(value as number)
  return String(value)
}

/** The value as stored for this property, or null when it is empty or invalid. */
export function normalizeValue(def: PropertyDef, value: PropertyValue | null): PropertyValue | null {
  if (value === null) return null
  switch (def.kind) {
    case 'choice':
      return typeof value === 'string' && hasKey(def.options ?? {}, value) ? value : null
    case 'multi': {
      if (!Array.isArray(value)) return null
      const ids = [...new Set(value)].filter((id) => hasKey(def.options ?? {}, id)).sort()
      return ids.length > 0 ? ids : null
    }
    case 'text': {
      if (typeof value !== 'string') return null
      const text = value.trim().slice(0, LIMITS.textValue).trim()
      return text || null
    }
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? value : null
    case 'date':
      return typeof value === 'string' && isValidIso(value) ? value : null
  }
}

const sameValue = (a: PropertyValue | undefined, b: PropertyValue | null) =>
  Array.isArray(a) && Array.isArray(b) ? a.join('|') === b.join('|') : a === (b ?? undefined)

function withValues(
  state: DashboardState,
  scope: PropertyScope,
  targetId: string,
  update: (values: PropertyValues) => PropertyValues,
): DashboardState {
  const key = TARGETS[scope]
  const targets = state[key] as Record<string, { values?: PropertyValues }>
  if (!hasKey(targets, targetId)) return state
  const target = targets[targetId]
  const current = target.values ?? {}
  const values = update(current)
  if (values === current) return state
  const next: { values?: PropertyValues } = { ...target, values }
  if (Object.keys(values).length === 0) delete next.values
  return { ...state, [key]: { ...targets, [targetId]: next } }
}

/** Sets or clears (null) one value; ignored when the property is gone or the value does not fit its kind. */
export const setValue =
  (scope: PropertyScope, targetId: string, propertyId: PropertyId, value: PropertyValue | null): Mutation =>
  (state) => {
    const defs = propertiesOf(state, scope)
    if (!hasKey(defs, propertyId)) return state
    const normalized = normalizeValue(defs[propertyId], value)
    if (value !== null && normalized === null && !(defs[propertyId].kind === 'text' && typeof value === 'string')) return state
    return withValues(state, scope, targetId, (values) => {
      if (sameValue(values[propertyId], normalized)) return values
      return normalized === null ? without(values, propertyId) : { ...values, [propertyId]: normalized }
    })
  }

/** Ticks or unticks one option of a multiple choice, so concurrent edits of other options are kept. */
export const setOptionValue =
  (scope: PropertyScope, targetId: string, propertyId: PropertyId, optionId: OptionId, selected: boolean): Mutation =>
  (state) => {
    const defs = propertiesOf(state, scope)
    if (!hasKey(defs, propertyId)) return state
    const def = defs[propertyId]
    if (def.kind !== 'multi' || !hasKey(def.options ?? {}, optionId)) return state
    return withValues(state, scope, targetId, (values) => {
      const current = Array.isArray(values[propertyId]) ? (values[propertyId] as OptionId[]) : []
      if (current.includes(optionId) === selected) return values
      const next = selected ? [...current, optionId].sort() : current.filter((id) => id !== optionId)
      return next.length > 0 ? { ...values, [propertyId]: next } : without(values, propertyId)
    })
  }
