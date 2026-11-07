import { useMemo, useState } from 'react'
import { parseColumn, valueMutations, type ColumnMapping } from '../../csv/importPlan'
import type { ImportRecord } from '../../csv/parse'
import { todayIso } from '../../domain/dates'
import { randomId } from '../../domain/ids'
import { LIMITS } from '../../domain/limits'
import { matchNames, normalizeName, type MatchResult } from '../../domain/matching'
import { canCall, hasStarted } from '../../domain/attendance'
import { addPerson, compose, recordFullCall, setReplies } from '../../domain/mutations'
import { eventEntry, sortedPeople, type PersonEntry } from '../../domain/selectors'
import type { DashboardState, EventId, Mutation, PersonId } from '../../domain/types'
import { useI18n } from '../../i18n/context'
import { button, cx, input } from '../components/styles'
import { eventTitle } from '../eventFormat'
import { CheckIcon } from '../components/icons'

/** "p:<id>" = mark that person present, "create" = new person, "ignore" = skip. */
type Choice = `p:${PersonId}` | 'create' | 'ignore'

/** What the file says about an event: who was there (a roll call), or who said yes. */
export type EventImport = 'present' | 'yes'

export interface ImportSummary {
  people: number
  created: number
  /** How the people were recorded at the event; null when only people and their properties were imported. */
  attendance: EventImport | null
}

interface Props {
  state: DashboardState
  /** Records the imported people at this event; without it, only people and their properties are imported. */
  eventId?: EventId
  /** A roll call of this event is in progress on this device: a file cannot make another one. */
  callInProgress?: boolean
  records: ImportRecord[]
  mappings: ColumnMapping[]
  onBack: () => void
  onDone: (mutation: Mutation, summary: ImportSummary) => void
}

const defaultChoice = (result: MatchResult): Choice =>
  result.kind === 'unknown' ? 'create' : `p:${result.personId}`

export function MatchStep({ state, eventId, callInProgress = false, records, mappings, onBack, onDone }: Props) {
  const i18n = useI18n()
  const { t, lang } = i18n
  const names = useMemo(() => records.map((record) => record.name), [records])
  // Matched against the state when the step opened, so concurrent edits do not reshuffle the choices.
  const [initial] = useState(state)
  const report = useMemo(() => matchNames(names, initial), [names, initial])
  const columns = useMemo(() => mappings.map((mapping) => parseColumn(initial, mapping, records, lang, () => randomId())), [initial, mappings, records, lang])
  const [overwrite, setOverwrite] = useState(false)
  const event = eventId ? eventEntry(state, eventId) : undefined
  const people = useMemo(() => sortedPeople(state, lang), [state, lang])
  const [choices, setChoices] = useState<Choice[]>(() => report.results.map(defaultChoice))
  // From the day of the event the file can be the roll call; before, it can only hold replies. A past or started
  // event is most likely a roll call, an event later today most likely replies.
  const canMakeCall = event !== undefined && canCall(event, todayIso()) && !callInProgress
  const [chosenKind, setChosenKind] = useState<EventImport | null>(null)
  // Decided when the step opens: the answer must not flip while it is open, as time passes.
  const [defaultKind] = useState<EventImport>(() =>
    event !== undefined && canCall(event, todayIso()) && hasStarted(event, new Date()) ? 'present' : 'yes',
  )
  const kind: EventImport = canMakeCall ? (chosenKind ?? defaultKind) : 'yes'

  const groups = {
    matched: report.results.flatMap((r, i) => (r.kind === 'matched' ? [{ result: r, index: i }] : [])),
    suggested: report.results.flatMap((r, i) => (r.kind === 'suggested' ? [{ result: r, index: i }] : [])),
    unknown: report.results.flatMap((r, i) => (r.kind === 'unknown' ? [{ result: r, index: i }] : [])),
  }

  const created = choices.filter((c) => c === 'create').length
  const presentIds = new Set(choices.flatMap((c) => (c.startsWith('p:') ? [c.slice(2)] : [])))
  const presentCount = presentIds.size + created
  const overLimit = Object.keys(state.people).length + created > LIMITS.people

  const confirm = () => {
    const mutations: Mutation[] = []
    // Person chosen for each match result, then for each CSV row (duplicate rows share their first row's person).
    const resultPeople = report.results.map((result, index): PersonId | null => {
      const choice = choices[index]
      if (choice === 'ignore') return null
      if (choice !== 'create') return choice.slice(2)
      const id = randomId()
      mutations.push(addPerson(id, result.input))
      return id
    })
    const byKey = new Map(report.results.map((result, index) => [normalizeName(result.input), resultPeople[index]]))
    const recordPeople = records.map((record) => byKey.get(normalizeName(record.name)) ?? null)
    mutations.push(...valueMutations(initial, columns, recordPeople, overwrite))
    const ids = resultPeople.filter((id): id is PersonId => id !== null)
    if (eventId) mutations.push(kind === 'present' ? recordFullCall(eventId, ids, Date.now()) : setReplies(eventId, ids, 'yes'))
    onDone(compose(...mutations), { people: new Set(ids).size, created, attendance: eventId ? kind : null })
  }

  const setChoice = (index: number, choice: Choice) =>
    setChoices((current) => current.map((c, i) => (i === index ? choice : c)))

  return (
    <div className="space-y-5">
      {groups.matched.length > 0 && (
        <details className="rounded-lg border border-line">
          <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 font-semibold text-success">
            <CheckIcon />
            {t('csv.match.recognized', { count: groups.matched.length })}
          </summary>
          <ul className="max-h-48 overflow-y-auto border-t border-line px-3 py-2 text-sm">
            {groups.matched.map(({ result, index }) => (
              <li key={index}>
                {result.input}
                {result.kind === 'matched' && state.people[result.personId].name !== result.input && (
                  <span className="text-muted"> → {state.people[result.personId].name}</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {groups.suggested.length > 0 && (
        <section className="space-y-2">
          <div>
            <h3 className="font-semibold text-warning">{t('csv.match.close', { count: groups.suggested.length })}</h3>
            <p className="text-sm text-muted">{t('csv.match.closeHint')}</p>
          </div>
          {groups.suggested.map(({ result, index }) => (
            <ChoiceRow key={index} input={result.input} choice={choices[index]} people={people} onChange={(c) => setChoice(index, c)} />
          ))}
        </section>
      )}

      {groups.unknown.length > 0 && (
        <section className="space-y-2">
          <div>
            <h3 className="font-semibold">{t('csv.match.unknown', { count: groups.unknown.length })}</h3>
            <p className="text-sm text-muted">{t('csv.match.unknownHint')}</p>
          </div>
          {groups.unknown.map(({ result, index }) => (
            <ChoiceRow key={index} input={result.input} choice={choices[index]} people={people} onChange={(c) => setChoice(index, c)} />
          ))}
        </section>
      )}

      {report.duplicates.length > 0 && (
        <p className="text-sm text-muted">{t('csv.match.duplicates', { count: report.duplicates.length })}</p>
      )}

      {columns.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-semibold">{t('csv.values.title')}</h3>
          <ul className="space-y-1 text-sm">
            {columns.map((column) => {
              const name = column.mapping.target.type === 'new' ? column.mapping.target.name : state.personProperties[column.propertyId]?.name
              return (
                <li key={column.mapping.column}>
                  <span className="font-medium">{name}</span>
                  {' · '}
                  {t('csv.values.count', { count: column.values.filter((v) => v !== null).length })}
                  {column.mapping.target.type === 'new' && ` · ${t('csv.values.newProperty')}`}
                  {column.newOptions.length > 0 && ` · ${t('csv.values.newOptions', { count: column.newOptions.length, labels: column.newOptions.map((o) => o.label).join(', ') })}`}
                  {column.unreadable.length > 0 && (
                    <span className="text-warning"> · {t('csv.values.unreadable', { count: column.unreadable.length, cells: column.unreadable.slice(0, 3).join(', ') })}</span>
                  )}
                </li>
              )
            })}
          </ul>
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-accent" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
            {t('csv.values.overwrite')}
          </label>
        </section>
      )}

      {event && canCall(event, todayIso()) && (
        <fieldset className="space-y-1.5">
          <legend className="mb-1 font-semibold">{t('csv.kind.title')}</legend>
          {(['present', 'yes'] as const).map((value) => {
            const blocked = value === 'present' && callInProgress
            return (
              <label
                key={value}
                className={cx(
                  'flex gap-2.5 rounded-lg border p-2.5',
                  blocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
                  kind === value ? 'border-accent bg-accent-soft' : 'border-line',
                )}
              >
                <input
                  type="radio"
                  name="event-import"
                  className="mt-1 accent-accent"
                  checked={kind === value}
                  disabled={blocked}
                  onChange={() => setChosenKind(value)}
                />
                <span>
                  <span className="block font-medium">{t(value === 'present' ? 'csv.kind.present' : 'csv.kind.yes')}</span>
                  <span className="block text-sm text-muted">
                    {t(blocked ? 'csv.kind.blocked' : value === 'present' ? 'csv.kind.presentHint' : 'csv.kind.yesHint')}
                  </span>
                </span>
              </label>
            )
          })}
        </fieldset>
      )}

      <div className="space-y-3 border-t border-line pt-4">
        <p className="font-medium">
          {event
            ? t(kind === 'present' ? 'csv.match.summary' : 'csv.match.summaryYes', { count: presentCount, date: eventTitle(event, i18n) })
            : t('csv.match.summaryPeople', { count: presentCount })}
          {created > 0 && ` ${t('csv.match.summaryCreated', { count: created })}`}
        </p>
        {overLimit && (
          <p className="text-sm text-danger" role="alert">
            {t('people.limitReached', { count: LIMITS.people })}
          </p>
        )}
        <div className="flex justify-between gap-2">
          <button type="button" className={button()} onClick={onBack}>
            {t('csv.back')}
          </button>
          <button type="button" className={button('primary')} disabled={presentCount === 0 || overLimit} onClick={confirm}>
            {t('csv.import')}
          </button>
        </div>
      </div>
    </div>
  )
}

interface ChoiceRowProps {
  input: string
  choice: Choice
  people: PersonEntry[]
  onChange: (choice: Choice) => void
}

function ChoiceRow({ input: name, choice, people, onChange }: ChoiceRowProps) {
  const { t } = useI18n()
  return (
    <div className="grid gap-1 rounded-lg border border-line p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] sm:items-center sm:gap-3">
      <span className={cx('font-medium [overflow-wrap:anywhere]', choice === 'ignore' && 'text-muted line-through')}>{name}</span>
      <select
        className={input}
        aria-label={t('csv.match.choice', { name })}
        value={choice}
        onChange={(e) => onChange(e.target.value as Choice)}
      >
        <option value="create">{t('csv.match.create', { name })}</option>
        <option value="ignore">{t('csv.match.ignore')}</option>
        <optgroup label={t('csv.match.others')}>
          {people.map((person) => (
            <option key={person.id} value={`p:${person.id}`}>
              {person.name}
            </option>
          ))}
        </optgroup>
      </select>
    </div>
  )
}
