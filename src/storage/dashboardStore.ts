import {
  Bytes,
  doc,
  getDocFromServer,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  type DocumentData,
  type DocumentReference,
  type Firestore,
  type FirestoreError,
} from 'firebase/firestore'
import { randomId } from '../domain/ids'
import { compose, emptyState } from '../domain/mutations'
import type { DashboardState, Mutation } from '../domain/types'
import { markOpened } from './cacheExpiry'
import { DecryptError, generateKeyString, NewerVersionError } from './crypto'
import { openState, sealState, TooLargeError } from './envelope'
import { commitmentOf, deriveEditKeys, importReadKey, proofFor } from './keys'
import { readRefOf, type DashboardRef } from './link'

const COLLECTION = 'dashboards'
/** Version of the stored envelope (the state inside has its own); mirrored in firestore.rules. */
const ENVELOPE_VERSION = 2

/** Edits are saved together once they stop for `idle` ms, and at the latest `max` ms after the first unsaved one. */
export interface SaveDelay {
  idle: number
  max: number
}

export const DEFAULT_SAVE_DELAY: SaveDelay = { idle: 1500, max: 5000 }

/** A hidden tab stops listening after this long, so a forgotten tab costs no reads. */
const DEFAULT_PAUSE_AFTER_MS = 5 * 60_000

/** Re-reads of a possibly stale server revision after a denied write, with a growing delay (about 1.5 s in all). */
const STALE_READ_RETRIES = 3
const STALE_READ_DELAY_MS = 250

export interface SessionOptions {
  saveDelay?: SaveDelay
  pauseAfterMs?: number
}

export interface MutateOptions {
  /** Saves at once instead of waiting for the delay, e.g. to finish a roll call. */
  now?: boolean
}

export type LoadError = 'not-found' | 'bad-key' | 'newer-version' | 'network'

/**
 * Why the last save failed: `too-large` when the dashboard is too large to be stored (see
 * `sealState`), `failed` for anything else (connection, rules).
 */
export type SaveError = 'failed' | 'too-large'

export interface DashboardSnapshot {
  /**
   * Server state with pending local edits applied; null until the first load.
   * Until the server state is known, it can stand on writes an earlier visit left pending.
   */
  state: DashboardState | null
  /**
   * True once the state stands on a revision confirmed by the server, not only on writes an
   * earlier visit left pending: irreversible steps (share documents, deleting replies) wait for it.
   */
  confirmed: boolean
  loadError: LoadError | null
  /** True while local edits are not yet confirmed by the server, whether or not they are being written. */
  saving: boolean
  /** True while a write is running (a subset of `saving`: edits can wait for the save delay). */
  writing: boolean
  /** Set when the last save failed; pending edits are kept for a retry. */
  saveError: SaveError | null
}

/** What the UI needs from an open dashboard, whether stored in Firestore or the in-browser demo. */
export interface DashboardStore {
  /** False for a read link: edits are ignored. */
  readonly canEdit: boolean
  /** The read-only link to share; null for the demo, and for an edit link until `start()` has derived its keys. */
  readonly readLink: DashboardRef | null
  start(): Promise<void>
  stop(): void
  subscribe(listener: () => void): () => void
  getSnapshot(): DashboardSnapshot
  mutate(mutation: Mutation, options?: MutateOptions): void
  /** Writes pending edits now, without waiting for the save delay. */
  flushNow(): void
  /** Tries a failed save again; a dashboard too large to save is only tried again after an edit. */
  retry(): void
}

interface SessionKeys {
  encKey: CryptoKey
  /** Null for a read link. */
  writeKey: CryptoKey | null
}

interface Revision {
  state: DashboardState
  rev: number
}

/**
 * Revision `rev` of a dashboard: reveals `proof`, which the previous revision
 * committed to, and commits to the proof of `rev + 1`.
 */
async function toEnvelope(encKey: CryptoKey, writeKey: CryptoKey, docId: string, state: DashboardState, rev: number, proof: string) {
  const { iv, ct } = await sealState(encKey, docId, state)
  return {
    v: ENVELOPE_VERSION,
    iv,
    ct: Bytes.fromUint8Array(ct),
    rev,
    proof,
    next: await commitmentOf(await proofFor(writeKey, docId, rev + 1)),
    updatedAt: serverTimestamp(),
  }
}

async function readEnvelope(encKey: CryptoKey, docId: string, data: DocumentData): Promise<Revision> {
  if (data.v > ENVELOPE_VERSION) throw new NewerVersionError()
  return { state: await openState(encKey, docId, { iv: data.iv, ct: data.ct.toUint8Array() }), rev: data.rev }
}

const loadErrorOf = (error: unknown): LoadError => (error instanceof NewerVersionError ? 'newer-version' : 'bad-key')

// By code, not `instanceof FirestoreError`: a denied write rejects with a plain FirebaseError.
const isPermissionDenied = (error: unknown) => (error as FirestoreError | null)?.code === 'permission-denied'

export const newDocId = (): string => randomId(16)

/**
 * Creates the dashboard as revision 1. `nonce` is the proof of work for `docId`;
 * `state` replaces the empty dashboard, e.g. to restore a backup.
 */
export async function createDashboard(
  db: Firestore,
  name: string,
  { docId, nonce, state = emptyState(name) }: { docId: string; nonce: string; state?: DashboardState },
): Promise<DashboardRef> {
  const ref: DashboardRef = { docId, key: generateKeyString(), access: 'edit' }
  const { encKey, writeKey } = await deriveEditKeys(ref.key, docId)
  await setDoc(doc(db, COLLECTION, docId), await toEnvelope(encKey, writeKey, docId, state, 1, nonce))
  return ref
}

/**
 * Live view of one dashboard. Edits are applied optimistically, queued, and
 * written on top of the latest known revision as `rev + 1`. The rules accept
 * only one write per revision, so of two concurrent saves the second is denied,
 * rebased on the server state and written again: editors never overwrite each
 * other. A burst of edits is saved by one write (see SaveDelay), and at once
 * when the tab goes to the background; a tab hidden for long stops listening.
 */
export class DashboardSession implements DashboardStore {
  readonly canEdit: boolean
  private readRef: DashboardRef | null
  private readonly db: Promise<Firestore>
  private docRef: DocumentReference | null = null
  private keys: SessionKeys | null = null
  /**
   * Latest revision confirmed by the server, never a pending write. Both only
   * move forward (see `adopt`).
   */
  private remote: DashboardState | null = null
  private remoteRev = 0
  /**
   * Shown until `remote` is known: the cached document with writes still
   * pending from an earlier visit, e.g. made offline before a reload. Display
   * only: it may yet be denied, so nothing is ever saved on top of it.
   */
  private unconfirmed: Revision | null = null
  private loadError: LoadError | null = null
  private inflight: Mutation[] = []
  private queue: Mutation[] = []
  /** Only one flush loop runs at a time, so at most one write is in flight. */
  private flushing = false
  private writing = false
  private saveError: SaveError | null = null
  private saveTimer: ReturnType<typeof setTimeout> | undefined
  /** When the oldest unsaved edit was made, to bound the wait with `saveDelay.max`. */
  private firstEditAt: number | null = null
  private pauseTimer: ReturnType<typeof setTimeout> | undefined
  private paused = false
  private warnedReadOnly = false
  private snapshot: DashboardSnapshot
  private readonly listeners = new Set<() => void>()
  private unsubscribe: (() => void) | null = null
  /** Between a completed `start()` and `stop()`. */
  private started = false
  private generation = 0
  private readonly ref: DashboardRef
  private readonly saveDelay: SaveDelay
  private readonly pauseAfterMs: number

  constructor(
    db: Firestore | Promise<Firestore>,
    ref: DashboardRef,
    { saveDelay = DEFAULT_SAVE_DELAY, pauseAfterMs = DEFAULT_PAUSE_AFTER_MS }: SessionOptions = {},
  ) {
    this.db = Promise.resolve(db)
    this.ref = ref
    this.canEdit = ref.access === 'edit'
    this.readRef = this.canEdit ? null : ref
    this.saveDelay = saveDelay
    this.pauseAfterMs = pauseAfterMs
    this.snapshot = this.computeSnapshot()
  }

  get readLink(): DashboardRef | null {
    return this.readRef
  }

  /** Starts listening to the server; can be called again after stop(). */
  async start(): Promise<void> {
    const generation = ++this.generation
    try {
      this.docRef ??= doc(await this.db, COLLECTION, this.ref.docId)
    } catch (error) {
      // Nothing can load, and reloading is the remedy, as for a lost connection.
      console.error('Firestore failed to start', error)
      this.setLoadError('network')
      return
    }
    try {
      this.keys ??= await this.openKeys()
    } catch {
      this.setLoadError('bad-key')
      return
    }
    if (generation !== this.generation) return
    markOpened(this.ref.docId)
    this.started = true
    globalThis.addEventListener?.('online', this.retry)
    globalThis.addEventListener?.('visibilitychange', this.onVisibilityChange)
    globalThis.addEventListener?.('pagehide', this.flushNow)
    this.listen()
  }

  /** Pending edits are saved before listening stops, so leaving the dashboard within the save delay loses nothing. */
  stop(): void {
    this.flushNow()
    this.generation++
    this.started = false
    this.paused = false
    clearTimeout(this.pauseTimer)
    this.unlisten()
    globalThis.removeEventListener?.('online', this.retry)
    globalThis.removeEventListener?.('visibilitychange', this.onVisibilityChange)
    globalThis.removeEventListener?.('pagehide', this.flushNow)
  }

  /** Stops receiving server changes; edits are still saved. */
  pause(): void {
    this.paused = true
    this.unlisten()
  }

  /** Listens again; the first snapshot brings the changes missed while paused. */
  resume(): void {
    this.paused = false
    this.listen()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): DashboardSnapshot => this.snapshot

  mutate = (mutation: Mutation, { now = false }: MutateOptions = {}): void => {
    if (!this.canEdit) {
      if (!this.warnedReadOnly) {
        this.warnedReadOnly = true
        console.warn('Edit ignored: this dashboard was opened with a read-only link')
      }
      return
    }
    // The edit may make a dashboard that was too large fit again: it gets one more try.
    if (this.saveError === 'too-large') this.saveError = null
    this.queue.push(mutation)
    this.emit()
    if (now) this.flushNow()
    else this.scheduleFlush()
  }

  flushNow = (): void => {
    clearTimeout(this.saveTimer)
    this.firstEditAt = null
    void this.flush()
  }

  retry = (): void => {
    // The same edits would be too large again: retrying waits for another edit (see `mutate`).
    if (this.saveError !== 'failed') return
    this.saveError = null
    this.emit()
    this.flushNow()
  }

  private async openKeys(): Promise<SessionKeys> {
    if (!this.canEdit) return { encKey: await importReadKey(this.ref.key), writeKey: null }
    const { encKey, encKeyString, writeKey } = await deriveEditKeys(this.ref.key, this.ref.docId)
    // Known before the listener starts, so before the first state reaches the UI.
    this.readRef = readRefOf(this.ref, encKeyString)
    return { encKey, writeKey }
  }

  private onVisibilityChange = (): void => {
    clearTimeout(this.pauseTimer)
    if (globalThis.document?.visibilityState === 'hidden') {
      this.flushNow()
      this.pauseTimer = setTimeout(() => this.pause(), this.pauseAfterMs)
    } else {
      this.resume()
    }
  }

  private listen(): void {
    if (!this.started || this.paused || this.unsubscribe) return
    this.unsubscribe = onSnapshot(
      this.docRef!,
      (snap) => {
        // This tab's own write shows here before the server has accepted it. The
        // session already applies its pending edits, and `remote` must hold only
        // confirmed revisions, so a denied write can be rebased. Before the first
        // load, pending writes come from an earlier visit, and are only shown.
        const pending = snap.metadata.hasPendingWrites
        if (pending && this.remote) return
        if (!snap.exists()) {
          // Offline, a dashboard missing from the cache may still exist on the server: it is
          // reported as a connection problem, and loads if the server sends it later.
          this.setLoadError(snap.metadata.fromCache ? 'network' : 'not-found')
          return
        }
        readEnvelope(this.keys!.encKey, this.ref.docId, snap.data()).then(
          (revision) => (pending ? this.showUnconfirmed(revision) : this.adopt(revision.state, revision.rev)),
          (error) => this.setLoadError(loadErrorOf(error)),
        )
      },
      () => {
        // A failed listener receives nothing more: forgetting it lets `resume` listen again.
        this.unsubscribe = null
        this.setLoadError('network')
      },
    )
  }

  private unlisten(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  /**
   * Takes a server revision unless a newer one is already known: snapshots are
   * decrypted asynchronously and may finish out of order, or after a save.
   */
  private adopt(state: DashboardState, rev: number): void {
    if (rev < this.remoteRev) return
    const firstLoad = this.remote === null
    this.remote = state
    this.remoteRev = rev
    this.unconfirmed = null
    this.loadError = null
    this.emit()
    // Edits made before the first load were not written: they had no base.
    if (firstLoad && this.queue.length > 0) this.flushNow()
  }

  /** Like `adopt`, for a revision that is only shown. */
  private showUnconfirmed(revision: Revision): void {
    if (this.remote || revision.rev < (this.unconfirmed?.rev ?? 0)) return
    this.unconfirmed = revision
    this.loadError = null
    this.emit()
  }

  /** Restarts the idle timer, never pushing the save later than `max` after the first unsaved edit. */
  private scheduleFlush(): void {
    const { idle, max } = this.saveDelay
    const now = Date.now()
    this.firstEditAt ??= now
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(this.flushNow, Math.min(idle, Math.max(0, this.firstEditAt + max - now)))
  }

  private async flush(): Promise<void> {
    // Edits apply to the loaded state: the UI only offers them once it is shown.
    if (this.flushing || this.saveError || !this.keys?.writeKey || !this.remote) return
    this.flushing = true
    // Runs on after stop(): edits made before leaving the dashboard are still saved.
    // A failure ends the loop; `retry`, or an edit after `too-large`, starts a new one.
    while (this.queue.length > 0 && !this.saveError) {
      // Edits made while a write runs are grouped into the next one.
      this.inflight = this.queue
      this.queue = []
      this.writing = true
      this.emit()
      try {
        await this.save(compose(...this.inflight))
        this.inflight = []
      } catch (error) {
        console.error('Save failed', error)
        this.queue = [...this.inflight, ...this.queue]
        this.inflight = []
        this.saveError = error instanceof TooLargeError ? 'too-large' : 'failed'
        if (error instanceof DecryptError || error instanceof NewerVersionError) this.loadError = loadErrorOf(error)
      }
      this.writing = false
      this.emit()
    }
    this.flushing = false
  }

  /**
   * Writes `apply(remote)` as the next revision. When another save took that
   * revision first, the write is denied: the session reads the server state
   * once, and applies the same edits on top of it again.
   */
  private async save(apply: Mutation): Promise<void> {
    const { encKey, writeKey } = this.keys!
    const { docId } = this.ref
    for (;;) {
      // `remote` may move forward during any await below (a snapshot), so the
      // base of this attempt is captured here.
      const base = this.remote!
      const rev = this.remoteRev + 1
      const next = apply(base)
      if (next === base) return
      try {
        const proof = await proofFor(writeKey!, docId, rev)
        await updateDoc(this.docRef!, await toEnvelope(encKey, writeKey!, docId, next, rev, proof))
        this.adopt(next, rev)
        return
      } catch (error) {
        if (!isPermissionDenied(error)) throw error
        const server = await this.readTakenRevision(rev)
        // The revision was not taken by someone else: the write itself was refused.
        if (!server) throw error
        this.adopt(server.state, server.rev)
      }
    }
  }

  /**
   * The server revision after a denied write of `rev`, or null when it is still below `rev`. The
   * denial can come before the read sees the winner's write, so the read is repeated for a short
   * while before concluding that the write itself was refused.
   */
  private async readTakenRevision(rev: number): Promise<Revision | null> {
    for (let attempt = 0; ; attempt++) {
      const snap = await getDocFromServer(this.docRef!)
      const server = snap.exists() ? await readEnvelope(this.keys!.encKey, this.ref.docId, snap.data()) : null
      if (server && server.rev >= rev) return server
      if (!server || attempt === STALE_READ_RETRIES) return null
      await new Promise((resolve) => setTimeout(resolve, STALE_READ_DELAY_MS * (attempt + 1)))
    }
  }

  private setLoadError(error: LoadError): void {
    this.loadError = error
    this.emit()
  }

  private computeSnapshot(): DashboardSnapshot {
    const pending = [...this.inflight, ...this.queue]
    const base = this.remote ?? this.unconfirmed?.state ?? null
    // Mutations are idempotent, so re-applying edits the server already has is harmless.
    const state = base && pending.length > 0 ? compose(...pending)(base) : base
    return {
      state,
      confirmed: this.remote !== null,
      loadError: this.loadError,
      saving: pending.length > 0,
      writing: this.writing,
      saveError: this.saveError,
    }
  }

  private emit(): void {
    this.snapshot = this.computeSnapshot()
    for (const listener of this.listeners) listener()
  }
}
