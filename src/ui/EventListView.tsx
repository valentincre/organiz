import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { eventTally } from '../domain/attendance'
import { addMonths, monthOf, todayIso, type YearMonth } from '../domain/dates'
import { newReplies } from '../domain/replies'
import { isShareOpen } from '../domain/shares'
import { eventsByDate, type EventEntry } from '../domain/selectors'
import type { ColorKey, DashboardState, EventId, IsoDate } from '../domain/types'
import { useI18n } from '../i18n/context'
import { AttendanceBar, NoCallTag } from './AttendanceBar'
import { useCanEdit } from './canEdit'
import { ChevronIcon } from './components/icons'
import { button, cx, optionDot } from './components/styles'
import { eventTime, eventTitle } from './eventFormat'
import { MiniMonth } from './MiniMonth'
import { useNowPassing } from './replies/useNowPassing'

/** Events drawn at first, then this many more per click. */
const PAGE = 100

interface Props {
  state: DashboardState
  /** Events matching the search and filters, newest first. */
  events: EventEntry[]
  /** The event or day to scroll to, from the URL. */
  selectedEvent?: EventId
  selectedDate?: IsoDate
  colorOf: (event: EventEntry) => ColorKey | undefined
  eventHref: (id: EventId) => string
  /** Goes to a day (from the mini calendar). */
  onSelectDate: (date: IsoDate) => void
  onOpenMonth: (month: YearMonth) => void
  /** The today shortcut, above the list. */
  today: ReactNode
  emptyText: string
}

/**
 * Events as a list: today's shortcut first, then every event by month,
 * newest first, upcoming ones included. A mini calendar on wide
 * screens jumps to a date.
 */
export function EventListView({ state, events, selectedEvent, selectedDate, colorOf, eventHref, onSelectDate, onOpenMonth, today: todayCard, emptyText }: Props) {
  const i18n = useI18n()
  const { t, formatDate, formatMonth } = i18n
  const today = todayIso()
  const total = Object.keys(state.people).length
  const list = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(PAGE)
  const canEdit = useCanEdit()

  // Events whose open presence link is private, for editors; the list updates when such a link closes by itself.
  const presenceShares = canEdit ? Object.values(state.shares ?? {}).filter((share) => share.kind === 'presence') : []
  const now = useNowPassing(presenceShares.map((share) => share.closesAt))
  const privateLinks = new Set(presenceShares.filter((share) => share.visibility === 'private' && isShareOpen(share, now)).map((share) => share.eventId))

  // Today's events are also in the shortcut above the list.
  const listed = events
  const byDate = useMemo(() => eventsByDate(events), [events])

  // The event or the closest one to the chosen day.
  const target = useMemo(() => {
    if (selectedEvent) return events.find((event) => event.id === selectedEvent)
    if (!selectedDate) return undefined
    let best: EventEntry | undefined
    for (const event of events) {
      const distance = Math.abs(Date.parse(event.date) - Date.parse(selectedDate))
      if (!best || distance < Math.abs(Date.parse(best.date) - Date.parse(selectedDate))) best = event
    }
    return best
  }, [events, selectedEvent, selectedDate])

  // Draw enough events to reach the target.
  const targetIndex = target ? listed.indexOf(target) : -1
  const limit = Math.max(shown, targetIndex + 1)

  useEffect(() => {
    if (!target) return
    list.current?.querySelector(`[data-event="${target.id}"]`)?.scrollIntoView({ block: 'center' })
  }, [target])

  // The mini calendar follows the event or day the list is at.
  const focus = target?.date ?? selectedDate ?? today
  const [miniMonth, setMiniMonth] = useState(() => monthOf(focus))
  const [shownFocus, setShownFocus] = useState(focus)
  if (focus !== shownFocus) {
    setShownFocus(focus)
    setMiniMonth(monthOf(focus))
  }

  // Past events grouped by month, in order.
  const months: { month: YearMonth; events: EventEntry[] }[] = []
  for (const event of listed.slice(0, limit)) {
    const month = monthOf(event.date)
    const last = months.at(-1)
    if (last && last.month.year === month.year && last.month.month === month.month) last.events.push(event)
    else months.push({ month, events: [event] })
  }

  const row = (event: EventEntry) => {
    const color = colorOf(event)
    const tally = eventTally(event, today)
    const highlighted = event.id === selectedEvent || (!selectedEvent && event.date === selectedDate)
    const fresh = canEdit ? newReplies(event).length : 0
    return (
      <li key={event.id}>
        <a
          href={eventHref(event.id)}
          data-event={event.id}
          aria-current={event.id === selectedEvent ? 'true' : undefined}
          className={cx('flex min-h-touch scroll-my-24 items-center gap-2 px-3 py-2 text-text no-underline hover:bg-surface-muted sm:gap-3 sm:px-4', highlighted && 'bg-accent-soft')}
        >
          <span className="w-9 shrink-0 leading-tight text-muted tabular-nums">
            <span className="block text-xs">{formatDate(event.date, { weekday: 'short' })}</span>
            <span className="block font-semibold whitespace-nowrap text-text">
              {formatDate(event.date, { day: 'numeric' })}
            </span>
          </span>
          <span className={cx('size-2.5 shrink-0 rounded-full', color ? optionDot[color] : 'bg-accent')} aria-hidden="true" />
          {/* Title and details get the whole width; the replies or attendance go under them on phones, at the right from sm. */}
          <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
            <span className="min-w-0 flex-1">
              <span className="block [overflow-wrap:anywhere]">
                {eventTitle(event, i18n)}
                {fresh > 0 && (
                  <span className="ml-2 inline-block rounded-full bg-accent-soft px-2 align-[1px] text-xs font-semibold whitespace-nowrap text-accent">
                    {t('replies.new', { count: fresh })}
                  </span>
                )}
              </span>
              <span className="block text-xs text-muted">
                {eventTime(event, i18n)}
                {privateLinks.has(event.id) && ` · ${t('replies.private')}`}
                <NoCallTag tally={tally} />
              </span>
            </span>
            <AttendanceBar tally={tally} total={total} className="shrink-0" />
          </span>
        </a>
      </li>
    )
  }

  const sectionTitle = 'border-b border-line bg-surface-muted px-4 py-1.5 text-xs font-semibold tracking-wide text-muted uppercase'

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div ref={list} className="min-w-0 space-y-3">
        {todayCard}
        {listed.length === 0 ? (
          <p className="py-8 text-center text-muted">{emptyText}</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-line bg-surface">
            {months.map(({ month, events: monthEvents }) => (
              <section key={`${month.year}-${month.month}`} aria-label={formatMonth(month)}>
                <h2 className={cx(sectionTitle, 'capitalize')}>{formatMonth(month)}</h2>
                <ul className="divide-y divide-line border-b border-line last:border-b-0">{monthEvents.map((event) => row(event))}</ul>
              </section>
            ))}
          </div>
        )}
        {listed.length > limit && (
          <button type="button" className={cx(button(), 'w-full')} onClick={() => setShown(limit + PAGE)}>
            {t('events.showOlder')}
          </button>
        )}
      </div>

      <aside className="rounded-xl border border-line bg-surface p-3 max-lg:hidden lg:sticky lg:top-24" aria-label={t('events.goToDate')}>
        <MiniMonth
          month={miniMonth}
          eventsByDate={byDate}
          selected={selectedDate}
          onSelect={onSelectDate}
          onOpenMonth={onOpenMonth}
          nav={
            <>
              <button type="button" className={cx(button(), 'min-h-8 w-8 px-0')} aria-label={t('calendar.prev')} onClick={() => setMiniMonth(addMonths(miniMonth, -1))}>
                <ChevronIcon direction="left" small />
              </button>
              <button type="button" className={cx(button(), 'min-h-8 w-8 px-0')} aria-label={t('calendar.next')} onClick={() => setMiniMonth(addMonths(miniMonth, 1))}>
                <ChevronIcon direction="right" small />
              </button>
            </>
          }
        />
      </aside>
    </div>
  )
}
