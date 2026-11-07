import { describe, expect, it } from 'vitest'
import { bigState } from './bigState.testing'
import { addEvent, addPerson, compose, emptyState, recordCall, setLeftOn, setReplies } from './mutations'
import {
  arrivals,
  bucketOf,
  bucketsOf,
  capPeriod,
  cells,
  expectedAt,
  isExpectedAt,
  isRecorded,
  MAX_PERIOD_MONTHS,
  noteFor,
  overview,
  peopleStats,
  personCells,
  seriesUnit,
  type PersonStats,
  type StatPeriod,
  type StatScope,
} from './stats'
import type { AppEvent, DashboardState, PersonId } from './types'

/** Local noon of a day, so the local date of `createdAt` is that day in any time zone. */
const at = (date: string): number => {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day, 12).getTime()
}

const EVERYONE: StatScope = { people: [], events: [] }
const YEAR: StatPeriod = { from: '2026-01-01', to: '2026-12-31' }
const TODAY = '2026-11-07'

const people = (...ids: PersonId[]) => compose(...ids.map((id) => addPerson(id, id.toUpperCase(), at('2026-01-01'))))
const ids = (set: Set<PersonId>) => [...set].sort()

describe('stats: who is expected', () => {
  it('records an event with a call or at least one reply', () => {
    const base: AppEvent = { date: '2026-10-01', name: '', createdAt: 0 }
    expect(isRecorded(base)).toBe(false)
    expect(isRecorded({ ...base, no: ['a'] })).toBe(true)
    expect(isRecorded({ ...base, calledAt: 1 })).toBe(true)
  })

  it('expects at a called event the people called and the people who replied, not the others', () => {
    const state = compose(
      people('a', 'b', 'c'),
      addEvent('e', '2026-10-10', {}, 1),
      recordCall('e', ['a'], [], 2),
      setReplies('e', ['c'], 'no'),
    )(emptyState('Club'))
    expect(ids(expectedAt(state, state.events.e, arrivals(state)))).toEqual(['a', 'c'])
  })

  it('expects at an uncalled event with replies every active person, leave date inclusive', () => {
    const state = compose(
      people('a', 'b', 'c', 'd'),
      addPerson('late', 'Late', at('2026-10-20')),
      addEvent('e', '2026-10-10', {}, 1),
      setReplies('e', ['a'], 'yes'),
      setLeftOn('b', '2026-10-09'),
      setLeftOn('c', '2026-10-10'),
    )(emptyState('Club'))
    expect(ids(expectedAt(state, state.events.e, arrivals(state)))).toEqual(['a', 'c', 'd'])
  })

  it('leaves an event with no call and no reply out of the rates but counts it as an event', () => {
    const state = compose(people('a'), addEvent('e', '2026-10-10', {}, 1))(emptyState('Club'))
    expect(expectedAt(state, state.events.e, arrivals(state)).size).toBe(0)
    const list = cells(state, YEAR, EVERYONE, TODAY)
    expect(list).toEqual([])
    expect(overview(state, YEAR, EVERYONE, TODAY, list)).toMatchObject({ pastEvents: 1, upcomingEvents: 0, expected: 0, rate: null })
  })

  it('dates an arrival back to a first reply or presence, never to an absent mark', () => {
    const state = compose(
      addPerson('yes', 'Yes', at('2026-11-10')),
      addPerson('absent', 'Absent', at('2026-11-10')),
      addEvent('e', '2026-09-05', {}, 1),
      setReplies('e', ['yes'], 'yes'),
      recordCall('e', [], ['absent'], 2),
    )(emptyState('Club'))
    const arrival = arrivals(state)
    expect(arrival.get('yes')).toBe('2026-09-05')
    expect(arrival.get('absent')).toBe('2026-11-10')
  })

  it('ignores an absent mark before the arrival, not a presence or a reply', () => {
    const state = compose(
      addPerson('newcomer', 'Newcomer', at('2026-11-02')),
      addPerson('present', 'Present', at('2026-11-02')),
      addPerson('replied', 'Replied', at('2026-11-02')),
      addEvent('e', '2026-09-05', {}, 1),
      recordCall('e', ['present'], ['newcomer', 'replied'], 2),
      setReplies('e', ['replied'], 'no'),
    )(emptyState('Club'))
    const arrival = arrivals(state)
    expect(arrival.get('newcomer')).toBe('2026-11-02')
    expect(ids(expectedAt(state, state.events.e, arrival))).toEqual(['present', 'replied'])
    expect(cells(state, YEAR, EVERYONE, TODAY).map((cell) => cell.personId).sort()).toEqual(['present', 'replied'])
  })

  it('counts an absent mark from the arrival day on', () => {
    const state = compose(
      addPerson('a', 'A', at('2026-11-02')),
      addEvent('on', '2026-11-02', {}, 1),
      addEvent('after', '2026-11-05', {}, 2),
      recordCall('on', [], ['a'], 3),
      recordCall('after', [], ['a'], 4),
    )(emptyState('Club'))
    const arrival = arrivals(state)
    expect(ids(expectedAt(state, state.events.on, arrival))).toEqual(['a'])
    expect(ids(expectedAt(state, state.events.after, arrival))).toEqual(['a'])
  })

  it('ignores an absent mark after the leave date, counting it on the leave day', () => {
    const state = compose(
      people('a'),
      setLeftOn('a', '2026-10-01'),
      addEvent('on', '2026-10-01', {}, 1),
      addEvent('after', '2026-10-20', {}, 2),
      recordCall('on', [], ['a'], 3),
      recordCall('after', [], ['a'], 4),
    )(emptyState('Club'))
    const arrival = arrivals(state)
    expect(ids(expectedAt(state, state.events.on, arrival))).toEqual(['a'])
    expect(ids(expectedAt(state, state.events.after, arrival))).toEqual([])
  })

  it('expects a person present at a called event after their leave date', () => {
    const state = compose(
      people('a'),
      setLeftOn('a', '2026-10-01'),
      addEvent('e', '2026-10-20', {}, 1),
      recordCall('e', ['a'], [], 2),
    )(emptyState('Club'))
    expect(cells(state, YEAR, EVERYONE, TODAY)).toEqual([
      { personId: 'a', eventId: 'e', date: '2026-10-20', present: true, replied: false, called: true },
    ])
  })

  it('ignores ids of people who no longer exist', () => {
    const state: DashboardState = {
      ...people('a')(emptyState('Club')),
      events: { e: { date: '2026-10-20', name: '', createdAt: 1, calledAt: 2, present: ['a', 'ghost'], yes: ['ghost'] } },
    }
    expect(ids(expectedAt(state, state.events.e, arrivals(state)))).toEqual(['a'])
    expect(cells(state, YEAR, EVERYONE, TODAY).map((cell) => cell.personId)).toEqual(['a'])
  })

  it('keeps the events and people of the period and the scope only', () => {
    const state: DashboardState = {
      ...compose(
        people('a', 'b'),
        addEvent('match', '2026-10-01', { values: { kind: 'm' } }, 1),
        addEvent('training', '2026-10-02', { values: { kind: 't' } }, 2),
        addEvent('before', '2025-12-31', { values: { kind: 'm' } }, 3),
        addEvent('future', '2026-11-20', { values: { kind: 'm' } }, 4),
        setReplies('match', ['a', 'b'], 'yes'),
        setReplies('training', ['a', 'b'], 'yes'),
        setReplies('before', ['a', 'b'], 'yes'),
        setReplies('future', ['a', 'b'], 'yes'),
      )(emptyState('Club')),
      personProperties: { team: { kind: 'choice', name: 'Team', order: 0, options: { red: { label: 'Red', order: 0, color: 'red' } } } },
      eventProperties: {
        kind: {
          kind: 'choice',
          name: 'Kind',
          order: 0,
          options: { m: { label: 'Match', order: 0, color: 'blue' }, t: { label: 'Training', order: 1, color: 'green' } },
        },
      },
    }
    state.people.a = { ...state.people.a, values: { team: 'red' } }
    const scope: StatScope = {
      people: [{ type: 'options', propertyId: 'team', optionIds: ['red'] }],
      events: [{ type: 'options', propertyId: 'kind', optionIds: ['m'] }],
    }
    expect(cells(state, YEAR, scope, TODAY).map((cell) => `${cell.eventId}:${cell.personId}`)).toEqual(['match:a'])
    expect(overview(state, YEAR, scope, TODAY, cells(state, YEAR, scope, TODAY))).toMatchObject({ pastEvents: 1, upcomingEvents: 1 })
  })
})

describe('stats: people and global numbers', () => {
  const state = compose(
    people('a', 'b'),
    addEvent('yesAbsent', '2026-10-01', {}, 1),
    setReplies('yesAbsent', ['a'], 'yes'),
    recordCall('yesAbsent', ['b'], ['a'], 2),
    addEvent('noReply', '2026-10-08', {}, 3),
    recordCall('noReply', ['a', 'b'], [], 4),
    addEvent('uncalled', '2026-10-15', {}, 5),
    setReplies('uncalled', ['a'], 'yes'),
  )(emptyState('Club'))

  it('counts the word kept and the arrivals without a reply on called events only', () => {
    const stats = peopleStats(state, cells(state, YEAR, EVERYONE, TODAY))
    expect(stats.get('a')).toEqual({
      personId: 'a',
      expected: 3,
      present: 2,
      absent: 1,
      replied: 2,
      yesCalled: 1,
      keptWord: 0,
      yesThenAbsent: 1,
      cameWithoutReply: 1,
      strip: [
        { eventId: 'yesAbsent', date: '2026-10-01', present: false },
        { eventId: 'noReply', date: '2026-10-08', present: true },
        { eventId: 'uncalled', date: '2026-10-15', present: true },
      ],
    })
    // b: present at both calls without a reply, absent at the uncalled event.
    expect(stats.get('b')).toMatchObject({ expected: 3, present: 2, absent: 1, replied: 0, cameWithoutReply: 2 })
  })

  it('sums the period into the four numbers', () => {
    const late = compose(addPerson('c', 'C', at('2026-10-20')), setLeftOn('b', '2026-10-31'))(state)
    const list = cells(late, YEAR, EVERYONE, TODAY)
    expect(overview(late, YEAR, EVERYONE, TODAY, list)).toEqual({
      expected: 6,
      present: 4,
      absences: 2,
      rate: 4 / 6,
      pastEvents: 3,
      upcomingEvents: 0,
      newcomers: 3,
      total: 2,
    })
    // No past event: the total is the people active at the end of the period.
    const november: StatPeriod = { from: '2026-11-01', to: '2026-11-30' }
    expect(overview(late, november, EVERYONE, TODAY, cells(late, november, EVERYONE, TODAY))).toMatchObject({ total: 2, newcomers: 0 })
  })

  it('has no rate on a period with only upcoming events', () => {
    const future = compose(addEvent('next', '2026-12-01', {}, 9), setReplies('next', ['a'], 'yes'))(state)
    const period: StatPeriod = { from: '2026-11-08', to: '2026-12-31' }
    const result = overview(future, period, EVERYONE, TODAY, cells(future, period, EVERYONE, TODAY))
    expect(result).toMatchObject({ rate: null, expected: 0, pastEvents: 0, upcomingEvents: 1 })
  })
})

describe('stats: time buckets', () => {
  it('uses weeks up to 31 days and months beyond', () => {
    expect(seriesUnit({ from: '2026-10-01', to: '2026-10-31' })).toBe('week')
    expect(seriesUnit({ from: '2026-10-01', to: '2026-11-01' })).toBe('month')
  })

  it('lists every month or week overlapping the period', () => {
    expect(bucketsOf({ from: '2026-09-15', to: '2026-12-02' }, 'month')).toEqual(['2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01'])
    expect(bucketsOf({ from: '2026-11-04', to: '2026-11-16' }, 'week')).toEqual(['2026-11-02', '2026-11-09', '2026-11-16'])
    expect(bucketsOf({ from: '2026-11-04', to: '2026-11-01' }, 'month')).toEqual([])
  })

  it('caps a period to its last 120 calendar months, so buckets stay bounded', () => {
    expect(capPeriod({ from: '1000-01-01', to: '9999-12-31' })).toEqual({ from: '9990-01-01', to: '9999-12-31' })
    // Exactly 120 months stay; one day more moves `from` to the first day of the first month kept.
    expect(capPeriod({ from: '2016-12-01', to: '2026-11-30' })).toEqual({ from: '2016-12-01', to: '2026-11-30' })
    expect(capPeriod({ from: '2016-11-30', to: '2026-11-30' })).toEqual({ from: '2016-12-01', to: '2026-11-30' })
    // The earliest month kept would be before year 1000: nothing to cut.
    expect(capPeriod({ from: '1000-01-01', to: '1005-06-15' })).toEqual({ from: '1000-01-01', to: '1005-06-15' })
    expect(bucketsOf({ from: '1000-01-01', to: '9999-12-31' }, 'month')).toHaveLength(MAX_PERIOD_MONTHS)
    const weeks = bucketsOf({ from: '1000-01-01', to: '9999-12-31' }, 'week')
    expect(weeks[0]).toBe(bucketOf('9990-01-01', 'week'))
    expect(weeks.length).toBeLessThanOrEqual(523)
  })

  it('finds the bucket of a day, weeks starting on Monday', () => {
    expect(bucketOf('2026-11-08', 'week')).toBe('2026-11-02')
    expect(bucketOf('2026-11-02', 'week')).toBe('2026-11-02')
    expect(bucketOf('2026-11-08', 'month')).toBe('2026-11-01')
  })
})

describe('stats: notes under a name', () => {
  const period: StatPeriod = { from: '2026-09-01', to: '2026-10-31' }
  const stats = (fields: Partial<PersonStats>): PersonStats => ({
    personId: 'a',
    expected: 10,
    present: 7,
    absent: 3,
    replied: 10,
    yesCalled: 0,
    keptWord: 0,
    yesThenAbsent: 0,
    cameWithoutReply: 0,
    strip: [],
    ...fields,
  })
  const person = { name: 'A', createdAt: 0 }

  it('says first that the person left during the period', () => {
    expect(noteFor({ ...person, leftOn: '2026-10-15' }, '2026-01-01', stats({ yesThenAbsent: 4 }), period)).toEqual({ kind: 'left', date: '2026-10-15' })
  })

  it('then the arrival, the yes then absent, the rare replies and the perfect record', () => {
    expect(noteFor({ ...person, leftOn: '2026-11-15' }, '2026-09-10', stats({}), period)).toEqual({ kind: 'arrived', date: '2026-09-10' })
    // Arrived on the period's first day: a newcomer of the period, like in the overview.
    expect(noteFor(person, '2026-09-01', stats({ yesThenAbsent: 3 }), period)).toEqual({ kind: 'arrived', date: '2026-09-01' })
    expect(noteFor(person, '2026-08-31', stats({ yesThenAbsent: 3 }), period)).toEqual({ kind: 'yesThenAbsent', count: 3 })
    expect(noteFor(person, '2026-01-01', stats({ yesThenAbsent: 2, replied: 4 }), period)).toEqual({ kind: 'rarelyReplies' })
    expect(noteFor(person, '2026-01-01', stats({ present: 10, absent: 0 }), period)).toEqual({ kind: 'neverAbsent' })
    expect(noteFor(person, '2026-01-01', stats({ replied: 5 }), period)).toBeNull()
  })
})

describe('stats: volume', () => {
  it('computes 200 people × 300 events quickly', () => {
    const state = bigState()
    const period: StatPeriod = { from: '2025-01-01', to: '2026-12-31' }
    const start = performance.now()
    const arrival = arrivals(state)
    const list = cells(state, period, EVERYONE, TODAY, arrival)
    peopleStats(state, list)
    overview(state, period, EVERYONE, TODAY, list, arrival)
    expect(performance.now() - start).toBeLessThan(200)
    expect(list.length).toBeGreaterThan(30_000)
  })

  it('expects one person by the same rule as the whole group', () => {
    const state = bigState(40, 60)
    const arrival = arrivals(state)
    for (const [eventId, event] of Object.entries(state.events)) {
      const group = expectedAt(state, event, arrival)
      for (const id of [...Object.keys(state.people), 'ghost']) {
        expect(isExpectedAt(state, event, id, arrival.get(id)), `${id} at ${eventId}`).toBe(group.has(id))
      }
    }
  })

  it("gives one person's cells over every past event, as the group's cells do", () => {
    const state = bigState(40, 60)
    const ever: StatPeriod = { from: '1900-01-01', to: TODAY }
    const all = cells(state, ever, EVERYONE, TODAY)
    for (const id of Object.keys(state.people)) {
      expect(personCells(state, id, TODAY)).toEqual(all.filter((cell) => cell.personId === id))
    }
  })

  it('takes the same arrivals whether they are passed or computed', () => {
    const state = bigState(40, 60)
    const arrival = arrivals(state)
    expect(cells(state, YEAR, EVERYONE, TODAY, arrival)).toEqual(cells(state, YEAR, EVERYONE, TODAY))
    const list = cells(state, YEAR, EVERYONE, TODAY)
    expect(overview(state, YEAR, EVERYONE, TODAY, list, arrival)).toEqual(overview(state, YEAR, EVERYONE, TODAY, list))
  })
})
