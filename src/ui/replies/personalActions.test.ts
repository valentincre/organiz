import { describe, expect, it } from 'vitest'
import { addPerson, compose, emptyState } from '../../domain/mutations'
import { revokePersonalLink } from '../../domain/personalLinks'
import { createPersonalLinkMutation, personalLinkOf } from './personalActions'

const base = compose(addPerson('p1', 'Alice', 1), addPerson('p2', 'Bob', 1))(emptyState('Club'))
const ids1 = { hubId: 'H'.repeat(22), hubKey: 'K'.repeat(43), secret: 'S'.repeat(43) }
const ids2 = { hubId: 'h'.repeat(22), hubKey: 'k'.repeat(43), secret: 's'.repeat(43) }

describe('createPersonalLinkMutation', () => {
  it('creates the hub with the first personal link only', () => {
    const once = createPersonalLinkMutation(base, 'p1', ids1)(base)
    expect(once.hub).toEqual({ id: ids1.hubId, key: ids1.hubKey })
    expect(createPersonalLinkMutation(once, 'p2', ids2)(once).hub).toEqual(once.hub)
  })

  it('keeps the secret another organizer saved first', () => {
    const once = createPersonalLinkMutation(base, 'p1', ids1)(base)
    expect(createPersonalLinkMutation(once, 'p1', ids2)(once).personalLinks?.p1?.secret).toBe(ids1.secret)
  })
})

describe('personalLinkOf', () => {
  it('gives the link that works now', () => {
    const once = createPersonalLinkMutation(base, 'p1', ids1)(base)
    expect(personalLinkOf(once, 'p1', 'http://x')).toBe(`http://x/#/p/${ids1.hubId}/${ids1.hubKey}/p1/${ids1.secret}`)
    expect(personalLinkOf(once, 'p2', 'http://x')).toBeNull()
  })

  it('follows the hub and secret in the state, not the ids drawn', () => {
    const first = createPersonalLinkMutation(base, 'p1', ids1)(base)
    // Another organizer's p2 link, replayed after ours: the hub is ours, the secret theirs.
    const both = createPersonalLinkMutation(first, 'p2', ids2)(first)
    expect(personalLinkOf(both, 'p2', 'http://x')).toBe(`http://x/#/p/${ids1.hubId}/${ids1.hubKey}/p2/${ids2.secret}`)
  })

  it('gives nothing once revoked, or without a hub', () => {
    const once = createPersonalLinkMutation(base, 'p1', ids1)(base)
    expect(personalLinkOf(revokePersonalLink('p1')(once), 'p1', 'http://x')).toBeNull()
    const { hub: _hub, ...noHub } = once
    expect(personalLinkOf(noHub, 'p1', 'http://x')).toBeNull()
  })
})
