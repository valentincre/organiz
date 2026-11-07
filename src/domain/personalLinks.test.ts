import { describe, expect, it } from 'vitest'
import { addEvent, addPerson, compose, deletePerson, emptyState } from './mutations'
import { createPersonalLink, isLocked, revokePersonalLink, setHub } from './personalLinks'

const base = compose(addPerson('p1', 'Alice', 1), addPerson('p2', 'Bob', 1), addEvent('e1', '2026-10-23', {}, 1))(emptyState('Club'))

describe('personal links', () => {
  it('keeps the first hub', () => {
    const first = setHub({ id: 'a'.repeat(22), key: 'k'.repeat(43) })(base)
    expect(first.hub).toEqual({ id: 'a'.repeat(22), key: 'k'.repeat(43) })
    expect(setHub({ id: 'b'.repeat(22), key: 'k'.repeat(43) })(first)).toBe(first)
  })

  it('creates a link, and does not replace an existing one', () => {
    const once = createPersonalLink('p1', 'a'.repeat(43), 5)(base)
    expect(once.personalLinks).toEqual({ p1: { secret: 'a'.repeat(43), createdAt: 5 } })
    expect(createPersonalLink('p1', 'b'.repeat(43), 6)(once)).toBe(once)
    expect(createPersonalLink('ghost', 'a'.repeat(43))(base)).toBe(base)
  })

  it('revokes a link and drops it with the person', () => {
    const once = createPersonalLink('p1', 'a'.repeat(43), 5)(base)
    expect(revokePersonalLink('p1')(once).personalLinks).toBeUndefined()
    expect(deletePerson('p1')(once).personalLinks).toBeUndefined()
    const both = createPersonalLink('p2', 'c'.repeat(43), 6)(once)
    expect(Object.keys(deletePerson('p1')(both).personalLinks ?? {})).toEqual(['p2'])
    expect(revokePersonalLink('p2')(once)).toBe(once)
    expect(deletePerson('p2')(once).personalLinks).toEqual(once.personalLinks)
  })

  it('tells who is locked', () => {
    const once = createPersonalLink('p1', 'a'.repeat(43), 5)(base)
    expect(isLocked(once, 'p1')).toBe(true)
    expect(isLocked(once, 'p2')).toBe(false)
    expect(isLocked(base, 'p1')).toBe(false)
    expect(isLocked(once, 'constructor')).toBe(false)
  })
})
