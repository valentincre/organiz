import { useState } from 'react'
import { parseNumber } from '../../csv/values'
import { LIMITS } from '../../domain/limits'
import { sortedOptions } from '../../domain/properties'
import type { OptionId, PropertyDef, PropertyValue } from '../../domain/types'
import { useI18n } from '../../i18n/context'
import { cx, input, optionChip } from '../components/styles'
import { CheckIcon } from '../components/icons'

interface Props {
  id: string
  label: string
  def: PropertyDef
  value: PropertyValue | undefined
  /** Sets or clears (null) the whole value. */
  onSet: (value: PropertyValue | null) => void
  /** Multiple choice: ticks or unticks one option, so concurrent edits of other options are kept. */
  onToggleOption: (optionId: OptionId, selected: boolean) => void
  /** Text values on several lines (event notes). */
  multiline?: boolean
}

/** Editor for one property value, fitted to its kind; text and numbers are saved when the field is left. */
export function ValueInput({ id, label, def, value, onSet, onToggleOption, multiline = false }: Props) {
  const { t, lang } = useI18n()

  switch (def.kind) {
    case 'choice':
      return (
        <select id={id} className={input} value={(value as string | undefined) ?? ''} onChange={(e) => onSet(e.target.value || null)}>
          <option value="">{t('property.noValue')}</option>
          {sortedOptions(def).map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      )
    case 'multi': {
      const selected = new Set(Array.isArray(value) ? value : [])
      return (
        <div id={id} role="group" aria-label={label} className="flex flex-wrap gap-1.5">
          {sortedOptions(def).map((option) => {
            const on = selected.has(option.id)
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={on}
                className={cx(
                  'inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-full border px-3 text-sm font-medium',
                  on ? cx(optionChip[option.color], 'border-transparent') : 'border-line bg-surface text-muted hover:text-text',
                )}
                onClick={() => onToggleOption(option.id, !on)}
              >
                {on && <CheckIcon small className="-ml-0.5" />}
                {option.label}
              </button>
            )
          })}
        </div>
      )
    }
    case 'date':
      return (
        <input id={id} type="date" className={input} value={(value as string | undefined) ?? ''} onChange={(e) => onSet(e.target.value || null)} />
      )
    case 'number':
      return <NumberInput id={id} value={value as number | undefined} lang={lang} onSet={onSet} invalidLabel={t('property.invalidNumber')} />
    case 'text':
      return <TextInput id={id} value={value as string | undefined} multiline={multiline} onSet={onSet} />
  }
}

/** Keeps a draft while typing; the field shows the stored value again when it changes elsewhere. */
function useDraft(stored: string) {
  const [draft, setDraft] = useState<string | null>(null)
  return { text: draft ?? stored, editing: draft !== null, setDraft, reset: () => setDraft(null) }
}

function TextInput({ id, value, multiline, onSet }: { id: string; value?: string; multiline: boolean; onSet: Props['onSet'] }) {
  const draft = useDraft(value ?? '')
  const commit = () => {
    if (draft.editing && draft.text.trim() !== (value ?? '')) onSet(draft.text.trim() || null)
    draft.reset()
  }
  const common = {
    id,
    className: input,
    value: draft.text,
    maxLength: LIMITS.textValue,
    onBlur: commit,
  }
  return multiline ? (
    <textarea {...common} rows={2} className={cx(input, 'resize-y')} onChange={(e) => draft.setDraft(e.target.value)} />
  ) : (
    <input
      {...common}
      onChange={(e) => draft.setDraft(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  )
}

function NumberInput(props: { id: string; value?: number; lang: 'en' | 'fr'; onSet: Props['onSet']; invalidLabel: string }) {
  const { id, value, lang, onSet, invalidLabel } = props
  const draft = useDraft(value === undefined ? '' : new Intl.NumberFormat(lang, { useGrouping: false, maximumFractionDigits: 10 }).format(value))
  const parsed = draft.text.trim() ? parseNumber(draft.text, lang) : null
  const invalid = draft.text.trim() !== '' && parsed === null

  const commit = () => {
    if (invalid) return
    if (draft.editing && parsed !== (value ?? null)) onSet(parsed)
    draft.reset()
  }

  return (
    <>
      <input
        id={id}
        className={cx(input, invalid && 'border-danger')}
        inputMode="decimal"
        value={draft.text}
        aria-invalid={invalid}
        onChange={(e) => draft.setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      {invalid && (
        <span className="text-sm text-danger" role="alert">
          {invalidLabel}
        </span>
      )}
    </>
  )
}
