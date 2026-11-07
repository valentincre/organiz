import { describe, expect, it } from 'vitest'
import { LIMITS } from './limits'
import { addEvent, addPerson, compose, deleteEvent, emptyState, setReply } from './mutations'
import { createPersonalLink, revokePersonalLink } from './personalLinks'
import { forgetShare } from './shares'
import {
  deviceNumbers,
  foldAll,
  foldAllReplies,
  foldReplies,
  hasConflict,
  keepReply,
  keepTime,
  markRepliesSeen,
  newReplies,
  trimTraces,
  type IncomingReply,
} from './replies'
import type { AppEvent, DashboardState, ReplyTrace, ShareEntry } from './types'

const base = compose(addPerson('p1', 'Alice', 1), addEvent('e1', '2026-10-23', {}, 1))(emptyState('Club'))
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
const SECRET = 'A'.repeat(43)
const OTHER = 'B'.repeat(43)
const replyOf = (event: AppEvent, id: string) => (event.yes?.includes(id) ? 'yes' : event.no?.includes(id) ? 'no' : undefined)

const r = (id: string, createdAt: number, answer: IncomingReply['answer'], device = 'd1', personId = 'p1'): IncomingReply => ({
  id,
  shareId: 's1',
  createdAt,
  personId,
  answer,
  device,
  via: 'shared',
})

describe('replies', () => {
  it('folds a reply with its trace and advances mergedUpTo', () => {
    const s = foldReplies('s1', [r('a', 10, 'yes')])(withShare({}))
    expect(replyOf(s.events.e1, 'p1')).toBe('yes')
    expect(s.events.e1.replyLog!.p1).toEqual({ via: 'shared', at: 10, device: 'd1' })
    expect(s.shares!.s1).toMatchObject({ mergedUpTo: 10, replied: true })
  })
  it('is idempotent and order-independent', () => {
    const replies = [r('a', 10, 'yes'), r('b', 20, 'no')]
    const once = foldReplies('s1', replies)(withShare({}))
    expect(foldReplies('s1', replies)(once)).toBe(once)
    expect(foldReplies('s1', [...replies].reverse())(withShare({}))).toEqual(once)
  })
  it('keeps a newer hand edit over an older reply folded later', () => {
    const edited = setReply('e1', 'p1', 'no', 15)(withShare({}))
    const s = foldReplies('s1', [r('a', 10, 'yes')])(edited)
    expect(replyOf(s.events.e1, 'p1')).toBe('no')
    expect(s.shares!.s1.mergedUpTo).toBe(10)
  })
  it('lets a newer reply win over a hand edit', () => {
    const s = foldReplies('s1', [r('a', 20, 'yes')])(setReply('e1', 'p1', 'no', 15)(withShare({})))
    expect(replyOf(s.events.e1, 'p1')).toBe('yes')
  })
  it('records two phones that disagree, until Keep', () => {
    const s = foldReplies('s1', [r('a', 10, 'yes', 'd1'), r('b', 20, 'no', 'd2')])(withShare({}))
    expect(hasConflict(s.events.e1.replyLog!.p1)).toBe(true)
    expect(s.events.e1.replyLog!.p1.others).toEqual([{ answer: 'yes', at: 10, device: 'd1' }])
    expect(hasConflict(keepReply('e1', 'p1', 'yes', 30)(s).events.e1.replyLog!.p1)).toBe(false)
  })
  it('clears the conflict when Keep confirms the current answer', () => {
    const s = foldReplies('s1', [r('a', 10, 'yes', 'd1'), r('b', 20, 'no', 'd2')])(withShare({}))
    const kept = keepReply('e1', 'p1', 'no', 30)(s)
    expect(replyOf(kept.events.e1, 'p1')).toBe('no')
    expect(kept.events.e1.replyLog!.p1).toEqual({ via: 'hand', at: 30 })
  })
  it('does not flag the same phone changing its mind, nor two phones that agree', () => {
    expect(hasConflict(foldReplies('s1', [r('a', 10, 'yes'), r('b', 20, 'no')])(withShare({})).events.e1.replyLog!.p1)).toBe(false)
    expect(hasConflict(foldReplies('s1', [r('a', 10, 'yes', 'd1'), r('b', 20, 'yes', 'd2')])(withShare({})).events.e1.replyLog!.p1)).toBe(false)
  })
  it('clears a reply with none', () => {
    const s = foldReplies('s1', [r('a', 10, 'yes'), r('b', 20, 'none')])(withShare({}))
    expect(replyOf(s.events.e1, 'p1')).toBeUndefined()
    expect(s.events.e1.replyLog!.p1.at).toBe(20)
  })
  it('ignores replies for people who no longer exist', () => {
    const s = foldReplies('s1', [r('a', 10, 'yes', 'd1', 'gone'), r('b', 20, 'yes')])(withShare({}))
    expect(s.people.gone).toBeUndefined()
    expect(replyOf(s.events.e1, 'p1')).toBe('yes')
    expect(s.shares!.s1.mergedUpTo).toBe(20)
  })
  it('skips check-ins', () => {
    const s = foldReplies('s1', [r('a', 10, 'here')])(withShare({}))
    expect(replyOf(s.events.e1, 'p1')).toBeUndefined()
  })
  it('ignores the replies of a forgotten share', () => {
    const state = forgetShare('s1')(withShare({}))
    expect(foldReplies('s1', [r('a', 10, 'yes')])(state)).toBe(state)
  })
  it('folds every share with foldAll', () => {
    const s = foldAll(withShare({}), [r('a', 10, 'yes'), { ...r('b', 20, 'no'), shareId: 'unknown' }])
    expect(replyOf(s.events.e1, 'p1')).toBe('yes')
  })
  it('counts new replies until they are seen', () => {
    const s = foldReplies('s1', [r('a', 10, 'yes')])(withShare({}))
    expect(newReplies(s.events.e1)).toEqual(['p1'])
    expect(newReplies(markRepliesSeen('e1', 11)(s).events.e1)).toEqual([])
  })
  it('gives the same result whatever the order across two links of one event', () => {
    const state: DashboardState = { ...withShare({}), shares: { s1: share({}), s2: share({}) } }
    const a = r('a', 10, 'yes', 'd1')
    const b = { ...r('b', 20, 'no', 'd2'), shareId: 's2' }
    const forward = foldAll(state, [a, b])
    expect(forward.events.e1.replyLog!.p1.others).toEqual([{ answer: 'yes', at: 10, device: 'd1' }])
    expect(foldAll(state, [b, a])).toEqual(forward)
    expect(foldAllReplies([b, a])(state)).toEqual(forward)
    expect(forward.shares).toMatchObject({ s1: { mergedUpTo: 10 }, s2: { mergedUpTo: 20 } })
  })
  it('does not flag a newer reply over a hand edit, nor over a personal reply', () => {
    const hand = foldReplies('s1', [r('a', 20, 'yes')])(setReply('e1', 'p1', 'no', 15)(withShare({})))
    expect(hasConflict(hand.events.e1.replyLog!.p1)).toBe(false)
    // A personal reply folded while the link existed, then a shared one once it was revoked.
    const signed = foldReplies('s1', [{ ...r('a', 10, 'yes', 'd1'), via: 'personal', signedWith: SECRET }])(createPersonalLink('p1', SECRET)(withShare({})))
    const personal = foldReplies('s1', [r('b', 20, 'no', 'd2')])(revokePersonalLink('p1')(signed))
    expect(replyOf(personal.events.e1, 'p1')).toBe('no')
    expect(hasConflict(personal.events.e1.replyLog!.p1)).toBe(false)
  })
  it('records the conflict whatever the input order', () => {
    const s = foldReplies('s1', [r('b', 20, 'no', 'd2'), r('a', 10, 'yes', 'd1')])(withShare({}))
    expect(s.events.e1.replyLog!.p1.others).toEqual([{ answer: 'yes', at: 10, device: 'd1' }])
  })
  it('breaks same-millisecond ties by id: the lowest id wins', () => {
    const s = foldReplies('s1', [r('b', 10, 'no'), r('a', 10, 'yes')])(withShare({}))
    expect(replyOf(s.events.e1, 'p1')).toBe('yes')
  })
  it('keeps mergedUpTo at the max when an older batch is folded later', () => {
    const s = foldReplies('s1', [r('a', 5, 'no')])(foldReplies('s1', [r('b', 20, 'yes')])(withShare({})))
    expect(s.shares!.s1.mergedUpTo).toBe(20)
  })
  it('advances mergedUpTo even when the newest reply is skipped', () => {
    const s = foldReplies('s1', [r('a', 10, 'yes'), r('b', 30, 'yes', 'd1', 'gone')])(withShare({}))
    expect(s.shares!.s1.mergedUpTo).toBe(30)
  })
  it('keeps the conflict until Keep', () => {
    const s = foldReplies('s1', [r('a', 10, 'yes', 'd1'), r('b', 20, 'no', 'd2'), r('c', 30, 'yes', 'd2')])(withShare({}))
    expect(hasConflict(s.events.e1.replyLog!.p1)).toBe(true)
  })
  it('lists disagreements newest first and cuts them to the limit', () => {
    const replies = Array.from({ length: LIMITS.traceOthers + 3 }, (_, i) => r(`r${i}`, 10 * (i + 1), i % 2 ? 'no' : 'yes', `d${i % 2}`))
    const others = foldReplies('s1', replies)(withShare({})).events.e1.replyLog!.p1.others!
    expect(others).toHaveLength(LIMITS.traceOthers)
    expect(others[0].at).toBeGreaterThan(others[1].at)
    expect(others[0].at).toBe(10 * (LIMITS.traceOthers + 2))
  })
  it('makes Keep survive a re-fold even with a skewed device clock', () => {
    const replies = [r('a', 10, 'yes', 'd1'), r('b', 20, 'no', 'd2')]
    const kept = keepReply('e1', 'p1', 'yes', 5)(foldReplies('s1', replies)(withShare({})))
    expect(kept.events.e1.replyLog!.p1.at).toBeGreaterThan(20)
    expect(foldReplies('s1', replies)(kept)).toBe(kept)
  })
  it('replays Keep without moving its time', () => {
    const keep = keepReply('e1', 'p1', 'yes', 5)
    const kept = keep(foldReplies('s1', [r('a', 10, 'yes', 'd1'), r('b', 20, 'no', 'd2')])(withShare({})))
    expect(keep(kept)).toBe(kept)
    expect(keep(kept)).toBe(kept)
  })
  it('keeps Keep ahead of a reply the sheet showed before it was folded', () => {
    const replies = [r('a', 10, 'yes', 'd1'), r('b', 20, 'no', 'd2')]
    const stored = foldReplies('s1', replies.slice(0, 1))(withShare({}))
    const shown = foldReplies('s1', replies)(stored).events.e1.replyLog!.p1
    const kept = keepReply('e1', 'p1', 'yes', keepTime(shown, 5))(stored)
    expect(replyOf(foldReplies('s1', replies)(kept).events.e1, 'p1')).toBe('yes')
  })
  it('takes the max when marking replies seen, and ignores hand traces in newReplies', () => {
    const seen = markRepliesSeen('e1', 50)(withShare({}))
    expect(markRepliesSeen('e1', 20)(seen)).toBe(seen)
    expect(newReplies(setReply('e1', 'p1', 'yes', 99)(withShare({})).events.e1)).toEqual([])
  })

  it('numbers phones by first appearance', () => {
    const trace: ReplyTrace = { via: 'shared', at: 30, device: 'd2', others: [{ answer: 'yes', at: 20, device: 'd1' }, { answer: 'no', at: 10, device: 'd2' }] }
    expect([...deviceNumbers(trace)]).toEqual([['d2', 1], ['d1', 2]])
  })

  describe('personal links', () => {
    const locked = createPersonalLink('p1', SECRET)(withShare({}))
    const signed = (id: string, createdAt: number, answer: IncomingReply['answer'], signedWith?: string, sentAt = createdAt): IncomingReply => ({
      ...r(id, createdAt, answer),
      via: 'personal',
      ...(signedWith !== undefined && { signedWith, sentAt }),
    })
    it('records the sentAt of a personal reply in its trace', () => {
      const s = foldReplies('s1', [signed('a', 10, 'yes', SECRET, 8)])(locked)
      expect(s.events.e1.replyLog!.p1).toEqual({ via: 'personal', at: 10, device: 'd1', sentAt: 8 })
    })
    it('ignores a signed reply replayed after a newer one, whatever the fold grouping', () => {
      const replies = [signed('a', 10, 'yes', SECRET), signed('b', 20, 'no', SECRET), signed('c', 30, 'yes', SECRET, 10), signed('d', 40, 'yes', SECRET, 20)]
      const together = foldReplies('s1', replies)(locked)
      const apart = replies.reduce((state, reply) => foldReplies('s1', [reply])(state), locked)
      for (const s of [together, apart]) {
        expect(replyOf(s.events.e1, 'p1')).toBe('no')
        expect(s.events.e1.replyLog!.p1).toMatchObject({ via: 'personal', at: 20, sentAt: 20 })
        expect(s.shares!.s1.mergedUpTo).toBe(40)
      }
    })
    it('accepts a signed reply sent after the last one', () => {
      const s = foldReplies('s1', [signed('a', 10, 'yes', SECRET), signed('b', 20, 'no', SECRET, 11)])(locked)
      expect(replyOf(s.events.e1, 'p1')).toBe('no')
      expect(s.events.e1.replyLog!.p1).toMatchObject({ at: 20, sentAt: 11 })
    })
    it('does not let a replayed signed reply undo a later hand edit or Keep', () => {
      const answered = foldReplies('s1', [signed('a', 10, 'yes', SECRET)])(locked)
      const edited = setReply('e1', 'p1', 'no', 15)(answered)
      expect(edited.events.e1.replyLog!.p1).toEqual({ via: 'hand', at: 15, sentAt: 10 })
      const kept = keepReply('e1', 'p1', 'no', 16)(answered)
      expect(kept.events.e1.replyLog!.p1).toEqual({ via: 'hand', at: 16, sentAt: 10 })
      for (const state of [edited, kept]) {
        const s = foldReplies('s1', [signed('b', 30, 'yes', SECRET, 10)])(state)
        expect(replyOf(s.events.e1, 'p1')).toBe('no')
        expect(s.shares!.s1.mergedUpTo).toBe(30)
      }
      // A reply sent later still wins over the hand edit.
      expect(replyOf(foldReplies('s1', [signed('c', 30, 'yes', SECRET, 12)])(edited).events.e1, 'p1')).toBe('yes')
    })
    it('ignores a shared reply for a locked person', () => {
      const s = foldReplies('s1', [r('a', 10, 'yes')])(locked)
      expect(replyOf(s.events.e1, 'p1')).toBeUndefined()
      expect(s.events.e1.replyLog).toBeUndefined()
      expect(s.shares!.s1.mergedUpTo).toBe(10)
    })
    it('accepts a personal reply signed with the current secret', () => {
      const s = foldReplies('s1', [signed('a', 10, 'yes', SECRET)])(locked)
      expect(replyOf(s.events.e1, 'p1')).toBe('yes')
      expect(s.events.e1.replyLog!.p1).toMatchObject({ via: 'personal', at: 10 })
    })
    it('ignores a personal reply that is unsigned or signed with another secret', () => {
      const s = foldReplies('s1', [signed('a', 10, 'yes'), signed('b', 20, 'no', OTHER)])(locked)
      expect(replyOf(s.events.e1, 'p1')).toBeUndefined()
      expect(s.shares!.s1.mergedUpTo).toBe(20)
    })
    it('ignores a personal reply after the link is revoked', () => {
      const reply = signed('a', 10, 'yes', SECRET)
      expect(replyOf(foldReplies('s1', [reply])(revokePersonalLink('p1')(locked)).events.e1, 'p1')).toBeUndefined()
      expect(replyOf(foldReplies('s1', [reply])(createPersonalLink('p1', OTHER)(revokePersonalLink('p1')(locked))).events.e1, 'p1')).toBeUndefined()
    })
    it('never counts a personal reply for a person without a link, but advances mergedUpTo', () => {
      const s = foldReplies('s1', [signed('a', 10, 'yes', SECRET)])(withShare({}))
      expect(replyOf(s.events.e1, 'p1')).toBeUndefined()
      expect(s.shares!.s1.mergedUpTo).toBe(10)
    })
    it('keeps shared replies of people without a link', () => {
      const state = compose(addPerson('p2', 'Bob', 2))(locked)
      const s = foldReplies('s1', [r('a', 10, 'yes', 'd1', 'p2'), r('b', 20, 'no')])(state)
      expect(replyOf(s.events.e1, 'p2')).toBe('yes')
      expect(replyOf(s.events.e1, 'p1')).toBeUndefined()
    })
    it('leaves check-ins of a finished call link to a locked person unaffected', () => {
      const finished = createPersonalLink('p1', SECRET)(withShare({ kind: 'call', finished: true, closed: true }))
      const called = { ...finished, events: { ...finished.events, e1: { ...finished.events.e1, calledAt: 5 } } }
      expect(foldReplies('s1', [r('a', 10, 'here')])(called).events.e1.present).toEqual(['p1'])
    })
  })

  describe('roll-call check-ins', () => {
    const withCall = (fields: Partial<ShareEntry>, event: Partial<AppEvent> = {}): DashboardState => {
      const state = withShare({ kind: 'call', ...fields })
      return { ...state, events: { ...state.events, e1: { ...state.events.e1, ...event } } }
    }
    it('holds check-ins of an unfinished call link', () => {
      const state = withCall({})
      expect(foldReplies('s1', [r('a', 10, 'here')])(state)).toBe(state)
    })
    it('leaves an unfinished call link untouched whatever else arrives, so held check-ins are not lost', () => {
      const state = withCall({})
      const personal: IncomingReply = { ...r('b', 20, 'here'), via: 'personal' }
      expect(foldReplies('s1', [r('a', 10, 'here'), personal, r('c', 30, 'yes')])(state)).toBe(state)
    })
    it("a deleted event's unfinished call link cleans up: its check-ins are skipped and mergedUpTo moves", () => {
      const deleted = deleteEvent('e1')(withCall({}))
      const s = foldReplies('s1', [r('a', 10, 'here'), r('b', 20, 'notHere')])(deleted)
      expect(s.shares!.s1).toMatchObject({ mergedUpTo: 20, replied: true })
      expect(s.shares!.s1.finished).toBeUndefined()
      expect(s.events).toBe(deleted.events)
    })
    it('folds a check-in that arrives after Finish into presence', () => {
      const finished = withCall({ finished: true, closed: true, mergedUpTo: 10 }, { calledAt: 15, absent: ['p1'] })
      const s = foldReplies('s1', [r('a', 10, 'here'), r('b', 20, 'here')])(finished)
      expect(s.events.e1.present).toEqual(['p1'])
      expect(s.events.e1.absent).toBeUndefined()
      expect(s.events.e1.calledAt).toBe(15)
      expect(s.events.e1.replyLog).toBeUndefined()
      expect(s.shares!.s1.mergedUpTo).toBe(20)
    })
    it('does not re-apply a check-in already in the call after a hand correction', () => {
      const finished = withCall({ finished: true, closed: true, mergedUpTo: 10 }, { calledAt: 15, absent: ['p1'] })
      const s = foldReplies('s1', [r('a', 10, 'here')])(finished)
      expect(s.events).toBe(finished.events)
      expect(s.shares!.s1.mergedUpTo).toBe(10)
    })
    it('a late "not here" puts the person absent', () => {
      const finished = withCall({ finished: true, closed: true, mergedUpTo: 10 }, { calledAt: 15, present: ['p1'] })
      const s = foldReplies('s1', [r('b', 20, 'notHere')])(finished)
      expect(s.events.e1.absent).toEqual(['p1'])
      expect(s.events.e1.present).toBeUndefined()
    })
    it('after Finish, ignores a personal check-in and a Coming reply but advances mergedUpTo', () => {
      const finished = withCall({ finished: true, closed: true }, { calledAt: 15 })
      const personal: IncomingReply = { ...r('a', 10, 'here'), via: 'personal' }
      const s = foldReplies('s1', [personal, r('b', 20, 'yes')])(finished)
      expect(s.events.e1.present).toBeUndefined()
      expect(replyOf(s.events.e1, 'p1')).toBeUndefined()
      expect(s.events.e1.replyLog).toBeUndefined()
      expect(s.shares!.s1.mergedUpTo).toBe(20)
    })
    it('skips a check-in on a presence link but advances mergedUpTo', () => {
      const s = foldReplies('s1', [r('a', 10, 'here')])(withShare({}))
      expect(s.events.e1.present).toBeUndefined()
      expect(s.shares!.s1.mergedUpTo).toBe(10)
    })
  })

  describe('trimTraces', () => {
    const withPeople = compose(addPerson('p2', 'Bob', 2), addPerson('p3', 'Carol', 3))(base)
    const traced = (state: DashboardState = withPeople): DashboardState => ({
      ...state,
      events: {
        ...state.events,
        e1: {
          ...state.events.e1,
          yes: ['p1', 'p3'],
          no: ['p2'],
          replyLog: {
            p1: { via: 'shared', at: 10, device: 'd1', others: [{ answer: 'no', at: 5, device: 'd2' }] },
            p2: { via: 'personal', at: 20, device: 'd3', sentAt: 19 },
            p3: { via: 'hand', at: 30, sentAt: 18 },
          },
          repliesSeenAt: 20,
        },
      },
    })

    it('keeps only where each reply came from on a past event with no link', () => {
      const s = trimTraces('2026-10-24')(traced())
      expect(s.events.e1.replyLog).toEqual({ p1: { via: 'shared' }, p2: { via: 'personal' }, p3: { via: 'hand' } })
      expect(s.events.e1.repliesSeenAt).toBeUndefined()
      expect(s.events.e1.yes).toEqual(['p1', 'p3'])
      expect(s.events.e1.no).toEqual(['p2'])
    })
    it('leaves a past event that still has a link, even closed', () => {
      const state = { ...traced(), shares: { s1: share({ closed: true }) } }
      expect(trimTraces('2026-10-24')(state)).toBe(state)
    })
    it("leaves today's event", () => {
      const state = traced()
      expect(trimTraces('2026-10-23')(state)).toBe(state)
    })
    it('returns the same state once trimmed', () => {
      const trimmed = trimTraces('2026-10-24')(traced())
      expect(trimTraces('2026-10-24')(trimmed)).toBe(trimmed)
    })
    it('trims a hand edit made after the trim', () => {
      const edited = setReply('e1', 'p2', 'yes', 40)(trimTraces('2026-10-24')(traced()))
      expect(edited.events.e1.replyLog!.p2).toEqual({ via: 'hand', at: 40 })
      expect(trimTraces('2026-10-24')(edited).events.e1.replyLog!.p2).toEqual({ via: 'hand' })
    })
    it('leaves a trimmed event with no new replies and no conflicts', () => {
      const event = trimTraces('2026-10-24')(traced()).events.e1
      expect(newReplies(event)).toEqual([])
      expect(hasConflict(event.replyLog!.p1)).toBe(false)
    })
    it('folds a later reply over a trimmed trace without a conflict', () => {
      const trimmed = { ...trimTraces('2026-10-24')(traced()), shares: { s1: share({ kind: 'presence' }) } }
      const s = foldReplies('s1', [r('a', 50, 'no')])(trimmed)
      expect(replyOf(s.events.e1, 'p1')).toBe('no')
      expect(s.events.e1.replyLog!.p1).toEqual({ via: 'shared', at: 50, device: 'd1' })
    })
  })
})
