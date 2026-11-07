import type { ReactNode } from 'react'
import { breakdown, type Breakdown } from '../../domain/filters'
import { sortedOptions } from '../../domain/properties'
import type { PropertyDef, PropertyId, PropertyValues } from '../../domain/types'
import { useI18n } from '../../i18n/context'
import { ChevronIcon } from '../components/icons'
import { cx, optionDot } from '../components/styles'

type Def = PropertyDef & { id: PropertyId }

interface Props {
  /** Properties in display order; choice, multiple choice and number ones are broken down. */
  properties: Def[]
  /** Values of the people counted (e.g. the ones present). */
  items: (PropertyValues | undefined)[]
  /** Always visible, even folded, e.g. "18 present · 3 absent"; bold unless the parts set their own weight. */
  title: ReactNode
}

/**
 * Folded: the count and a one-line summary of every property. Open: one row
 * per property with a bar in the options' colors, so nothing has to be picked.
 */
export function BreakdownSummary({ properties, items, title }: Props) {
  const { t, lang } = useI18n()
  const defs = Object.fromEntries(properties.map((p) => [p.id, p]))
  const number = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 })
  const rows = properties
    .filter((p) => p.kind === 'choice' || p.kind === 'multi' || p.kind === 'number')
    .map((def) => ({ def, result: breakdown(defs, def.id, items) }))
    .filter((row): row is { def: Def; result: Breakdown } => row.result !== null)

  const inline = (def: Def, result: Breakdown) =>
    result.type === 'options'
      ? sortedOptions(def)
          .map((option) => `${option.label} ${result.counts.find((c) => c.optionId === option.id)?.count ?? 0}`)
          .join(' · ')
      : result.count === 0
        ? t('breakdown.noNumbers')
        : t('breakdown.numbers', { min: number.format(result.min), average: number.format(result.average), max: number.format(result.max) })

  if (rows.length === 0 || items.length === 0) {
    return <p className="px-1 text-sm font-semibold">{title}</p>
  }

  return (
    <details className="group rounded-xl border border-line bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2.5 text-sm [&::-webkit-details-marker]:hidden">
        <span className="shrink-0 font-semibold">{title}</span>
        <span className="min-w-0 flex-1 truncate text-muted">
          {/* Numbers only make sense opened, next to their property. */}
          {rows
            .filter(({ result }) => result.type === 'options')
            .map(({ def, result }) => `${t('property.withName', { name: def.name })} ${inline(def, result)}`)
            .join(' · ')}
        </span>
        <span className="shrink-0 text-muted transition-transform group-open:rotate-90">
          <ChevronIcon direction="right" small />
        </span>
      </summary>
      <div className="space-y-3 border-t border-line px-4 py-3">
        {rows.map(({ def, result }) => (
          <div key={def.id} className="grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)] items-center gap-x-3 gap-y-1 text-sm">
            <span className="truncate font-medium text-muted">{def.name}</span>
            {result.type === 'options' ? (
              <>
                <OptionsBar def={def} result={result} />
                <span className="col-start-2 flex flex-wrap gap-x-3 gap-y-0.5">
                  {sortedOptions(def).map((option) => (
                    <span key={option.id} className="inline-flex items-center gap-1.5">
                      <span className={cx('size-2.5 rounded-full', optionDot[option.color])} aria-hidden="true" />
                      {option.label} <span className="font-semibold tabular-nums">{result.counts.find((c) => c.optionId === option.id)?.count ?? 0}</span>
                    </span>
                  ))}
                  {result.empty > 0 && (
                    <span className="text-muted">
                      {t('breakdown.empty')} <span className="tabular-nums">{result.empty}</span>
                    </span>
                  )}
                </span>
              </>
            ) : (
              <span className="tabular-nums">{inline(def, result)}</span>
            )}
          </div>
        ))}
      </div>
    </details>
  )
}

/** Options side by side, each as wide as its count; people without a value in grey. */
function OptionsBar({ def, result }: { def: Def; result: Extract<Breakdown, { type: 'options' }> }) {
  const segments = [
    ...sortedOptions(def).map((option) => ({
      key: option.id,
      count: result.counts.find((c) => c.optionId === option.id)?.count ?? 0,
      color: optionDot[option.color],
    })),
    { key: 'empty', count: result.empty, color: 'bg-line' },
  ].filter((segment) => segment.count > 0)
  return (
    <span className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
      {segments.map((segment) => (
        <span key={segment.key} className={segment.color} style={{ flexGrow: segment.count }} />
      ))}
    </span>
  )
}
