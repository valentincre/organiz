import { useMemo } from 'react'
import { readValue } from '../domain/filters'
import { sortedOptions, sortedProperties } from '../domain/properties'
import type { EventEntry } from '../domain/selectors'
import type { ColorKey, DashboardState } from '../domain/types'

/** Color of an event: the color of its value for the first choice property, if any. */
export function useEventColor(state: DashboardState) {
  const palette = useMemo(() => {
    const property = sortedProperties(state, 'event').find((p) => p.kind === 'choice')
    return property ? { id: property.id, colors: new Map(sortedOptions(property).map((option) => [option.id, option.color])) } : null
  }, [state])

  return (event: EventEntry): ColorKey | undefined => {
    if (!palette) return undefined
    const value = readValue(state.eventProperties, event.values, palette.id)
    return typeof value === 'string' ? palette.colors.get(value) : undefined
  }
}
