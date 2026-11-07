import { useMemo, useState } from 'react'
import { monthOf, todayIso, type YearMonth } from '../domain/dates'
import { matchesFilter, readValue } from '../domain/filters'
import { matchesSearch } from '../domain/matching'
import { sortedOptions, sortedProperties } from '../domain/properties'
import { compareEvents, eventEntries, eventEntry, eventsByDate, type EventEntry } from '../domain/selectors'
import type { DashboardState, EventId, IsoDate, Mutation, Time } from '../domain/types'
import { useI18n } from '../i18n/context'
import { navigate, viewPath, type CalendarPeriod, type DashboardView } from '../router'
import type { DashboardRef } from '../storage/link'
import { useCanEdit } from './canEdit'
import { CalendarIcon, ListIcon, PlusIcon } from './components/icons'
import { button, cardFrame, cx, inputBase } from './components/styles'
import { DayPanel } from './DayPanel'
import { DayView } from './DayView'
import { EventListView } from './EventListView'
import { ListToolbar } from './ListToolbar'
import { MonthGrid } from './MonthGrid'
import { PropertiesDialog } from './properties/PropertiesDialog'
import { RangeView } from './RangeView'
import { TodayCard } from './TodayCard'
import { useEventColor } from './useEventColor'
import { useViewFilters } from './useViewFilters'
import { YearView } from './YearView'

type Mode = 'list' | CalendarPeriod['kind']
type CalendarView = Extract<DashboardView, { tab: 'calendar' }>

interface Props {
  dashboardRef: DashboardRef
  state: DashboardState
  view: CalendarView
  mutate: (mutation: Mutation) => void
}

const sameMonth = (a: YearMonth, b: YearMonth) => a.year === b.year && a.month === b.month

/** The text an event is searched by: its name and its property values. */
function searchText(state: DashboardState, event: EventEntry): string {
  const parts = [event.name ?? '']
  for (const [id, def] of Object.entries(state.eventProperties)) {
    const value = readValue(state.eventProperties, event.values, id)
    if (value === undefined) continue
    if (def.kind === 'choice' || def.kind === 'multi') {
      const ids = new Set(Array.isArray(value) ? value : [value])
      parts.push(...sortedOptions(def).filter((option) => ids.has(option.id)).map((option) => option.label))
    } else if (def.kind === 'text') parts.push(String(value))
  }
  return parts.join(' ')
}

/** The Events tab: a list by default, or a calendar (month, day, year or period) with the chosen day beside it. */
export function CalendarPage({ dashboardRef, state, view, mutate }: Props) {
  const { t } = useI18n()
  const canEdit = useCanEdit()
  const { period, filters } = view
  const { eventFilter, setEventFilter } = useViewFilters(state, dashboardRef, view)
  const colorOf = useEventColor(state)
  const [propertiesOpen, setPropertiesOpen] = useState(false)
  const [query, setQuery] = useState('')
  const today = todayIso()

  const selectedEvent = view.eventId ? eventEntry(state, view.eventId) : undefined
  const selected = selectedEvent?.date ?? view.date
  const mode: Mode = period?.kind ?? 'list'
  const isCalendar = mode !== 'list'

  // Every event matching the filter and the search, newest first.
  const allEvents = useMemo(
    () =>
      eventEntries(state)
        .filter((event) => matchesFilter(state.eventProperties, event.values, eventFilter))
        .filter((event) => !query.trim() || matchesSearch(searchText(state, event), query))
        .sort(compareEvents)
        .reverse(),
    [state, eventFilter, query],
  )
  const byDate = useMemo(() => eventsByDate(allEvents), [allEvents])

  // The calendar opens on the selected day, else today.
  const [month, setMonth] = useState(() => monthOf(selected ?? today))
  const [year, setYear] = useState(month.year)
  const [shownSelection, setShownSelection] = useState(selected)

  // Follow selections made elsewhere (list, links) to their month and year.
  if (selected !== shownSelection) {
    setShownSelection(selected)
    if (selected && !sameMonth(monthOf(selected), month)) setMonth(monthOf(selected))
    if (selected && monthOf(selected).year !== year) setYear(monthOf(selected).year)
  }

  // `next` is required: undefined means the list, so a default value would hide it.
  const go = (target: { date?: IsoDate; eventId?: EventId }, next: CalendarPeriod | undefined, replace = false) =>
    navigate(viewPath(dashboardRef, { tab: 'calendar', ...target, period: next, filters }), { replace })
  const select = (date: IsoDate) => go({ date }, period)
  const openMonth = (target: YearMonth) => {
    setMonth(target)
    go({ date: selected }, { kind: 'month' })
  }
  const create = (date: IsoDate, start?: Time) =>
    navigate(viewPath(dashboardRef, { tab: 'draft', date, ...(start && { start }), period, filters }))
  const openSheet = (eventId: EventId) => navigate(viewPath(dashboardRef, { tab: 'sheet', eventId, period, filters }))
  const eventHref = (eventId: EventId) => `#${viewPath(dashboardRef, { tab: 'sheet', eventId, period, filters })}`

  const changeMode = (next: Mode) => {
    if (next === 'list') go({ date: selected }, undefined)
    if (next === 'month') go({ date: selected }, { kind: 'month' })
    if (next === 'day') go({ date: selected ?? today }, { kind: 'day' })
    if (next === 'year') {
      setYear(month.year)
      go({ date: selected }, { kind: 'year' })
    }
    // A new period starts at the first event, so it covers everything by default.
    if (next === 'range') go({ date: selected }, { kind: 'range', from: allEvents.at(-1)?.date ?? today })
  }

  const range = period?.kind === 'range' ? period : undefined
  const dayDate = mode === 'day' ? (selected ?? today) : undefined
  // The day beside the calendar: today unless another one is chosen.
  const panelDate = selected ?? today

  const shownFrom = range?.from ?? allEvents.at(-1)?.date ?? today
  const latest = allEvents[0] && allEvents[0].date > today ? allEvents[0].date : today
  const shownTo = range?.to ?? (latest > shownFrom ? latest : shownFrom)
  const eventProperties = sortedProperties(state, 'event')
  const total = Object.keys(state.events).length

  const viewSelect = (
    <select
      className={cx(inputBase, 'min-h-9 py-1 text-sm')}
      aria-label={t('calendar.mode.label')}
      value={mode}
      onChange={(e) => changeMode(e.target.value as Mode)}
    >
      <option value="month">{t('calendar.mode.month')}</option>
      <option value="day">{t('calendar.mode.day')}</option>
      <option value="year">{t('calendar.mode.year')}</option>
      <option value="range">{t('calendar.mode.range')}</option>
    </select>
  )

  // Wide screens: both views side by side; phones: one button to the other view.
  const views = [
    { id: 'list', icon: <ListIcon />, label: t('events.view.list') },
    { id: 'calendar', icon: <CalendarIcon />, label: t('events.view.calendar') },
  ] as const
  const showView = (id: 'list' | 'calendar') => changeMode(id === 'list' ? 'list' : 'month')
  const other = views[isCalendar ? 0 : 1]
  const toggle = (
    <>
      <div className="inline-flex h-10 shrink-0 overflow-hidden rounded-md border border-line max-sm:hidden" role="group" aria-label={t('events.view.label')}>
        {views.map(({ id, icon, label }) => {
          const on = id === 'list' ? !isCalendar : isCalendar
          return (
            <button
              key={id}
              type="button"
              aria-pressed={on}
              className={cx(
                'inline-flex cursor-pointer items-center gap-2 px-3 text-sm font-medium [&+&]:border-l [&+&]:border-line',
                on ? 'bg-accent-soft text-accent' : 'bg-surface text-muted hover:text-text',
              )}
              onClick={() => !on && showView(id)}
            >
              {icon}
              {label}
            </button>
          )
        })}
      </div>
      <button type="button" className={cx(button(), 'w-10 shrink-0 px-0 sm:hidden')} aria-label={other.label} title={other.label} onClick={() => showView(other.id)}>
        {other.icon}
      </button>
    </>
  )

  return (
    <div className="space-y-4">
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        searchLabel={t('events.search')}
        filter={{
          properties: eventProperties,
          filter: eventFilter,
          onChange: setEventFilter,
          items: Object.values(state.events).map((event) => event.values),
          summary: t('filter.eventsShown', { count: allEvents.length, total }),
        }}
        actions={
          <>
            {toggle}
            {canEdit && (
              <button
                type="button"
                className={cx(button('primary'), 'shrink-0 px-3 max-sm:w-10 max-sm:px-0')}
                title={t('events.newLabel')}
                onClick={() => create(isCalendar ? (dayDate ?? panelDate) : today)}
              >
                <PlusIcon />
                <span className="max-sm:sr-only">{t('events.new')}</span>
              </button>
            )}
          </>
        }
        more={canEdit ? [{ label: t('events.propertiesMenu'), onSelect: () => setPropertiesOpen(true) }] : undefined}
        foldedSearch={{
          count: allEvents.length < total ? t('events.countOf', { count: allEvents.length, total }) : t('events.count', { count: total }),
        }}
      />

      {!isCalendar && (
        <EventListView
          state={state}
          events={allEvents}
          selectedEvent={view.eventId}
          selectedDate={view.date}
          colorOf={colorOf}
          eventHref={eventHref}
          onSelectDate={(date) => go({ date }, undefined, true)}
          onOpenMonth={openMonth}
          emptyText={total === 0 ? t(canEdit ? 'events.empty' : 'events.emptyRead') : t('events.noResults')}
          today={
            <TodayCard
              dashboardRef={dashboardRef}
              state={state}
              context={{ period: view.period, filters: view.filters }}
              onCreate={() => create(today)}
              onOpenSheet={openSheet}
              onSelectEvent={openSheet}
            />
          }
        />
      )}

      {isCalendar && (
        <div className={cx('grid grid-cols-1 items-start gap-4', !dayDate && 'lg:grid-cols-[minmax(0,1fr)_300px]')}>
          <div className="min-w-0 space-y-4">
            <section className={cx(cardFrame, 'p-3 sm:p-4')}>
              {mode === 'month' && (
                <MonthGrid
                  month={month}
                  onMonthChange={setMonth}
                  eventsByDate={byDate}
                  colorOf={colorOf}
                  selected={panelDate}
                  onSelect={select}
                  viewSelect={viewSelect}
                />
              )}
              {dayDate && (
                <DayView
                  state={state}
                  date={dayDate}
                  events={byDate.get(dayDate) ?? []}
                  selectedEvent={view.eventId}
                  onDateChange={(date) => go({ date }, period)}
                  onSelectEvent={openSheet}
                  onCreate={(start) => create(dayDate, start)}
                  viewSelect={viewSelect}
                />
              )}
              {mode === 'year' && (
                <YearView
                  year={year}
                  onYearChange={setYear}
                  eventsByDate={byDate}
                  selected={selected}
                  onSelect={select}
                  onOpenMonth={openMonth}
                  viewSelect={viewSelect}
                />
              )}
              {range && (
                <RangeView
                  from={range.from}
                  to={range.to}
                  onChange={(from, to) => go({ date: selected }, { kind: 'range', from, to })}
                  shownFrom={shownFrom}
                  shownTo={shownTo}
                  eventsByDate={byDate}
                  selected={selected}
                  onSelect={select}
                  onOpenMonth={openMonth}
                  viewSelect={viewSelect}
                />
              )}
            </section>
          </div>

          {!dayDate && (
            <DayPanel
              state={state}
              date={panelDate}
              events={byDate.get(panelDate) ?? []}
              selectedEvent={view.eventId}
              colorOf={colorOf}
              eventHref={eventHref}
              onCreate={() => create(panelDate)}
            />
          )}
        </div>
      )}

      <PropertiesDialog open={propertiesOpen} onClose={() => setPropertiesOpen(false)} scope="event" state={state} mutate={mutate} />
    </div>
  )
}
