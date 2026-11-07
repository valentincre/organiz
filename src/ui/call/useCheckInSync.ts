import { useEffect } from 'react'
import { applyCheckIns, type CallDraft } from '../../domain/call'
import { hasKey } from '../../domain/limits'
import type { IncomingReply } from '../../domain/replies'
import type { DashboardState, EventId, ShareId } from '../../domain/types'
import { readCallDraft, saveCallDraft, useCallDraftEntries, type DraftEntry } from './callDraftStore'

/**
 * The drafts of this device that take new roll-call check-ins: every unfinished, readable draft
 * whose event has a call link not finished yet, with the check-ins of those links applied.
 * A finished call link's late check-ins are left to the fold, which makes them presence.
 * Check-ins of people no longer in the dashboard are ignored. A read link changes nothing.
 */
export function checkInSteps(
  entries: DraftEntry[],
  replies: IncomingReply[],
  state: DashboardState | null,
  canEdit: boolean,
): { eventId: EventId; draft: CallDraft }[] {
  if (!canEdit || !state || replies.length === 0) return []
  const callLinks = new Map<EventId, Set<ShareId>>()
  for (const [id, share] of Object.entries(state.shares ?? {})) {
    if (share.kind !== 'call' || share.finished) continue
    const links = callLinks.get(share.eventId) ?? new Set<ShareId>()
    callLinks.set(share.eventId, links.add(id))
  }
  const steps: { eventId: EventId; draft: CallDraft }[] = []
  for (const { eventId, draft } of entries) {
    const links = callLinks.get(eventId)
    if (draft === null || draft.finishedAt !== undefined || !links) continue
    const checkIns = replies.filter((reply) => links.has(reply.shareId) && hasKey(state.people, reply.personId))
    const next = applyCheckIns(draft, checkIns)
    if (next !== draft) steps.push({ eventId, draft: next })
  }
  return steps
}

/**
 * Saves the steps of `checkInSteps`, each worked out from the draft as stored right now: another
 * tab may have marked someone or finished the call since `entries` were read.
 */
export function saveCheckIns(
  entries: DraftEntry[],
  replies: IncomingReply[],
  state: DashboardState | null,
  canEdit: boolean,
  read: (eventId: EventId) => CallDraft | null,
  save: (draft: CallDraft) => void,
): void {
  if (!canEdit || !state || replies.length === 0) return
  const latest = entries.map(({ eventId }) => ({ eventId, draft: read(eventId) }))
  for (const { draft } of checkInSteps(latest, replies, state, canEdit)) save(draft)
}

/**
 * Puts the check-ins of the dashboard's call links into this device's calls in progress, as they
 * arrive: the call screen shows them live, and a call opened later picks up the waiting ones.
 */
export function useCheckInSync(docId: string, state: DashboardState | null, replies: IncomingReply[], canEdit: boolean): void {
  const entries = useCallDraftEntries(docId)

  useEffect(() => {
    saveCheckIns(entries, replies, state, canEdit, (eventId) => readCallDraft(docId, eventId), (draft) => saveCallDraft(docId, draft))
  }, [docId, entries, replies, state, canEdit])
}
