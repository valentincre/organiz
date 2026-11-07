import { readValue } from '../../domain/filters'
import { sortedOptions } from '../../domain/properties'
import type { OptionId, PropertyDef, PropertyId, PropertyValue, PropertyValues } from '../../domain/types'
import { useI18n } from '../../i18n/context'
import { cx, optionChip } from '../components/styles'

interface Props {
  defs: Record<PropertyId, PropertyDef>
  propertyId: PropertyId
  values?: PropertyValues
  /** Compact: one line, text cut with an ellipsis. */
  compact?: boolean
  /** Prefixes the property name ("Player: Yes"), for chips shown without a label. */
  withName?: boolean
}

/** A property value as read-only text or colored chips; renders nothing when empty. */
export function ValueView({ defs, propertyId, values, compact = false, withName = false }: Props) {
  const { t } = useI18n()
  const value = readValue(defs, values, propertyId)
  if (value === undefined) return null
  const def = defs[propertyId]
  const content = <ValueContent def={def} value={value} compact={compact} />
  if (!withName) return content
  return (
    <span className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-x-1">
      <span className="text-xs text-muted">{t('property.withName', { name: def.name })}</span>
      {content}
    </span>
  )
}

interface ContentProps {
  def: PropertyDef
  value: PropertyValue
  compact: boolean
}

function ValueContent({ def, value, compact }: ContentProps) {
  const { lang, formatDate } = useI18n()
  if (def.kind === 'choice' || def.kind === 'multi') {
    const selected = new Set<OptionId>(Array.isArray(value) ? value : [value as string])
    return (
      <span className="inline-flex flex-wrap gap-1">
        {sortedOptions(def)
          .filter((option) => selected.has(option.id))
          .map((option) => (
            <span key={option.id} className={cx('rounded-full px-2 py-0.5 text-xs font-medium', optionChip[option.color])}>
              {option.label}
            </span>
          ))}
      </span>
    )
  }
  const text =
    def.kind === 'number'
      ? new Intl.NumberFormat(lang).format(value as number)
      : def.kind === 'date'
        ? formatDate(value as string, { dateStyle: 'medium' })
        : (value as string)
  return (
    <span className={cx('text-sm', compact ? 'truncate' : 'whitespace-pre-line [overflow-wrap:anywhere]')}>{text}</span>
  )
}
