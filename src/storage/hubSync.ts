import { buildHubContent, type HubContent } from '../domain/hub'
import { hasKey } from '../domain/limits'
import type { DashboardState, PersonId } from '../domain/types'
import { DEFAULT_SAVE_DELAY, type DashboardStore, type SaveDelay } from './dashboardStore'
import { HubExistsError, type HubBackend } from './hubBackend'
import { openHub, openHubPerson, sealHub } from './hubCrypto'
import { commitmentOf, deriveEditKeys, hubProofFor } from './keys'
import type { DashboardRef } from './link'
import { startPow } from './powClient'
import { importShareKey } from './shareCrypto'

export interface HubSyncOptions {
  /** Groups hub rewrites like dashboard saves; default DEFAULT_SAVE_DELAY. */
  delay?: SaveDelay
  /** The creation nonce of the hub document; default: `startPow(hubId).result`. */
  solvePow?: (hubId: string) => Promise<string>
}

/** A failed storage call is tried again after this long, or as soon as what it should write changes. */
const RETRY_MS = 30_000

/** The hub's content of one dashboard state, with the secret each person's entry is sealed with. */
interface Built {
  state: DashboardState
  content: HubContent
  secrets: Record<PersonId, string>
  json: string
}

interface Tracked {
  readonly id: string
  readonly key: string
  readonly hubKey: Promise<CryptoKey>
  /** Undefined until read; null when the document does not exist. */
  doc: { rev: number; json: string | null } | null | undefined
  /** One storage call at a time. */
  busy: boolean
  /** The write last seen as wanted: the save delay restarts only when it changes. */
  wanted: string | null
  /** The call that failed last, not tried again before `retryAt` unless what it does changes. */
  failed: string | null
  retryAt: number
}

/**
 * What decides whether the hub must be rewritten: its content, and the secret each entry is sealed
 * with, so a link made again for the same person is resealed even when the content is the same.
 */
const comparable = (content: HubContent, secrets: Record<PersonId, string>): string => JSON.stringify({ content, secrets })

/**
 * Keeps the hub document of a dashboard's personal links in step with it, in editors' apps only.
 * The hub is created once the state that records it is saved, then rewritten when its content
 * changes, at most once per save delay. It is not watched: the content is rebuilt from the state,
 * which every organizer already shares, and a write on a stale revision reads it again first.
 */
export class HubSync {
  private readonly backend: HubBackend
  private readonly ref: DashboardRef
  private readonly store: DashboardStore
  private readonly delay: SaveDelay
  private readonly solvePow: (hubId: string) => Promise<string>
  private tracked: Tracked | null = null
  private built: Built | null = null
  private started = false
  private unsubscribeStore: (() => void) | null = null
  private writeKey: Promise<CryptoKey> | null = null
  private writeTimer: ReturnType<typeof setTimeout> | undefined
  /** When the oldest unwritten change was seen, to bound the wait with `delay.max`. */
  private firstChangeAt: number | null = null
  /** The save delay has run out: a wanted write goes now. */
  private writesDue = false
  private readonly retryTimers = new Set<ReturnType<typeof setTimeout>>()

  constructor(backend: HubBackend, ref: DashboardRef, store: DashboardStore, options: HubSyncOptions = {}) {
    this.backend = backend
    this.ref = ref
    this.store = store
    this.delay = options.delay ?? DEFAULT_SAVE_DELAY
    this.solvePow = options.solvePow ?? ((hubId) => startPow(hubId).result)
  }

  /** Can be called again after stop(). */
  start(): void {
    if (this.started) return
    this.started = true
    this.unsubscribeStore = this.store.subscribe(this.update)
    this.update()
  }

  /** Calls in flight finish, but start nothing more; a hub creation in flight is abandoned. */
  stop(): void {
    this.started = false
    this.unsubscribeStore?.()
    this.unsubscribeStore = null
    clearTimeout(this.writeTimer)
    for (const timer of this.retryTimers) clearTimeout(timer)
    this.retryTimers.clear()
    this.firstChangeAt = null
    this.writesDue = false
    this.tracked = null
    this.built = null
  }

  private update = (): void => {
    if (!this.started) return
    this.step()
    this.writesDue = false
  }

  private step(): void {
    const { state, saving, confirmed } = this.store.getSnapshot()
    // A reader never writes, so it does not read either.
    if (!state || !this.store.canEdit) return
    const hub = state.hub
    if (!hub) {
      this.tracked = null
      return
    }
    // Another organizer's hub can win the race to the state: the current one is always followed,
    // and one that lost is dropped, never written.
    if (this.tracked?.id !== hub.id || this.tracked.key !== hub.key) this.tracked = this.newTracked(hub)
    const t = this.tracked
    if (t.busy) return
    if (t.doc === undefined) {
      this.run(t, 'read', () => this.read(t))
      return
    }
    const built = this.build(state)
    if (t.doc === null) {
      // Created only once the state that records it is saved: until then, a save rebased on
      // another organizer's edits can replace it with the hub they saved first.
      if (confirmed && !saving) this.run(t, `create|${built.json}`, () => this.create(t, built))
      return
    }
    if (built.json === t.doc.json) {
      t.wanted = null
      return
    }
    if (built.json !== t.wanted) {
      t.wanted = built.json
      this.scheduleWrite()
    }
    const doc = t.doc
    if (this.writesDue) this.run(t, `write|${built.json}`, () => this.write(t, doc, built))
  }

  private newTracked(hub: { id: string; key: string }): Tracked {
    const hubKey = importShareKey(hub.key)
    // Reported by the call that needs it, not as an unhandled rejection.
    hubKey.catch(() => {})
    return { id: hub.id, key: hub.key, hubKey, doc: undefined, busy: false, wanted: null, failed: null, retryAt: 0 }
  }

  /** The content and the secrets of one state, together: `sealHub` needs a secret for every person in it. */
  private build(state: DashboardState): Built {
    if (this.built?.state !== state) {
      const content = buildHubContent(state)!
      const links = state.personalLinks ?? {}
      const secrets: Record<PersonId, string> = {}
      for (const personId of Object.keys(content.people)) if (hasKey(links, personId)) secrets[personId] = links[personId].secret
      this.built = { state, content, secrets, json: comparable(content, secrets) }
    }
    return this.built
  }

  /** Remembers the revision, and the content when every entry opens with its person's current secret. */
  private async read(t: Tracked): Promise<void> {
    const stored = await this.backend.readHub(t.id)
    if (!stored) {
      t.doc = null
      return
    }
    let json: string | null = null
    try {
      const { shares, sealedPeople } = await openHub(await t.hubKey, t.id, stored.sealed)
      const links = this.store.getSnapshot().state?.personalLinks ?? {}
      const people: HubContent['people'] = {}
      const secrets: Record<PersonId, string> = {}
      for (const [personId, entry] of Object.entries(sealedPeople)) {
        if (!hasKey(links, personId)) throw new Error('A person with no link')
        secrets[personId] = links[personId].secret
        people[personId] = await openHubPerson(secrets[personId], t.id, personId, entry)
      }
      json = comparable({ v: 1, shares, people }, secrets)
    } catch {
      // Replaced by the next write.
    }
    t.doc = { rev: stored.rev, json }
  }

  private async create(t: Tracked, built: Built): Promise<void> {
    const writeKey = await this.editKey()
    const sealed = await sealHub(await t.hubKey, t.id, built.content, built.secrets)
    const nonce = await this.solvePow(t.id)
    // Stopped, or the state now records another hub.
    if (this.tracked !== t) return
    const next = await commitmentOf(await hubProofFor(writeKey, t.id, 2))
    try {
      await this.backend.createHub(t.id, sealed, { nonce, next })
      t.doc = { rev: 1, json: built.json }
    } catch (error) {
      if (!(error instanceof HubExistsError)) throw error
      // Another organizer's app created it first.
      t.doc = undefined
    }
  }

  /** Writes the next revision; on a conflict, the hub is read again and compared once more. */
  private async write(t: Tracked, doc: { rev: number }, built: Built): Promise<void> {
    const writeKey = await this.editKey()
    const sealed = await sealHub(await t.hubKey, t.id, built.content, built.secrets)
    const rev = doc.rev + 1
    const auth = {
      rev,
      proof: await hubProofFor(writeKey, t.id, rev),
      next: await commitmentOf(await hubProofFor(writeKey, t.id, rev + 1)),
    }
    if ((await this.backend.updateHub(t.id, sealed, auth)) === 'conflict') {
      t.doc = undefined
      return
    }
    t.doc = { rev, json: built.json }
  }

  private editKey(): Promise<CryptoKey> {
    this.writeKey ??= deriveEditKeys(this.ref.key, this.ref.docId).then((keys) => keys.writeKey)
    return this.writeKey
  }

  /**
   * Runs one storage call for the hub, then looks again. A failed call is not repeated before
   * RETRY_MS, unless what it does changes.
   */
  private run(t: Tracked, what: string, call: () => Promise<void>): void {
    if (t.failed === what && Date.now() < t.retryAt) return
    t.busy = true
    call().then(
      () => {
        t.failed = null
      },
      (error: unknown) => {
        // Only the kind of call: what it writes holds the personal secrets.
        console.error(`Hub ${t.id}: ${what.split('|')[0]} failed`, error)
        t.failed = what
        t.retryAt = Date.now() + RETRY_MS
        const timer = setTimeout(() => {
          this.retryTimers.delete(timer)
          // A rewrite waits for the save delay again.
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

  /** Restarts the idle timer, never pushing the write later than `max` after the first change. */
  private scheduleWrite(): void {
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
}
