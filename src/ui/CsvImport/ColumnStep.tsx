import { useMemo, useState } from 'react'
import type { ColumnMapping, ColumnTarget } from '../../csv/importPlan'
import { extractRecords, guessHasHeader, guessNameColumns, type ImportRecord, type Table } from '../../csv/parse'
import { guessKind } from '../../csv/values'
import { foldText } from '../../domain/matching'
import { sortedProperties } from '../../domain/properties'
import type { DashboardState, PropertyKind } from '../../domain/types'
import { useI18n } from '../../i18n/context'
import type { MessageKey } from '../../i18n/en'
import { button, cx, input, inputBase } from '../components/styles'

const PREVIEW_ROWS = 6

interface Props {
  state: DashboardState
  table: Table
  onBack: () => void
  onNext: (records: ImportRecord[], mappings: ColumnMapping[]) => void
}

const KINDS: PropertyKind[] = ['choice', 'multi', 'text', 'number', 'date']

/** "ignore", "p:<propertyId>" or "new". */
type Choice = string

export function ColumnStep({ state, table, onBack, onNext }: Props) {
  const { t, lang } = useI18n()
  const [hasHeader, setHasHeader] = useState(() => guessHasHeader(table))
  // Selection order matters: it is the order the columns are joined in.
  const [columns, setColumns] = useState(() => guessNameColumns(table, guessHasHeader(table)))
  const records = useMemo(() => extractRecords(table, columns, hasHeader), [table, columns, hasHeader])
  const names = records.map((record) => record.name)
  const width = table[0]?.length ?? 0
  const properties = sortedProperties(state, 'person')
  const [choices, setChoices] = useState<Record<number, Choice>>({})
  const [kinds, setKinds] = useState<Record<number, PropertyKind>>({})

  // A column whose title is a property name maps to it by default; others are ignored.
  const defaultChoice = (index: number): Choice => {
    const title = hasHeader ? foldText(table[0][index] ?? '') : ''
    const property = title && properties.find((p) => foldText(p.name) === title)
    return property ? `p:${property.id}` : 'ignore'
  }
  const choiceOf = (index: number) => choices[index] ?? defaultChoice(index)
  const kindOf = (index: number) => kinds[index] ?? guessKind(records.map((record) => record.row[index] ?? ''), lang)
  const otherColumns = Array.from({ length: width }, (_, index) => index).filter((index) => !columns.includes(index))

  const next = () => {
    const mappings: ColumnMapping[] = otherColumns.flatMap((index) => {
      const choice = choiceOf(index)
      if (choice === 'ignore') return []
      const target: ColumnTarget =
        choice === 'new'
          ? { type: 'new', name: (hasHeader && table[0][index]) || t('csv.columns.column', { n: index + 1 }), kind: kindOf(index) }
          : { type: 'existing', propertyId: choice.slice(2) }
      return [{ column: index, target }]
    })
    onNext(records, mappings)
  }

  const toggle = (index: number) =>
    setColumns((current) => (current.includes(index) ? current.filter((c) => c !== index) : [...current, index]))

  const columnTitle = (index: number) => (hasHeader && table[0][index]) || t('csv.columns.column', { n: index + 1 })

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">{t('csv.columns.title')}</h3>
        <p className="text-sm text-muted">{t('csv.columns.hint')}</p>
      </div>

      <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-accent"
          checked={hasHeader}
          onChange={(e) => setHasHeader(e.target.checked)}
        />
        {t('csv.columns.header')}
      </label>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              {Array.from({ length: width }, (_, index) => {
                const order = columns.indexOf(index)
                return (
                  <th key={index} className="border-b border-line p-0">
                    <button
                      type="button"
                      aria-pressed={order >= 0}
                      onClick={() => toggle(index)}
                      className={cx(
                        'flex min-h-touch w-full cursor-pointer items-center gap-2 px-3 text-left font-semibold whitespace-nowrap',
                        order >= 0 ? 'bg-accent-soft text-accent' : 'hover:bg-surface-muted',
                      )}
                    >
                      <span
                        className={cx(
                          'inline-flex size-5 shrink-0 items-center justify-center rounded-full border text-xs',
                          order >= 0 ? 'border-accent bg-accent text-on-accent' : 'border-line',
                        )}
                      >
                        {order >= 0 ? order + 1 : ''}
                      </span>
                      {columnTitle(index)}
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {table.slice(hasHeader ? 1 : 0, (hasHeader ? 1 : 0) + PREVIEW_ROWS).map((row, r) => (
              <tr key={r} className="border-b border-line last:border-0">
                {row.map((cell, index) => (
                  <td key={index} className={cx('px-3 py-1.5 whitespace-nowrap', columns.includes(index) ? 'font-medium' : 'text-muted')}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-sm">
        <span className="font-semibold">{t('csv.columns.found', { count: names.length })}</span>
        {names.length > 0 && <span className="text-muted"> · {names.slice(0, 3).join(', ')}{names.length > 3 ? '…' : ''}</span>}
      </p>

      {otherColumns.length > 0 && names.length > 0 && (
        <section className="space-y-2 border-t border-line pt-4">
          <div>
            <h3 className="font-semibold">{t('csv.columns.otherTitle')}</h3>
            <p className="text-sm text-muted">{t('csv.columns.otherHint')}</p>
          </div>
          {otherColumns.map((index) => {
            const choice = choiceOf(index)
            return (
              <div key={index} className="grid gap-2 rounded-lg border border-line p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] sm:items-center">
                <span className="min-w-0 truncate font-medium">
                  {columnTitle(index)}
                  <span className="font-normal text-muted"> · {records.slice(0, 2).map((r) => r.row[index]).filter(Boolean).join(', ')}</span>
                </span>
                <select
                  className={input}
                  aria-label={t('csv.columns.target', { name: columnTitle(index) })}
                  value={choice}
                  onChange={(e) => setChoices({ ...choices, [index]: e.target.value })}
                >
                  <option value="ignore">{t('csv.columns.ignore')}</option>
                  <option value="new">{t('csv.columns.newProperty')}</option>
                  {properties.length > 0 && (
                    <optgroup label={t('csv.columns.existing')}>
                      {properties.map((p) => (
                        <option key={p.id} value={`p:${p.id}`}>
                          {p.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                {choice === 'new' ? (
                  <select
                    className={inputBase}
                    aria-label={t('property.kind')}
                    value={kindOf(index)}
                    onChange={(e) => setKinds({ ...kinds, [index]: e.target.value as PropertyKind })}
                  >
                    {KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {t(`property.kind.${kind}` as MessageKey)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span />
                )}
              </div>
            )
          })}
        </section>
      )}

      <div className="flex justify-between gap-2">
        <button type="button" className={button()} onClick={onBack}>
          {t('csv.back')}
        </button>
        <button type="button" className={button('primary')} disabled={names.length === 0} onClick={next}>
          {t('csv.continue')}
        </button>
      </div>
    </div>
  )
}
