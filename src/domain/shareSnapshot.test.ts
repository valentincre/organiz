import { describe, expect, it } from 'vitest'
import { LIMITS } from './limits'
import { addEvent, addPerson, compose, emptyState, renamePerson, setLeftOn, setReply } from './mutations'
import { addProperty, setValue } from './properties'
import type { IncomingReply } from './replies'
import { createPersonalLink } from './personalLinks'
import { addShare, setOrganizerKeys } from './shares'
import { buildSnapshot, isShareSnapshot, snapshotAnswers, snapshotPresent, type ShareSnapshot } from './shareSnapshot'

const KEY = 'A'.repeat(43)
const JWK = JSON.stringify({ kty: 'EC', crv: 'P-256', x: 'x', y: 'y' })

const base = compose(
  addPerson('p1', 'Bob', 1),
  addPerson('p2', 'Zoe', 2),
  addEvent('e1', '2026-10-23', { name: 'Training', start: '18:00', end: '19:30' }, 1),
  addProperty('event', 'a', 'text', 'Place', [], 1),
  addProperty('event', 'b', 'text', 'Notes', [], 2),
  addProperty('event', 'c', 'text', 'Bring', [], 3),
  setValue('event', 'e1', 'c', 'Shoes'),
  setValue('event', 'e1', 'a', 'Gym'),
  setReply('e1', 'p1', 'yes'),
)(emptyState('Club'))
const open = (visibility: 'public' | 'private') =>
  compose(addShare('s1', { eventId: 'e1', kind: 'presence', key: KEY, visibility, autoClose: false }, 1))(base)
const publicState = open('public')
const privateState = setOrganizerKeys({ publicKey: JWK, privateKey: JWK })(open('private'))

const reply = (createdAt: number, personId: string, answer: IncomingReply['answer'], id = `r${createdAt}`): IncomingReply => ({
  id,
  shareId: 's1',
  createdAt,
  personId,
  answer,
  device: 'd1',
  via: 'shared',
})

describe('buildSnapshot', () => {
  it('builds names only, sorted, from the current people', () => {
    const snap = buildSnapshot(renamePerson('p2', 'Aline')(publicState), 's1', 'fr')!
    expect(snap.people).toEqual([
      { id: 'p2', name: 'Aline' },
      { id: 'p1', name: 'Bob' },
    ])
    expect(JSON.stringify(snap)).not.toContain('values')
  })

  it('shows answers and event properties in public, the key only in private', () => {
    expect(buildSnapshot(publicState, 's1', 'en')).toMatchObject({
      v: 1,
      kind: 'presence',
      visibility: 'public',
      dashboard: 'Club',
      answers: { p1: 'yes' },
      event: { name: 'Training', date: '2026-10-23', start: '18:00', end: '19:30', properties: [
          { name: 'Place', value: 'Gym' },
          { name: 'Bring', value: 'Shoes' },
        ],
      },
    })
    const priv = buildSnapshot(privateState, 's1', 'en')!
    expect(priv.answers).toBeUndefined()
    expect(priv.publicKey).toBe(privateState.organizerKeys!.publicKey)
    expect(buildSnapshot(publicState, 's1', 'en')!.publicKey).toBeUndefined()
  })

  it('lists event properties in order and leaves empty values out', () => {
    const props = buildSnapshot(publicState, 's1', 'en')!.event.properties
    expect(props).toEqual([
      { name: 'Place', value: 'Gym' },
      { name: 'Bring', value: 'Shoes' },
    ])
  })

  it('waits for the organizer keys of a private link', () => {
    expect(buildSnapshot({ ...privateState, organizerKeys: undefined }, 's1', 'en')).toBeNull()
  })

  it('returns null for a missing share or event', () => {
    expect(buildSnapshot(publicState, 'nope', 'en')).toBeNull()
    expect(buildSnapshot({ ...publicState, events: {} }, 's1', 'en')).toBeNull()
  })

  it('leaves out the people who left before the event, unless they replied to it', () => {
    // p2 left before the event; p1 too, but their reply stays, and so does their name.
    const left = compose(setLeftOn('p2', '2026-10-22'), setLeftOn('p1', '2026-10-01'))(publicState)
    const snap = buildSnapshot(left, 's1', 'en')!
    expect(snap.people).toEqual([{ id: 'p1', name: 'Bob' }])
    expect(snap.answers).toEqual({ p1: 'yes' })
    expect(isShareSnapshot(snap)).toBe(true)
    // Left on the day of the event: still listed.
    expect(buildSnapshot(setLeftOn('p2', '2026-10-23')(publicState), 's1', 'en')!.people.map((p) => p.id)).toEqual(['p1', 'p2'])
  })

  it('stamps the share merge time', () => {
    const state = { ...publicState, shares: { s1: { ...publicState.shares!.s1, mergedUpTo: 42 } } }
    expect(buildSnapshot(state, 's1', 'en')!.at).toBe(42)
  })
})

const callState = (visibility: 'public' | 'private', finished = false, mergedUpTo = 0) => {
  const opened = compose(addShare('s1', { eventId: 'e1', kind: 'call', key: KEY, visibility, autoClose: false }, 1))(base)
  const withKeys = visibility === 'private' ? setOrganizerKeys({ publicKey: JWK, privateKey: JWK })(opened) : opened
  const share = { ...withKeys.shares!.s1, mergedUpTo, ...(finished && { finished: true as const, closed: true }) }
  const event = finished ? { ...withKeys.events.e1, calledAt: 5, present: ['p1'] } : withKeys.events.e1
  return { ...withKeys, shares: { s1: share }, events: { e1: event } }
}

describe('call snapshots', () => {
  it('locks the names with a personal link on presence links only', () => {
    const link = createPersonalLink('p1', KEY)
    const presence = buildSnapshot(link(publicState), 's1', 'en')!
    expect(presence.people.find((p) => p.id === 'p1')!.locked).toBe(true)
    expect(presence.people.find((p) => p.id === 'p2')!.locked).toBeUndefined()
    expect(isShareSnapshot(presence)).toBe(true)
    expect(buildSnapshot(link(callState('public')), 's1', 'en')!.people.find((p) => p.id === 'p1')!.locked).toBeUndefined()
  })

  it('lists the people checked in on a public call link', () => {
    const s = buildSnapshot(callState('public'), 's1', 'en', [reply(10, 'p1', 'here', 'a'), reply(20, 'p2', 'here', 'b'), reply(30, 'p1', 'notHere', 'c')])!
    expect(s.present).toEqual(['p2'])
    expect(s.at).toBe(30)
    expect(isShareSnapshot(s)).toBe(true)
  })

  it('keeps the merge time when nothing was checked in', () => {
    const s = buildSnapshot(callState('public', false, 42), 's1', 'en')!
    expect(s.present).toEqual([])
    expect(s.at).toBe(42)
  })

  it('a finished call link shows the recorded presence', () => {
    const s = buildSnapshot(callState('public', true, 77), 's1', 'en', [reply(90, 'p2', 'here')])!
    expect(s.present).toEqual(['p1'])
    expect(s.at).toBe(77)
  })

  it('a private call snapshot has no presence', () => {
    const s = buildSnapshot(callState('private'), 's1', 'en', [reply(10, 'p1', 'here')])!
    expect(s.present).toBeUndefined()
    expect(isShareSnapshot(s)).toBe(true)
    expect(isShareSnapshot({ ...s, present: [] })).toBe(false)
  })

  it('a presence snapshot has no presence', () => {
    const s = buildSnapshot(publicState, 's1', 'en', [reply(10, 'p1', 'here')])!
    expect(s.present).toBeUndefined()
    expect(isShareSnapshot({ ...s, present: [] })).toBe(false)
  })

  it('rejects unknown or repeated people in the presence', () => {
    const s = buildSnapshot(callState('public'), 's1', 'en')!
    expect(isShareSnapshot({ ...s, present: ['zz'] })).toBe(false)
    expect(isShareSnapshot({ ...s, present: ['p1', 'p1'] })).toBe(false)
    expect(isShareSnapshot({ ...s, present: 'p1' })).toBe(false)
  })

  it('adds newer check-ins to the snapshot presence', () => {
    const snap = { ...buildSnapshot(callState('public'), 's1', 'en')!, present: ['p1'], at: 20 }
    expect([...snapshotPresent(snap, [reply(10, 'p2', 'here', 'a'), reply(30, 'p1', 'notHere', 'b')])]).toEqual([])
    expect([...snapshotPresent(snap, [reply(30, 'p2', 'here', 'a'), reply(31, 'x', 'here', 'b'), reply(32, 'p1', 'yes', 'c')])].sort()).toEqual(['p1', 'p2'])
  })
})

describe('snapshotAnswers', () => {
  it('adds newer replies to the answers', () => {
    const snap = { ...buildSnapshot(publicState, 's1', 'en')!, at: 10 }
    expect(snapshotAnswers(snap, [reply(5, 'p1', 'no'), reply(20, 'p2', 'yes'), reply(30, 'p1', 'none'), reply(40, 'x', 'yes')])).toEqual({ p2: 'yes' })
  })

  it('keeps the latest reply per person, the lowest id winning a tie like the fold, and ignores roll-call answers', () => {
    const snap = { ...buildSnapshot(publicState, 's1', 'en')!, at: 0 }
    expect(snapshotAnswers(snap, [reply(5, 'p2', 'no', 'b'), reply(5, 'p2', 'yes', 'a'), reply(6, 'p1', 'here')])).toEqual({ p1: 'yes', p2: 'yes' })
  })

  it('ignores replies for a locked name unless they came through the personal link', () => {
    const built = buildSnapshot(publicState, 's1', 'en')!
    const snap = { ...built, people: built.people.map((p) => (p.id === 'p1' ? { ...p, locked: true as const } : p)), answers: { p1: 'yes' as const }, at: 0 }
    expect(snapshotAnswers(snap, [reply(5, 'p1', 'no'), reply(6, 'p2', 'no')])).toEqual({ p1: 'yes', p2: 'no' })
    expect(snapshotAnswers(snap, [{ ...reply(5, 'p1', 'no'), via: 'personal' }])).toEqual({ p1: 'no' })
  })

  it('starts from nothing for a private snapshot', () => {
    const snap = { ...buildSnapshot(privateState, 's1', 'en')!, at: 0 }
    expect(snapshotAnswers(snap, [reply(5, 'p1', 'no')])).toEqual({ p1: 'no' })
  })
})

describe('isShareSnapshot', () => {
  const valid = () => buildSnapshot(publicState, 's1', 'en')!
  it('accepts a built snapshot', () => {
    expect(isShareSnapshot(valid())).toBe(true)
    expect(isShareSnapshot(buildSnapshot(privateState, 's1', 'en'))).toBe(true)
  })
  it('accepts a locked name', () => {
    const s = valid()
    expect(isShareSnapshot({ ...s, people: [{ ...s.people[0], locked: true }, ...s.people.slice(1)] })).toBe(true)
  })
  it.each<[string, (s: ShareSnapshot) => unknown]>([
    ['another version', (s) => ({ ...s, v: 2 })],
    ['an unknown kind', (s) => ({ ...s, kind: 'x' })],
    ['an unknown visibility', (s) => ({ ...s, visibility: 'x' })],
    ['an empty dashboard name', (s) => ({ ...s, dashboard: '' })],
    ['a bad date', (s) => ({ ...s, event: { ...s.event, date: '2026-13-01' } })],
    ['a too long event name', (s) => ({ ...s, event: { ...s.event, name: 'x'.repeat(LIMITS.eventName + 1) } })],
    ['too many properties', (s) => ({ ...s, event: { ...s.event, properties: Array.from({ length: LIMITS.eventProperties + 1 }, () => ({ name: 'a', value: 'b' })) } })],
    ['a bad property', (s) => ({ ...s, event: { ...s.event, properties: [{ name: 1, value: 'b' }] } })],
    ['a bad person id', (s) => ({ ...s, people: [{ id: '__proto__ x', name: 'A' }] })],
    ['a too long person name', (s) => ({ ...s, people: [{ id: 'p1', name: 'x'.repeat(LIMITS.personName + 1) }] })],
    ['too many people', (s) => ({ ...s, people: Array.from({ length: LIMITS.people + 1 }, (_, i) => ({ id: `p${i}`, name: 'A' })) })],
    ['duplicate people', (s) => ({ ...s, people: [...s.people, s.people[0]] })],
    ['a lock that is not true', (s) => ({ ...s, people: [{ ...s.people[0], locked: false }] })],
    ['an answer of an unlisted person', (s) => ({ ...s, answers: { zz: 'yes' } })],
    ['a public key in a public snapshot', (s) => ({ ...s, publicKey: JWK })],
    ['a private snapshot without a key', (s) => ({ ...s, visibility: 'private', answers: undefined })],
    ['a private snapshot with answers', (s) => ({ ...s, visibility: 'private', publicKey: JWK })],
    ['a bad answer', (s) => ({ ...s, answers: { p1: 'maybe' } })],
    ['a bad answer key', (s) => ({ ...s, answers: { 'a b': 'yes' } })],
    ['a too long public key', (s) => ({ ...s, publicKey: 'x'.repeat(LIMITS.jwk + 1) })],
    ['a missing time', (s) => ({ ...s, at: undefined })],
    ['null', () => null],
  ])('rejects %s', (_, change) => {
    expect(isShareSnapshot(change(valid()))).toBe(false)
  })
})
