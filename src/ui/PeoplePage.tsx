import { useMemo, useState } from 'react'
import { todayIso } from '../domain/dates'
import { compareByProperty, matchesFilter, readValue } from '../domain/filters'
import { randomId } from '../domain/ids'
import { hasLeftBy } from '../domain/leave'
import { hasKey, LIMITS } from '../domain/limits'
import { findPersonByName, matchesSearch } from '../domain/matching'
import { addPerson, compose, deletePerson } from '../domain/mutations'
import { sortedProperties } from '../domain/properties'
import { eventsByPerson, sortedPeople } from '../domain/selectors'
import type { DashboardState, Mutation, PersonId } from '../domain/types'
import { useI18n } from '../i18n/context'
import { navigate, viewPath, type DashboardView } from '../router'
import type { DashboardRef } from '../storage/link'
import { useCanEdit } from './canEdit'
import { CheckIcon } from './components/icons'
import { button, cx } from './components/styles'
import { useToast } from './components/toast'
import { AddCandidateRow, ListToolbar } from './ListToolbar'
import { PersonRow } from './PersonRow'
import { BulkEditor } from './properties/BulkEditor'
import { PropertiesDialog } from './properties/PropertiesDialog'
import { useViewFilters } from './useViewFilters'

interface Props {
  dashboardRef: DashboardRef
  view: Extract<DashboardView, { tab: 'people' }>
  state: DashboardState
  mutate: (mutation: Mutation) => void
  onImport: () => void
}

export function PeoplePage({ dashboardRef, view, state, mutate, onImport }: Props) {
  const { t, lang } = useI18n()
  const toast = useToast()
  const canEdit = useCanEdit()
  const [query, setQuery] = useState('')
  // "name", "count" or a person property id.
  const [sort, setSort] = useState<string>('name')
  const [propertiesOpen, setPropertiesOpen] = useState(false)
  const [selection, setSelection] = useState<Set<PersonId> | null>(null)
  const [showLeft, setShowLeft] = useState(false)
  const { peopleFilter, setPeopleFilter } = useViewFilters(state, dashboardRef, view)
  const properties = sortedProperties(state, 'person')
  const defs = state.personProperties

  const today = todayIso()
  // People who left the group before today are hidden unless asked for.
  const left = useMemo(() => new Set(Object.keys(state.people).filter((id) => hasLeftBy(state.people[id], today))), [state.people, today])
  const listed = useMemo(() => sortedPeople(state, lang).filter((p) => showLeft || !left.has(p.id)), [state, lang, showLeft, left])
  const people = useMemo(() => listed.filter((p) => matchesFilter(defs, p.values, peopleFilter)), [listed, defs, peopleFilter])
  // Hidden for having left, among the people the filters keep.
  const hiddenLeft = showLeft
    ? 0
    : Object.entries(state.people).filter(([id, person]) => left.has(id) && matchesFilter(defs, person.values, peopleFilter)).length
  const attended = useMemo(() => eventsByPerson(state), [state])

  const visible = useMemo(() => {
    const shown = people.filter((p) => matchesSearch(p.name, query))
    // Stable sorts keep alphabetical order among ties.
    if (sort === 'count') shown.sort((a, b) => (attended.get(b.id)?.length ?? 0) - (attended.get(a.id)?.length ?? 0))
    else if (sort !== 'name' && hasKey(defs, sort)) {
      const compare = compareByProperty(defs[sort], new Intl.Collator(lang, { sensitivity: 'base', numeric: true }))
      shown.sort((a, b) => compare(readValue(defs, a.values, sort), readValue(defs, b.values, sort)))
    }
    return shown
  }, [people, query, sort, attended, defs, lang])

  const total = Object.keys(state.people).length
  const full = total >= LIMITS.people

  // The search field also adds people (editors); a name that exists opens that person.
  const typed = query.trim()
  const existing = typed ? findPersonByName(state, typed) : undefined
  const candidate: { kind: 'add' } | { kind: 'open'; id: PersonId } | null = !typed
    ? null
    : existing
      ? visible.some((p) => p.id === existing)
        ? null
        : { kind: 'open', id: existing }
      : canEdit
        ? { kind: 'add' }
        : null
  const addOrOpen = () => {
    if (!typed) return
    if (existing) return navigate(viewPath(dashboardRef, { tab: 'person', personId: existing }))
    if (!canEdit || full) return
    // A new person usually needs their properties filled in: open their page.
    const id = randomId()
    mutate(addPerson(id, typed))
    toast(t('people.added', { name: typed }))
    navigate(viewPath(dashboardRef, { tab: 'person', personId: id }))
  }

  const toggle = (id: PersonId, selected: boolean) =>
    setSelection((current) => {
      const next = new Set(current)
      if (selected) next.add(id)
      else next.delete(id)
      return next
    })
  const allShownSelected = selection !== null && visible.length > 0 && visible.every((p) => selection.has(p.id))
  const removeSelected = () => {
    if (!selection?.size) return
    if (!window.confirm(t('bulk.deleteConfirm', { count: selection.size }))) return
    mutate(compose(...[...selection].map((id) => deletePerson(id))))
    toast(t('bulk.deleted', { count: selection.size }))
    setSelection(new Set())
  }

  return (
    <div className="space-y-3">
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        searchLabel={t(canEdit ? 'people.searchOrAdd' : 'people.search')}
        onSubmit={addOrOpen}
        filter={{
          properties,
          filter: peopleFilter,
          onChange: setPeopleFilter,
          items: listed.map((person) => person.values),
          summary: t('filter.peopleShown', { count: people.length, total: listed.length }),
        }}
        pills={
          left.size > 0 && (
            <button
              type="button"
              aria-pressed={showLeft}
              className={cx(
                'inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-full border px-3 text-sm',
                showLeft ? 'border-accent/50 bg-accent-soft pl-2' : 'border-line text-muted hover:border-accent hover:text-accent',
              )}
              onClick={() => setShowLeft(!showLeft)}
            >
              {showLeft && <CheckIcon small />}
              {t('people.showLeft')}
            </button>
          )
        }
        sorted={sort !== 'name'}
        sort={[
          { label: t('people.sort.name'), checked: sort === 'name', onSelect: () => setSort('name') },
          { label: t('people.sort.count'), checked: sort === 'count', onSelect: () => setSort('count') },
          ...properties.map((def, index) => ({ label: def.name, checked: sort === def.id, separated: index === 0, onSelect: () => setSort(def.id) })),
        ]}
        more={
          canEdit
            ? [
                {
                  label: t(selection ? 'bulk.done' : 'bulk.start'),
                  disabled: total === 0,
                  onSelect: () => setSelection(selection ? null : new Set()),
                },
                { label: t('people.propertiesMenu'), onSelect: () => setPropertiesOpen(true) },
                { label: t('people.importMenu'), separated: true, onSelect: onImport },
              ]
            : undefined
        }
      />

      {selection && (
        <section className="space-y-3 rounded-xl border border-accent/40 bg-accent-soft p-3" aria-label={t('bulk.title')}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 font-medium">
              <input
                type="checkbox"
                className="size-4 accent-accent"
                checked={allShownSelected}
                onChange={(e) => setSelection(e.target.checked ? new Set([...selection, ...visible.map((p) => p.id)]) : new Set())}
              />
              {t('bulk.selectShown')}
            </label>
            <span className="text-muted">{t('bulk.selected', { count: selection.size })}</span>
            <button type="button" className={cx(button(), 'ml-auto min-h-9 text-sm')} onClick={() => setSelection(null)}>
              {t('bulk.done')}
            </button>
          </div>
          {selection.size > 0 && (
            <>
              <BulkEditor state={state} selected={[...selection]} mutate={mutate} onApplied={(count) => toast(t('bulk.applied', { count }))} />
              <button type="button" className="min-h-8 cursor-pointer text-sm text-danger underline-offset-2 hover:underline" onClick={removeSelected}>
                {t('bulk.delete', { count: selection.size })}
              </button>
            </>
          )}
        </section>
      )}

      {!selection && total > 0 && (
        <p className="px-1 text-sm text-muted">
          {t('people.count', { count: people.length })}
          {hiddenLeft > 0 && ` · ${t('people.leftHidden', { count: hiddenLeft })}`}
        </p>
      )}

      {candidate || visible.length > 0 ? (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {candidate && (
            <AddCandidateRow
              disabled={candidate.kind === 'add' && full}
              onClick={addOrOpen}
              label={
                candidate.kind === 'add'
                  ? full
                    ? t('people.limitReached', { count: LIMITS.people })
                    : t('people.addNamed', { name: typed })
                  : t('people.openHidden', { name: state.people[candidate.id].name })
              }
            />
          )}
          {visible.map((person) => {
            const events = attended.get(person.id) ?? []
            return (
              <PersonRow
                key={person.id}
                dashboardRef={dashboardRef}
                state={state}
                person={person}
                attended={events.length}
                last={events[0]?.date}
                leftOn={left.has(person.id) ? state.people[person.id].leftOn : undefined}
                selection={selection ? { selected: selection.has(person.id), onChange: (on) => toggle(person.id, on) } : undefined}
              />
            )
          })}
        </ul>
      ) : (
        <p className="py-8 text-center text-muted">{total === 0 ? t(canEdit ? 'people.empty' : 'people.emptyRead') : query ? t('people.noResults', { query }) : t('sheet.noneShown')}</p>
      )}
      <PropertiesDialog open={propertiesOpen} onClose={() => setPropertiesOpen(false)} scope="person" state={state} mutate={mutate} />
    </div>
  )
}
