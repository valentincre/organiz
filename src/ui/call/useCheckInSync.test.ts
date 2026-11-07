import { describe, expect, it } from 'vitest'
import { mark, startCall, type CallDraft } from '../../domain/call'
import { addEvent, addPerson, compose, emptyState } from '../../domain/mutations'
import type { IncomingReply } from '../../domain/replies'
import { addShare } from '../../domain/shares'
import { checkInSteps, saveCheckIns } from './useCheckInSync'

const CALL = 'C'.repeat(22)
const PRESENCE = 'P'.repeat(22)
const share = (eventId: string, kind: 'presence' | 'call') => ({ eventId, kind, key: 'k'.repeat(43), visibility: 'public' as const, autoClose: false })

const state = compose(
  addPerson('a', 'Alice'),
  addPerson('b', 'Bob'),
  addEvent('e1', '2026-10-10'),
  addEvent('e2', '2026-10-11'),
  addShare(CALL, share('e1', 'call'), 100),
  addShare(PRESENCE, share('e2', 'presence'), 100),
)(emptyState('Club'))

const checkIn = (personId: string, createdAt: number, shareId = CALL, answer: IncomingReply['answer'] = 'here'): IncomingReply => ({
  id: `r${createdAt}`,
  shareId,
  createdAt,
  personId,
  answer,
  device: 'phone',
  via: 'shared',
})

const e1 = startCall(state, 'e1', ['a', 'b'], 100)
const e2 = startCall(state, 'e2', ['a', 'b'], 100)

describe('checkInSteps', () => {
  it('applies check-ins to unfinished drafts of their event only', () => {
    const entries = [
      { eventId: 'e1', draft: e1 },
      { eventId: 'e2', draft: e2 },
    ]
    // A reply of e2's presence link is not a check-in for any call.
    const replies = [checkIn('a', 200), checkIn('b', 300, PRESENCE, 'yes')]
    const steps = checkInSteps(entries, replies, state, true)
    expect(steps).toHaveLength(1)
    expect(steps[0].eventId).toBe('e1')
    expect(steps[0].draft).toMatchObject({ marks: { a: 'present' }, checkedInUpTo: 200 })

    // Already applied: nothing to save again.
    expect(checkInSteps([{ eventId: 'e1', draft: steps[0].draft }], replies, state, true)).toEqual([])
  })

  it('ignores check-ins of people no longer in the dashboard', () => {
    const steps = checkInSteps([{ eventId: 'e1', draft: e1 }], [checkIn('gone', 200)], state, true)
    expect(steps).toEqual([])
  })

  it('leaves finished drafts and readers alone', () => {
    const replies = [checkIn('a', 200)]
    expect(checkInSteps([{ eventId: 'e1', draft: { ...e1, finishedAt: 150 } }], replies, state, true)).toEqual([])
    expect(checkInSteps([{ eventId: 'e1', draft: e1 }], replies, state, false)).toEqual([])
    expect(checkInSteps([{ eventId: 'e1', draft: e1 }], replies, null, true)).toEqual([])
    expect(checkInSteps([{ eventId: 'e1', draft: null }], replies, state, true)).toEqual([])
  })

  it('leaves the check-ins of a finished call link to the fold', () => {
    const finished = { ...state, shares: { ...state.shares, [CALL]: { ...state.shares![CALL], finished: true as const, closed: true } } }
    expect(checkInSteps([{ eventId: 'e1', draft: e1 }], [checkIn('a', 200)], finished, true)).toEqual([])
  })
})

describe('saveCheckIns', () => {
  const run = (stored: Record<string, CallDraft | null>, entries = [{ eventId: 'e1', draft: e1 }]) => {
    const saved: CallDraft[] = []
    saveCheckIns(entries, [checkIn('a', 200)], state, true, (eventId) => stored[eventId] ?? null, (draft) => saved.push(draft))
    return saved
  }

  it('applies the check-ins to the latest stored draft, not the one seen at render', () => {
    // Another tab marked Bob absent by hand after this one rendered.
    const saved = run({ e1: mark(e1, 'b', 'absent') })
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ marks: { a: 'present', b: 'absent' }, checkedInUpTo: 200 })
  })

  it('saves nothing when the latest draft is gone, finished or already up to date', () => {
    expect(run({})).toEqual([])
    expect(run({ e1: { ...e1, finishedAt: 150 } })).toEqual([])
    const done = checkInSteps([{ eventId: 'e1', draft: e1 }], [checkIn('a', 200)], state, true)[0].draft
    expect(run({ e1: done })).toEqual([])
  })
})
