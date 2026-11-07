import { countedCount, isCalled } from '../domain/attendance'
import { pruneDraft, progress } from '../domain/call'
import { todayIso } from '../domain/dates'
import { sortedEvents, type EventEntry } from '../domain/selectors'
import type { DashboardState, EventId } from '../domain/types'
import { useI18n } from '../i18n/context'
import type { DashboardRef } from '../storage/link'
import { beginCall, callScopeOf, resumeCall, type CallContext } from './call/actions'
import { useCallDraft } from './call/callDraftStore'
import { useCanEdit } from './canEdit'
import { CallIcon, PencilIcon } from './components/icons'
import { button, cx } from './components/styles'
import { eventTime, eventTitle } from './eventFormat'

interface Props {
  dashboardRef: DashboardRef
  state: DashboardState
  /** What the call screen needs to return to this list. */
  context: CallContext
  /** Opens today's draft event. */
  onCreate: () => void
  onOpenSheet: (eventId: EventId) => void
  onSelectEvent: (eventId: EventId) => void
}

const action = cx(button('primary'), 'min-h-9 shrink-0 px-3 text-sm')

/** Short label on phones, full label from the sm breakpoint. */
const label = (short: string, full: string) => (
  <>
    <span className="sm:hidden">{short}</span>
    <span className="max-sm:hidden">{full}</span>
  </>
)

/**
 * How far the roll call in progress on this device has got, or null. Readers never see one: they
 * cannot resume it, and the draft may be left from an edit link opened on the same device.
 */
function useCallInProgress({ dashboardRef, state }: Props, eventId: EventId) {
  const canEdit = useCanEdit()
  const [stored] = useCallDraft(dashboardRef.docId, eventId)
  return canEdit && stored && stored.finishedAt === undefined ? progress(pruneDraft(state, stored)) : null
}

/** Where an event stands today: to call, a call in progress on this device, or already called. */
function useTodayEvent(props: Props, event: EventEntry) {
  const { dashboardRef, state, context, onOpenSheet } = props
  const { t, lang } = useI18n()
  const pending = useCallInProgress(props, event.id)
  const hasPeople = callScopeOf(state, lang, context, event).length > 0

  if (pending) {
    return {
      status: t('todayCard.callInProgress', { marked: pending.marked, total: pending.total }),
      button: (
        <button type="button" className={action} onClick={() => resumeCall(dashboardRef, event.id, context)}>
          {t('todayCard.resume')}
        </button>
      ),
    }
  }
  if (isCalled(event)) {
    return {
      status: t('calendar.present', { count: countedCount(event) }),
      button: (
        <button type="button" className={action} aria-label={t('day.editAttendance')} onClick={() => onOpenSheet(event.id)}>
          {label(t('todayCard.editShort'), t('day.editAttendance'))}
        </button>
      ),
    }
  }
  return {
    status: t('sheet.countYes', { count: countedCount(event) }),
    button: (
      <button type="button" className={action} disabled={!hasPeople} onClick={() => beginCall(dashboardRef, state, event.id, lang, context)}>
        {label(t('todayCard.callShort'), t('call.start'))}
      </button>
    ),
  }
}

/**
 * A row of a day with several events: the title (cut with "…" when long) and the time with where the event
 * stands open the event; a square icon button does the one action that follows, as for a single event.
 */
function TodayChip({ event, ...props }: Props & { event: EventEntry }) {
  const i18n = useI18n()
  const { t, lang } = i18n
  const canEdit = useCanEdit()
  const { dashboardRef, state, context, onOpenSheet, onSelectEvent } = props
  const pending = useCallInProgress(props, event.id)

  const [status, actionLabel, icon, run, disabled] = pending
    ? [
        <span key="s">{t('todayCard.callInProgress', { marked: pending.marked, total: pending.total })}</span>,
        t('todayCard.resume'),
        <CallIcon key="i" />,
        () => resumeCall(dashboardRef, event.id, context),
        false,
      ]
    : isCalled(event)
      ? [
          <span key="s" className="text-success">
            {t('calendar.present', { count: countedCount(event) })}
          </span>,
          t('day.editAttendance'),
          <PencilIcon key="i" />,
          () => onOpenSheet(event.id),
          false,
        ]
      : [
          <span key="s" className="text-warning">
            {t('events.noCall')}
          </span>,
          t('call.start'),
          <CallIcon key="i" />,
          () => beginCall(dashboardRef, state, event.id, lang, context),
          callScopeOf(state, lang, context, event).length === 0,
        ]

  return (
    <li className={cx('flex items-center gap-2 rounded-lg border border-line bg-surface py-1.5 pl-3 text-sm', canEdit ? 'pr-1.5' : 'pr-3')}>
      <button type="button" className="min-w-0 flex-1 cursor-pointer text-left" onClick={() => onSelectEvent(event.id)}>
        <span className="block truncate">{eventTitle(event, i18n)}</span>
        <span className="block truncate text-xs text-muted">
          {eventTime(event, i18n)} · {status}
        </span>
      </button>
      {canEdit && (
        <button
          type="button"
          className={cx(button('primary'), 'size-9 min-h-9 shrink-0 px-0')}
          aria-label={actionLabel}
          title={actionLabel}
          disabled={disabled}
          onClick={run}
        >
          {icon}
        </button>
      )}
    </li>
  )
}

/** The card's line when the day has one event. */
function TodayRow({ event, today, ...props }: Props & { event: EventEntry; today: string }) {
  const { t } = useI18n()
  const canEdit = useCanEdit()
  const { status, button } = useTodayEvent(props, event)
  return (
    <div className="flex items-center gap-3">
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-semibold text-warning">{t('todayCard.label')}</span>
        <span className="max-sm:hidden"> · {today}</span>
        <span className="text-muted"> · {status}</span>
      </p>
      {canEdit && button}
    </div>
  )
}

/**
 * One-line shortcut to today's attendance: creates today's event, calls or edits the only one, or lists today's events.
 * Readers only see where today's events stand.
 */
export function TodayCard(props: Props) {
  const i18n = useI18n()
  const { t, formatDate } = i18n
  const canEdit = useCanEdit()
  const { state, onCreate } = props
  const today = todayIso()
  const events = sortedEvents(state, today, today).reverse()

  return (
    <section className="space-y-2 rounded-xl border border-warning/30 bg-today py-2 pr-2 pl-4" aria-label={t('todayCard.label')}>
      {events.length === 1 ? (
        <TodayRow {...props} event={events[0]} today={formatDate(today, { weekday: 'long', day: 'numeric', month: 'long' })} />
      ) : (
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 truncate text-sm">
            <span className="font-semibold text-warning">{t('todayCard.label')}</span>
            <span className="max-sm:hidden"> · {formatDate(today, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
            <span className="text-muted">
              {' · '}
              {events.length === 0 ? t('todayCard.noEvent') : t('calendar.events', { count: events.length })}
            </span>
          </p>
          {events.length === 0 && canEdit && (
            <button type="button" className={action} aria-label={t('todayCard.create')} onClick={onCreate}>
              {label(t('todayCard.createShort'), t('todayCard.create'))}
            </button>
          )}
        </div>
      )}
      {events.length > 1 && (
        <ul className="grid gap-2 pr-2 pb-1">
          {events.map((event) => (
            <TodayChip key={event.id} {...props} event={event} />
          ))}
        </ul>
      )}
    </section>
  )
}
