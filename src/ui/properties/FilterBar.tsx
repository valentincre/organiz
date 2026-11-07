import { useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { parseNumber } from '../../csv/values'
import { breakdown, type Condition, type Filter } from '../../domain/filters'
import { hasKey } from '../../domain/limits'
import { matchesSearch } from '../../domain/matching'
import { sortedOptions } from '../../domain/properties'
import type { PropertyDef, PropertyId, PropertyValues } from '../../domain/types'
import { useI18n, type I18n } from '../../i18n/context'
import type { MessageKey } from '../../i18n/en'
import { Popover } from '../components/Popover'
import { cx, inputBase, optionDot } from '../components/styles'
import { CloseIcon, PlusIcon } from '../components/icons'

type Def = PropertyDef & { id: PropertyId }

export interface FilterBarProps {
  /** Properties in display order. */
  properties: Def[]
  filter: Filter
  onChange: (filter: Filter) => void
  /** Values of everything that can be filtered, to show how many items have each option. */
  items?: (PropertyValues | undefined)[]
  /** e.g. "18 of 30 people", shown while a filter is active. */
  summary?: string
  /** A single-choice filter on top of the properties (replies or attendance of an event), each option with its number of people. */
  status?: {
    /** Name of the filter, e.g. "Attendance". */
    label: string
    /** The chosen option; null when not filtering on it. */
    value: string | null
    options: { value: string; label: string; count: number }[]
    onChange: (value: string | null) => void
  }
  /** Shows "+ Filter" when nothing is filtered; off when a toolbar has its own Filter button. */
  addButton?: boolean
  /** Controlled list of properties to filter on, opened under `anchor` (the toolbar's button). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  anchor?: RefObject<HTMLElement | null>
  /** Pills drawn before the filters, e.g. the toolbar's folded search. */
  leading?: ReactNode
}

/** Stands for the status filter among the properties (property ids never contain ":"). */
const STATUS = ':status'

/**
 * Filters as pills, one per property: "+ Add a filter" lists the properties,
 * a pill opens its options, and every change applies at once. Pills are
 * combined with "and"; options within a pill with "or".
 */
export function FilterBar(props: FilterBarProps) {
  const { properties, filter, onChange, items, summary, status, addButton = true, open, onOpenChange, anchor, leading } = props
  const i18n = useI18n()
  const { t } = i18n
  const addRef = useRef<HTMLButtonElement>(null)
  const [pickerState, setPickerState] = useState(false)
  // Where the list of properties was opened from: this bar's own button, or the toolbar's.
  const [fromBar, setFromBar] = useState(false)
  // The pill whose options are open; it stays shown while empty, as a draft.
  const [editing, setEditing] = useState<PropertyId | null>(null)
  const defs = Object.fromEntries(properties.map((p) => [p.id, p]))

  const pickerOpen = open ?? pickerState
  const setPicker = (value: boolean) => {
    setPickerState(value)
    onOpenChange?.(value)
    if (!value) setFromBar(false)
  }
  if (properties.length === 0 && !status) return leading ? <div className="flex flex-wrap items-center gap-2">{leading}</div> : null

  const conditions = filter.filter((condition) => hasKey(defs, condition.propertyId))
  const statusActive = status?.value != null
  const active = conditions.length + (statusActive ? 1 : 0)
  const filtered = new Set<string>([...conditions.map((c) => c.propertyId), ...(statusActive ? [STATUS] : [])])

  const setCondition = (propertyId: PropertyId, condition: Condition | null) => {
    const others = filter.filter((c) => c.propertyId !== propertyId)
    onChange(condition ? [...others, condition] : others)
  }
  const choose = (id: PropertyId) => {
    setPicker(false)
    setEditing(id)
  }
  const pills: PropertyId[] = [...(statusActive || editing === STATUS ? [STATUS] : []), ...conditions.map((c) => c.propertyId)]
  if (editing && editing !== STATUS && !filtered.has(editing) && hasKey(defs, editing)) pills.push(editing)
  const showRow = pills.length > 0 || addButton || Boolean(leading)

  return (
    <>
      {showRow && (
        <div className="flex flex-wrap items-center gap-2">
          {leading}
          {pills.map((id) =>
            id === STATUS && status ? (
              <FilterPill
                key={id}
                label={t('filter.is', { name: status.label, values: status.options.find((o) => o.value === status.value)?.label ?? '…' })}
                name={status.label}
                draft={!statusActive}
                open={editing === id}
                onOpenChange={(value) => setEditing(value ? id : null)}
                onRemove={() => status.onChange(null)}
              >
                <StatusOptions status={status} />
              </FilterPill>
            ) : (
              <FilterPill
                key={id}
                label={describe(defs[id], conditions.find((c) => c.propertyId === id), i18n)}
                name={defs[id].name}
                draft={!filtered.has(id)}
                open={editing === id}
                onOpenChange={(value) => setEditing(value ? id : null)}
                onRemove={() => setCondition(id, null)}
              >
                <ConditionOptions
                  def={defs[id]}
                  condition={conditions.find((c) => c.propertyId === id)}
                  items={items}
                  onChange={(condition) => setCondition(id, condition)}
                  onDone={() => setEditing(null)}
                />
              </FilterPill>
            ),
          )}
          {(addButton || pills.length > 0) && (
            <button
              ref={addRef}
              type="button"
              className={cx(
                'inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-full border border-dashed pr-3 pl-2.5 text-sm hover:border-accent hover:text-accent',
                pickerOpen && fromBar ? 'border-accent text-accent' : 'border-line text-muted',
              )}
              aria-expanded={pickerOpen && fromBar}
              aria-haspopup="menu"
              onClick={() => {
                setFromBar(!(pickerOpen && fromBar))
                setPicker(!(pickerOpen && fromBar))
              }}
            >
              <PlusIcon small />
              {t(pills.length > 0 ? 'filter.addAnother' : 'filter.add')}
            </button>
          )}
          {active > 1 && (
            <button
              type="button"
              className="cursor-pointer text-sm text-accent underline-offset-2 hover:underline"
              onClick={() => {
                onChange([])
                status?.onChange(null)
              }}
            >
              {t('filter.clear')}
            </button>
          )}
          {active > 0 && summary && <span className="text-sm text-muted">{summary}</span>}
        </div>
      )}
      {pickerOpen && (
        <PropertyPicker
          anchor={fromBar || !anchor ? addRef : anchor}
          properties={properties.filter((p) => !filtered.has(p.id))}
          status={status && !statusActive ? status.label : undefined}
          onChoose={choose}
          onClose={() => setPicker(false)}
        />
      )}
    </>
  )
}

const kindLabel: Record<PropertyDef['kind'], MessageKey> = {
  choice: 'property.kind.choice',
  multi: 'property.kind.multi',
  text: 'property.kind.text',
  number: 'property.kind.number',
  date: 'property.kind.date',
}

/** The list of properties a new filter can be on, with a search field when it is long. */
function PropertyPicker(props: {
  anchor: RefObject<HTMLElement | null>
  properties: Def[]
  /** Name of the status filter, while it can still be added. */
  status?: string
  onChoose: (id: PropertyId) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const entries = [
    ...(props.status ? [{ id: STATUS, name: props.status, kind: undefined }] : []),
    ...props.properties.map((p) => ({ id: p.id, name: p.name, kind: p.kind })),
  ]
  const shown = entries.filter((entry) => matchesSearch(entry.name, query))

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    if (buttons.length === 0) return
    event.preventDefault()
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus()
  }

  return (
    <Popover anchor={props.anchor} onClose={props.onClose} role="menu" label={t('filter.by')} align="start" className="w-64">
      <div onKeyDown={onKeyDown}>
        {entries.length > 6 && (
          <input
            className={cx(inputBase, 'mb-1 min-h-9 w-full text-sm')}
            placeholder={t('filter.by')}
            aria-label={t('filter.by')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && shown[0] && props.onChoose(shown[0].id)}
          />
        )}
        {shown.length === 0 ? (
          <p className="px-2.5 py-2 text-sm text-muted">{t(entries.length === 0 ? 'filter.nothingLeft' : 'filter.noProperty')}</p>
        ) : (
          shown.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="menuitem"
              className="flex min-h-9 w-full cursor-pointer items-center gap-3 rounded-md px-2.5 text-left text-sm hover:bg-surface-muted focus-visible:bg-surface-muted"
              onClick={() => props.onChoose(entry.id)}
            >
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              {entry.kind && <span className="shrink-0 text-xs text-muted">{t(kindLabel[entry.kind])}</span>}
            </button>
          ))
        )}
      </div>
    </Popover>
  )
}

/** One filter: its summary opens its options; × removes it. */
function FilterPill(props: {
  label: string
  name: string
  draft: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onRemove: () => void
  children: ReactNode
}) {
  const { t } = useI18n()
  const pill = useRef<HTMLButtonElement>(null)
  return (
    <span
      className={cx(
        'inline-flex max-w-full items-center rounded-full border text-sm',
        props.draft ? 'border-dashed border-accent/60' : 'border-accent/50 bg-accent-soft',
        props.open && 'border-accent',
      )}
    >
      <button
        ref={pill}
        type="button"
        className="min-h-8 min-w-0 cursor-pointer truncate py-1 pr-1 pl-3 text-left"
        aria-expanded={props.open}
        aria-haspopup="dialog"
        title={t('filter.edit')}
        onClick={() => props.onOpenChange(!props.open)}
      >
        {props.label}
      </button>
      <button
        type="button"
        className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted hover:text-text"
        aria-label={t('filter.remove', { name: props.name })}
        onClick={() => {
          props.onOpenChange(false)
          props.onRemove()
        }}
      >
        <CloseIcon small />
      </button>
      {props.open && (
        <Popover anchor={pill} onClose={() => props.onOpenChange(false)} label={props.name} align="start" className="w-64 p-2">
          <p className="px-2 pt-0.5 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">{props.name}</p>
          {props.children}
        </Popover>
      )}
    </span>
  )
}

const optionRow = 'flex min-h-10 cursor-pointer items-center gap-2.5 rounded-md px-2 text-sm hover:bg-surface-muted'

function StatusOptions({ status }: { status: NonNullable<FilterBarProps['status']> }) {
  return (
    <div role="radiogroup" aria-label={status.label}>
      {status.options.map((option) => (
        <label key={option.value} className={optionRow}>
          <input type="radio" name="status" className="size-4 accent-accent" checked={status.value === option.value} onChange={() => status.onChange(option.value)} />
          <span className="flex-1">{option.label}</span>
          <span className="text-muted tabular-nums">{option.count}</span>
        </label>
      ))}
    </div>
  )
}

/** The options of one property's filter, applied as soon as they change. */
function ConditionOptions(props: {
  def: Def
  condition?: Condition
  items?: (PropertyValues | undefined)[]
  onChange: (condition: Condition | null) => void
  onDone: () => void
}) {
  const { def, condition, items, onChange, onDone } = props
  const { t, lang } = useI18n()
  const id = def.id
  const [text, setText] = useState(condition?.type === 'text' ? condition.query : '')
  const [min, setMin] = useState(condition?.type === 'range' ? (condition.min ?? '') : '')
  const [max, setMax] = useState(condition?.type === 'range' ? (condition.max ?? '') : '')
  const counts = items ? breakdown({ [id]: def }, id, items) : null
  const doneOnEnter = (event: KeyboardEvent<HTMLInputElement>) => event.key === 'Enter' && onDone()

  // Numbers are typed in the user's format and kept in the URL as plain numbers.
  const toBound = (value: string) => {
    if (!value.trim()) return undefined
    if (def.kind === 'date') return value
    const number = parseNumber(value, lang)
    return number === null ? null : String(number)
  }
  const applyRange = (nextMin: string, nextMax: string) => {
    const low = toBound(nextMin)
    const high = toBound(nextMax)
    if (low === null || high === null) return
    onChange(low || high ? { type: 'range', propertyId: id, ...(low && { min: low }), ...(high && { max: high }) } : null)
  }

  const selected = condition?.type === 'options' ? condition.optionIds : []
  const presenceOf = (type: 'empty' | 'filled') => (
    <label className={optionRow}>
      <input
        type="checkbox"
        className="size-4 accent-accent"
        checked={condition?.type === type}
        onChange={(e) => {
          setText('')
          setMin('')
          setMax('')
          onChange(e.target.checked ? { type, propertyId: id } : null)
        }}
      />
      <span className="flex-1 text-muted">{t(type === 'empty' ? 'filter.optionEmpty' : 'filter.optionFilled')}</span>
      {type === 'empty' && counts && <span className="text-muted tabular-nums">{counts.empty}</span>}
    </label>
  )

  return (
    <div className="space-y-1">
      {(def.kind === 'choice' || def.kind === 'multi') &&
        sortedOptions(def).map((option) => {
          const count = counts?.type === 'options' ? (counts.counts.find((c) => c.optionId === option.id)?.count ?? 0) : undefined
          return (
            <label key={option.id} className={optionRow}>
              <input
                type="checkbox"
                className="size-4 accent-accent"
                checked={selected.includes(option.id)}
                onChange={(e) => {
                  const next = e.target.checked ? [...selected, option.id] : selected.filter((o) => o !== option.id)
                  onChange(next.length ? { type: 'options', propertyId: id, optionIds: next } : null)
                }}
              />
              <span className={cx('size-2.5 shrink-0 rounded-full', optionDot[option.color])} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {count !== undefined && <span className="text-muted tabular-nums">{count}</span>}
            </label>
          )
        })}
      {def.kind === 'text' && (
        <input
          className={cx(inputBase, 'w-full')}
          placeholder={t('filter.modeContains')}
          aria-label={`${def.name} – ${t('filter.modeContains')}`}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            onChange(e.target.value.trim() ? { type: 'text', propertyId: id, query: e.target.value.trim() } : null)
          }}
          onKeyDown={doneOnEnter}
        />
      )}
      {(def.kind === 'number' || def.kind === 'date') && (
        <div className="flex items-center gap-2">
          {[
            { label: t('filter.min'), value: min, set: setMin, other: max, first: true },
            { label: t('filter.max'), value: max, set: setMax, other: min, first: false },
          ].map((field) => (
            <input
              key={field.label}
              className={cx(inputBase, 'w-full min-w-0', field.value.trim() && toBound(field.value) === null && 'border-danger')}
              type={def.kind === 'date' ? 'date' : 'text'}
              inputMode={def.kind === 'number' ? 'decimal' : undefined}
              placeholder={field.label}
              aria-label={field.label}
              value={field.value}
              onChange={(e) => {
                field.set(e.target.value)
                applyRange(field.first ? e.target.value : field.other, field.first ? field.other : e.target.value)
              }}
              onKeyDown={doneOnEnter}
            />
          ))}
        </div>
      )}
      <hr className="my-1 border-line" />
      {presenceOf('empty')}
      {presenceOf('filled')}
    </div>
  )
}

/** A pill's text: "Position: Midfield, Forward", "Position: Midfield +2", "Born ≥ …". */
function describe(def: PropertyDef, condition: Condition | undefined, i18n: I18n): string {
  const { t, lang, formatDate } = i18n
  if (!condition) return t('filter.is', { name: def.name, values: '…' })
  const show = (value: string) =>
    def.kind === 'date' ? formatDate(value, { dateStyle: 'medium' }) : new Intl.NumberFormat(lang).format(Number(value))
  switch (condition.type) {
    case 'empty':
      return t('filter.isEmpty', { name: def.name })
    case 'filled':
      return t('filter.isFilled', { name: def.name })
    case 'text':
      return t('filter.contains', { name: def.name, text: condition.query })
    case 'options': {
      const labels = sortedOptions(def)
        .filter((option) => condition.optionIds.includes(option.id))
        .map((option) => option.label)
      const values = labels.length > 2 ? `${labels[0]} +${labels.length - 1}` : labels.join(', ')
      return t('filter.is', { name: def.name, values })
    }
    case 'range':
      if (condition.min && condition.max) return t('filter.between', { name: def.name, min: show(condition.min), max: show(condition.max) })
      if (condition.min) return t('filter.atLeast', { name: def.name, min: show(condition.min) })
      return t('filter.atMost', { name: def.name, max: show(condition.max!) })
  }
}
