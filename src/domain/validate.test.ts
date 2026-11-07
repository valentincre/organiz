import { describe, expect, it } from 'vitest'
import { LIMITS } from './limits'
import { addEvent, addPerson, compose, emptyState, setReplies } from './mutations'
import { addProperty, setValue } from './properties'
import { isDashboardState, isNewerVersion } from './validate'

const valid = compose(
  addPerson('a1', 'Alice'),
  addEvent('e1', '2026-10-10', { name: 'Training', start: '18:00', end: '19:30', seriesId: 's1' }),
  setReplies('e1', ['a1'], 'yes'),
  addProperty('person', 'p1', 'choice', 'Joueur', [{ id: 'o1', label: 'Oui', color: 'green' }]),
  addProperty('event', 'p2', 'text', 'Notes'),
  setValue('person', 'a1', 'p1', 'o1'),
  setValue('event', 'e1', 'p2', 'Line 1\nLine 2'),
)(emptyState('Club'))

const withEvent = (patch: object) => ({ ...valid, events: { e1: { ...valid.events.e1, ...patch } } })

describe('isDashboardState', () => {
  it('accepts a valid state', () => {
    expect(isDashboardState(valid)).toBe(true)
  })

  it('rejects malformed data', () => {
    expect(isDashboardState(null)).toBe(false)
    expect(isDashboardState({ ...valid, v: 1 })).toBe(false)
    expect(isDashboardState({ ...valid, name: '' })).toBe(false)
    expect(isDashboardState({ ...valid, personProperties: undefined })).toBe(false)
    expect(isDashboardState(withEvent({ date: 'not-a-date' }))).toBe(false)
    expect(isDashboardState(withEvent({ yes: [42] }))).toBe(false)
    expect(isDashboardState(withEvent({ start: '25:00' }))).toBe(false)
    expect(isDashboardState(withEvent({ start: '10:00', end: '09:00' }))).toBe(false)
    expect(isDashboardState({ ...valid, people: { a1: { name: 'Alice' } } })).toBe(false)
    expect(isDashboardState({ ...valid, eventProperties: { p2: { kind: 'color', name: 'X', order: 0 } } })).toBe(false)
    expect(
      isDashboardState({
        ...valid,
        personProperties: { p1: { kind: 'choice', name: 'X', order: 0, options: { o1: { label: 'Oui', order: 0, color: 'neon' } } } },
      }),
    ).toBe(false)
  })

  it('rejects the previous schema version', () => {
    expect(isDashboardState({ ...valid, v: 2 })).toBe(false)
  })

  it('checks the reply and presence lists and the time of the call', () => {
    const called = withEvent({ no: ['a1'], yes: undefined, calledAt: 5, present: ['a1'], absent: [] })
    expect(isDashboardState(called)).toBe(true)
    for (const key of ['yes', 'no', 'present', 'absent']) {
      expect(isDashboardState(withEvent({ [key]: [42] }))).toBe(false)
      expect(isDashboardState(withEvent({ [key]: 'a1' }))).toBe(false)
      expect(isDashboardState(withEvent({ [key]: ['a1', 'a1'] }))).toBe(false)
      expect(isDashboardState(withEvent({ [key]: ['constructor'] }))).toBe(false)
    }
    expect(isDashboardState(withEvent({ calledAt: 'now' }))).toBe(false)
    expect(isDashboardState(withEvent({ calledAt: Number.NaN }))).toBe(false)
  })

  it('tolerates values whose property no longer exists', () => {
    expect(isDashboardState({ ...valid, personProperties: {} })).toBe(true)
  })

  it('rejects ids that would shadow Object.prototype members', () => {
    for (const id of ['constructor', 'toString', '__proto__', 'a b']) {
      const people = JSON.parse(`{"${id}": {"name": "X", "createdAt": 0}}`)
      expect(isDashboardState({ ...valid, people, events: {} })).toBe(false)
    }
  })

  it('rejects data beyond the limits', () => {
    expect(isDashboardState({ ...valid, name: 'x'.repeat(LIMITS.dashboardName + 1) })).toBe(false)
    expect(isDashboardState(withEvent({ name: 'x'.repeat(LIMITS.eventName + 1) }))).toBe(false)
    expect(isDashboardState(withEvent({ values: { p2: 'x'.repeat(LIMITS.textValue + 1) } }))).toBe(false)
    const people = Object.fromEntries(
      Array.from({ length: LIMITS.people + 1 }, (_, i) => [`p${i}`, { name: 'X', createdAt: 0 }]),
    )
    expect(isDashboardState({ ...valid, people })).toBe(false)
  })
})

describe('leave date and stat charts', () => {
  const chart = { show: 'rate', split: 'none', order: 0 }
  const withCharts = (statCharts: unknown) => ({ ...valid, statCharts })
  const withPerson = (patch: object) => ({ ...valid, people: { a1: { ...valid.people.a1, ...patch } } })

  it('accepts and rejects the leave date', () => {
    expect(isDashboardState(withPerson({ leftOn: '2027-01-15' }))).toBe(true)
    expect(isDashboardState(withPerson({ leftOn: '2027-13-01' }))).toBe(false)
    expect(isDashboardState(withPerson({ leftOn: 5 }))).toBe(false)
  })

  it('accepts every show value and split shape', () => {
    for (const show of ['rate', 'present', 'absent', 'replyRate', 'events', 'newcomers']) {
      expect(isDashboardState(withCharts({ c1: { ...chart, show } }))).toBe(true)
    }
    for (const split of ['none', 'month', 'week', { person: 'p1' }, { event: 'p2' }]) {
      expect(isDashboardState(withCharts({ c1: { ...chart, split } }))).toBe(true)
    }
    expect(isDashboardState(withCharts({ c1: { ...chart, name: 'Mine', people: 'a=b', events: 'c=d' } }))).toBe(true)
  })

  it('rejects malformed charts', () => {
    expect(isDashboardState(withCharts({ c1: { ...chart, show: 'other' } }))).toBe(false)
    expect(isDashboardState(withCharts({ c1: { ...chart, split: { person: 'constructor' } } }))).toBe(false)
    expect(isDashboardState(withCharts({ c1: { ...chart, split: { event: 5 } } }))).toBe(false)
    expect(isDashboardState(withCharts({ c1: { ...chart, order: NaN } }))).toBe(false)
    expect(isDashboardState(withCharts({ c1: { ...chart, name: 'x'.repeat(LIMITS.chartName + 1) } }))).toBe(false)
    expect(isDashboardState(withCharts({ c1: { ...chart, people: 'x'.repeat(LIMITS.encodedFilter + 1) } }))).toBe(false)
    expect(isDashboardState(withCharts({ c1: { ...chart, events: 5 } }))).toBe(false)
    const many = Object.fromEntries(Array.from({ length: LIMITS.statCharts + 1 }, (_, i) => [`c${i}`, chart]))
    expect(isDashboardState(withCharts(many))).toBe(false)
  })
})

describe('reply links state', () => {
  const share = { eventId: 'e1', kind: 'presence', key: 'k'.repeat(43), visibility: 'public', autoClose: true, closesAt: 1, closed: false, createdAt: 1, mergedUpTo: 0 }

  it('accepts shares, organizer keys and reply traces', () => {
    const state = withEvent({ replyLog: { p1: { via: 'shared', at: 2, device: 'd1', others: [{ answer: 'no', at: 1, device: 'd2' }] } }, repliesSeenAt: 3 })
    expect(isDashboardState({ ...state, shares: { s1: share }, organizerKeys: { publicKey: '{}', privateKey: '{}' } })).toBe(true)
  })

  it('accepts a hub, personal links and a finished call link', () => {
    const link = { secret: 's'.repeat(43), createdAt: 1 }
    const state = { ...valid, hub: { id: 'h'.repeat(22), key: 'k'.repeat(43) }, personalLinks: { a1: link }, shares: { s1: { ...share, kind: 'call', finished: true } } }
    expect(isDashboardState(state)).toBe(true)
  })

  it('rejects a malformed hub, personal link or finished flag', () => {
    const link = { secret: 's'.repeat(43), createdAt: 1 }
    const hub = { id: 'h'.repeat(22), key: 'k'.repeat(43) }
    for (const bad of [
      { hub: { ...hub, id: 'short' } },
      { hub: { ...hub, key: 'short' } },
      { personalLinks: { a1: { ...link, secret: 'short' } } },
      { personalLinks: { a1: { ...link, createdAt: 'x' } } },
      { personalLinks: { ghost: link } },
      { personalLinks: { constructor: link } },
      { shares: { s1: { ...share, finished: false } } },
    ]) {
      expect(isDashboardState({ ...valid, ...bad })).toBe(false)
    }
    const one = { ...emptyState('x'), people: { a1: valid.people.a1 } }
    expect(isDashboardState({ ...one, personalLinks: { a1: link, a2: link } })).toBe(false) // more links than people
  })

  it('rejects a malformed share', () => {
    for (const bad of [{ ...share, kind: 'other' }, { ...share, key: 'short' }, { ...share, closesAt: 'soon' }, { ...share, eventId: 'constructor' }]) {
      expect(isDashboardState({ ...emptyState('x'), shares: { s1: bad } })).toBe(false)
    }
  })

  it('rejects a trace for an unknown via or with too many others', () => {
    const others = Array.from({ length: 6 }, (_, i) => ({ answer: 'yes', at: i, device: 'd' }))
    expect(isDashboardState(withEvent({ replyLog: { p1: { via: 'mail', at: 1 } } }))).toBe(false)
    expect(isDashboardState(withEvent({ replyLog: { p1: { via: 'shared', at: 1, device: 'd', others } } }))).toBe(false)
  })

  it('accepts a trimmed trace, with only where the reply came from', () => {
    expect(isDashboardState(withEvent({ replyLog: { p1: { via: 'shared' } } }))).toBe(true)
    expect(isDashboardState(withEvent({ replyLog: { p1: { via: 'shared', at: '1' } } }))).toBe(false)
  })

  it("accepts a trace's sentAt only when it is a finite number", () => {
    expect(isDashboardState(withEvent({ replyLog: { p1: { via: 'personal', at: 2, device: 'd', sentAt: 1 } } }))).toBe(true)
    expect(isDashboardState(withEvent({ replyLog: { p1: { via: 'hand', at: 2, sentAt: 1 } } }))).toBe(true)
    for (const sentAt of ['1', null, Infinity]) {
      expect(isDashboardState(withEvent({ replyLog: { p1: { via: 'personal', at: 2, device: 'd', sentAt } } }))).toBe(false)
    }
  })
})

describe('isNewerVersion', () => {
  it('detects data written by a newer build', () => {
    expect(isNewerVersion({ v: 4 })).toBe(true)
    expect(isNewerVersion({ v: 3 })).toBe(false)
    expect(isNewerVersion(valid)).toBe(false)
    expect(isNewerVersion('v3')).toBe(false)
  })
})
