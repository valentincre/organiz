import { describe, expect, it } from 'vitest'
import { parseRoute, viewPath, type DashboardView } from './router'
import { demoReplyPath } from './storage/link'

const DOC = 'A'.repeat(22)
const KEY = 'B'.repeat(43)
const ref = { docId: DOC, key: KEY, access: 'edit' as const }
const base = `#/d/${ref.docId}/${ref.key}`

describe('router', () => {
  it('parses the home page', () => {
    expect(parseRoute('')).toEqual({ name: 'home' })
    expect(parseRoute('#/')).toEqual({ name: 'home' })
    expect(parseRoute('#/unknown')).toEqual({ name: 'home' })
  })

  it('rejects truncated links', () => {
    expect(parseRoute(`#/d/${ref.docId}`)).toEqual({ name: 'invalid-link' })
    expect(parseRoute(base.slice(0, -3))).toEqual({ name: 'invalid-link' })
  })

  it('parses a read link', () => {
    expect(parseRoute(`#/v/${DOC}/${KEY}/event/e1`)).toEqual({
      name: 'dashboard',
      ref: { docId: DOC, key: KEY, access: 'read' },
      view: { tab: 'calendar', eventId: 'e1' },
    })
  })

  it('rejects a malformed read link', () => {
    expect(parseRoute(`#/v/${DOC}/short`)).toEqual({ name: 'invalid-link' })
  })

  it('parses a reply link', () => {
    expect(parseRoute(`#/r/${DOC}/${KEY}`)).toEqual({ name: 'reply', shareId: DOC, key: KEY })
    expect(parseRoute(`#/r/${DOC}/short`)).toEqual({ name: 'invalid-link' })
    expect(parseRoute(`#/r/${DOC}x/${KEY}`)).toEqual({ name: 'invalid-link' })
  })

  it('parses a demo reply link', () => {
    expect(parseRoute(`#/demo/r/${DOC}/${KEY}`)).toEqual({ name: 'reply', shareId: DOC, key: KEY, demo: true })
    expect(parseRoute(`#/demo/r/${DOC}/short`)).toEqual({ name: 'invalid-link' })
    expect(parseRoute(`#${demoReplyPath(DOC, KEY)}`)).toEqual({ name: 'reply', shareId: DOC, key: KEY, demo: true })
    // A real reply link is not the demo's.
    expect(parseRoute(`#/r/${DOC}/${KEY}`)).not.toHaveProperty('demo')
  })

  it('parses a personal link', () => {
    expect(parseRoute(`#/p/${DOC}/${KEY}/p1/${KEY}`)).toEqual({ name: 'personal', hubId: DOC, hubKey: KEY, personId: 'p1', secret: KEY })
    expect(parseRoute(`#/p/${DOC}/${KEY}/p1/short`)).toEqual({ name: 'invalid-link' })
    expect(parseRoute(`#/p/${DOC}/${KEY}/p1`)).toEqual({ name: 'invalid-link' })
    expect(parseRoute(`#/p/${DOC}x/${KEY}/p1/${KEY}`)).toEqual({ name: 'invalid-link' })
    expect(parseRoute(`#/p/${DOC}/${KEY}/a.b/${KEY}`)).toEqual({ name: 'invalid-link' })
  })

  it('round-trips every view', () => {
    const views: DashboardView[] = [
      { tab: 'calendar' },
      { tab: 'calendar', date: '2026-10-10' },
      { tab: 'sheet', eventId: 'ev_1' },
      { tab: 'calendar', eventId: 'ev_1', period: { kind: 'day' } },
      { tab: 'calendar', date: '2026-10-10', period: { kind: 'day' }, filters: { people: 'p1:o1|o2', events: 'p2~a%2Cb' } },
      { tab: 'people', filters: { people: 'p1*' } },
      { tab: 'people' },
      { tab: 'calendar', period: { kind: 'year' } },
      { tab: 'calendar', date: '2026-10-10', period: { kind: 'month' } },
      { tab: 'calendar', date: '2026-10-10', period: { kind: 'range', from: '2026-09-01' } },
      { tab: 'calendar', period: { kind: 'range', from: '2026-09-01', to: '2026-12-31' } },
      { tab: 'calendar', period: { kind: 'range' } },
      { tab: 'sheet', eventId: 'ev_1', period: { kind: 'year' }, filters: { events: 'p2!' } },
      { tab: 'call', eventId: 'ev_1' },
      { tab: 'call', eventId: 'ev_1', period: { kind: 'day' }, filters: { people: 'p1:o1', events: 'p2!' } },
      { tab: 'draft', date: '2026-10-14' },
      { tab: 'draft', date: '2026-10-14', start: '18:00', period: { kind: 'day' }, filters: { events: 'p2!' } },
      { tab: 'person', personId: 'pe_1' },
      { tab: 'person', personId: 'pe_1', from: 'ev_1' },
      { tab: 'person', personId: 'pe_1', from: 'ev_1', filters: { events: 'p2:o1' } },
      { tab: 'stats' },
      { tab: 'stats', from: '2026-01-01', to: '2026-06-30' },
      { tab: 'stats', from: '2026-01-01', filters: { people: 'p1:o1', events: 'p2!' } },
      { tab: 'stats', page: 'people' },
      { tab: 'stats', page: 'people', from: '2026-01-01', to: '2026-06-30', filters: { events: 'p2!' } },
    ]
    for (const view of views) {
      expect(parseRoute(`#${viewPath(ref, view)}`)).toEqual({ name: 'dashboard', ref, view })
    }
  })

  it('falls back to the calendar for unknown sections or bad dates', () => {
    const calendar = { name: 'dashboard', ref, view: { tab: 'calendar' } }
    expect(parseRoute(`${base}/nope`)).toEqual(calendar)
    expect(parseRoute(`${base}/date/2026-02-30`)).toEqual(calendar)
    expect(parseRoute(`${base}/person/bad!id`)).toEqual(calendar)
    expect(parseRoute(`${base}/person/pe_1?from=bad!id`)).toEqual({ name: 'dashboard', ref, view: { tab: 'person', personId: 'pe_1' } })
  })
})

describe('statistics route', () => {
  it('drops invalid dates', () => {
    expect(parseRoute(`${base}/stats?from=2027-13-01&to=2027-02-30`)).toEqual({ name: 'dashboard', ref, view: { tab: 'stats' } })
    expect(parseRoute(`${base}/stats/people?from=2027-01-01&to=x`)).toEqual({
      name: 'dashboard',
      ref,
      view: { tab: 'stats', page: 'people', from: '2027-01-01' },
    })
  })

  it('builds the paths', () => {
    expect(viewPath(ref, { tab: 'stats' })).toBe(`/d/${DOC}/${KEY}/stats`)
    expect(viewPath(ref, { tab: 'stats', page: 'people', from: '2026-01-01', to: '2026-02-01', filters: { people: 'p1*' } })).toBe(
      `/d/${DOC}/${KEY}/stats/people?from=2026-01-01&to=2026-02-01&f=p1*`,
    )
  })
})

describe('new event route', () => {
  it('drops an invalid start and falls back to the list for a bad date', () => {
    expect(parseRoute(`${base}/new/2026-10-14?start=25:00`)).toEqual({ name: 'dashboard', ref, view: { tab: 'draft', date: '2026-10-14' } })
    expect(parseRoute(`${base}/new/nope`)).toEqual({ name: 'dashboard', ref, view: { tab: 'calendar' } })
  })
})

describe('calendar period', () => {
  it('ignores invalid period parameters', () => {
    expect(parseRoute(`${base}?view=nope`)).toEqual({ name: 'dashboard', ref, view: { tab: 'calendar' } })
    expect(parseRoute(`${base}?view=range&from=2026-02-30&to=x`)).toEqual({
      name: 'dashboard',
      ref,
      view: { tab: 'calendar', period: { kind: 'range' } },
    })
  })
})

describe('demo routes', () => {
  it('parses and builds demo views', () => {
    const demo = { docId: 'demo', key: '', access: 'edit' as const }
    expect(parseRoute('#/demo')).toEqual({ name: 'dashboard', ref: demo, view: { tab: 'calendar' } })
    const views: DashboardView[] = [
      { tab: 'people' },
      { tab: 'sheet', eventId: 'ev_1', period: { kind: 'year' } },
      { tab: 'calendar', date: '2026-10-10' },
    ]
    for (const view of views) {
      const path = viewPath(demo, view)
      expect(path.startsWith('/demo')).toBe(true)
      expect(parseRoute(`#${path}`)).toEqual({ name: 'dashboard', ref: demo, view })
    }
  })
})
