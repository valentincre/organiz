import { describe, expect, it } from 'vitest'
import { addEvent, addPerson, compose, emptyState, setLeftOn, setReplies } from '../../domain/mutations'
import { cells, peopleStats, type Cell, type PersonStats } from '../../domain/stats'
import { addProperty, setValue } from '../../domain/properties'
import { en, type MessageKey } from '../../i18n/en'
import { fr } from '../../i18n/fr'
import { translate } from '../../i18n/translate'
import { attendanceBars, barScale, CHART_SHOWS, chartTitle, listedPeople, mostPresent, rateTone, sortPeopleRows, valueKindOf } from './statsView'

const row = (personId: string, present: number, expected: number): PersonStats => ({
  personId,
  expected,
  present,
  absent: expected - present,
  replied: 0,
  yesCalled: 0,
  keptWord: 0,
  yesThenAbsent: 0,
  cameWithoutReply: 0,
  strip: [],
})

const cell = (eventId: string, date: string, present: boolean): Cell => ({
  personId: 'a',
  eventId,
  date,
  present,
  replied: false,
  called: true,
})

describe('stats view', () => {
  const names: Record<string, string> = { a: 'Zoé', b: 'Adam', c: 'émile', d: 'Bea', e: 'Chloé', f: 'Yann' }
  const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true })

  const named = compose(...Object.entries(names).map(([id, name]) => addPerson(id, name)))(emptyState('Club'))

  it('previews the four highest rates, equal rates by name, like the people page', () => {
    const rows = [row('a', 3, 4), row('b', 3, 4), row('c', 0, 3), row('d', 1, 4), row('e', 2, 4), row('f', 4, 4)]
    expect(mostPresent(named, rows, collator).map((stats) => stats.personId)).toEqual(['f', 'b', 'a', 'e'])
    expect(mostPresent(named, rows, collator, rows.length)).toEqual(sortPeopleRows(named, rows, 'rate', collator))
  })

  it('previews everyone when there are fewer than four', () => {
    expect(mostPresent(named, [row('a', 1, 2)], collator)).toHaveLength(1)
  })

  it('lists everyone expected in the period, someone who left before it only when they have a record in it', () => {
    const january = new Date(2026, 0, 1, 12).getTime()
    const state = compose(
      addPerson('a', 'A', january),
      addPerson('b', 'B', january),
      addPerson('c', 'C', january),
      addPerson('d', 'D', january),
      addEvent('e', '2026-03-10', {}, january),
      setReplies('e', ['b'], 'yes'),
      setLeftOn('b', '2026-02-28'),
      setLeftOn('c', '2026-02-28'),
      setLeftOn('d', '2026-03-15'),
    )(emptyState('Club'))
    const period = { from: '2026-03-01', to: '2026-03-31' }
    const people = peopleStats(state, cells(state, period, { people: [], events: [] }, '2026-11-07'))
    // b left before March but still said yes to a March event: that counts everywhere, so b is listed.
    // c left before March with nothing in it: no cell, so not listed. d left during March.
    expect(listedPeople(people).map((stats) => stats.personId).sort()).toEqual(['a', 'b', 'd'])
  })

  it('reads rates as low, middling or high', () => {
    expect([0, 0.39, 0.4, 0.69, 0.7, 1].map(rateTone)).toEqual(['low', 'low', 'mid', 'mid', 'high', 'high'])
  })

  it('computes attendance per month with empty months, counting events', () => {
    const cells = [cell('e1', '2026-01-05', true), cell('e1', '2026-01-05', false), cell('e2', '2026-01-20', true), cell('e3', '2026-03-02', false)]
    expect(attendanceBars(cells, { from: '2026-01-01', to: '2026-03-31' })).toEqual([
      { start: '2026-01-01', value: 2 / 3, count: 2 },
      { start: '2026-02-01', value: null, count: 0 },
      { start: '2026-03-01', value: 0, count: 1 },
    ])
  })

  it('computes attendance per week for a period of a month or less', () => {
    // 2026-03-02 is a Monday.
    const bars = attendanceBars([cell('e1', '2026-03-04', true)], { from: '2026-03-01', to: '2026-03-14' })
    expect(bars.map((bar) => bar.start)).toEqual(['2026-02-23', '2026-03-02', '2026-03-09'])
    expect(bars[1]).toEqual({ start: '2026-03-02', value: 1, count: 1 })
  })

  describe('sorting the people page', () => {
    const state = compose(
      addProperty('person', 'level', 'number', 'Level'),
      addPerson('a', 'Zoé'),
      addPerson('b', 'Adam'),
      addPerson('c', 'Bea'),
      addPerson('d', 'Chloé'),
      setValue('person', 'a', 'level', 1),
      setValue('person', 'b', 'level', 3),
      setValue('person', 'c', 'level', 1),
    )(emptyState('Club'))
    const rows = [row('a', 2, 4), row('b', 1, 4), row('c', 2, 4), row('d', 4, 4)]
    const ids = (sort: string) => sortPeopleRows(state, rows, sort, collator).map((stats) => stats.personId)

    it('puts the highest rate first, equal rates by name', () => {
      expect(ids('rate')).toEqual(['d', 'c', 'a', 'b'])
    })

    it('sorts by name', () => {
      expect(ids('name')).toEqual(['b', 'c', 'd', 'a'])
    })

    it('sorts by a property, empty values last, equal values by name', () => {
      expect(ids('level')).toEqual(['c', 'a', 'b', 'd'])
    })

    it('falls back to the rate for an unknown property and leaves the input untouched', () => {
      expect(ids('gone')).toEqual(['d', 'c', 'a', 'b'])
      // An inherited key is not a property either.
      expect(ids('constructor')).toEqual(['d', 'c', 'a', 'b'])
      expect(rows.map((stats) => stats.personId)).toEqual(['a', 'b', 'c', 'd'])
    })
  })
  describe('composed charts', () => {
    it('reads rates as shares and everything else as counts', () => {
      expect(['rate', 'replyRate', 'present', 'absent', 'events', 'newcomers'].map((show) => valueKindOf(show as never))).toEqual([
        'rate',
        'rate',
        'count',
        'count',
        'count',
        'count',
      ])
    })

    it('scales rates to 100 % and counts to their largest value', () => {
      expect(barScale([0.2, null, 0.5], 'rate')).toBe(1)
      expect(barScale([3, null, 12, 7], 'count')).toBe(12)
    })

    it('never scales counts below 1, so empty or zero bars do not divide by zero', () => {
      expect(barScale([], 'count')).toBe(1)
      expect(barScale([null, 0], 'count')).toBe(1)
    })

    it('names every chart from its choices in both languages, unless it has its own name', () => {
      const state = addProperty('person', 'sport', 'choice', 'Sport')(emptyState('Club'))
      const t = (key: MessageKey, params?: Record<string, string | number>) => {
        expect(en[key]).toBeDefined()
        expect(fr[key]).toBeDefined()
        return translate('en', key, params)
      }
      for (const show of CHART_SHOWS) {
        for (const split of ['none', 'month', 'week', { person: 'sport' }] as const) {
          expect(chartTitle(t, state, { show, split })).not.toMatch(/[{}.]/)
        }
      }
      expect(chartTitle(t, state, { show: 'rate', split: { person: 'sport' } })).toBe('Attendance rate by Sport')
      expect(chartTitle(t, state, { show: 'rate', split: 'none', name: 'Mine' })).toBe('Mine')
    })

  })
})
