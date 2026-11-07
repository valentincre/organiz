import { describe, expect, it } from 'vitest'
import { countedCount, isCounted } from '../domain/attendance'
import { todayIso } from '../domain/dates'
import { newReplies } from '../domain/replies'
import { eventEntries, eventsByDate } from '../domain/selectors'
import { closesAtFor } from '../domain/shares'
import { chartData, isChartValid, sortedCharts } from '../domain/statCharts'
import { presetPeriod } from '../domain/statPeriod'
import { cells, overview } from '../domain/stats'
import { isDashboardState } from '../domain/validate'
import { buildDemoState } from './demoData'

describe('buildDemoState', () => {
  const state = buildDemoState('Demo', '2026-10-10')

  it('is a valid, deterministic dashboard', () => {
    expect(isDashboardState(state)).toBe(true)
    expect(buildDemoState('Demo', '2026-10-10')).toEqual(state)
    expect(Object.keys(state.people)).toHaveLength(30)
    expect(isDashboardState(buildDemoState('Démo', '2026-10-10', 'fr'))).toBe(true)
  })

  it('covers about a season up to today, plus one empty upcoming training', () => {
    const dates = eventEntries(state)
      .map((event) => event.date)
      .sort()
    expect(dates.length).toBeGreaterThan(40)
    expect(dates[0] >= '2025-11-01').toBe(true)
    // 2026-10-10 is a Saturday: the next training is on Wednesday the 14th.
    expect(dates.at(-1)).toBe('2026-10-14')
    expect(state.events.next.calledAt).toBeUndefined()
    expect(dates.some((d) => d >= '2026-07-15' && d <= '2026-08-20')).toBe(false)
  })

  it('has replies and a roll call on past events, except the last three, and only replies on the next one', () => {
    const past = eventEntries(state)
      .filter((event) => event.date <= '2026-10-10')
      .sort((a, b) => a.createdAt - b.createdAt)
    const called = past.filter((event) => event.calledAt !== undefined)
    expect(past.slice(-3).every((event) => event.calledAt === undefined)).toBe(true)
    expect(called).toHaveLength(past.length - 3)
    expect(past.slice(0, -3).every((event) => event.calledAt !== undefined)).toBe(true)
    // The call is made five minutes after the start, in the viewer's time zone.
    const first = called[0]
    const [year, month, day] = first.date.split('-').map(Number)
    const [hours, minutes] = (first.start ?? '').split(':').map(Number)
    expect(first.calledAt).toBe(new Date(year, month - 1, day, hours, minutes + 5).getTime())

    const everyone = Object.keys(state.people)
    const present = called.flatMap((event) => event.present ?? [])
    const saidYes = called.flatMap((event) => event.yes ?? [])
    // Most people who said yes came; some came without telling; some who said yes did not come.
    const yesAndPresent = called.reduce((total, event) => total + (event.yes ?? []).filter((id) => event.present?.includes(id)).length, 0)
    expect(yesAndPresent / saidYes.length).toBeGreaterThan(0.7)
    expect(yesAndPresent).toBeLessThan(saidYes.length)
    expect(present.length).toBeGreaterThan(yesAndPresent)
    expect(called.some((event) => (event.no ?? []).some((id) => event.present?.includes(id)))).toBe(true)
    for (const event of called) {
      expect(new Set([...(event.present ?? []), ...(event.absent ?? [])]).size).toBe((event.present?.length ?? 0) + (event.absent?.length ?? 0))
      expect([...(event.present ?? []), ...(event.absent ?? [])].every((id) => everyone.includes(id))).toBe(true)
    }

    const next = state.events.next
    expect(next.yes?.length).toBeGreaterThan(0)
    expect(next.no?.length).toBeGreaterThan(0)
    expect(next.present).toBeUndefined()
  })

  it('has named and timed events, a training series and days with two events', () => {
    const events = eventEntries(state)
    expect(events.every((event) => event.name && event.start && event.end)).toBe(true)
    expect(events.filter((event) => event.seriesId === 'trainings').length).toBeGreaterThan(20)
    expect([...eventsByDate(events).values()].some((day) => day.length === 2)).toBe(true)
  })

  it('fills in person and event properties', () => {
    const players = Object.values(state.people).filter((p) => p.values?.player === 'yes')
    expect(players.length).toBe(26)
    expect(players.every((p) => Array.isArray(p.values?.position) && typeof p.values?.license === 'number')).toBe(true)
    expect(Object.values(state.events).every((event) => event.values?.type)).toBe(true)
  })

  it('has two composed charts, two people who left, and newcomers in the last 12 months', () => {
    expect(isDashboardState(state)).toBe(true)
    expect(sortedCharts(state).map(({ show, split, people }) => ({ show, split, people }))).toEqual([
      { show: 'rate', split: { person: 'position' }, people: 'player:yes' },
      { show: 'events', split: { event: 'type' }, people: undefined },
    ])
    // The position chart has no "no value" bar: only players are counted, and they all have a position.
    const period = presetPeriod('last12Months', '2026-10-10')
    const scope = { people: [], events: [] }
    const byPosition = chartData(state, sortedCharts(state)[0], period, scope, '2026-10-10')
    expect(byPosition.kind === 'bars' && byPosition.bars.map((bar) => bar.key)).toEqual(['gk', 'def', 'mid', 'fwd'])
    expect(sortedCharts(state).every((chart) => isChartValid(state, chart))).toBe(true)

    const left = Object.entries(state.people).filter(([, person]) => person.leftOn)
    expect(left).toHaveLength(2)
    // Called up to their last day, never after.
    const calledDates = (id: string) =>
      eventEntries(state)
        .filter((event) => [...(event.present ?? []), ...(event.absent ?? [])].includes(id))
        .map((event) => event.date)
    for (const [id, person] of left) {
      expect(calledDates(id).some((date) => date <= person.leftOn!)).toBe(true)
      expect(calledDates(id).some((date) => date > person.leftOn!)).toBe(false)
    }

    const people = Object.values(state.people)
    // Everyone was added at a real date, not on 1 January 1970.
    expect(people.every((person) => todayIso(new Date(person.createdAt)) >= '2025-01-01')).toBe(true)
    const stats = overview(state, period, scope, '2026-10-10', cells(state, period, scope, '2026-10-10'))
    expect(stats.newcomers).toBe(4)
  })

  it('has varied attendance', () => {
    const counts = Object.values(state.events)
      .filter((event) => event.date <= '2026-10-10')
      .map((event) => countedCount(event))
    expect(Math.max(...counts) - Math.min(...counts)).toBeGreaterThan(5)
    const perPerson = Object.keys(state.people).map(
      (id) => Object.values(state.events).filter((event) => isCounted(event, id)).length,
    )
    expect(Math.max(...perPerson)).toBeGreaterThan(3 * Math.min(...perPerson))
  })

  it('opens a public link on the next event, with traced replies', () => {
    const state = buildDemoState('Demo', '2026-10-25', 'en', { id: 'd'.repeat(22), key: 'k'.repeat(43) })
    const [[id, share]] = Object.entries(state.shares!)
    expect(id).toBe('d'.repeat(22))
    expect(share).toMatchObject({ kind: 'presence', visibility: 'public', key: 'k'.repeat(43), autoClose: true, closed: false })
    const event = state.events[share.eventId]
    expect(event.date > '2026-10-25').toBe(true)
    // The first event after today.
    expect(eventEntries(state).filter((e) => e.date > '2026-10-25' && e.date < event.date)).toEqual([])
    expect(share.closesAt).toBe(closesAtFor('presence', event))
    expect(isDashboardState(state)).toBe(true)

    // Each existing answer came from the shared link, from its own demo device, before the newest fold.
    const answered = [...(event.yes ?? []), ...(event.no ?? [])].sort()
    expect(answered.length).toBeGreaterThan(0)
    expect(Object.keys(event.replyLog ?? {}).sort()).toEqual(answered)
    const traces = Object.values(event.replyLog!)
    expect(traces.every((trace) => trace.via === 'shared' && /^demo-\d+$/.test(trace.device ?? ''))).toBe(true)
    expect(new Set(traces.map((trace) => trace.device)).size).toBe(traces.length)
    expect(Math.max(...traces.map((trace) => trace.at ?? 0))).toBe(share.mergedUpTo)
    expect(traces.every((trace) => (trace.at ?? 0) > share.createdAt)).toBe(true)
    // Already seen: the row says "Replies open · Public", without new replies.
    expect(newReplies(event)).toEqual([])
    // Nothing else changes.
    const { shares: _shares, ...rest } = state
    const plain = buildDemoState('Demo', '2026-10-25', 'en')
    expect({ ...rest, events: { ...rest.events, next: { ...rest.events.next, replyLog: undefined, repliesSeenAt: undefined } } }).toEqual({
      ...plain,
      events: { ...plain.events, next: { ...plain.events.next, replyLog: undefined, repliesSeenAt: undefined } },
    })
  })

  it('has no reply link without one', () => {
    expect(state.shares).toBeUndefined()
    expect(Object.values(state.events).some((event) => event.replyLog)).toBe(false)
  })

  it('follows the current date', () => {
    const dates = Object.values(buildDemoState('Demo', '2027-03-01').events).map((event) => event.date)
    // 2027-03-01 is a Monday.
    expect(dates.sort().at(-1)).toBe('2027-03-03')
  })
})
