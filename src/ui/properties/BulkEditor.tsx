import { useState } from 'react'
import { compose } from '../../domain/mutations'
import { setOptionValue, setValue, sortedOptions, sortedProperties } from '../../domain/properties'
import type { DashboardState, Mutation, OptionId, PersonId, PropertyValue } from '../../domain/types'
import { useI18n } from '../../i18n/context'
import { button, inputBase } from '../components/styles'
import { ValueInput } from './ValueInput'

interface Props {
  state: DashboardState
  selected: PersonId[]
  mutate: (mutation: Mutation) => void
  onApplied: (count: number) => void
}

/** Sets one property for every selected person at once (or adds/removes one option of a multiple choice). */
export function BulkEditor({ state, selected, mutate, onApplied }: Props) {
  const { t } = useI18n()
  const properties = sortedProperties(state, 'person')
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? '')
  const [value, setDraft] = useState<PropertyValue | null>(null)
  const [option, setOption] = useState<OptionId>('')
  const [add, setAdd] = useState(true)
  const def = properties.find((p) => p.id === propertyId)
  if (!def) return <p className="text-sm text-muted">{t('bulk.noProperties')}</p>

  const apply = () => {
    const mutations =
      def.kind === 'multi'
        ? selected.map((id) => setOptionValue('person', id, def.id, option, add))
        : selected.map((id) => setValue('person', id, def.id, value))
    mutate(compose(...mutations))
    onApplied(selected.length)
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="grid gap-1">
        <label htmlFor="bulk-property" className="text-sm font-medium">
          {t('filter.property')}
        </label>
        <select
          id="bulk-property"
          className={inputBase}
          value={propertyId}
          onChange={(e) => {
            setPropertyId(e.target.value)
            setDraft(null)
            setOption('')
          }}
        >
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      {def.kind === 'multi' ? (
        <>
          <select className={inputBase} aria-label={t('bulk.action')} value={add ? 'add' : 'remove'} onChange={(e) => setAdd(e.target.value === 'add')}>
            <option value="add">{t('bulk.addOption')}</option>
            <option value="remove">{t('bulk.removeOption')}</option>
          </select>
          <select className={inputBase} aria-label={t('property.optionLabel')} value={option} onChange={(e) => setOption(e.target.value)}>
            <option value="">{t('property.noValue')}</option>
            {sortedOptions(def).map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </>
      ) : (
        <div key={def.id} className="grid min-w-40 flex-1 gap-1">
          <ValueInput
            id="bulk-value"
            label={t('bulk.value')}
            def={def}
            value={value ?? undefined}
            onSet={setDraft}
            onToggleOption={() => {}}
          />
        </div>
      )}
      <button type="button" className={button('primary')} disabled={def.kind === 'multi' && !option} onClick={apply}>
        {t(value === null && def.kind !== 'multi' ? 'bulk.clear' : 'bulk.apply', { count: selected.length })}
      </button>
    </div>
  )
}
