import { hasKey } from '../domain/limits'
import { todayIso } from '../domain/dates'
import { foldAllReplies, trimTraces, type IncomingReply } from '../domain/replies'
import { forgetShare } from '../domain/shares'
import { buildSnapshot, type ShareSnapshot } from '../domain/shareSnapshot'
import type { DashboardState, Mutation, ShareEntry, ShareId } from '../domain/types'
import { DecryptError } from './crypto'
import { DEFAULT_SAVE_DELAY, type DashboardStore, type SaveDelay } from './dashboardStore'
import type { Sealed } from './envelope'
import { commitmentOf, deriveEditKeys, shareProofFor } from './keys'
import type { DashboardRef } from './link'
import { verifyReply } from './personalCrypto'
import { startPow } from './powClient'
import { REPLY_PAGE, ShareExistsError, type ReplyPageInfo, type ShareBackend, type ShareWrite, type StoredReply } from './shareBackend'
import { importOrganizerKey, importShareKey, openReply, openSnapshot, sealSnapshot } from './shareCrypto'

export interface ShareSyncSnapshot {
  /** Decrypted replies not yet folded (or, for readers, not in the dashboard yet), all open shares. */
  replies: IncomingReply[]
}

export interface ShareSyncOptions {
  /** Sorts the names in the share snapshots. */
  locale: string
  /** Groups snapshot rewrites like dashboard saves; default DEFAULT_SAVE_DELAY. */
  delay?: SaveDelay
  now?: () => number
  /** The creation nonce of a share document; default: `startPow(shareId).result`. */
  solvePow?: (shareId: string) => Promise<string>
  /** The key that signs the write proofs; default: the write key derived from the edit link. */
  editKey?: () => Promise<CryptoKey>
  /** A hidden tab stops listening after this long; default 5 minutes, like DashboardSession. */
  pauseAfterMs?: number
}

const DEFAULT_PAUSE_AFTER_MS = 5 * 60_000
/** A signed reply counts only when it reached the server within this long of being sent: an old one replayed later is ignored. */
const MAX_SIGNED_AGE_MS = 24 * 60 * 60_000
/** A failed storage call is tried again after this long, or as soon as what it should write changes. */
const RETRY_MS = 30_000
/** setTimeout fires at once beyond this delay (about 24.8 days). */
const MAX_TIMEOUT_MS = 2 ** 31 - 1

/** The share document as this app last read or wrote it. */
interface KnownShare {
  rev: number
  sealed: Sealed
  /** Null when it cannot be opened: any write then replaces it. */
  snapshot: ShareSnapshot | null
  /** `comparable(snapshot)`, worked out once. */
  json: string | null
  closesAt: number | null
  closed: boolean
  foldedUpTo: number | null
}

/** A decrypted reply, with what its signature is checked with once the person's secret is known. */
interface Opened {
  reply: IncomingReply
  mac?: string
  sentAt?: number
}

/** A share's snapshot of one dashboard state and its check-ins, with its comparable form. */
interface Built {
  state: DashboardState
  checkIns: IncomingReply[]
  snapshot: ShareSnapshot | null
  json: string | null
}

interface Tracked {
  readonly id: ShareId
  entry: ShareEntry
  readonly shareKey: Promise<CryptoKey>
  /** Counts listeners, so a page from a replaced one is ignored. */
  listener: number
  unwatch: (() => void) | null
  since: number
  /** The current listener's page has arrived and been decrypted. */
  loaded: boolean
  /** That page is the server's current result, not a cached or unconfirmed one. */
  fromServer: boolean
  page: StoredReply[]
  /** Decrypted replies of the page, newer than `mergedUpTo` when it arrived. */
  replies: IncomingReply[]
  /** The current listener's last page, opened again when the personal links change. */
  received: { page: StoredReply[]; info: ReplyPageInfo } | null
  /** `secrets()` when the last page started to be opened: it is opened again when they change. */
  checkingFor: string
  /**
   * `replies` of the last server page. A call link's snapshot shows its check-ins from these only:
   * a cached page can neither drop nor add a name, so the snapshot never flaps.
   */
  serverReplies: IncomingReply[]
  /**
   * Listening starts at least here: the last reply of a full page with nothing to fold, so a
   * page full of replies that cannot be opened does not stop the listener for good.
   */
  skipTo: number
  /** `createdAt` of the newest reply that could not be opened; it is deleted with the folded ones. */
  droppedUpTo: number
  /** Counts pages, so an older page decrypted late is ignored. */
  batch: number
  /** Decrypted replies by id. */
  readonly opened: Map<string, Promise<Opened | null>>
  /**
   * Personal replies by id, checked against the secret their person had then: a reply is checked
   * again when that secret changes (a link revoked or re-created).
   */
  readonly signed: Map<string, { secret: string; reply: Promise<IncomingReply> }>
  warned: boolean
  /** Undefined until read; null when the document does not exist. */
  doc: KnownShare | null | undefined
  /** The snapshot last built; built again only for a new state or server page, not on every store emit. */
  built: Built | null
  /** One storage call at a time per share. */
  busy: boolean
  /** The write last seen as wanted: the save delay restarts only when it changes. */
  wanted: string | null
  /** The call that failed last, not tried again before `retryAt` unless what it does changes. */
  failed: string | null
  retryAt: number
  /**
   * The close write is confirmed and the listener, started afterwards, listens from the start:
   * its server pages are complete, since no reply can be added to a closed share.
   */
  cleaning: boolean
  /** A missing document is read once more before the share is forgotten. */
  rechecked: boolean
  /** Replies already asked to be deleted. */
  readonly deleting: Set<string>
}

const NO_CHECK_INS: IncomingReply[] = []

const byCreation = (a: IncomingReply, b: IncomingReply): number => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * What decides whether a snapshot must be rewritten. A private page shows no answer and watches
 * no reply, so its snapshot's `at` is left out: folding a reply does not rewrite it.
 */
const comparable = (snapshot: ShareSnapshot | null): string | null =>
  snapshot && JSON.stringify(snapshot.visibility === 'private' ? { ...snapshot, at: 0 } : snapshot)

/**
 * A copy of the reply, with `signedWith: secret` and its `sentAt` when it carries a MAC of its fields
 * made with that secret and was sent within MAX_SIGNED_AGE_MS of reaching the server (the fold
 * ignores one not sent after the last personal reply it took: a replay within that day). Always a new object, so it
 * can be told apart from the reply checked with no secret. Check-ins are never signed: personal
 * links take no part in the roll call.
 */
async function verified(reply: IncomingReply, secret: string, mac: string | undefined, sentAt: number | undefined): Promise<IncomingReply> {
  const { shareId, personId, answer, device, createdAt } = reply
  if (mac === undefined || sentAt === undefined || answer === 'here' || answer === 'notHere') return { ...reply }
  if (Math.abs(createdAt - sentAt) > MAX_SIGNED_AGE_MS) return { ...reply }
  return (await verifyReply(secret, { shareId, personId, answer, device, sentAt }, mac)) ? { ...reply, signedWith: secret, sentAt } : { ...reply }
}

/** A personal answer, which counts only when signed; personal check-ins never count. */
const isSignable = (reply: IncomingReply): boolean => reply.via === 'personal' && reply.answer !== 'here' && reply.answer !== 'notHere'

// foldedUpTo goes through a Firestore Timestamp: equal to the microsecond.
const sameTime = (a: number | null, b: number | null): boolean => a === b || (a !== null && b !== null && Math.abs(a - b) < 0.0005)

/**
 * Keeps the reply links of an open dashboard in step with it. Everyone listens to the replies
 * not folded yet and sees them through `getSnapshot`. Editors also fold them into the dashboard,
 * keep each share document's snapshot and closing time current, and once a link is closed and
 * folded, delete its replies and forget it. Readers only listen.
 */
export class ShareSync {
  private readonly backend: ShareBackend
  private readonly ref: DashboardRef
  private readonly store: DashboardStore
  private readonly locale: string
  private readonly delay: SaveDelay
  private readonly now: () => number
  private readonly solvePow: (shareId: string) => Promise<string>
  private readonly customEditKey: (() => Promise<CryptoKey>) | undefined
  private readonly pauseAfterMs: number
  private readonly tracked = new Map<ShareId, Tracked>()
  private readonly listeners = new Set<() => void>()
  private snapshot: ShareSyncSnapshot = { replies: [] }
  private started = false
  private paused = false
  private updating = false
  private again = false
  private unsubscribeStore: (() => void) | null = null
  private writeKey: Promise<CryptoKey> | null = null
  private organizerKey: { jwk: string; key: Promise<CryptoKey> } | null = null
  private writeTimer: ReturnType<typeof setTimeout> | undefined
  /** When the oldest unwritten change was seen, to bound the wait with `delay.max`. */
  private firstChangeAt: number | null = null
  /** The save delay has run out: wanted writes go now. */
  private writesDue = false
  private wakeTimer: ReturnType<typeof setTimeout> | undefined
  private pauseTimer: ReturnType<typeof setTimeout> | undefined
  private readonly retryTimers = new Set<ReturnType<typeof setTimeout>>()
  /** The secret each personal reply was checked against; null when its person had no link. */
  private readonly checkedWith = new WeakMap<IncomingReply, string | null>()

  constructor(backend: ShareBackend, ref: DashboardRef, store: DashboardStore, options: ShareSyncOptions) {
    this.backend = backend
    this.ref = ref
    this.store = store
    this.locale = options.locale
    this.delay = options.delay ?? DEFAULT_SAVE_DELAY
    this.now = options.now ?? Date.now
    this.solvePow = options.solvePow ?? ((shareId) => startPow(shareId).result)
    this.customEditKey = options.editKey
    this.pauseAfterMs = options.pauseAfterMs ?? DEFAULT_PAUSE_AFTER_MS
  }

  /** Can be called again after stop(). */
  start(): void {
    if (this.started) return
    this.started = true
    this.paused = false
    this.unsubscribeStore = this.store.subscribe(this.update)
    globalThis.addEventListener?.('visibilitychange', this.onVisibilityChange)
    this.update()
  }

  /** Calls in flight finish, but start nothing more. */
  stop(): void {
    this.started = false
    this.unsubscribeStore?.()
    this.unsubscribeStore = null
    globalThis.removeEventListener?.('visibilitychange', this.onVisibilityChange)
    clearTimeout(this.writeTimer)
    clearTimeout(this.wakeTimer)
    clearTimeout(this.pauseTimer)
    for (const timer of this.retryTimers) clearTimeout(timer)
    this.retryTimers.clear()
    this.firstChangeAt = null
    this.writesDue = false
    for (const t of this.tracked.values()) this.unlisten(t)
    this.tracked.clear()
    this.setReplies([])
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): ShareSyncSnapshot => this.snapshot

  private onVisibilityChange = (): void => {
    clearTimeout(this.pauseTimer)
    if (globalThis.document?.visibilityState === 'hidden') {
      this.pauseTimer = setTimeout(this.pause, this.pauseAfterMs)
    } else if (this.paused) {
      this.paused = false
      this.update()
    }
  }

  private pause = (): void => {
    this.paused = true
    for (const t of this.tracked.values()) this.unlisten(t)
  }

  /** Runs `step` until nothing changes; a store change made by a step runs it again. */
  private update = (): void => {
    if (!this.started) return
    if (this.updating) {
      this.again = true
      return
    }
    this.updating = true
    try {
      do {
        this.again = false
        this.step()
      } while (this.again && this.started)
    } finally {
      this.updating = false
    }
  }

  private step(): void {
    const { state, saving, confirmed } = this.store.getSnapshot()
    if (!state) return
    this.track(state)
    this.recheck()
    if (this.store.canEdit && !this.fold(state)) {
      // Steps that cannot be undone wait for a state the server has confirmed, with nothing left to save.
      const settled = confirmed && !saving
      for (const t of this.tracked.values()) {
        // A forgotten share changes the store: the next step goes on with the new state.
        if (this.syncDocument(t, state, settled)) return
      }
      if (this.trim(state)) return
      this.writesDue = false
      this.scheduleWake()
    }
    this.setReplies(this.pending())
  }

  /** Follows the shares of the state: one reply listener each. */
  private track(state: DashboardState): void {
    const shares = state.shares ?? {}
    for (const [id, t] of this.tracked) {
      if (hasKey(shares, id)) continue
      this.unlisten(t)
      this.tracked.delete(id)
    }
    for (const [id, entry] of Object.entries(shares)) {
      let t = this.tracked.get(id)
      if (t) t.entry = entry
      else this.tracked.set(id, (t = this.newTracked(id, entry)))
      this.listen(t)
    }
  }

  private newTracked(id: ShareId, entry: ShareEntry): Tracked {
    const shareKey = importShareKey(entry.key)
    // Reported when a reply or snapshot needs it, not as an unhandled rejection.
    shareKey.catch(() => {})
    return {
      id,
      entry,
      shareKey,
      listener: 0,
      unwatch: null,
      since: 0,
      loaded: false,
      fromServer: false,
      page: [],
      replies: [],
      received: null,
      checkingFor: '',
      serverReplies: NO_CHECK_INS,
      skipTo: 0,
      droppedUpTo: 0,
      batch: 0,
      opened: new Map(),
      signed: new Map(),
      warned: false,
      doc: undefined,
      built: null,
      busy: false,
      wanted: null,
      failed: null,
      retryAt: 0,
      cleaning: false,
      rechecked: false,
      deleting: new Set(),
    }
  }

  /**
   * Listens from `mergedUpTo` (or `skipTo`), and again from there only when the page came back
   * full, or when the cursor went back below where the listener starts (a rebased fold cut short):
   * ordinary folds cost no re-read. While cleaning up, listens from the start.
   */
  private listen(t: Tracked): void {
    if (this.paused) return
    const since = t.cleaning ? 0 : Math.max(t.entry.mergedUpTo, t.skipTo)
    if (t.unwatch) {
      if (t.cleaning || !((t.page.length >= REPLY_PAGE && since > t.since) || since < t.since)) return
      this.unlisten(t)
    }
    const listener = ++t.listener
    t.since = since
    t.unwatch = this.backend.watchReplies(
      t.id,
      since,
      (page, info) => this.onPage(t, listener, page, info),
      (error) => {
        if (listener !== t.listener) return
        console.warn(`Reply link ${t.id}: listening failed`, error)
        // Forgetting the failed listener lets the next change listen again.
        t.unwatch = null
        t.loaded = false
      },
    )
  }

  private unlisten(t: Tracked): void {
    t.unwatch?.()
    t.unwatch = null
    t.listener++
    t.loaded = false
    t.fromServer = false
    t.received = null
  }

  /** A new listener, whose pages all reflect what the server holds from now on. */
  private restart(t: Tracked): void {
    this.unlisten(t)
    this.listen(t)
  }

  private onPage(t: Tracked, listener: number, page: StoredReply[], info: ReplyPageInfo): void {
    if (listener !== t.listener) return
    const { fromServer } = info
    const batch = ++t.batch
    t.received = { page, info }
    t.checkingFor = this.secrets()
    const fresh = page.filter((reply) => reply.createdAt > t.entry.mergedUpTo)
    // Only replies still in the page stay cached.
    const ids = new Set(page.map((reply) => reply.id))
    for (const id of t.opened.keys()) if (!ids.has(id)) t.opened.delete(id)
    for (const id of t.signed.keys()) if (!ids.has(id)) t.signed.delete(id)
    void Promise.all(fresh.map((reply) => this.open(t, reply))).then((opened) => {
      if (listener !== t.listener || batch !== t.batch) return
      // The page, its replies and where it came from change together.
      t.page = page
      t.replies = opened.filter((reply): reply is IncomingReply => reply !== null)
      // A cached page may miss replies the server has: only a server page moves the cursors.
      if (fromServer) {
        t.serverReplies = t.replies
        opened.forEach((reply, i) => {
          if (reply === null) t.droppedUpTo = Math.max(t.droppedUpTo, fresh[i].createdAt)
        })
        if (page.length >= REPLY_PAGE && this.pendingOf(t).length === 0) t.skipTo = Math.max(t.skipTo, page[page.length - 1].createdAt)
      }
      t.loaded = true
      t.fromServer = fromServer
      this.update()
    })
  }

  private open(t: Tracked, stored: StoredReply): Promise<IncomingReply | null> {
    let opened = t.opened.get(stored.id)
    if (!opened) {
      opened = this.decrypt(t, stored)
      t.opened.set(stored.id, opened)
    }
    return opened.then((o) => o && this.checkSignature(t, o))
  }

  /**
   * A personal reply with `signedWith` set when its MAC checks out with its person's current secret.
   * Other replies, and personal ones whose person has no link, are returned as decrypted.
   */
  private checkSignature(t: Tracked, { reply, mac, sentAt }: Opened): IncomingReply | Promise<IncomingReply> {
    if (reply.via !== 'personal') return reply
    const links = this.store.getSnapshot().state?.personalLinks
    const secret = links && hasKey(links, reply.personId) ? links[reply.personId].secret : undefined
    if (secret === undefined) {
      // `verified` never returns the decrypted object itself, so this one always stands for "no link".
      this.checkedWith.set(reply, null)
      return reply
    }
    const known = t.signed.get(reply.id)
    if (known?.secret === secret) return known.reply
    const checked = verified(reply, secret, mac, sentAt).then((result) => {
      this.checkedWith.set(result, secret)
      return result
    })
    t.signed.set(reply.id, { secret, reply: checked })
    return checked
  }

  /**
   * The replies a fold may take on `state`: on a presence link, none from the first personal answer
   * that was not checked against its person's secret in `state` on. Compared by time, so mergedUpTo
   * never passes it; `recheck` checks it again and a later fold takes it.
   */
  private foldable(replies: IncomingReply[], state: DashboardState): IncomingReply[] {
    const cuts = new Map<ShareId, number>()
    for (const reply of replies) {
      const share = state.shares && hasKey(state.shares, reply.shareId) ? state.shares[reply.shareId] : undefined
      if (share?.kind !== 'presence' || !isSignable(reply)) continue
      const links = state.personalLinks
      const secret = links && hasKey(links, reply.personId) ? links[reply.personId].secret : null
      if (this.checkedWith.get(reply) === secret) continue
      cuts.set(reply.shareId, Math.min(cuts.get(reply.shareId) ?? Infinity, reply.createdAt))
    }
    if (cuts.size === 0) return replies
    return replies.filter((reply) => reply.createdAt < (cuts.get(reply.shareId) ?? Infinity))
  }

  /** Null for a reply that cannot be opened or is invalid, with one warning per share. */
  private async decrypt(t: Tracked, stored: StoredReply): Promise<Opened | null> {
    try {
      const privateKey = stored.sealed.epk === undefined ? undefined : await this.privateKey()
      const { personId, answer, device, via, mac, sentAt } = await openReply({ shareKey: await t.shareKey, privateKey }, t.id, stored.sealed)
      return { reply: { id: stored.id, shareId: t.id, createdAt: stored.createdAt, personId, answer, device, via }, mac, sentAt }
    } catch (error) {
      if (!t.warned) {
        t.warned = true
        console.warn(`Reply link ${t.id}: ignoring a reply that cannot be opened`, error)
      }
      return null
    }
  }

  private privateKey(): Promise<CryptoKey> {
    const jwk = this.store.getSnapshot().state?.organizerKeys?.privateKey
    if (!jwk) return Promise.reject(new DecryptError())
    if (this.organizerKey?.jwk !== jwk) this.organizerKey = { jwk, key: importOrganizerKey(jwk) }
    return this.organizerKey.key
  }

  /** The personal links' secrets, in one comparable string. */
  private secrets(): string {
    const links = this.store.getSnapshot().state?.personalLinks ?? {}
    return JSON.stringify(Object.entries(links).map(([id, link]) => [id, link.secret]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  }

  /**
   * Opens each share's last page again once the personal links change, so its personal replies
   * are checked against the current secrets (only those whose secret changed are verified again).
   */
  private recheck(): void {
    const secrets = this.secrets()
    for (const t of this.tracked.values()) {
      if (t.unwatch && t.received && t.checkingFor !== secrets) this.onPage(t, t.listener, t.received.page, t.received.info)
    }
  }

  /** Replies of every share newer than its `mergedUpTo`, in fold order. */
  private pending(): IncomingReply[] {
    const replies: IncomingReply[] = []
    for (const t of this.tracked.values()) replies.push(...this.pendingOf(t))
    return replies.sort(byCreation)
  }

  private pendingOf(t: Tracked): IncomingReply[] {
    return t.replies.filter((reply) => reply.createdAt > t.entry.mergedUpTo)
  }

  /**
   * Folds every pending reply in one mutation, in one global order whatever share they came
   * from; the session's save delay groups it with other edits. True when the store changed.
   * Only server pages are folded: a cached page may miss an older reply, which would then end
   * below `mergedUpTo`, never folded. Cached replies are still shown (see `pending`).
   * Which personal replies count is decided on the state the fold is finally applied to: a save
   * rebased on a newer state (one with a link this device did not know) runs it again there.
   */
  private fold(state: DashboardState): boolean {
    const replies: IncomingReply[] = []
    for (const t of this.tracked.values()) if (t.fromServer) replies.push(...this.pendingOf(t))
    if (replies.length === 0) return false
    const mutation: Mutation = (current) => foldAllReplies(this.foldable(replies, current))(current)
    if (mutation(state) === state) return false
    this.store.mutate(mutation)
    return true
  }

  /** Trims the reply traces of the events that are over and have no link left. True when the store changed. */
  private trim(state: DashboardState): boolean {
    const mutation = trimTraces(todayIso(new Date(this.now())))
    if (mutation(state) === state) return false
    this.store.mutate(mutation)
    return true
  }

  /** Creates, updates or cleans up the share document. True when the store changed. */
  private syncDocument(t: Tracked, state: DashboardState, settled: boolean): boolean {
    if (t.busy) return false
    const { entry, doc } = t
    if (doc === undefined) {
      this.run(t, 'read', () => this.read(t))
      return false
    }
    const now = this.now()
    const closing =
      entry.closed ||
      (entry.closesAt !== null && now >= entry.closesAt) ||
      (doc !== null && (doc.closed || (doc.closesAt !== null && now >= doc.closesAt)))
    if (doc === null) {
      if (closing) {
        // Another organizer's app may have created it since it was read.
        if (!t.rechecked) {
          this.run(t, 'read', async () => {
            await this.read(t)
            // Only a read that worked: an offline one must not let the share be forgotten.
            t.rechecked = true
          })
          return false
        }
        // Never created, so no reply can exist.
        this.store.mutate(forgetShare(t.id))
        return true
      }
      // Created only once the link is saved: a save rebased on another organizer's edits can
      // undo it (a link opened elsewhere first, the event deleted, other organizer keys), and an
      // open document that no dashboard knows would take replies nobody folds.
      if (!settled) return false
      const { snapshot } = this.snapshotOf(t, state)
      if (snapshot) this.run(t, 'create', () => this.create(t, snapshot))
      return false
    }
    if (closing) return this.cleanUp(t, doc, state, settled)
    this.keepCurrent(t, doc, state)
    return false
  }

  /** Once the closing time has passed, the rules keep it as it is: it is never rewritten. */
  private closesAtFor(t: Tracked, doc: KnownShare): number | null {
    return doc.closesAt !== null && this.now() >= doc.closesAt ? doc.closesAt : t.entry.closesAt
  }

  /**
   * The share's snapshot of `state`, built again only when the state is a new one or, for a call
   * link, when a new server page brings its check-ins.
   */
  private snapshotOf(t: Tracked, state: DashboardState): Built {
    const checkIns = t.entry.kind === 'call' ? t.serverReplies : NO_CHECK_INS
    if (t.built?.state !== state || t.built.checkIns !== checkIns) {
      const snapshot = buildSnapshot(state, t.id, this.locale, checkIns)
      t.built = { state, checkIns, snapshot, json: comparable(snapshot) }
    }
    return t.built
  }

  /** Rewrites the snapshot and closing time when they changed, at most once per save delay. */
  private keepCurrent(t: Tracked, doc: KnownShare, state: DashboardState): void {
    const { snapshot: built, json } = this.snapshotOf(t, state)
    const snapshot = json !== null && json !== doc.json ? built : null
    const closesAt = this.closesAtFor(t, doc)
    if (!snapshot && closesAt === doc.closesAt) {
      t.wanted = null
      return
    }
    const wanted = `${json}|${closesAt}`
    if (wanted !== t.wanted) {
      t.wanted = wanted
      this.scheduleWrites()
    }
    if (this.writesDue) this.run(t, wanted, () => this.write(t, doc, { snapshot, closesAt, closed: false, foldedUpTo: doc.foldedUpTo }))
  }

  /**
   * A closed link, or one whose time has passed. Once every reply is folded and saved:
   * 1. closes the document with `foldedUpTo`, keeping its closing time;
   * 2. listens again from the start, and waits for a server page: no reply can be added any
   *    more, so a reply missed until then shows up, is folded, and `foldedUpTo` is written again;
   * 3. deletes the folded replies, and listens again, until a server page shows none;
   * 4. forgets the link. True when the store changed.
   * A call link not finished yet folds nothing, so its check-ins stay pending and it waits here
   * until a call is finished; once finished, the fold takes every reply and it cleans up as usual.
   * Once its event is deleted, the fold skips its check-ins and it cleans up as usual too.
   */
  private cleanUp(t: Tracked, doc: KnownShare, state: DashboardState, settled: boolean): boolean {
    if (!settled || !t.loaded || !t.fromServer || this.pendingOf(t).length > 0) return false
    if (!t.cleaning && t.page.length >= REPLY_PAGE) return false
    // Replies that cannot be opened are deleted too.
    const foldedUpTo = Math.max(t.entry.mergedUpTo, t.droppedUpTo)
    if (!doc.closed || !sameTime(doc.foldedUpTo, foldedUpTo)) {
      // The listener that follows this write is the one that can be trusted.
      t.cleaning = false
      // The last snapshot shows the final answers on the closed page.
      const { snapshot: built, json } = this.snapshotOf(t, state)
      const snapshot = json !== null && json !== doc.json ? built : null
      // Kept as stored: a device clock behind the server could otherwise move a passed closing time.
      const write = { snapshot, closesAt: doc.closesAt, closed: true, foldedUpTo }
      this.run(t, `close|${foldedUpTo}`, () => this.write(t, doc, write))
      return false
    }
    if (!t.cleaning) {
      t.cleaning = true
      this.restart(t)
      return false
    }
    const folded = t.page.filter((reply) => reply.createdAt <= foldedUpTo)
    const doomed = folded.filter((reply) => !t.deleting.has(reply.id)).map((reply) => reply.id)
    if (doomed.length > 0) {
      for (const id of doomed) t.deleting.add(id)
      this.run(t, `delete|${doomed.join(',')}`, async () => {
        try {
          await this.backend.deleteReplies(t.id, doomed)
        } catch (error) {
          // Not asked after all: they are tried again, rather than given up on.
          for (const id of doomed) t.deleting.delete(id)
          throw error
        }
        this.restart(t)
      })
      return false
    }
    if (folded.length > 0) console.warn(`Reply link ${t.id}: some folded replies could not be deleted`)
    this.store.mutate(forgetShare(t.id))
    return true
  }

  private async read(t: Tracked): Promise<void> {
    const stored = await this.backend.readShare(t.id)
    if (!stored) {
      t.doc = null
      return
    }
    let snapshot: ShareSnapshot | null = null
    try {
      snapshot = await openSnapshot(await t.shareKey, t.id, stored.sealed)
    } catch {
      // Replaced by the next write.
    }
    t.doc = { ...stored, snapshot, json: comparable(snapshot) }
  }

  private async create(t: Tracked, snapshot: ShareSnapshot): Promise<void> {
    const writeKey = await this.editKey()
    const write: ShareWrite = {
      sealed: await sealSnapshot(await t.shareKey, t.id, snapshot),
      closesAt: t.entry.closesAt,
      closed: false,
      foldedUpTo: null,
    }
    const nonce = await this.solvePow(t.id)
    const next = await commitmentOf(await shareProofFor(writeKey, t.id, 2))
    try {
      await this.backend.createShare(t.id, write, { nonce, next })
      t.doc = { rev: 1, snapshot, json: comparable(snapshot), ...write }
    } catch (error) {
      if (!(error instanceof ShareExistsError)) throw error
      // Another organizer's app created it first.
      t.doc = undefined
    }
  }

  /** Writes the next revision; on a conflict, the document is read again and compared once more. */
  private async write(
    t: Tracked,
    doc: KnownShare,
    change: { snapshot: ShareSnapshot | null; closesAt: number | null; closed: boolean; foldedUpTo: number | null },
  ): Promise<void> {
    const writeKey = await this.editKey()
    const { snapshot, ...fields } = change
    const write: ShareWrite = { sealed: snapshot ? await sealSnapshot(await t.shareKey, t.id, snapshot) : doc.sealed, ...fields }
    const rev = doc.rev + 1
    const auth = {
      rev,
      proof: await shareProofFor(writeKey, t.id, rev),
      next: await commitmentOf(await shareProofFor(writeKey, t.id, rev + 1)),
    }
    if ((await this.backend.updateShare(t.id, write, auth)) === 'conflict') {
      t.doc = undefined
      return
    }
    t.doc = snapshot ? { rev, snapshot, json: comparable(snapshot), ...write } : { rev, snapshot: doc.snapshot, json: doc.json, ...write }
  }

  private editKey(): Promise<CryptoKey> {
    this.writeKey ??= this.customEditKey?.() ?? deriveEditKeys(this.ref.key, this.ref.docId).then((keys) => keys.writeKey)
    return this.writeKey
  }

  /**
   * Runs one storage call for the share, then looks again. A failed call is not repeated
   * before RETRY_MS, unless what it does changes.
   */
  private run(t: Tracked, what: string, call: () => Promise<void>): void {
    if (t.failed === what && Date.now() < t.retryAt) return
    t.busy = true
    call().then(
      () => {
        t.failed = null
      },
      (error: unknown) => {
        console.error(`Reply link ${t.id}: ${what.split('|')[0]} failed`, error)
        t.failed = what
        t.retryAt = Date.now() + RETRY_MS
        const timer = setTimeout(() => {
          this.retryTimers.delete(timer)
          // A snapshot rewrite waits for the save delay again.
          t.wanted = null
          this.update()
        }, RETRY_MS)
        this.retryTimers.add(timer)
      },
    ).finally(() => {
      t.busy = false
      // A change still wanted after this call waits for a new save delay.
      t.wanted = null
      this.update()
    })
  }

  /** Restarts the idle timer, never pushing the writes later than `max` after the first change. */
  private scheduleWrites(): void {
    const { idle, max } = this.delay
    const now = Date.now()
    this.firstChangeAt ??= now
    clearTimeout(this.writeTimer)
    this.writeTimer = setTimeout(
      () => {
        this.firstChangeAt = null
        this.writesDue = true
        this.update()
      },
      Math.min(idle, Math.max(0, this.firstChangeAt + max - now)),
    )
  }

  /** Looks again when the next open link reaches its closing time. */
  private scheduleWake(): void {
    clearTimeout(this.wakeTimer)
    const now = this.now()
    let next = Infinity
    for (const { entry } of this.tracked.values()) {
      if (!entry.closed && entry.closesAt !== null && entry.closesAt > now) next = Math.min(next, entry.closesAt)
    }
    if (next !== Infinity) this.wakeTimer = setTimeout(this.update, Math.min(next - now, MAX_TIMEOUT_MS))
  }

  private setReplies(replies: IncomingReply[]): void {
    const current = this.snapshot.replies
    if (replies.length === current.length && replies.every((reply, i) => reply === current[i])) return
    this.snapshot = { replies }
    for (const listener of this.listeners) listener()
  }
}
