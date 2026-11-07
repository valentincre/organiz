import { useMemo, useRef, useState } from 'react'
import {
  isCalled,
  presenceOf,
  replyOf,
  statusCounts,
  statusMatcher,
  type StatusFilter,
} from '../domain/attendance'
import { compareByProperty, matchesFilter, readValue } from '../domain/filters'
import { randomId } from '../domain/ids'
import { isListedAt } from '../domain/leave'
import { hasKey, LIMITS } from '../domain/limits'
import { findPersonByName, matchesSearch } from '../domain/matching'
import { addPerson, compose, setPresence, setPresences, setReplies, setReply } from '../domain/mutations'
import { sortedProperties } from '../domain/properties'
import { hasConflict, markRepliesSeen, newReplies } from '../domain/replies'
import { sortedPeople, type EventEntry } from '../domain/selectors'
import type { DashboardState, Mutation, PersonId, Reply } from '../domain/types'
import { useI18n } from '../i18n/context'
import { viewPath, type DashboardView } from '../router'
import { isDemoRef, type DashboardRef } from '../storage/link'
import { useCanEdit } from './canEdit'
import { ChoicePill } from './components/ChoicePill'
import { ChevronIcon } from './components/icons'
import { cx } from './components/styles'
import { useToast } from './components/toast'
import { CallBox } from './call/CallBox'
import { AddCandidateRow, ListToolbar } from './ListToolbar'
import { BreakdownSummary } from './properties/BreakdownSummary'
import { PersonValues } from './PersonValues'
import { ReplyLabel } from './ReplyLabel'
import { ReplyPicker } from './ReplyPicker'
import { ConflictSheet } from './replies/ConflictSheet'
import { NewRepliesBanner } from './replies/NewRepliesBanner'
import { ReplyTraceLine } from './replies/ReplyTraceLine'
import { useViewFilters } from './useViewFilters'

/** Before the roll call people reply yes or no; once it is done the same list shows who was present. */
type Phase = 'replies' | 'presence'

interface Props {
  dashboardRef: DashboardRef
  state: DashboardState
  view: Extract<DashboardView, { tab: 'sheet' | 'draft' }>
  event: EventEntry
  mutate: (mutation: Mutation) => void
  onImport: () => void
}

/**
 * The list of an event page: toolbar, counters and one row per person, with replies or presence according to the phase.
 * Readers see the same list without anything that changes it: no adding, no bulk actions, no import.
 */
export function EventAttendance({ dashboardRef, state, view, event, mutate, onImport }: Props) {
  const { t, lang } = useI18n()
  const toast = useToast()
  const canEdit = useCanEdit()
  const eventId = event.id
  const { peopleFilter, setPeopleFilter } = useViewFilters(state, dashboardRef, view)
  const phase: Phase = isCalled(event) ? 'presence' : 'replies'
  const personProperties = sortedProperties(state, 'person')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter | null>(null)
  // "name", "first" (yes or present first) or a person property id.
  const [sort, setSort] = useState<string>('name')
  // People in the "first" group when that sort is chosen, so rows do not jump around while ticking.
  const [firstGroup, setFirstGroup] = useState<{ phase: Phase; ids: Set<PersonId> }>({ phase, ids: new Set() })
  const [replying, setReplying] = useState<PersonId | null>(null)
  const replyAnchor = useRef<HTMLElement | null>(null)
  // The person whose conflicting replies are shown.
  const [conflictFor, setConflictFor] = useState<PersonId | null>(null)
  // Replies from a link the editors have not marked as seen yet; readers have nothing to mark.
  const fresh = useMemo(() => new Set(canEdit ? newReplies(event) : []), [canEdit, event])
  const traceOf = (id: PersonId) => (event.replyLog && hasKey(event.replyLog, id) ? event.replyLog[id] : undefined)
  // Up to the newest reply shown rather than the device clock, so a reply not shown yet stays new.
  const markSeen = () => mutate(markRepliesSeen(eventId, Math.max(...[...fresh].map((id) => traceOf(id)?.at ?? 0))))
  const conflictTrace = conflictFor !== null && hasKey(state.people, conflictFor) ? traceOf(conflictFor) : undefined
  // Settled meanwhile (by Keep here or by another organizer): the sheet closes and does not come back by itself.
  if (conflictFor !== null && !hasConflict(conflictTrace)) setConflictFor(null)

  // People who left before the event are not offered, unless they have a reply or a presence on it.
  const listed = useMemo(() => sortedPeople(state, lang).filter((p) => isListedAt(state, event, p.id)), [state, lang, event])
  const people = useMemo(
    () => listed.filter((p) => matchesFilter(state.personProperties, p.values, peopleFilter)),
    [listed, state.personProperties, peopleFilter],
  )
  const everyone = useMemo(() => Object.keys(state.people), [state.people])
  const allCounts = useMemo(() => statusCounts(event, listed.map((p) => p.id)), [event, listed])
  const shownCounts = useMemo(() => statusCounts(event, people.map((p) => p.id)), [event, people])

  const statusOptions = useMemo(
    () =>
      (phase === 'replies'
        ? [
            { value: 'yes', label: t('filter.yes') },
            { value: 'no', label: t('filter.no') },
            { value: 'noReply', label: t('filter.noReply') },
          ]
        : [
            { value: 'present', label: t('filter.present') },
            { value: 'absent', label: t('filter.absent') },
            { value: 'yes', label: t('filter.saidYes') },
            { value: 'no', label: t('filter.saidNo') },
            { value: 'noReply', label: t('filter.noReply') },
          ]
      ).map((option) => ({ ...option, count: allCounts[option.value as StatusFilter] })),
    [phase, allCounts, t],
  )
  // A choice of the other phase (the roll call was made or redone meanwhile) no longer applies.
  const activeStatus = statusOptions.some((option) => option.value === status) ? status : null
  const firstIds = firstGroup.phase === phase ? firstGroup.ids : null

  const visible = useMemo(() => {
    const matchesStatus = activeStatus ? statusMatcher(event, activeStatus) : null
    const shown = people.filter((p) => matchesSearch(p.name, query) && (!matchesStatus || matchesStatus(p.id)))
    // Stable sorts keep alphabetical order among ties.
    if (sort === 'first' && firstIds) shown.sort((a, b) => Number(firstIds.has(b.id)) - Number(firstIds.has(a.id)))
    else if (sort !== 'name' && sort !== 'first' && hasKey(state.personProperties, sort)) {
      const compare = compareByProperty(state.personProperties[sort], new Intl.Collator(lang, { sensitivity: 'base', numeric: true }))
      shown.sort((a, b) => compare(readValue(state.personProperties, a.values, sort), readValue(state.personProperties, b.values, sort)))
    }
    return shown
  }, [people, query, activeStatus, event, sort, firstIds, state.personProperties, lang])

  // The group the first-sort puts on top, and the one the breakdown describes.
  const topStatus: StatusFilter = phase === 'replies' ? 'yes' : 'present'
  const isTop = statusMatcher(event, topStatus)
  const counted = people.filter((p) => isTop(p.id))
  const changeSort = (next: string) => {
    setSort(next)
    if (next === 'first') setFirstGroup({ phase, ids: new Set(counted.map((p) => p.id)) })
  }

  // The search field also adds people: a name nobody has is offered as a new
  // person; an existing one hidden by the filters can be marked.
  const typed = query.trim()
  const existing = typed ? findPersonByName(state, typed) : undefined
  const candidate: { kind: 'add' } | { kind: 'mark'; id: PersonId } | null = !typed || !canEdit
    ? null
    : existing
      ? visible.some((p) => p.id === existing)
        ? null
        : { kind: 'mark', id: existing }
      : { kind: 'add' }
  const full = everyone.length >= LIMITS.people
  /** A late arrival: said yes before the call, present after it. */
  const markPerson = (id: PersonId): Mutation => (phase === 'replies' ? setReply(eventId, id, 'yes') : setPresence(eventId, id, true))
  const addOrMark = () => {
    if (!typed) return
    if (existing) {
      mutate(markPerson(existing))
      toast(t(phase === 'replies' ? 'sheet.alreadyExistsYes' : 'sheet.alreadyExists', { name: state.people[existing].name }))
    } else {
      if (full) return
      const id = randomId()
      mutate(compose(addPerson(id, typed), markPerson(id)))
      toast(t(phase === 'replies' ? 'sheet.addedYes' : 'sheet.added', { name: typed }))
    }
    setQuery('')
  }

  const shownIds = visible.map((p) => p.id)
  const disabled = visible.length === 0
  const more = !canEdit ? undefined : [
    ...(phase === 'replies'
      ? [
          { label: t('sheet.yesAll'), disabled, onSelect: () => mutate(setReplies(eventId, shownIds, 'yes')) },
          { label: t('sheet.noAll'), disabled, onSelect: () => mutate(setReplies(eventId, shownIds, 'no')) },
          { label: t('sheet.clearAll'), disabled, onSelect: () => mutate(setReplies(eventId, shownIds, null)) },
        ]
      : [
          { label: t('sheet.allLabel'), disabled, onSelect: () => mutate(setPresences(eventId, shownIds, true)) },
          { label: t('sheet.noneLabel'), disabled, onSelect: () => mutate(setPresences(eventId, shownIds, false)) },
        ]),
    { label: t('sheet.importMenu'), separated: true, onSelect: onImport },
  ]

  const counter =
    phase === 'replies' ? (
      <>
        <span className="text-success">{t('sheet.countYes', { count: shownCounts.yes })}</span>
        {' · '}
        <span className="text-danger">{t('sheet.countNo', { count: shownCounts.no })}</span>
        {' · '}
        <span className="font-normal text-muted">{t('sheet.countNoReply', { count: shownCounts.noReply })}</span>
      </>
    ) : (
      <>
        <span className="text-success">{t('sheet.countPresent', { count: shownCounts.present })}</span>
        {' · '}
        <span className="text-danger">{t('sheet.countAbsent', { count: shownCounts.absent })}</span>
      </>
    )

  const replyingPerson = replying !== null && hasKey(state.people, replying) ? replying : null

  return (
    <>
      {/* An event not saved yet cannot be called. */}
      {view.tab === 'sheet' && (
        <CallBox
          dashboardRef={dashboardRef}
          state={state}
          event={event}
          context={{ period: view.period, filters: view.filters }}
          scopeSize={people.length}
          filtered={peopleFilter.length > 0}
          mutate={mutate}
        />
      )}
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        searchLabel={t(canEdit ? 'sheet.searchOrAdd' : 'people.search')}
        onSubmit={canEdit ? addOrMark : undefined}
        filter={{
          properties: personProperties,
          filter: peopleFilter,
          onChange: setPeopleFilter,
          items: Object.values(state.people).map((person) => person.values),
          status: {
            label: t(phase === 'replies' ? 'filter.reply' : 'filter.presence'),
            value: activeStatus,
            options: statusOptions,
            onChange: (value) => setStatus(value as StatusFilter | null),
          },
          summary: t('filter.peopleShown', { count: visible.length, total: listed.length }),
        }}
        sorted={sort !== 'name'}
        sort={[
          { label: t('sheet.sortName'), checked: sort === 'name', onSelect: () => changeSort('name') },
          { label: t(phase === 'replies' ? 'sheet.yesFirst' : 'sheet.presentFirst'), checked: sort === 'first', onSelect: () => changeSort('first') },
          ...personProperties.map((def, index) => ({
            label: def.name,
            checked: sort === def.id,
            separated: index === 0,
            onSelect: () => changeSort(def.id),
          })),
        ]}
        more={more}
      />

      {fresh.size > 0 && <NewRepliesBanner count={fresh.size} onSeen={markSeen} />}

      <BreakdownSummary properties={personProperties} items={counted.map((p) => p.values)} title={counter} />

      {(candidate || visible.length > 0) && (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {candidate && (
            <AddCandidateRow
              disabled={candidate.kind === 'add' && full}
              onClick={addOrMark}
              label={
                candidate.kind === 'add'
                  ? full
                    ? t('people.limitReached', { count: LIMITS.people })
                    : t(phase === 'replies' ? 'sheet.addAsYes' : 'sheet.addAsPresent', { name: typed })
                  : t(phase === 'replies' ? 'sheet.markYes' : 'sheet.markPresent', { name: state.people[candidate.id].name })
              }
            />
          )}
          {visible.map((person) => {
            const reply = replyOf(event, person.id)
            const presence = presenceOf(event, person.id)
            const highlighted = phase === 'replies' ? reply === 'yes' : presence === true
            const trace = traceOf(person.id)
            const traceLine = (className?: string) =>
              trace && (
                <ReplyTraceLine
                  trace={trace}
                  onOpenConflict={canEdit ? () => setConflictFor(person.id) : undefined}
                  conflictOpen={conflictFor === person.id}
                  className={className}
                />
              )
            const isNew = fresh.has(person.id)
            return (
              <li key={person.id} className={cx(isNew && 'bg-accent-soft')}>
                <div className="space-y-1 px-4 py-2">
                  <div className="flex min-h-touch items-center gap-3">
                    <a
                      href={`#${viewPath(dashboardRef, { tab: 'person', personId: person.id, from: eventId })}`}
                      className={cx('min-w-0 flex-1 text-text no-underline [overflow-wrap:anywhere] hover:underline', highlighted && 'font-medium')}
                    >
                      {person.name}
                      {isNew && <span className="sr-only"> ({t('replies.newReply')})</span>}
                    </a>
                    {phase === 'replies' ? (
                      <ChoicePill<Reply>
                        value={reply ?? null}
                        options={[
                          { value: 'yes', label: t('reply.yes') },
                          { value: 'no', label: t('reply.no') },
                        ]}
                        clearable
                        label={person.name}
                        onChange={(value) => mutate(setReply(eventId, person.id, value))}
                      />
                    ) : (
                      <ChoicePill<'present' | 'absent'>
                        value={presence === undefined ? null : presence ? 'present' : 'absent'}
                        options={[
                          { value: 'present', label: t('sheet.statePresent') },
                          { value: 'absent', label: t('sheet.stateAbsent') },
                        ]}
                        label={person.name}
                        onChange={(value) => value && mutate(setPresence(eventId, person.id, value === 'present'))}
                      />
                    )}
                  </div>
                  {/* Under the name: the reply before the event (after the call) and where the reply came from. */}
                  {(phase === 'presence' || trace) && (
                    <div className="flex flex-wrap items-center gap-x-3">
                      {phase === 'presence' &&
                        (canEdit ? (
                          <ReplyButton
                            name={person.name}
                            reply={reply}
                            open={replyingPerson === person.id}
                            onClick={(button) => {
                              replyAnchor.current = button
                              setReplying(replyingPerson === person.id ? null : person.id)
                            }}
                          />
                        ) : (
                          <span className="inline-flex items-center gap-1 py-1 text-xs text-muted">
                            <ReplyLabel reply={reply} />
                          </span>
                        ))}
                      {traceLine()}
                    </div>
                  )}
                  <PersonValues state={state} properties={personProperties} values={person.values} />
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {!candidate && visible.length === 0 && (
        <p className="py-6 text-center text-muted">
          {everyone.length === 0 ? t('sheet.empty') : query ? t('people.noResults', { query }) : t('sheet.noneShown')}
        </p>
      )}

      {replyingPerson && (
        <ReplyPicker
          anchor={replyAnchor}
          name={state.people[replyingPerson].name}
          reply={replyOf(event, replyingPerson)}
          presence={presenceOf(event, replyingPerson)}
          onChange={(value) => mutate(setReply(eventId, replyingPerson, value))}
          onClose={() => setReplying(null)}
        />
      )}

      {conflictFor !== null && conflictTrace && hasConflict(conflictTrace) && (
        <ConflictSheet
          open
          onClose={() => setConflictFor(null)}
          eventId={eventId}
          personId={conflictFor}
          name={state.people[conflictFor].name}
          reply={replyOf(event, conflictFor)}
          trace={conflictTrace}
          state={state}
          withPersonalLink={!isDemoRef(dashboardRef)}
          mutate={mutate}
        />
      )}
    </>
  )
}

/** What the person said before the event ("said yes ⌄"); opens the sheet or popover that fixes it. */
function ReplyButton({ name, reply, open, onClick }: { name: string; reply: Reply | undefined; open: boolean; onClick: (button: HTMLButtonElement) => void }) {
  const { t } = useI18n()
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-expanded={open}
      className={cx(
        'inline-flex cursor-pointer items-center gap-1 py-1 text-xs underline decoration-dotted underline-offset-4 hover:text-text',
        open ? 'text-accent' : 'text-muted',
      )}
      onClick={(event) => onClick(event.currentTarget)}
    >
      <span className="sr-only">{t('reply.title', { name })}: </span>
      <ReplyLabel reply={reply} />
      <ChevronIcon direction="down" small />
    </button>
  )
}
