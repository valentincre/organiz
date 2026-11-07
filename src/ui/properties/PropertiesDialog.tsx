import { useRef, useState, type FormEvent } from 'react'
import { breakdown } from '../../domain/filters'
import { randomId } from '../../domain/ids'
import { LIMITS } from '../../domain/limits'
import { compose } from '../../domain/mutations'
import {
  addOption,
  addProperty,
  chartsSplitBy,
  convertToMulti,
  deleteOption,
  deleteProperty,
  moveOption,
  moveProperty,
  renameOption,
  renameProperty,
  setOptionColor,
  sortedOptions,
  sortedProperties,
} from '../../domain/properties'
import {
  COLOR_KEYS,
  type ColorKey,
  type DashboardState,
  type Mutation,
  type PropertyDef,
  type PropertyId,
  type PropertyKind,
  type PropertyScope,
  type PropertyValues,
} from '../../domain/types'
import { useI18n } from '../../i18n/context'
import type { MessageKey } from '../../i18n/en'
import { Dialog } from '../components/Dialog'
import { ChevronIcon, TrashIcon } from '../components/icons'
import { Popover } from '../components/Popover'
import { SortableList } from '../components/SortableList'
import { button, cx, input, inputBase, optionDot } from '../components/styles'
import { chartTitle } from '../stats/statsView'

interface Props {
  open: boolean
  onClose: () => void
  scope: PropertyScope
  state: DashboardState
  mutate: (mutation: Mutation) => void
}

type NewKind = PropertyKind | 'yesNo'
type Def = PropertyDef & { id: PropertyId }

const KIND_LABELS: Record<PropertyKind, MessageKey> = {
  choice: 'property.kind.choice',
  multi: 'property.kind.multi',
  text: 'property.kind.text',
  number: 'property.kind.number',
  date: 'property.kind.date',
}

/** Gives every id its index as order, in one change. */
const reorder = (ids: string[], move: (id: string, order: number) => Mutation) => compose(...ids.map((id, index) => move(id, index)))

/**
 * The custom properties of people or events: a list that is reordered by
 * dragging, where a property opens in place (one at a time) to rename it,
 * manage its options (color dot, name, trash) or delete it.
 */
export function PropertiesDialog({ open, onClose, scope, state, mutate }: Props) {
  const { t } = useI18n()
  const properties = sortedProperties(state, scope)
  const max = scope === 'person' ? LIMITS.personProperties : LIMITS.eventProperties
  const [name, setName] = useState('')
  const [kind, setKind] = useState<NewKind>('choice')
  const [expanded, setExpanded] = useState<PropertyId | null>(null)
  const targets = Object.values(scope === 'person' ? state.people : state.events)
  const items = targets.map((target) => target.values)

  const create = (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    const options =
      kind === 'yesNo'
        ? [
            { id: randomId(), label: t('property.yes'), color: 'green' as const },
            { id: randomId(), label: t('property.no'), color: 'gray' as const },
          ]
        : []
    const id = randomId()
    mutate(addProperty(scope, id, kind === 'yesNo' ? 'choice' : kind, name, options))
    setName('')
    // Opened right away, so its options can be added.
    setExpanded(id)
  }

  return (
    <Dialog open={open} onClose={onClose} title={t(scope === 'person' ? 'property.titlePeople' : 'property.titleEvents')} closeLabel={t('csv.close')}>
      <div className="space-y-4">
        <p className="text-sm text-muted">
          {t(scope === 'person' ? 'property.hintPeople' : 'property.hintEvents')} {properties.length > 1 && t('property.dragHint')}
        </p>

        {properties.length > 0 && (
          <SortableList
            items={properties}
            className="divide-y divide-line overflow-hidden rounded-lg border border-line"
            handleLabel={(def) => t('property.move', { name: def.name })}
            onReorder={(ids) => mutate(reorder(ids, (id, order) => moveProperty(scope, id, order)))}
            renderItem={(def, handle, dragging) => {
              const isOpen = expanded === def.id
              const filled = items.filter((values) => values?.[def.id] !== undefined).length
              return (
                <div className={cx(dragging && 'relative z-10 shadow-lg ring-2 ring-accent')}>
                  <div className={cx('flex items-center gap-2 pl-2', isOpen ? 'bg-accent-soft' : 'bg-surface')}>
                    {handle}
                    <button
                      type="button"
                      className="flex min-h-12 min-w-0 flex-1 cursor-pointer items-center gap-3 py-1.5 pr-3 text-left"
                      aria-expanded={isOpen}
                      onClick={() => setExpanded(isOpen ? null : def.id)}
                    >
                      <span className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-3">
                        <span className={cx('block truncate sm:w-40 sm:shrink-0', isOpen ? 'font-semibold' : 'font-medium')}>{def.name}</span>
                        <span className="block truncate text-xs text-muted sm:text-sm">
                          {isOpen
                            ? t(scope === 'person' ? 'property.filledPeople' : 'property.filledEvents', { count: filled })
                            : sortedOptions(def)
                                .map((option) => option.label)
                                .join(' · ')}
                        </span>
                      </span>
                      <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-xs text-muted">{t(KIND_LABELS[def.kind])}</span>
                      <span className={cx('shrink-0 text-muted transition-transform', isOpen && 'rotate-180')}>
                        <ChevronIcon direction="down" small />
                      </span>
                    </button>
                  </div>
                  {isOpen && (
                    <PropertyEditor
                      def={def}
                      scope={scope}
                      items={items}
                      filled={filled}
                      charts={chartsSplitBy(state, scope, def.id).map((id) => chartTitle(t, state, state.statCharts![id]))}
                      mutate={mutate}
                      onDeleted={() => setExpanded(null)}
                    />
                  )}
                </div>
              )
            }}
          />
        )}

        {properties.length >= max ? (
          <p className="text-sm text-muted">{t('property.limit', { count: max })}</p>
        ) : (
          <form className="space-y-2 border-t border-line pt-4" onSubmit={create}>
            <h3 className="font-semibold">{t('property.add')}</h3>
            <div className="flex flex-wrap gap-2">
              <input
                className={cx(input, 'min-w-40 flex-[2_1_12rem]')}
                aria-label={t('property.name')}
                placeholder={t(scope === 'person' ? 'property.namePlaceholderPeople' : 'property.namePlaceholderEvents')}
                value={name}
                maxLength={LIMITS.label}
                onChange={(e) => setName(e.target.value)}
              />
              <select
                className={cx(inputBase, 'flex-[1_1_10rem]')}
                aria-label={t('property.kind')}
                value={kind}
                onChange={(e) => setKind(e.target.value as NewKind)}
              >
                <option value="yesNo">{t('property.kind.yesNo')}</option>
                {(Object.keys(KIND_LABELS) as PropertyKind[]).map((k) => (
                  <option key={k} value={k}>
                    {t(KIND_LABELS[k])}
                  </option>
                ))}
              </select>
              <button type="submit" className={button('primary')} disabled={!name.trim()}>
                {t('property.create')}
              </button>
            </div>
          </form>
        )}
      </div>
    </Dialog>
  )
}

/** An opened property: its name, options and deletion; one column on phones, two on wider screens. */
function PropertyEditor(props: {
  def: Def
  scope: PropertyScope
  items: (PropertyValues | undefined)[]
  filled: number
  /** Names of the charts split by the property, deleted with it. */
  charts: string[]
  mutate: (mutation: Mutation) => void
  onDeleted: () => void
}) {
  const { def, scope, items, filled, charts, mutate, onDeleted } = props
  const { t } = useI18n()
  const hasOptions = def.kind === 'choice' || def.kind === 'multi'
  const counts = hasOptions ? breakdown({ [def.id]: def }, def.id, items) : null
  const options = sortedOptions(def)

  const remove = () => {
    const lines = [t('property.deleteConfirm', { name: def.name, count: filled })]
    if (charts.length > 0) lines.push('', t('property.deleteCharts', { count: charts.length }), ...charts.map((name) => `• ${name}`))
    if (!window.confirm(lines.join('\n'))) return
    onDeleted()
    mutate(deleteProperty(scope, def.id))
  }

  return (
    <div className={cx('space-y-4 border-t border-line bg-bg/50 px-3 py-3 sm:pl-12', hasOptions && 'sm:grid sm:grid-cols-2 sm:gap-5 sm:space-y-0')}>
      <div className="flex flex-col gap-3">
        <label className="grid gap-1 text-sm font-medium">
          {t('property.name')}
          <InlineText boxed value={def.name} label={t('property.name')} maxLength={LIMITS.label} onCommit={(value) => mutate(renameProperty(scope, def.id, value))} />
        </label>
        {hasOptions && (
          <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-accent"
              checked={def.kind === 'multi'}
              // Only "one option" → "several" is possible: values stay valid that way.
              disabled={def.kind === 'multi'}
              onChange={() => window.confirm(t('property.toMultiConfirm', { name: def.name })) && mutate(convertToMulti(scope, def.id))}
            />
            {t('property.multiple')}
          </label>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 pt-1">
          <button type="button" className={cx(button('danger'), 'min-h-9 text-sm')} onClick={remove}>
            {t('property.deleteProperty')}
          </button>
        </div>
      </div>

      {hasOptions && (
        <div className="space-y-1.5">
          <span className="text-sm font-medium">{t('property.options')}</span>
          <div className="overflow-hidden rounded-md border border-line bg-surface">
            <SortableList
              items={options}
              className="divide-y divide-line"
              handleLabel={(option) => t('property.move', { name: option.label })}
              onReorder={(ids) => mutate(reorder(ids, (id, order) => moveOption(scope, def.id, id, order)))}
              renderItem={(option, handle, dragging) => (
                <div className={cx('flex min-h-11 items-center gap-1.5 pr-1 pl-1', dragging && 'bg-surface-muted')}>
                  {handle}
                  <ColorPicker label={option.label} color={option.color} onChange={(color) => mutate(setOptionColor(scope, def.id, option.id, color))} />
                  <InlineText value={option.label} label={t('property.optionLabel')} maxLength={LIMITS.label} onCommit={(value) => mutate(renameOption(scope, def.id, option.id, value))} />
                  {counts?.type === 'options' && (
                    <span className="shrink-0 px-1 text-xs text-muted tabular-nums">{counts.counts.find((c) => c.optionId === option.id)?.count ?? 0}</span>
                  )}
                  <button
                    type="button"
                    className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-danger-soft hover:text-danger"
                    aria-label={t('property.deleteOption', { name: option.label })}
                    title={t('property.deleteOption', { name: option.label })}
                    onClick={() => {
                      if (window.confirm(t('property.deleteOptionConfirm', { name: option.label }))) mutate(deleteOption(scope, def.id, option.id))
                    }}
                  >
                    <TrashIcon small />
                  </button>
                </div>
              )}
            />
            {options.length < LIMITS.options && (
              <NewOption
                onAdd={(label) => mutate(addOption(scope, def.id, randomId(), label, COLOR_KEYS[Object.keys(def.options ?? {}).length % COLOR_KEYS.length]))}
                bordered={options.length > 0}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** An option's colored dot: a click opens the palette. */
function ColorPicker({ label, color, onChange }: { label: string; color: ColorKey; onChange: (color: ColorKey) => void }) {
  const { t } = useI18n()
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={cx('inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-surface-muted', open && 'bg-surface-muted')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('property.optionColor', { name: label, color: t(`color.${color}` as MessageKey) })}
        title={t('property.optionColor', { name: label, color: t(`color.${color}` as MessageKey) })}
        onClick={() => setOpen(!open)}
      >
        <span className={cx('size-3.5 rounded-full', optionDot[color])} />
      </button>
      {open && (
        <Popover anchor={trigger} onClose={() => setOpen(false)} label={t('property.color')} align="start" className="p-2">
          <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label={t('property.color')}>
            {COLOR_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={color === key}
                aria-label={t(`color.${key}` as MessageKey)}
                title={t(`color.${key}` as MessageKey)}
                className={cx('size-7 cursor-pointer rounded-full', optionDot[key], color === key && 'ring-2 ring-text ring-offset-2 ring-offset-surface')}
                onClick={() => {
                  setOpen(false)
                  onChange(key)
                  trigger.current?.focus()
                }}
              />
            ))}
          </div>
        </Popover>
      )}
    </>
  )
}

function NewOption({ onAdd, bordered }: { onAdd: (label: string) => void; bordered: boolean }) {
  const { t } = useI18n()
  const [label, setLabel] = useState('')
  return (
    <form
      className={cx('flex gap-2 p-1.5', bordered && 'border-t border-line')}
      onSubmit={(e) => {
        e.preventDefault()
        if (!label.trim()) return
        onAdd(label)
        setLabel('')
      }}
    >
      <input
        className={cx(input, 'min-h-9')}
        aria-label={t('property.newOption')}
        placeholder={t('property.newOption')}
        value={label}
        maxLength={LIMITS.label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <button type="submit" className={cx(button(), 'min-h-9')} disabled={!label.trim()}>
        {t('property.addOption')}
      </button>
    </form>
  )
}

/** Text saved when the field is left or Enter is pressed; borderless until hovered, unless `boxed`. */
function InlineText(props: { value: string; label: string; maxLength: number; onCommit: (value: string) => void; boxed?: boolean }) {
  const { value, label, maxLength, onCommit, boxed = false } = props
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft !== null && draft.trim() && draft.trim() !== value) onCommit(draft)
    setDraft(null)
  }
  return (
    <input
      className={
        boxed
          ? input
          : 'min-h-9 w-full min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 hover:border-line focus:border-line focus:bg-surface'
      }
      aria-label={label}
      value={draft ?? value}
      maxLength={maxLength}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') setDraft(null)
      }}
    />
  )
}
