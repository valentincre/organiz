import { useState } from 'react'
import { breakdown } from '../../domain/filters'
import { sortedOptions } from '../../domain/properties'
import type { PropertyDef, PropertyId, PropertyValues } from '../../domain/types'
import { useI18n } from '../../i18n/context'
import { cx, inputBase, optionDot } from '../components/styles'

interface Props {
  /** Properties in display order; only choice, multi and number ones can be broken down. */
  properties: (PropertyDef & { id: PropertyId })[]
  /** Values of the group, e.g. the people present at an event. */
  items: (PropertyValues | undefined)[]
}

/** "Joueur: Oui 11 · Non 3", or min / average / max for a number, with a picker when several properties qualify. */
export function BreakdownView({ properties, items }: Props) {
  const { t, lang } = useI18n()
  const eligible = properties.filter((p) => p.kind === 'choice' || p.kind === 'multi' || p.kind === 'number')
  const [chosen, setChosen] = useState<PropertyId | null>(null)
  const current = eligible.find((p) => p.id === chosen) ?? eligible[0]
  if (!current || items.length === 0) return null

  const defs = Object.fromEntries(properties.map((p) => [p.id, p]))
  const result = breakdown(defs, current.id, items)
  if (!result) return null
  const number = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 })

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      {eligible.length > 1 ? (
        <select
          className={cx(inputBase, 'min-h-8 py-0.5 text-sm')}
          aria-label={t('breakdown.property')}
          value={current.id}
          onChange={(e) => setChosen(e.target.value)}
        >
          {eligible.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      ) : (
        <span className="font-medium">{current.name}</span>
      )}
      {result.type === 'options' ? (
        <>
          {sortedOptions(current).map((option) => {
            const count = result.counts.find((c) => c.optionId === option.id)?.count ?? 0
            return (
              <span key={option.id} className="inline-flex items-center gap-1.5">
                <span className={cx('size-2.5 rounded-full', optionDot[option.color])} aria-hidden="true" />
                {option.label} <span className="font-semibold tabular-nums">{count}</span>
              </span>
            )
          })}
          {result.empty > 0 && (
            <span className="text-muted">
              {t('breakdown.empty')} <span className="tabular-nums">{result.empty}</span>
            </span>
          )}
        </>
      ) : result.count === 0 ? (
        <span className="text-muted">{t('breakdown.noNumbers')}</span>
      ) : (
        <span className="tabular-nums">
          {t('breakdown.numbers', { min: number.format(result.min), average: number.format(result.average), max: number.format(result.max) })}
        </span>
      )}
    </div>
  )
}
