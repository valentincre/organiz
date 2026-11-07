import { describe, expect, it } from 'vitest'
import { buildHubContent } from './hub'
import { addEvent, addPerson, compose, emptyState, renamePerson, setReply } from './mutations'
import { createPersonalLink, setHub } from './personalLinks'
import { foldAllReplies } from './replies'
import { addShare, closeShare } from './shares'

const K = 'K'.repeat(43)
const SECRET = 'S'.repeat(43)
const HUB = { id: 'H'.repeat(22), key: 'k'.repeat(43) }

const base = compose(
  addPerson('p1', 'Alice', 1),
  addPerson('p2', 'Bob', 2),
  addEvent('e1', '2026-10-23', { name: 'Training' }, 1),
  addEvent('e2', '2026-10-20', { name: 'Match' }, 2),
  addShare('s1', { eventId: 'e1', kind: 'presence', key: K, visibility: 'public', autoClose: false }, 3),
  // A closed presence link and a roll-call link: neither is on a personal page.
  addShare('s2', { eventId: 'e2', kind: 'presence', key: 'L'.repeat(43), visibility: 'public', autoClose: false }, 4),
  closeShare('s2'),
  addShare('c1', { eventId: 'e1', kind: 'call', key: 'M'.repeat(43), visibility: 'public', autoClose: false }, 5),
  createPersonalLink('p1', SECRET, 6),
  setHub(HUB),
)(emptyState('Club'))

describe('buildHubContent', () => {
  it('is null without a hub', () => {
    const { hub: _hub, ...withoutHub } = base
    expect(buildHubContent(withoutHub)).toBeNull()
  })

  it('lists open presence links and each linked person with their replies', () => {
    const state = compose(
      foldAllReplies([{ id: 'r1', shareId: 's1', createdAt: 10, personId: 'p1', answer: 'yes', device: 'd1', via: 'personal', signedWith: SECRET }]),
      // p2 has no personal link: not in the hub, even with a reply.
      setReply('e1', 'p2', 'no', 11),
    )(base)
    expect(buildHubContent(state)).toEqual({
      v: 1,
      shares: [{ shareId: 's1', key: K }],
      people: { p1: { name: 'Alice', replies: { s1: { answer: 'yes', at: 10 } } } },
    })
  })

  it('includes hand edits and follows renames', () => {
    const state = compose(setReply('e1', 'p1', 'no', 42), renamePerson('p1', 'Alicia'))(base)
    expect(buildHubContent(state)!.people).toEqual({ p1: { name: 'Alicia', replies: { s1: { answer: 'no', at: 42 } } } })
  })

  it('gives at 0 to a reply without a trace, and leaves out people without a reply', () => {
    // Replies set before the event had a link carry no trace.
    const state = compose(
      addEvent('e3', '2026-10-25', { name: 'Run' }, 7),
      setReply('e3', 'p1', 'yes', 50),
      addShare('s3', { eventId: 'e3', kind: 'presence', key: 'N'.repeat(43), visibility: 'private', autoClose: false }, 8),
    )(base)
    expect(buildHubContent(state)!.people.p1).toEqual({ name: 'Alice', replies: { s3: { answer: 'yes', at: 0 } } })
  })

  it('lists links by event, oldest first, including those whose time has passed but are not closed', () => {
    const state = compose(
      addEvent('e0', '2020-01-01', { name: 'Old' }, 7),
      // autoClose: its closing time is long past, but the content does not depend on the clock.
      addShare('s0', { eventId: 'e0', kind: 'presence', key: 'O'.repeat(43), visibility: 'public', autoClose: true }, 8),
      addEvent('e9', '2027-01-01', { name: 'Later' }, 9),
      addShare('s9', { eventId: 'e9', kind: 'presence', key: 'P'.repeat(43), visibility: 'public', autoClose: false }, 10),
    )(base)
    expect(buildHubContent(state)!.shares.map((s) => s.shareId)).toEqual(['s0', 's1', 's9'])
  })

  it('leaves out a linked person who no longer exists', () => {
    const state = { ...base, personalLinks: { ...base.personalLinks, ghost: { secret: SECRET, createdAt: 1 } } }
    expect(Object.keys(buildHubContent(state)!.people)).toEqual(['p1'])
  })
})
