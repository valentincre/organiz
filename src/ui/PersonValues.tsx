import type { DashboardState, PropertyDef, PropertyId, PropertyValues } from '../domain/types'
import { ValueView } from './properties/ValueView'

/** The first two property values of a person under their name in a list; nothing when they have none. */
export function PersonValues({
  state,
  properties,
  values,
}: {
  state: DashboardState
  /** Person properties in display order. */
  properties: (PropertyDef & { id: PropertyId })[]
  values?: PropertyValues
}) {
  const shown = properties.slice(0, 2)
  if (!shown.some((p) => values?.[p.id] !== undefined)) return null
  return (
    <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1">
      {shown.map((p) => (
        <ValueView key={p.id} defs={state.personProperties} propertyId={p.id} values={values} compact withName />
      ))}
    </span>
  )
}
