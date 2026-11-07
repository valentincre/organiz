import { useEffect, useRef } from 'react'
import { finishMutation, type CallDraft } from '../../domain/call'
import { hasKey } from '../../domain/limits'
import type { DashboardState, EventId } from '../../domain/types'
import type { DashboardStore } from '../../storage/dashboardStore'
import { removeCallDraft, useCallDraftEntries, type DraftEntry } from './callDraftStore'

export type DraftSyncStep =
  | { kind: 'remove'; eventId: EventId }
  /** Sends a finished call to the store; `key` (event and time of the call) marks it as sent. */
  | { kind: 'finish'; key: string; draft: CallDraft; finishedAt: number }

interface SyncContext {
  /** False on a read link: the drafts belong to this device's editors, and the session cannot write. */
  canEdit: boolean
  /** Keys of the finished calls this session has already sent. */
  written: ReadonlySet<string>
  /** No edit is pending or failing, i.e. the server has every sent call. */
  settled: boolean
}

/** What to do with the stored drafts of a dashboard, given its current state. */
export function draftSyncSteps(entries: DraftEntry[], state: DashboardState | null, { canEdit, written, settled }: SyncContext): DraftSyncStep[] {
  if (!canEdit || !state) return []
  const steps: DraftSyncStep[] = []
  for (const { eventId, draft } of entries) {
    if (draft === null || !hasKey(state.events, eventId)) {
      steps.push({ kind: 'remove', eventId })
      continue
    }
    if (draft.finishedAt === undefined) continue
    const key = `${eventId}:${draft.finishedAt}`
    if (!written.has(key)) steps.push({ kind: 'finish', key, draft, finishedAt: draft.finishedAt })
    else if (settled) steps.push({ kind: 'remove', eventId })
  }
  return steps
}

/**
 * Keeps the drafts of a dashboard honest. A finished call is written once by
 * this session (also after a reload that interrupted it: the write is idempotent)
 * and its draft deleted only when no edit is pending or failing, i.e. the server
 * has it. A draft that cannot be read, or whose event is gone, is deleted.
 * A read link touches nothing.
 */
export function useCallDraftSync(docId: string, state: DashboardState | null, session: DashboardStore, saving: boolean, saveFailed: boolean): void {
  const entries = useCallDraftEntries(docId)
  // Finished calls this session has already sent to the store, by event and time of the call.
  const written = useRef(new Set<string>())

  useEffect(() => {
    const steps = draftSyncSteps(entries, state, { canEdit: session.canEdit, written: written.current, settled: !saving && !saveFailed })
    for (const step of steps) {
      if (step.kind === 'remove') {
        removeCallDraft(docId, step.eventId)
      } else {
        written.current.add(step.key)
        session.mutate(finishMutation(step.draft, step.finishedAt), { now: true })
      }
    }
  }, [docId, state, entries, session, saving, saveFailed])
}
