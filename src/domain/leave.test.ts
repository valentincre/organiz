import { describe, expect, it } from 'vitest'
import { hasLeftBy, isListedAt } from './leave'
import { addEvent, addPerson, compose, emptyState, recordCall, setLeftOn, setReply } from './mutations'

describe('hasLeftBy', () => {
  const person = { name: 'Ana', createdAt: 1 }

  it('is false without a leave date', () => {
    expect(hasLeftBy(person, '2027-01-15')).toBe(false)
  })

  it('is false on the leave day itself and before it', () => {
    expect(hasLeftBy({ ...person, leftOn: '2027-01-15' }, '2027-01-15')).toBe(false)
    expect(hasLeftBy({ ...person, leftOn: '2027-01-15' }, '2027-01-14')).toBe(false)
  })

  it('is true from the day after', () => {
    expect(hasLeftBy({ ...person, leftOn: '2027-01-15' }, '2027-01-16')).toBe(true)
  })
})

describe('isListedAt', () => {
  const state = compose(
    addPerson('a', 'Ana', 1),
    setLeftOn('a', '2027-01-15'),
    addEvent('same', '2027-01-15', {}, 1),
    addEvent('later', '2027-01-20', {}, 1),
    addEvent('replied', '2027-01-21', {}, 1),
    addEvent('called', '2027-01-22', {}, 1),
    setReply('replied', 'a', 'no'),
    recordCall('called', [], ['a'], 5),
  )(emptyState('Club'))
  const listed = (eventId: string) => isListedAt(state, state.events[eventId], 'a')

  it('keeps the person on the leave day', () => {
    expect(listed('same')).toBe(true)
  })

  it('leaves the person out of a later event', () => {
    expect(listed('later')).toBe(false)
  })

  it('keeps the person on a later event where they have a reply or a presence', () => {
    expect(listed('replied')).toBe(true)
    expect(listed('called')).toBe(true)
  })
})
