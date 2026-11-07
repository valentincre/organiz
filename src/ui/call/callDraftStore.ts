import { useMemo, useSyncExternalStore } from 'react'
import { isCallDraft, type CallDraft } from '../../domain/call'
import type { EventId } from '../../domain/types'
import { isDemoRef } from '../../storage/link'

// The roll call in progress lives on this device only: localStorage, under
// "organiz.call.<docId>.<eventId>" (the document id, never the key: person ids reveal
// nothing). Every access can throw (private mode, blocked or full storage), so a
// value that cannot be stored stays in memory for the life of the page.

const PREFIX = 'organiz.call.'
const MODE_KEY = 'organiz.callMode'

const draftKey = (docId: string, eventId: EventId) => `${PREFIX}${docId}.${eventId}`

/** The demo lives in memory for the page's life and a reload builds a new one: its drafts never reach localStorage. */
const inMemoryOnly = (docId: string) => isDemoRef({ docId })

/** Values that could not be stored, or must not be; they win over the stored ones. */
const memory = new Map<string, string>()
const listeners = new Set<() => void>()
/** Changes at every write, so lists can be recomputed only when something changed. */
let version = 0

function notify(): void {
  version++
  for (const listener of listeners) listener()
}

function read(key: string): string | null {
  if (memory.has(key)) return memory.get(key) ?? null
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string, persist = true): void {
  memory.delete(key)
  try {
    if (!persist) throw new Error('memory only')
    localStorage.setItem(key, value)
  } catch {
    memory.set(key, value)
  }
  notify()
}

function remove(key: string): void {
  memory.delete(key)
  try {
    localStorage.removeItem(key)
  } catch {
    // Nothing stored, or storage unavailable: nothing to remove.
  }
  notify()
}

/** The browser tells the other tabs about a change; this tab's own writes notify directly. */
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) window.addEventListener('storage', notify)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) window.removeEventListener('storage', notify)
  }
}

/** Parsed drafts by their stored text, so a draft read twice is the same object (what useSyncExternalStore needs). */
const parsed = new Map<string, CallDraft | null>()

function parse(raw: string | null): CallDraft | null {
  if (raw === null) return null
  if (!parsed.has(raw)) {
    if (parsed.size > 100) parsed.clear()
    let draft: CallDraft | null = null
    try {
      const value: unknown = JSON.parse(raw)
      draft = isCallDraft(value) ? value : null
    } catch {
      // Not JSON: ignored like any other unknown shape.
    }
    parsed.set(raw, draft)
  }
  return parsed.get(raw) ?? null
}

export const readCallDraft = (docId: string, eventId: EventId): CallDraft | null => parse(read(draftKey(docId, eventId)))

export const saveCallDraft = (docId: string, draft: CallDraft): void =>
  write(draftKey(docId, draft.eventId), JSON.stringify(draft), !inMemoryOnly(docId))

export const removeCallDraft = (docId: string, eventId: EventId): void => remove(draftKey(docId, eventId))

/** The draft of an event on this device, with how to change it: null while there is none (or it is unreadable). */
export function useCallDraft(docId: string, eventId: EventId): readonly [CallDraft | null, (draft: CallDraft) => void, () => void] {
  const draft = useSyncExternalStore(subscribe, () => readCallDraft(docId, eventId))
  return [draft, (next) => saveCallDraft(docId, next), () => removeCallDraft(docId, eventId)] as const
}

export interface DraftEntry {
  eventId: EventId
  /** Null when what is stored cannot be read as a draft. */
  draft: CallDraft | null
}

/** Every draft stored for a dashboard, readable or not. */
function listEntries(docId: string): DraftEntry[] {
  const prefix = `${PREFIX}${docId}.`
  const keys = new Set([...memory.keys()])
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key) keys.add(key)
    }
  } catch {
    // Storage unavailable: only the drafts kept in memory.
  }
  return [...keys]
    .filter((key) => key.startsWith(prefix))
    .map((key) => ({ eventId: key.slice(prefix.length), draft: parse(read(key)) }))
}

/** Every draft of a dashboard, recomputed when a draft is written or removed (here or in another tab). */
export function useCallDraftEntries(docId: string): DraftEntry[] {
  const current = useSyncExternalStore(subscribe, () => version, () => 0)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `current` stands for the stored drafts
  return useMemo(() => listEntries(docId), [docId, current])
}

export type CallMode = 'one' | 'list'

/** "One by one" or "list" on phones, remembered on the device. */
export function useCallMode(): readonly [CallMode, (mode: CallMode) => void] {
  const stored = useSyncExternalStore(subscribe, () => read(MODE_KEY))
  return [stored === 'list' ? 'list' : 'one', (mode) => write(MODE_KEY, mode)] as const
}
