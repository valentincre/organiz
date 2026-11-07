import { markOf, type CallDraft, type Mark } from '../../domain/call'
import { LIMITS } from '../../domain/limits'
import { findPersonByName, matchesSearch } from '../../domain/matching'
import type { DashboardState, PersonId, PropertyDef, PropertyId } from '../../domain/types'
import { useI18n } from '../../i18n/context'
import { ChoicePill } from '../components/ChoicePill'
import { AddCandidateRow } from '../ListToolbar'
import { PersonValues } from '../PersonValues'

/** People outside the call offered at most this many at a time; typing more narrows them. */
const MAX_OUTSIDE = 5

interface Props {
  state: DashboardState
  draft: CallDraft
  properties: (PropertyDef & { id: PropertyId })[]
  query: string
  onMark: (id: PersonId, mark: Mark | null) => void
  /** Somebody who exists but is outside the call (a filter left them out). */
  onAddExisting: (id: PersonId) => void
  /** A name nobody has: creates the person, present. */
  onAddNew: (name: string) => void
}

/**
 * What the search finds: the people of the call with a quick Present / Absent,
 * the other people of the dashboard to add to the call, and the typed name as a
 * new person. Marking from here never changes the person "one by one" shows.
 */
export function CallSearch({ state, draft, properties, query, onMark, onAddExisting, onAddNew }: Props) {
  const { t } = useI18n()
  const typed = query.trim()
  const inCall = new Set(draft.scope)
  const found = draft.scope.filter((id) => matchesSearch(state.people[id].name, query))
  const outside = Object.keys(state.people)
    .filter((id) => !inCall.has(id) && matchesSearch(state.people[id].name, query))
    .sort((a, b) => state.people[a].name.localeCompare(state.people[b].name))
    .slice(0, MAX_OUTSIDE)
  const canAddNew = typed !== '' && findPersonByName(state, typed) === undefined && Object.keys(state.people).length < LIMITS.people

  if (found.length === 0 && outside.length === 0 && !canAddNew) {
    return <p className="py-6 text-center text-muted">{t('people.noResults', { query })}</p>
  }

  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
      {found.map((id) => {
        const person = state.people[id]
        const value = markOf(draft, id)
        return (
          <li key={id} className="flex min-h-touch items-center gap-3 px-4 py-2">
            <span className="min-w-0 flex-1">
              <span className="block [overflow-wrap:anywhere]">{person.name}</span>
              <PersonValues state={state} properties={properties} values={person.values} />
            </span>
            <ChoicePill<Mark>
              value={value ?? null}
              options={[
                { value: 'present', label: t('sheet.statePresent') },
                { value: 'absent', label: t('sheet.stateAbsent') },
              ]}
              clearable
              label={person.name}
              onChange={(next) => onMark(id, next)}
            />
          </li>
        )
      })}
      {outside.map((id) => (
        <AddCandidateRow key={id} label={t('call.addExisting', { name: state.people[id].name })} onClick={() => onAddExisting(id)} />
      ))}
      {canAddNew && <AddCandidateRow label={t('call.addNew', { name: typed })} onClick={() => onAddNew(typed)} />}
    </ul>
  )
}
