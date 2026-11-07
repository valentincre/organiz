import { readValue } from '../../domain/filters'
import { setOptionValue, setValue, sortedProperties, propertiesOf } from '../../domain/properties'
import type { DashboardState, Mutation, PropertyScope, PropertyValues } from '../../domain/types'
import { useCanEdit } from '../canEdit'
import { ValueInput } from './ValueInput'
import { ValueView } from './ValueView'

interface Props {
  state: DashboardState
  scope: PropertyScope
  /** Person or event id. */
  targetId: string
  values?: PropertyValues
  mutate: (mutation: Mutation) => void
  /** Applies a change made for the target; by default to the target only (events of a series can share it). */
  apply?: (change: (targetId: string) => Mutation) => void
}

/** One labeled input per property of the scope; each change is saved on its own. Readers get the values as text. */
export function ValuesEditor({ state, scope, targetId, values, mutate, apply = (change) => mutate(change(targetId)) }: Props) {
  const canEdit = useCanEdit()
  const defs = propertiesOf(state, scope)

  if (!canEdit) {
    return (
      <div className="@container">
        <dl className="grid gap-3 @md:grid-cols-2">
          {sortedProperties(state, scope).map((def) => (
            <div key={def.id} className="grid gap-1">
              <dt className="text-sm font-medium">{def.name}</dt>
              <dd className="min-w-0">
                {readValue(defs, values, def.id) === undefined ? (
                  <span className="text-sm text-muted">–</span>
                ) : (
                  <ValueView defs={defs} propertyId={def.id} values={values} />
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    )
  }

  return (
    // Two columns when the editor itself is wide enough, wherever it is placed.
    <div className="@container">
      <div className="grid gap-3 @md:grid-cols-2">
        {sortedProperties(state, scope).map((def) => {
          const inputId = `value-${targetId}-${def.id}`
          const wide = def.kind === 'multi' || (def.kind === 'text' && scope === 'event')
          return (
            <div key={def.id} className={wide ? 'grid gap-1 @md:col-span-2' : 'grid gap-1'}>
              {def.kind === 'multi' ? (
                <span className="text-sm font-medium">{def.name}</span>
              ) : (
                <label htmlFor={inputId} className="text-sm font-medium">
                  {def.name}
                </label>
              )}
              <ValueInput
                id={inputId}
                label={def.name}
                def={def}
                value={readValue(defs, values, def.id)}
                multiline={scope === 'event'}
                onSet={(value) => apply((id) => setValue(scope, id, def.id, value))}
                onToggleOption={(optionId, selected) => apply((id) => setOptionValue(scope, id, def.id, optionId, selected))}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
