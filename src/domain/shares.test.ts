import { describe, expect, it } from 'vitest'
import { addPerson, addEvent, compose, deleteEvent, emptyState, moveEvent, setEventTime } from './mutations'
import { addShare, callVisibilityFor, closeShare, closesAtFor, forgetShare, isShareOpen, openShareOf, setOrganizerKeys, settleCallLinks, setShareVisibility, sharesOf } from './shares'
import type { DashboardState, ShareEntry } from './types'

const local = (y: number, m: number, d: number, h: number, min: number) => new Date(y, m - 1, d, h, min).getTime()

const base = compose(addPerson('p1', 'Alice', 1), addEvent('e1', '2026-10-23', { start: '18:00', end: '19:30' }, 1))(emptyState('Club'))

const share = (fields: Partial<ShareEntry>): ShareEntry => ({
  eventId: 'e1',
  kind: 'presence',
  key: 'k',
  visibility: 'public',
  autoClose: false,
  closesAt: null,
  closed: false,
  createdAt: 1,
  mergedUpTo: 0,
  ...fields,
})
const withShare = (fields: Partial<ShareEntry>): DashboardState => ({ ...base, shares: { s1: share(fields) } })
const init = { eventId: 'e1', kind: 'presence' as const, key: 'k', visibility: 'public' as const, autoClose: false }

describe('shares', () => {
  it('closes a presence link at the start, or at midnight for an all-day event', () => {
    expect(closesAtFor('presence', { date: '2026-10-23', start: '18:00', end: '19:30' })).toBe(local(2026, 10, 23, 18, 0))
    expect(closesAtFor('presence', { date: '2026-10-23' })).toBe(local(2026, 10, 23, 0, 0))
  })
  it('closes a roll-call link at the end, or at 23:59', () => {
    expect(closesAtFor('call', { date: '2026-10-23', start: '18:00', end: '19:30' })).toBe(local(2026, 10, 23, 19, 30))
    expect(closesAtFor('call', { date: '2026-10-23', start: '18:00' })).toBe(local(2026, 10, 23, 23, 59))
  })
  it('knows when a share is open', () => {
    expect(isShareOpen(share({}), 10)).toBe(true)
    expect(isShareOpen(share({ closed: true }), 10)).toBe(false)
    expect(isShareOpen(share({ closesAt: 10 }), 10)).toBe(false)
    expect(isShareOpen(share({ closesAt: 10 }), 9)).toBe(true)
  })
  it('opens one presence link per event', () => {
    const once = addShare('s1', init)(base)
    expect(once.shares!.s1.closesAt).toBeNull()
    expect(addShare('s2', init)(once)).toBe(once)
    expect(addShare('s2', { ...init, eventId: 'nope' })(base)).toBe(base)
  })
  it('sets the closing time when the link closes by itself', () => {
    expect(addShare('s1', { ...init, autoClose: true })(base).shares!.s1.closesAt).toBe(local(2026, 10, 23, 18, 0))
  })
  it('opens a new link once the previous one is closed', () => {
    const closed = closeShare('s1')(withShare({}))
    expect(addShare('s2', init)(closed).shares!.s2).toBeDefined()
  })
  it('finds shares of an event', () => {
    const state = withShare({})
    expect(openShareOf(state, 'e1', 'presence', 5)![0]).toBe('s1')
    expect(openShareOf(state, 'e1', 'call', 5)).toBeUndefined()
    expect(openShareOf(closeShare('s1')(state), 'e1', 'presence', 5)).toBeUndefined()
    expect(sharesOf(closeShare('s1')(state), 'e1')).toHaveLength(1)
    expect(sharesOf(base, 'e1')).toEqual([])
  })
  it('refuses to make a private link public once someone replied', () => {
    const state = withShare({ visibility: 'private', replied: true })
    expect(setShareVisibility('s1', 'public')(state)).toBe(state)
    expect(setShareVisibility('s1', 'public')(withShare({ visibility: 'private' })).shares!.s1.visibility).toBe('public')
  })
  it('closes and forgets a share', () => {
    expect(closeShare('s1')(withShare({})).shares!.s1.closed).toBe(true)
    expect(forgetShare('s1')(withShare({})).shares).toBeUndefined()
  })
  it('keeps the first organizer keys', () => {
    const first = setOrganizerKeys({ publicKey: 'a', privateKey: 'b' })(base)
    expect(setOrganizerKeys({ publicKey: 'c', privateKey: 'd' })(first)).toBe(first)
  })
  it('follows the event when it moves', () => {
    const moved = moveEvent('e1', '2026-10-30', local(2026, 10, 20, 12, 0))(withShare({ autoClose: true }))
    expect(moved.shares!.s1.closesAt).toBe(local(2026, 10, 30, 18, 0))
  })
  it('follows the event when its time changes', () => {
    const changed = setEventTime('e1', '20:00', '21:00', local(2026, 10, 20, 12, 0))(withShare({ autoClose: true }))
    expect(changed.shares!.s1.closesAt).toBe(local(2026, 10, 23, 20, 0))
  })
  it('leaves manual links alone when the event moves', () => {
    expect(moveEvent('e1', '2026-10-30', 1)(withShare({ autoClose: false })).shares!.s1.closesAt).toBeNull()
  })
  it('never reopens a link whose time has passed', () => {
    const state = withShare({ autoClose: true, closesAt: local(2026, 10, 23, 18, 0) })
    expect(moveEvent('e1', '2026-10-30', local(2026, 10, 24, 9, 0))(state).shares!.s1.closesAt).toBe(local(2026, 10, 23, 18, 0))
  })
  it('closes the links of a deleted event', () => {
    expect(deleteEvent('e1')(withShare({})).shares!.s1.closed).toBe(true)
  })
})

describe('call links', () => {
  it('a call link takes the visibility of the latest presence link', () => {
    const state: DashboardState = {
      ...base,
      shares: {
        s1: share({ createdAt: 1, visibility: 'public' }),
        s2: share({ createdAt: 2, visibility: 'private' }),
        s3: share({ kind: 'call', createdAt: 3, visibility: 'public' }),
      },
    }
    expect(callVisibilityFor(state, 'e1')).toBe('private')
    expect(callVisibilityFor(base, 'e1')).toBeNull()
    expect(callVisibilityFor({ ...base, shares: { s3: share({ kind: 'call' }) } }, 'e1')).toBeNull()
  })
  it('settles unfinished call links created before the finish, idempotently', () => {
    const state: DashboardState = {
      ...base,
      shares: {
        s1: share({ kind: 'call', createdAt: 5, mergedUpTo: 0 }),
        s2: share({ kind: 'call', createdAt: 500 }),
        s3: share({ kind: 'presence', createdAt: 5 }),
        s4: share({ kind: 'call', createdAt: 5, eventId: 'other' }),
      },
    }
    const done = settleCallLinks('e1', 30, 100)(state)
    expect(done.shares!.s1).toMatchObject({ finished: true, closed: true, mergedUpTo: 30 })
    expect(done.shares!.s2.finished).toBeUndefined()
    expect(done.shares!.s3.finished).toBeUndefined()
    expect(done.shares!.s4.finished).toBeUndefined()
    expect(settleCallLinks('e1', 30, 100)(done)).toBe(done)
    expect(settleCallLinks('e1', 30, 100)(base)).toBe(base)
  })
})
