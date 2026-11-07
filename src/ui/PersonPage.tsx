import { useId, useMemo, useState } from 'react'
import { todayIso } from '../domain/dates'
import { matchesFilter } from '../domain/filters'
import { hasKey, LIMITS } from '../domain/limits'
import { matchesSearch } from '../domain/matching'
import { isCalled, isCounted, presenceOf, replyOf } from '../domain/attendance'
import { compose, deletePerson, renamePerson, setLeftOn, setPresence, setReply } from '../domain/mutations'
import { isLocked, revokePersonalLink } from '../domain/personalLinks'
import { sortedProperties } from '../domain/properties'
import { sortedEvents, type EventEntry } from '../domain/selectors'
import { peopleStats, personCells } from '../domain/stats'
import type { DashboardState, IsoDate, Mutation, Reply } from '../domain/types'
import { useI18n } from '../i18n/context'
import { navigate, viewPath, type DashboardView } from '../router'
import { isDemoRef, type DashboardRef } from '../storage/link'
import { useCanEdit } from './canEdit'
import { ChoicePill } from './components/ChoicePill'
import { Dialog } from './components/Dialog'
import { EditableTitle } from './components/EditableTitle'
import { TagIcon } from './components/icons'
import { button, cx, input } from './components/styles'
import { eventTime, eventTitle } from './eventFormat'
import { ListToolbar } from './ListToolbar'
import { PropertiesDialog } from './properties/PropertiesDialog'
import { PersonalLinkRow } from './replies/PersonalLinkRow'
import { ValuesEditor } from './properties/ValuesEditor'
import { ValueView } from './properties/ValueView'
import { BackLink, SplitPage } from './SplitPage'
import { useViewFilters } from './useViewFilters'

/** Looks like a link: small actions next to a line of text. */
const textAction = 'min-h-8 cursor-pointer text-accent underline-offset-2 hover:underline'

interface Props {
  dashboardRef: DashboardRef
  state: DashboardState
  view: Extract<DashboardView, { tab: 'person' }>
  mutate: (mutation: Mutation) => void
}

/** One person: name and properties on the left, every event with their attendance on the right. */
export function PersonPage({ dashboardRef, state, view, mutate }: Props) {
  const i18n = useI18n()
  const { t, lang, formatDate } = i18n
  const canEdit = useCanEdit()
  const { personId, from } = view
  const person = hasKey(state.people, personId) ? state.people[personId] : undefined
  const { eventFilter, setEventFilter } = useViewFilters(state, dashboardRef, view)
  const [query, setQuery] = useState('')
  const [presence, setPresenceFilter] = useState<'present' | 'absent' | null>(null)
  const [oldestFirst, setOldestFirst] = useState(false)
  const [propertiesOpen, setPropertiesOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const personProperties = sortedProperties(state, 'person')
  const eventProperties = sortedProperties(state, 'event')
  const today = todayIso()

  // Back to the sheet it was opened from, else to the people list.
  const fromEvent = from && hasKey(state.events, from) ? from : undefined
  const back = fromEvent
    ? { href: `#${viewPath(dashboardRef, { tab: 'sheet', eventId: fromEvent })}`, label: t('person.backToEvent') }
    : { href: `#${viewPath(dashboardRef, { tab: 'people' })}`, label: t('person.backToPeople') }

  const events = useMemo(() => sortedEvents(state), [state])
  // Their numbers over all time, by the definitions of the Statistics tab (recorded events, arrival, leave date).
  const allTime = useMemo(() => peopleStats(state, personCells(state, personId, today)).get(personId), [state, today, personId])
  // Present at the event: the real presence after a call, a "yes" before it.
  const attends = (event: EventEntry) => isCounted(event, personId)
  const visible = useMemo(() => {
    const shown = events.filter(
      (event) =>
        matchesFilter(state.eventProperties, event.values, eventFilter) &&
        matchesSearch(eventTitle(event, i18n), query) &&
        (presence === null || isCounted(event, personId) === (presence === 'present')),
    )
    return oldestFirst ? shown.reverse() : shown
  }, [events, state.eventProperties, eventFilter, query, presence, personId, oldestFirst, i18n])

  if (!person) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <BackLink {...back} />
        <p className="py-6 text-center text-muted">{t('person.notFound')}</p>
      </div>
    )
  }

  const last = events.find((event) => event.date <= today && attends(event))?.date
  const presentCount = events.filter(attends).length
  const rate = allTime ? Math.round((allTime.present / allTime.expected) * 100) : null

  const remove = () => {
    if (!window.confirm(t('people.deleteConfirm', { name: person.name, count: presentCount }))) return
    navigate(back.href.slice(1))
    mutate(deletePerson(personId))
  }

  // Events grouped by month, in the list's order.
  const monthLabel = (date: string) =>
    new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))
  const months: { label: string; events: EventEntry[] }[] = []
  for (const event of visible) {
    const label = monthLabel(event.date)
    if (months.at(-1)?.label === label) months.at(-1)!.events.push(event)
    else months.push({ label, events: [event] })
  }

  const details = (
    <div className="space-y-4">
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">{t('event.properties')}</h3>
          {canEdit && (
            <button
              type="button"
              className={cx(button(), 'min-h-8 gap-1.5 px-2.5 text-sm')}
              title={t('people.propertiesMenu')}
              onClick={() => setPropertiesOpen(true)}
            >
              <TagIcon small />
              {t('property.manage')}
            </button>
          )}
        </div>
        {personProperties.length > 0 ? (
          <ValuesEditor state={state} scope="person" targetId={personId} values={person.values} mutate={mutate} />
        ) : (
          <p className="text-sm text-muted">{t(canEdit ? 'person.noProperties' : 'person.noPropertiesRead')}</p>
        )}
      </section>
      {/* Organizers only; the demo has no links. */}
      {canEdit && !isDemoRef(dashboardRef) && (
        <section className="space-y-1 border-t border-line pt-4">
          <h3 className="font-semibold">{t('personal.section')}</h3>
          <PersonalLinkRow state={state} personId={personId} withName={false} mutate={mutate} />
        </section>
      )}
      {canEdit && (
        <div className="flex flex-col items-start border-t border-line pt-4 text-sm">
          {person.leftOn === undefined && (
            <button type="button" className={textAction} aria-haspopup="dialog" onClick={() => setLeaving(true)}>
              {t('person.leave')}
            </button>
          )}
          <button type="button" className="min-h-8 cursor-pointer text-danger underline-offset-2 hover:underline" onClick={remove}>
            {t('person.delete')}
          </button>
        </div>
      )}
    </div>
  )

  const stats = [
    { value: String(presentCount), label: t('person.statAttended', { count: presentCount }) },
    { value: rate === null ? '–' : `${rate} %`, label: t('person.statRate') },
    { value: last ? formatDate(last, { day: 'numeric', month: 'short' }) : '–', label: t('person.statLast') },
  ]

  return (
    <>
      <SplitPage
        back={back}
        expanded={propertiesOpen}
        header={
          <div>
            <EditableTitle
              as="h2"
              value={person.name}
              onChange={(name) => mutate(renamePerson(personId, name))}
              label={t('people.nameLabel')}
              editLabel={t('person.rename')}
              maxLength={LIMITS.personName}
            />
            <p className="text-muted">{t('person.subtitle', { count: allTime?.present ?? 0, total: allTime?.expected ?? 0 })}</p>
            {person.leftOn !== undefined && (
              <p className="flex flex-wrap items-center gap-x-3 text-sm">
                <span className="text-muted">{t('person.leftOn', { date: formatDate(person.leftOn, { dateStyle: 'medium' }) })}</span>
                {canEdit && (
                  <>
                    <button type="button" className={textAction} aria-haspopup="dialog" onClick={() => setLeaving(true)}>
                      {t('person.leaveChange')}
                    </button>
                    <button type="button" className={textAction} onClick={() => mutate(setLeftOn(personId, null))}>
                      {t('person.leaveCancel')}
                    </button>
                  </>
                )}
              </p>
            )}
          </div>
        }
        details={details}
        summary={
          <>
            {t('event.properties')}
            {personProperties.map((p) => (
              <ValueView key={p.id} defs={state.personProperties} propertyId={p.id} values={person.values} compact withName />
            ))}
          </>
        }
      >
        <dl className="grid grid-cols-3 gap-2">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-xl border border-line bg-surface px-3 py-2.5">
              <dt className="text-xs text-muted">{stat.label}</dt>
              <dd className="text-xl font-semibold tabular-nums">{stat.value}</dd>
            </div>
          ))}
        </dl>

        <ListToolbar
          query={query}
          onQueryChange={setQuery}
          searchLabel={t('person.searchEvents')}
          filter={{
            properties: eventProperties,
            filter: eventFilter,
            onChange: setEventFilter,
            items: events.map((event) => event.values),
            status: {
              label: t('filter.presence'),
              value: presence,
              options: [
                { value: 'present', label: t('filter.present'), count: presentCount },
                { value: 'absent', label: t('filter.absent'), count: events.length - presentCount },
              ],
              onChange: (value) => setPresenceFilter(value as 'present' | 'absent' | null),
            },
            summary: t('filter.eventsShown', { count: visible.length, total: events.length }),
          }}
          sorted={oldestFirst}
          sort={[
            { label: t('person.newestFirst'), checked: !oldestFirst, onSelect: () => setOldestFirst(false) },
            { label: t('person.oldestFirst'), checked: oldestFirst, onSelect: () => setOldestFirst(true) },
          ]}
        />

        {months.length === 0 ? (
          <p className="py-6 text-center text-muted">{events.length === 0 ? t('person.noEvents') : t('person.noneShown')}</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-line bg-surface">
            {months.map((month) => (
              <section key={month.label} aria-label={month.label}>
                <h3 className="border-b border-line bg-surface-muted px-4 py-1.5 text-xs font-semibold tracking-wide text-muted uppercase">{month.label}</h3>
                <ul className="divide-y divide-line border-b border-line last:border-b-0">
                  {month.events.map((event) => {
                    const title = eventTitle(event, i18n)
                    return (
                      <li key={event.id} className="space-y-1 px-4 py-2">
                        <a
                          href={`#${viewPath(dashboardRef, { tab: 'sheet', eventId: event.id })}`}
                          className="block text-text no-underline [overflow-wrap:anywhere] hover:underline"
                        >
                          {title}
                          {event.date > today && <span className="text-sm text-muted"> · {t('person.upcoming')}</span>}
                        </a>
                        <div className="flex items-center justify-between gap-3">
                          {/* Date and time stay whole: when they do not fit next to the choice, the time goes under the date. */}
                          <span className="flex min-w-0 flex-wrap gap-x-2 text-sm text-muted">
                            <span className="whitespace-nowrap">{formatDate(event.date, { day: 'numeric', month: 'short' })}</span>
                            <span className="whitespace-nowrap">{eventTime(event, i18n)}</span>
                          </span>
                          <span className="shrink-0">
                            {isCalled(event) ? (
                              <ChoicePill<'present' | 'absent'>
                                value={presenceOf(event, personId) === undefined ? null : presenceOf(event, personId) ? 'present' : 'absent'}
                                options={[
                                  { value: 'present', label: t('sheet.statePresent') },
                                  { value: 'absent', label: t('sheet.stateAbsent') },
                                ]}
                                label={title}
                                onChange={(value) => value && mutate(setPresence(event.id, personId, value === 'present'))}
                              />
                            ) : (
                              <ChoicePill<Reply>
                                value={replyOf(event, personId) ?? null}
                                options={[
                                  { value: 'yes', label: t('reply.yes') },
                                  { value: 'no', label: t('reply.no') },
                                ]}
                                clearable
                                label={title}
                                onChange={(value) => mutate(setReply(event.id, personId, value))}
                              />
                            )}
                          </span>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </SplitPage>
      {/* Outside the details: on phones they are folded, and the dialog must survive the switch. */}
      <PropertiesDialog open={propertiesOpen} onClose={() => setPropertiesOpen(false)} scope="person" state={state} mutate={mutate} />
      {leaving && (
        <LeaveDialog
          initial={person.leftOn ?? today}
          hasLink={isLocked(state, personId)}
          // Checked when the leave is set; when it is changed, a link created since was meant to stay.
          revokeByDefault={person.leftOn === undefined}
          onSave={(date, revoke) => {
            mutate(revoke ? compose(setLeftOn(personId, date), revokePersonalLink(personId)) : setLeftOn(personId, date))
            setLeaving(false)
          }}
          onClose={() => setLeaving(false)}
        />
      )}
    </>
  )
}

/** The day a person left the group: later events no longer list them, their history stays. Their personal link can go with it. */
function LeaveDialog(props: {
  initial: IsoDate
  hasLink: boolean
  revokeByDefault: boolean
  onSave: (date: IsoDate, revoke: boolean) => void
  onClose: () => void
}) {
  const { initial, hasLink, revokeByDefault, onSave, onClose } = props
  const { t } = useI18n()
  const [date, setDate] = useState(initial)
  const [revoke, setRevoke] = useState(revokeByDefault)
  const formId = useId()
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('person.leaveTitle')}
      closeLabel={t('common.cancel')}
      narrow
      footer={
        <>
          <button type="button" className={button()} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form={formId} className={button('primary')} disabled={!date}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (date) onSave(date, hasLink && revoke)
        }}
      >
        <label className="grid gap-1 text-sm font-medium">
          {t('person.leaveDate')}
          <input type="date" className={input} value={date} required onChange={(e) => setDate(e.target.value)} />
        </label>
        <p className="text-sm text-muted">{t('person.leaveHint')}</p>
        {hasLink && (
          <div className="space-y-1 text-sm">
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" className="size-4 accent-accent" checked={revoke} onChange={(e) => setRevoke(e.target.checked)} />
              {t('person.leaveRevoke')}
            </label>
            <p className="pl-6 text-muted">{t('person.leaveRevokeHint')}</p>
          </div>
        )}
      </form>
    </Dialog>
  )
}
