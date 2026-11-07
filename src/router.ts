import { useSyncExternalStore } from 'react'
import { isValidIso, isValidTime } from './domain/dates'
import type { EventId, IsoDate, PersonId, Time } from './domain/types'
import { dashboardPath, DEMO_REF, isValidPersonalRef, isValidRef, isValidReplyRef, type DashboardRef } from './storage/link'

/** Calendar display mode; the event list is the default and has no URL parameter. */
export type CalendarPeriod = { kind: 'month' } | { kind: 'day' } | { kind: 'year' } | { kind: 'range'; from?: IsoDate; to?: IsoDate }

/** Property filters as encoded in the URL (see domain/filters); decoded against the current properties. */
export interface ViewFilters {
  people?: string
  events?: string
}

export type DashboardView =
  | { tab: 'calendar'; date?: IsoDate; eventId?: EventId; period?: CalendarPeriod; filters?: ViewFilters }
  | { tab: 'people'; filters?: ViewFilters }
  // The sheet keeps the calendar period and filters so "back" returns to the same view.
  | { tab: 'sheet'; eventId: EventId; period?: CalendarPeriod; filters?: ViewFilters }
  // The roll call of an event, outside the app header; keeps the period and filters so leaving returns to the same list.
  | { tab: 'call'; eventId: EventId; period?: CalendarPeriod; filters?: ViewFilters }
  // A new event, not saved yet; becomes { tab: 'sheet' } at its first change.
  | { tab: 'draft'; date: IsoDate; start?: Time; period?: CalendarPeriod; filters?: ViewFilters }
  // A person's page; `from` is the event whose sheet led there, for the back link.
  | { tab: 'person'; personId: PersonId; from?: EventId; filters?: ViewFilters }
  // Statistics over a period; without dates the page uses its default (see domain/statPeriod).
  | { tab: 'stats'; page?: 'people'; from?: IsoDate; to?: IsoDate; filters?: ViewFilters }

export type Route =
  | { name: 'home' }
  | { name: 'invalid-link' }
  | { name: 'dashboard'; ref: DashboardRef; view: DashboardView }
  // A reply link: the share id and the key that decrypts it; `demo` for the demo's, which lives in this tab.
  | { name: 'reply'; shareId: string; key: string; demo?: true }
  // A personal link: the hub and its key, the person, and the secret that opens their entry and signs their replies.
  | { name: 'personal'; hubId: string; hubKey: string; personId: PersonId; secret: string }

/** Event and person ids: random base64url, or short names in the demo. */
const EVENT_ID = /^[A-Za-z0-9_-]{1,22}$/

/**
 * Hash routes:
 *   #/                               home
 *   #/d/:docId/:key                  event list (the share link)
 *   #/d/:docId/:key/date/:iso        event list or calendar, at a day
 *   #/d/:docId/:key/event/:id        event list or calendar, at an event
 *   #/d/:docId/:key/event/:id/edit   attendance sheet of an event
 *   #/d/:docId/:key/event/:id/call   roll call of an event
 *   #/d/:docId/:key/new/:iso        a new event on a day, not saved yet (`start` = clicked time)
 *   #/d/:docId/:key/people           people
 *   #/d/:docId/:key/person/:id       a person's page (`from` = the event it was opened from)
 *   #/d/:docId/:key/stats            statistics (`from`, `to` = the period)
 *   #/d/:docId/:key/stats/people     attendance of every person over the period
 *   #/v/:docId/:key…                 the read-only link: same sub-routes as #/d/
 *   #/r/:shareId/:key                reply to a shared event (see storage/link)
 *   #/p/:hubId/:hubKey/:personId/:secret   a person's own link, for every open event (see storage/link)
 *   #/demo…                          the same views on the in-browser demo
 *   #/demo/r/:shareId/:key           reply to the demo's shared event, in this tab
 * Query: `view=month|day|year|range` (+ `from`, `to`), people filter `f`, event filter `ef`, `start` (new event).
 */
export function parseRoute(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?')
  const parts = path.split('/').filter(Boolean)
  if (parts[0] === 'r') {
    const shareId = parts[1] ?? ''
    const key = parts[2] ?? ''
    return isValidReplyRef(shareId, key) ? { name: 'reply', shareId, key } : { name: 'invalid-link' }
  }
  if (parts[0] === 'p') {
    const [, hubId = '', hubKey = '', personId = '', secret = ''] = parts
    const ref = { hubId, hubKey, personId, secret }
    return parts.length === 5 && isValidPersonalRef(ref) ? { name: 'personal', ...ref } : { name: 'invalid-link' }
  }
  if (parts[0] === 'demo' && parts[1] === 'r') {
    const shareId = parts[2] ?? ''
    const key = parts[3] ?? ''
    return isValidReplyRef(shareId, key) ? { name: 'reply', shareId, key, demo: true } : { name: 'invalid-link' }
  }
  let ref: DashboardRef
  let rest: string[]
  if (parts[0] === 'demo') {
    ref = DEMO_REF
    rest = parts.slice(1)
  } else if (parts[0] === 'd' || parts[0] === 'v') {
    ref = { docId: parts[1] ?? '', key: parts[2] ?? '', access: parts[0] === 'd' ? 'edit' : 'read' }
    if (!isValidRef(ref)) return { name: 'invalid-link' }
    rest = parts.slice(3)
  } else {
    return { name: 'home' }
  }

  const params = new URLSearchParams(query)
  const filters = parseFilters(params)
  const withFilters = filters ? { filters } : {}
  const [section, id, action] = rest
  if (section === 'people') {
    const people = filters?.people
    return { name: 'dashboard', ref, view: { tab: 'people', ...(people && { filters: { people } }) } }
  }
  if (section === 'stats') {
    const valid = (value: string | null) => (value && isValidIso(value) ? value : undefined)
    const from = valid(params.get('from'))
    const to = valid(params.get('to'))
    return {
      name: 'dashboard',
      ref,
      view: { tab: 'stats', ...(id === 'people' && { page: 'people' as const }), ...(from && { from }), ...(to && { to }), ...withFilters },
    }
  }
  if (section === 'person' && id && EVENT_ID.test(id)) {
    const from = params.get('from')
    const events = filters?.events
    const view: DashboardView = {
      tab: 'person',
      personId: id,
      ...(from && EVENT_ID.test(from) && { from }),
      ...(events && { filters: { events } }),
    }
    return { name: 'dashboard', ref, view }
  }

  const period = parsePeriod(params)
  const withPeriod = period ? { period } : {}
  if (section === 'event' && id && EVENT_ID.test(id)) {
    const view: DashboardView =
      action === 'edit'
        ? { tab: 'sheet', eventId: id, ...withPeriod, ...withFilters }
        : action === 'call'
          ? { tab: 'call', eventId: id, ...withPeriod, ...withFilters }
          : { tab: 'calendar', eventId: id, ...withPeriod, ...withFilters }
    return { name: 'dashboard', ref, view }
  }
  if (section === 'new' && id && isValidIso(id)) {
    const start = params.get('start')
    return { name: 'dashboard', ref, view: { tab: 'draft', date: id, ...(start && isValidTime(start) && { start }), ...withPeriod, ...withFilters } }
  }
  if (section === 'date' && id && isValidIso(id)) {
    return { name: 'dashboard', ref, view: { tab: 'calendar', date: id, ...withPeriod, ...withFilters } }
  }
  return { name: 'dashboard', ref, view: { tab: 'calendar', ...withPeriod, ...withFilters } }
}

function parsePeriod(params: URLSearchParams): CalendarPeriod | undefined {
  const view = params.get('view')
  if (view === 'month') return { kind: 'month' }
  if (view === 'day') return { kind: 'day' }
  if (view === 'year') return { kind: 'year' }
  if (view !== 'range') return undefined
  const valid = (value: string | null) => (value && isValidIso(value) ? value : undefined)
  const from = valid(params.get('from'))
  const to = valid(params.get('to'))
  return { kind: 'range', ...(from && { from }), ...(to && { to }) }
}

function parseFilters(params: URLSearchParams): ViewFilters | undefined {
  const people = params.get('f') || undefined
  const events = params.get('ef') || undefined
  return people || events ? { ...(people && { people }), ...(events && { events }) } : undefined
}

function query(period: CalendarPeriod | undefined, filters: ViewFilters | undefined): string {
  const params = new URLSearchParams()
  if (period) params.set('view', period.kind)
  if (period?.kind === 'range' && period.from) params.set('from', period.from)
  if (period?.kind === 'range' && period.to) params.set('to', period.to)
  if (filters?.people) params.set('f', filters.people)
  if (filters?.events) params.set('ef', filters.events)
  const text = params.toString()
  return text ? `?${text}` : ''
}

export function viewPath(ref: DashboardRef, view: DashboardView): string {
  const base = dashboardPath(ref)
  switch (view.tab) {
    case 'people':
      return `${base}/people${query(undefined, view.filters?.people ? { people: view.filters.people } : undefined)}`
    case 'stats': {
      const params = new URLSearchParams()
      if (view.from) params.set('from', view.from)
      if (view.to) params.set('to', view.to)
      const filters = query(undefined, view.filters).slice(1)
      const text = [params.toString(), filters].filter(Boolean).join('&')
      return `${base}/stats${view.page ? `/${view.page}` : ''}${text ? `?${text}` : ''}`
    }
    case 'sheet':
      return `${base}/event/${view.eventId}/edit${query(view.period, view.filters)}`
    case 'call':
      return `${base}/event/${view.eventId}/call${query(view.period, view.filters)}`
    case 'draft': {
      const text = query(view.period, view.filters)
      if (!view.start) return `${base}/new/${view.date}${text}`
      return `${base}/new/${view.date}${text ? `${text}&` : '?'}start=${view.start}`
    }
    case 'person': {
      const events = query(undefined, view.filters?.events ? { events: view.filters.events } : undefined)
      const from = view.from ? `from=${view.from}` : ''
      const text = [events.slice(1), from].filter(Boolean).join('&')
      return `${base}/person/${view.personId}${text ? `?${text}` : ''}`
    }
    case 'calendar': {
      const target = view.eventId ? `/event/${view.eventId}` : view.date ? `/date/${view.date}` : ''
      return `${base}${target}${query(view.period, view.filters)}`
    }
  }
}

/** Goes to a route; `replace` updates the current history entry instead, e.g. while typing a filter. */
export function navigate(path: string, { replace = false }: { replace?: boolean } = {}): void {
  if (!replace) {
    window.location.hash = path
    return
  }
  const url = new URL(window.location.href)
  url.hash = path
  window.history.replaceState(window.history.state, '', url)
  // replaceState does not fire hashchange; the router listens to it.
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

const subscribe = (onChange: () => void) => {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

export function useHash(): string {
  // Prerendered pages are the home page, whose hash is empty.
  return useSyncExternalStore(subscribe, () => window.location.hash, () => '')
}
