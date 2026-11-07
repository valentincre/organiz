import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyCheckIns, finishMutation, startCall } from '../domain/call'
import { addProperty, setValue } from '../domain/properties'
import { addEvent, addPerson, compose, deleteEvent, emptyState, moveEvent, renamePerson, setReply } from '../domain/mutations'
import { createPersonalLink, revokePersonalLink } from '../domain/personalLinks'
import { addShare, closeShare, closesAtFor, setOrganizerKeys } from '../domain/shares'
import type { DashboardState, Mutation, ShareKind, Visibility } from '../domain/types'
import { generateKeyString } from './crypto'
import type { DashboardSnapshot, DashboardStore, SaveDelay } from './dashboardStore'
import type { DashboardRef } from './link'
import { MemoryShareBackend } from './memoryShares'
import { signReply } from './personalCrypto'
import { REPLY_PAGE, type ReplyPageInfo, type ShareBackend, type ShareWrite, type StoredReply } from './shareBackend'
import { generateOrganizerKeys, importShareKey, openSnapshot, sealReply, type ReplyPayload } from './shareCrypto'
import { ShareSync, type ShareSyncOptions } from './shareSync'

const SHARE = 'S'.repeat(22)
const IMMEDIATE: SaveDelay = { idle: 0, max: 0 }
const EVENT_DATE = '2026-11-02'
const CLOSES_AT = closesAtFor('presence', { date: EVENT_DATE, start: '18:00' })

/** A store that applies each edit at once, like a saved session. */
class FakeStore implements DashboardStore {
  readonly readLink = null
  readonly canEdit: boolean
  mutations = 0
  private snapshot: DashboardSnapshot
  private readonly listeners = new Set<() => void>()

  constructor(state: DashboardState, canEdit = true) {
    this.canEdit = canEdit
    this.snapshot = { state, confirmed: true, loadError: null, saving: false, writing: false, saveError: null }
  }

  get state(): DashboardState {
    return this.snapshot.state!
  }

  async start(): Promise<void> {}
  stop(): void {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  getSnapshot = () => this.snapshot
  mutate = (mutation: Mutation): void => {
    this.mutations++
    if (!this.canEdit) return
    this.set(mutation(this.state))
  }
  flushNow(): void {}
  retry(): void {}

  /** Changes whether edits are being saved, or the state is confirmed by the server. */
  setStatus(status: Partial<Pick<DashboardSnapshot, 'saving' | 'confirmed'>>): void {
    this.snapshot = { ...this.snapshot, ...status }
    for (const listener of this.listeners) listener()
  }

  /** Replaces the state as if it came from the server. */
  set(state: DashboardState): void {
    if (state === this.state) return
    this.snapshot = { ...this.snapshot, state }
    for (const listener of this.listeners) listener()
  }
}

const baseState = (): DashboardState =>
  compose(
    addPerson('p1', 'Alice', 1),
    addPerson('p2', 'Bob', 2),
    addEvent('e1', EVENT_DATE, { name: 'Training', start: '18:00', end: '20:00' }, 3),
  )(emptyState('Club'))

/**
 * Like DashboardSession: edits are shown at once on top of the last server state, and applied
 * again to a newer one that arrives before they are saved (a write denied on its stale revision).
 */
class RebasingStore extends FakeStore {
  private pending: Mutation[] = []

  override mutate = (mutation: Mutation): void => {
    this.mutations++
    this.pending.push(mutation)
    this.set(mutation(this.state))
  }

  /** A newer server state: the unsaved edits are rebased on it. */
  receive(remote: DashboardState): void {
    this.set(this.pending.reduce((state, mutation) => mutation(state), remote))
  }
}

/**
 * The memory backend, with Firestore's ways of delivering reply pages: they can be marked as
 * cached, and a reply can be held back from the listeners started before the first close write.
 */
class TestBackend implements ShareBackend {
  readonly inner: MemoryShareBackend
  /** `createdAt` of the replies the early listeners do not see. */
  readonly heldBack = new Set<number>()
  fromServer = true
  /** `since` of every listener started. */
  readonly watches: number[] = []
  creates = 0
  /** Called before each readShare with its number (1 for the first); throwing makes the read fail. */
  onRead: ((call: number) => void) | null = null
  private reads = 0
  private closeWrites = 0
  private readonly deliveries = new Set<() => void>()

  constructor(now: () => number) {
    this.inner = new MemoryShareBackend({ now })
  }

  get active(): number {
    return this.deliveries.size
  }

  createShare(shareId: string, write: ShareWrite, auth: { nonce: string; next: string }) {
    this.creates++
    return this.inner.createShare(shareId, write, auth)
  }
  async updateShare(shareId: string, write: ShareWrite, auth: { rev: number; proof: string; next: string }) {
    const result = await this.inner.updateShare(shareId, write, auth)
    if (result === 'ok' && write.closed) this.closeWrites++
    return result
  }
  async readShare(shareId: string) {
    this.onRead?.(++this.reads)
    return this.inner.readShare(shareId)
  }
  watchShare(...args: Parameters<ShareBackend['watchShare']>) {
    return this.inner.watchShare(...args)
  }
  addReply(...args: Parameters<ShareBackend['addReply']>) {
    return this.inner.addReply(...args)
  }
  deleteReplies(...args: Parameters<ShareBackend['deleteReplies']>) {
    return this.inner.deleteReplies(...args)
  }
  watchReplies(shareId: string, since: number, onReplies: (replies: StoredReply[], page: ReplyPageInfo) => void, onError: (error: unknown) => void) {
    this.watches.push(since)
    const holds = this.closeWrites === 0
    let last: StoredReply[] = []
    const deliver = () => onReplies(holds ? last.filter((r) => !this.heldBack.has(r.createdAt)) : last, { fromServer: this.fromServer })
    this.deliveries.add(deliver)
    const stop = this.inner.watchReplies(
      shareId,
      since,
      (replies) => {
        last = replies
        deliver()
      },
      onError,
    )
    return () => {
      this.deliveries.delete(deliver)
      stop()
    }
  }

  /** Delivers the current pages again, e.g. once they come from the server. */
  resend(): void {
    for (const deliver of [...this.deliveries]) deliver()
  }
}

const editRef = (): DashboardRef => ({ docId: 'D'.repeat(22), key: generateKeyString(), access: 'edit' })

interface Setup {
  clock: { now: number }
  backend: TestBackend
  store: FakeStore
  sync: ShareSync
  shareKey: string
}

const syncs: ShareSync[] = []
afterEach(() => {
  for (const sync of syncs.splice(0)) sync.stop()
})

function startSync(
  backend: ShareBackend,
  store: DashboardStore,
  clock: { now: number },
  ref = editRef(),
  options: Partial<ShareSyncOptions> = {},
): ShareSync {
  const sync = new ShareSync(backend, ref, store, { locale: 'en', delay: IMMEDIATE, now: () => clock.now, solvePow: async () => 'nonce', ...options })
  syncs.push(sync)
  sync.start()
  return sync
}

async function setup({
  kind = 'presence',
  visibility = 'public',
  autoClose = false,
  state = baseState(),
  options = {},
}: {
  kind?: ShareKind
  visibility?: Visibility
  autoClose?: boolean
  state?: DashboardState
  options?: Partial<ShareSyncOptions> | ((backend: TestBackend) => Partial<ShareSyncOptions>)
} = {}): Promise<Setup> {
  const clock = { now: CLOSES_AT - 10 * 60_000 }
  const backend = new TestBackend(() => clock.now)
  const store = new FakeStore(state)
  const sync = startSync(backend, store, clock, editRef(), typeof options === 'function' ? options(backend) : options)
  const shareKey = generateKeyString()
  store.mutate(addShare(SHARE, { eventId: 'e1', kind, key: shareKey, visibility, autoClose }, clock.now))
  await vi.waitFor(async () => expect(await backend.readShare(SHARE)).not.toBeNull())
  return { clock, backend, store, sync, shareKey }
}

/** A share already created on a store that rebases its unsaved edits. */
async function rebasingSetup(): Promise<{ s: Setup; store: RebasingStore }> {
  const clock = { now: CLOSES_AT - 10 * 60_000 }
  const backend = new TestBackend(() => clock.now)
  const shareKey = generateKeyString()
  const store = new RebasingStore(addShare(SHARE, { eventId: 'e1', kind: 'presence', key: shareKey, visibility: 'public', autoClose: false }, clock.now)(baseState()))
  const sync = startSync(backend, store, clock)
  await vi.waitFor(async () => expect(await backend.readShare(SHARE)).not.toBeNull())
  return { s: { clock, backend, store, sync, shareKey }, store }
}

const payload = (personId: string, answer: ReplyPayload['answer'], device = 'phone1'): ReplyPayload => ({ personId, answer, device, via: 'shared' })

async function reply({ clock, backend, shareKey }: Setup, p: ReplyPayload, to?: { publicKey: string }): Promise<number> {
  clock.now += 1_000
  await backend.addReply(SHARE, await sealReply(to ?? { shareKey: await importShareKey(shareKey) }, SHARE, p))
  return clock.now
}

const SECRET = generateKeyString()
const OTHER = generateKeyString()
const HOUR = 60 * 60_000

/** A reply sent through p's personal link, signed with `secret`; `sentAt` is `sentBefore` ms before the server time. */
async function personalReply(s: Setup, personId: string, answer: 'yes' | 'no', secret: string, sentBefore = 0): Promise<number> {
  s.clock.now += 1_000
  const sentAt = s.clock.now - sentBefore
  const mac = await signReply(secret, { shareId: SHARE, personId, answer, device: 'phone1', sentAt })
  const p: ReplyPayload = { personId, answer, device: 'phone1', via: 'personal', mac, sentAt }
  await s.backend.addReply(SHARE, await sealReply({ shareKey: await importShareKey(s.shareKey) }, SHARE, p))
  return s.clock.now
}

function storedReplies(backend: TestBackend): StoredReply[] {
  let replies: StoredReply[] = []
  backend.inner.watchReplies(SHARE, 0, (r) => (replies = r), () => {})()
  return replies
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** The snapshot stored in the share document. */
async function storedSnapshot({ backend, shareKey }: Setup) {
  return openSnapshot(await importShareKey(shareKey), SHARE, (await backend.readShare(SHARE))!.sealed)
}

describe('ShareSync', () => {
  it('creates the share document of a new link', async () => {
    const { backend, store, shareKey } = await setup()
    const share = (await backend.readShare(SHARE))!
    expect(share).toMatchObject({ rev: 1, closesAt: null, closed: false, foldedUpTo: null })
    const snapshot = await openSnapshot(await importShareKey(shareKey), SHARE, share.sealed)
    expect(snapshot).toMatchObject({ kind: 'presence', visibility: 'public', dashboard: 'Club', at: 0 })
    expect(snapshot.event).toMatchObject({ name: 'Training', date: EVENT_DATE, start: '18:00', end: '20:00' })
    expect(snapshot.people).toEqual([
      { id: 'p1', name: 'Alice' },
      { id: 'p2', name: 'Bob' },
    ])
    expect(store.state.shares![SHARE].mergedUpTo).toBe(0)
  })

  it('folds replies once and stops listening to them', async () => {
    const s = await setup()
    const before = s.store.mutations
    // Both replies arrive before the sync has decrypted the first one.
    s.clock.now += 1_000
    const key = await importShareKey(s.shareKey)
    const sealed = [await sealReply({ shareKey: key }, SHARE, payload('p1', 'yes')), await sealReply({ shareKey: key }, SHARE, payload('p2', 'no', 'phone2'))]
    const first = s.backend.addReply(SHARE, sealed[0])
    s.clock.now += 1_000
    const second = s.backend.addReply(SHARE, sealed[1])
    await Promise.all([first, second])
    const newest = s.clock.now

    await vi.waitFor(() => expect(s.store.state.shares![SHARE].mergedUpTo).toBe(newest))
    expect(s.store.state.events.e1.yes).toEqual(['p1'])
    expect(s.store.state.events.e1.no).toEqual(['p2'])
    expect(s.store.state.events.e1.replyLog).toEqual({
      p1: { via: 'shared', at: newest - 1_000, device: 'phone1' },
      p2: { via: 'shared', at: newest, device: 'phone2' },
    })
    expect(s.sync.getSnapshot().replies).toEqual([])
    await sleep(20)
    expect(s.store.mutations - before).toBe(1)
    // The snapshot now carries the folded answers.
    await vi.waitFor(async () => expect((await s.backend.readShare(SHARE))!.rev).toBe(2))
    const snapshot = await openSnapshot(await importShareKey(s.shareKey), SHARE, (await s.backend.readShare(SHARE))!.sealed)
    expect(snapshot).toMatchObject({ answers: { p1: 'yes', p2: 'no' }, at: newest })
  })

  it('rewrites the snapshot when a name changes, not when nothing does', async () => {
    const { backend, store, shareKey } = await setup()
    store.mutate(renamePerson('p1', 'Alicia'))
    await vi.waitFor(async () => expect((await backend.readShare(SHARE))!.rev).toBe(2))
    const snapshot = await openSnapshot(await importShareKey(shareKey), SHARE, (await backend.readShare(SHARE))!.sealed)
    expect(snapshot.people[0]).toEqual({ id: 'p1', name: 'Alicia' })

    // Person properties are not in the snapshot.
    store.mutate(compose(addProperty('person', 'role', 'text', 'Role', [], 1), setValue('person', 'p1', 'role', 'Coach')))
    await sleep(30)
    expect((await backend.readShare(SHARE))!.rev).toBe(2)
  })

  it('a reader shows replies without folding or writing', async () => {
    const s = await setup()
    // The editor's app is closed; only a reader is watching.
    s.sync.stop()
    const reader = new FakeStore(s.store.state, false)
    const readerSync = startSync(s.backend, reader, s.clock, { docId: 'D'.repeat(22), key: generateKeyString(), access: 'read' })
    const at = await reply(s, payload('p1', 'yes'))

    await vi.waitFor(() => expect(readerSync.getSnapshot().replies).toHaveLength(1))
    expect(readerSync.getSnapshot().replies[0]).toMatchObject({ shareId: SHARE, createdAt: at, personId: 'p1', answer: 'yes', device: 'phone1', via: 'shared' })
    await sleep(20)
    expect(reader.mutations).toBe(0)
    expect((await s.backend.readShare(SHARE))!.rev).toBe(1)
  })

  it('opens private replies with the organizer key', async () => {
    const keys = await generateOrganizerKeys()
    const s = await setup({ visibility: 'private', state: setOrganizerKeys(keys)(baseState()) })
    const at = await reply(s, payload('p2', 'yes'), { publicKey: keys.publicKey })

    await vi.waitFor(() => expect(s.store.state.shares![SHARE].mergedUpTo).toBe(at))
    expect(s.store.state.events.e1.yes).toEqual(['p2'])
    expect(s.sync.getSnapshot().replies).toEqual([])
  })

  it('drops a reply it cannot open, with one warning', async () => {
    const s = await setup()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const wrongKey = await importShareKey(generateKeyString())
      s.clock.now += 1_000
      await s.backend.addReply(SHARE, await sealReply({ shareKey: wrongKey }, SHARE, payload('p1', 'yes')))
      s.clock.now += 1_000
      await s.backend.addReply(SHARE, await sealReply({ shareKey: wrongKey }, SHARE, payload('p2', 'yes')))
      const at = await reply(s, payload('p2', 'no'))
      await vi.waitFor(() => expect(s.store.state.shares![SHARE].mergedUpTo).toBe(at))
      expect(s.store.state.events.e1.no).toEqual(['p2'])
      expect(s.store.state.events.e1.yes).toBeUndefined()
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })

  it('closes, cleans up and forgets a closed link', async () => {
    const s = await setup()
    await reply(s, payload('p1', 'yes'))
    const at = await reply(s, payload('p2', 'no', 'phone2'))
    await vi.waitFor(() => expect(s.store.state.shares![SHARE].mergedUpTo).toBe(at))

    s.store.mutate(closeShare(SHARE))
    await vi.waitFor(() => expect(s.store.state.shares).toBeUndefined())
    expect(await s.backend.readShare(SHARE)).toMatchObject({ closed: true, foldedUpTo: at })
    expect(storedReplies(s.backend)).toEqual([])
    // The answers stay in the dashboard.
    expect(s.store.state.events.e1.yes).toEqual(['p1'])
    expect(s.store.state.events.e1.no).toEqual(['p2'])
  })

  it("keeps only where the replies came from once a past event's last link is forgotten", async () => {
    const s = await setup()
    await reply(s, payload('p1', 'yes'))
    s.store.mutate(closeShare(SHARE))
    await vi.waitFor(() => expect(s.store.state.shares).toBeUndefined())
    // Still the event's day: the trace keeps its time and device.
    expect(s.store.state.events.e1.replyLog!.p1).toMatchObject({ via: 'shared', device: 'phone1' })

    s.clock.now = new Date(2026, 10, 3, 10).getTime()
    s.store.mutate(addProperty('person', 'role', 'text', 'Role', [], 1))
    await vi.waitFor(() => expect(s.store.state.events.e1.replyLog).toEqual({ p1: { via: 'shared' } }))
    expect(s.store.state.events.e1.repliesSeenAt).toBeUndefined()
    expect(s.store.state.events.e1.yes).toEqual(['p1'])
  })

  it('trims the traces of past events with no link when it starts', () => {
    const state = setReply('e1', 'p1', 'yes', 5)({ ...baseState(), shares: { [SHARE]: { eventId: 'e1', kind: 'presence', key: 'k', visibility: 'public', autoClose: false, closesAt: null, closed: true, createdAt: 1, mergedUpTo: 0 } } })
    const { shares: _shares, ...unlinked } = state
    const store = new FakeStore(unlinked)
    startSync(new TestBackend(() => 0), store, { now: new Date(2026, 10, 3, 10).getTime() })
    expect(store.state.events.e1.replyLog).toEqual({ p1: { via: 'hand' } })
  })

  it('leaves the traces to editors', () => {
    const state = setReply('e1', 'p1', 'yes', 5)({ ...baseState(), shares: { [SHARE]: { eventId: 'e1', kind: 'presence', key: 'k', visibility: 'public', autoClose: false, closesAt: null, closed: true, createdAt: 1, mergedUpTo: 0 } } })
    const { shares: _shares, ...unlinked } = state
    const store = new FakeStore(unlinked, false)
    startSync(new TestBackend(() => 0), store, { now: new Date(2026, 10, 3, 10).getTime() })
    expect(store.mutations).toBe(0)
  })

  it('closes a link whose time has passed', async () => {
    const s = await setup({ autoClose: true })
    expect((await s.backend.readShare(SHARE))!.closesAt).toBe(CLOSES_AT)
    const at = await reply(s, payload('p1', 'yes'))
    await vi.waitFor(() => expect(s.store.state.shares![SHARE].mergedUpTo).toBe(at))

    // Shortly before the closing time, an edit lets the sync see how long is left; the closing
    // time then passes with no other change, so only its timer can notice.
    s.clock.now = CLOSES_AT - 20
    s.store.mutate(addProperty('person', 'role', 'text', 'Role', [], 1))
    s.clock.now = CLOSES_AT + 1
    await vi.waitFor(() => expect(s.store.state.shares).toBeUndefined())
    expect(await s.backend.readShare(SHARE)).toMatchObject({ closed: true, foldedUpTo: at, closesAt: CLOSES_AT })
    expect(storedReplies(s.backend)).toEqual([])
    expect(s.store.state.events.e1.yes).toEqual(['p1'])
  })

  it('pushes the new closing time when the event moves', async () => {
    const s = await setup({ autoClose: true })
    s.store.mutate(moveEvent('e1', '2026-11-03', s.clock.now))
    const moved = closesAtFor('presence', { date: '2026-11-03', start: '18:00' })
    await vi.waitFor(async () => expect((await s.backend.readShare(SHARE))!.closesAt).toBe(moved))
    expect((await s.backend.readShare(SHARE))!.rev).toBe(2)
  })

  it('keeps a passed closing time when the event moves after closing', async () => {
    const s = await setup({ autoClose: true })
    const at = await reply(s, payload('p1', 'yes'))
    await vi.waitFor(() => expect(s.store.state.shares![SHARE].mergedUpTo).toBe(at))
    // The event was moved on another device after the closing time; this app opens afterwards.
    s.sync.stop()
    s.clock.now = CLOSES_AT + 1
    s.store.set(moveEvent('e1', '2026-11-01', 0)(s.store.state))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      startSync(s.backend, s.store, s.clock)
      await vi.waitFor(() => expect(s.store.state.shares).toBeUndefined())
      expect(await s.backend.readShare(SHARE)).toMatchObject({ closed: true, closesAt: CLOSES_AT, foldedUpTo: at })
      expect(error).not.toHaveBeenCalled()
    } finally {
      error.mockRestore()
    }
  })

  it('cleans up once the stored closing time has passed, even if the event moved later', async () => {
    const s = await setup({ autoClose: true })
    const at = await reply(s, payload('p1', 'yes'))
    await vi.waitFor(() => expect(s.store.state.shares![SHARE].mergedUpTo).toBe(at))
    // Moved on a device whose clock was behind: the state's closing time is still ahead.
    s.sync.stop()
    s.clock.now = CLOSES_AT + 1
    s.store.set(moveEvent('e1', '2026-11-05', 0)(s.store.state))
    expect(s.store.state.shares![SHARE].closesAt).toBeGreaterThan(s.clock.now)
    startSync(s.backend, s.store, s.clock)
    await vi.waitFor(() => expect(s.store.state.shares).toBeUndefined())
    expect(await s.backend.readShare(SHARE)).toMatchObject({ closed: true, closesAt: CLOSES_AT, foldedUpTo: at })
  })

  it('folds a reply the listener missed before the close write, then cleans up', async () => {
    const s = await setup()
    await reply(s, payload('p1', 'yes'))
    // Accepted by the server, but not delivered to the listener open before the close write.
    s.backend.heldBack.add(s.clock.now + 1_000)
    const late = await reply(s, payload('p2', 'no', 'phone2'))
    await sleep(20)
    expect(s.store.state.shares![SHARE].mergedUpTo).toBe(late - 1_000)

    s.store.mutate(closeShare(SHARE))
    await vi.waitFor(() => expect(s.store.state.shares).toBeUndefined())
    expect(s.store.state.events.e1.no).toEqual(['p2'])
    expect(await s.backend.readShare(SHARE)).toMatchObject({ closed: true, foldedUpTo: late })
    expect(storedReplies(s.backend)).toEqual([])
  })

  it('shows a cached reply without folding it until a server page arrives', async () => {
    const s = await setup()
    s.backend.fromServer = false
    const at = await reply(s, payload('p1', 'yes'))
    await vi.waitFor(() => expect(s.sync.getSnapshot().replies).toHaveLength(1))
    expect(s.sync.getSnapshot().replies[0]).toMatchObject({ personId: 'p1', answer: 'yes', createdAt: at })
    await sleep(20)
    expect(s.store.state.shares![SHARE].mergedUpTo).toBe(0)

    s.backend.fromServer = true
    s.backend.resend()
    await vi.waitFor(() => expect(s.store.state.shares![SHARE].mergedUpTo).toBe(at))
    expect(s.store.state.events.e1.yes).toEqual(['p1'])
    expect(s.sync.getSnapshot().replies).toEqual([])
  })

  it('does not close on a cached page', async () => {
    const s = await setup()
    const at = await reply(s, payload('p1', 'yes'))
    await vi.waitFor(() => expect(s.store.state.shares![SHARE].mergedUpTo).toBe(at))
    // The page is delivered again, from the cache this time.
    s.backend.fromServer = false
    s.backend.resend()
    await sleep(10)
    s.store.mutate(closeShare(SHARE))
    await sleep(30)
    expect(await s.backend.readShare(SHARE)).toMatchObject({ closed: false })

    s.backend.fromServer = true
    s.backend.resend()
    await vi.waitFor(() => expect(s.store.state.shares).toBeUndefined())
    expect(await s.backend.readShare(SHARE)).toMatchObject({ closed: true, foldedUpTo: at })
  })

  it('creates the share document only once the link is saved', async () => {
    const clock = { now: CLOSES_AT - 10 * 60_000 }
    const backend = new TestBackend(() => clock.now)
    const store = new FakeStore(baseState())
    startSync(backend, store, clock)
    store.setStatus({ saving: true })
    store.mutate(addShare(SHARE, { eventId: 'e1', kind: 'presence', key: generateKeyString(), visibility: 'public', autoClose: false }, clock.now))
    await sleep(30)
    expect(backend.creates).toBe(0)

    store.setStatus({ saving: false })
    await vi.waitFor(async () => expect(await backend.readShare(SHARE)).not.toBeNull())
    expect(backend.creates).toBe(1)
  })

  it('never creates the document of a link a rebased save undid', async () => {
    const clock = { now: CLOSES_AT - 10 * 60_000 }
    const backend = new TestBackend(() => clock.now)
    const before = baseState()
    const store = new FakeStore(before)
    startSync(backend, store, clock)
    store.setStatus({ saving: true })
    store.mutate(addShare(SHARE, { eventId: 'e1', kind: 'presence', key: generateKeyString(), visibility: 'public', autoClose: false }, clock.now))
    await sleep(20)
    // Rebased on another organizer's edit (here, the event was deleted): the link is gone.
    store.set(before)
    store.setStatus({ saving: false })
    await sleep(30)
    expect(backend.creates).toBe(0)
    expect(await backend.readShare(SHARE)).toBeNull()
  })

  it('waits for a confirmed state before closing and deleting', async () => {
    const s = await setup()
    const at = await reply(s, payload('p1', 'yes'))
    await vi.waitFor(() => expect(s.store.state.shares![SHARE].mergedUpTo).toBe(at))
    // Shown from writes an earlier offline visit left pending, not yet confirmed by the server.
    s.store.setStatus({ confirmed: false })
    s.store.mutate(closeShare(SHARE))
    await sleep(30)
    expect(await s.backend.readShare(SHARE)).toMatchObject({ closed: false })
    expect(storedReplies(s.backend)).toHaveLength(1)

    s.store.setStatus({ confirmed: true })
    await vi.waitFor(() => expect(s.store.state.shares).toBeUndefined())
    expect(await s.backend.readShare(SHARE)).toMatchObject({ closed: true, foldedUpTo: at })
    expect(storedReplies(s.backend)).toEqual([])
  })

  it('forgets a link with no document only after reading it again', async () => {
    const clock = { now: CLOSES_AT - 10 * 60_000 }
    // A link closed before its document was ever created.
    const closed = () =>
      compose(addShare(SHARE, { eventId: 'e1', kind: 'presence', key: generateKeyString(), visibility: 'public', autoClose: false }, clock.now), closeShare(SHARE))(baseState())
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      // The second read fails (offline): the link must stay.
      const offline = new TestBackend(() => clock.now)
      offline.onRead = (call) => {
        if (call === 2) throw new Error('unavailable')
      }
      const kept = new FakeStore(closed())
      startSync(offline, kept, clock)
      await vi.waitFor(() => expect(error).toHaveBeenCalled())
      await sleep(20)
      expect(kept.state.shares![SHARE]).toBeDefined()

      // Both reads work: the link is forgotten.
      const online = new TestBackend(() => clock.now)
      const forgotten = new FakeStore(closed())
      startSync(online, forgotten, clock)
      await vi.waitFor(() => expect(forgotten.state.shares).toBeUndefined())
      expect(online.creates).toBe(0)
    } finally {
      error.mockRestore()
    }
  })

  it('gets past a full page of replies it cannot open', async () => {
    const s = await setup()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const wrongKey = await importShareKey(generateKeyString())
      const garbage = await sealReply({ shareKey: wrongKey }, SHARE, payload('p1', 'no'))
      for (let i = 0; i < REPLY_PAGE; i++) {
        s.clock.now += 1_000
        await s.backend.addReply(SHARE, garbage)
      }
      const at = await reply(s, payload('p2', 'yes'))
      for (let i = 0; i < 2; i++) {
        s.clock.now += 1_000
        await s.backend.addReply(SHARE, garbage)
      }
      const last = s.clock.now
      await vi.waitFor(() => expect(s.store.state.shares![SHARE].mergedUpTo).toBe(at))
      expect(s.store.state.events.e1.yes).toEqual(['p2'])

      // The replies it could not open are deleted with the folded ones.
      s.store.mutate(closeShare(SHARE))
      await vi.waitFor(() => expect(s.store.state.shares).toBeUndefined())
      expect(await s.backend.readShare(SHARE)).toMatchObject({ closed: true, foldedUpTo: last })
      expect(storedReplies(s.backend)).toEqual([])
    } finally {
      warn.mockRestore()
    }
  })

  it('listens again only when a page comes back full', async () => {
    const s = await setup()
    // Replies sent while no organizer app is open.
    s.sync.stop()
    const key = await importShareKey(s.shareKey)
    const times: number[] = []
    for (let i = 0; i <= REPLY_PAGE; i++) {
      s.clock.now += 1_000
      await s.backend.addReply(SHARE, await sealReply({ shareKey: key }, SHARE, payload(i % 2 ? 'p1' : 'p2', i % 3 ? 'yes' : 'no')))
      times.push(s.clock.now)
    }
    const watches = s.backend.watches.length
    startSync(s.backend, s.store, s.clock)
    await vi.waitFor(() => expect(s.store.state.shares![SHARE].mergedUpTo).toBe(times[REPLY_PAGE]))
    expect(s.backend.watches.slice(watches)).toEqual([0, times[REPLY_PAGE - 1]])

    const at = await reply(s, payload('p1', 'no'))
    await vi.waitFor(() => expect(s.store.state.shares![SHARE].mergedUpTo).toBe(at))
    expect(s.backend.watches.slice(watches)).toEqual([0, times[REPLY_PAGE - 1]])
  })

  it('reads the document again after a conflict and writes on top of it', async () => {
    const s = await setup()
    // Another organizer's app writes revision 2 first.
    const stored = (await s.backend.readShare(SHARE))!
    await s.backend.updateShare(SHARE, { sealed: stored.sealed, closesAt: null, closed: false, foldedUpTo: null }, { rev: 2, proof: 'p', next: 'n' })
    s.store.mutate(renamePerson('p2', 'Bobby'))
    await vi.waitFor(async () => expect((await s.backend.readShare(SHARE))!.rev).toBe(3))
    const snapshot = await openSnapshot(await importShareKey(s.shareKey), SHARE, (await s.backend.readShare(SHARE))!.sealed)
    expect(snapshot.people[1]).toEqual({ id: 'p2', name: 'Bobby' })
  })

  it('takes over a document another organizer created first', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      // The other app creates it while this one is solving the proof of work.
      const s = await setup({
        options: (backend) => ({
          solvePow: async (shareId) => {
            const sealed = { iv: 'abcdefghijklmnop', ct: new Uint8Array([1, 2, 3]) }
            await backend.createShare(shareId, { sealed, closesAt: null, closed: false, foldedUpTo: null }, { nonce: 'n', next: 'n' })
            return 'nonce'
          },
        }),
      })
      // The stored snapshot cannot be opened, so it is replaced.
      await vi.waitFor(async () => expect((await s.backend.readShare(SHARE))!.rev).toBe(2))
      const snapshot = await openSnapshot(await importShareKey(s.shareKey), SHARE, (await s.backend.readShare(SHARE))!.sealed)
      expect(snapshot.dashboard).toBe('Club')
      expect(error).not.toHaveBeenCalled()
    } finally {
      error.mockRestore()
    }
  })

  it('keeps check-ins in the overlay until Finish, then folds and cleans up', async () => {
    const s = await setup({ kind: 'call' })
    await reply(s, payload('p1', 'here'))
    const newest = await reply(s, payload('p2', 'here', 'phone2'))
    await vi.waitFor(() => expect(s.sync.getSnapshot().replies).toHaveLength(2))
    const before = s.store.state
    await vi.waitFor(async () => expect((await storedSnapshot(s)).present).toEqual(['p1', 'p2']))
    expect((await storedSnapshot(s)).at).toBe(newest)
    // Nothing is folded while the call is in progress.
    expect(s.store.state).toBe(before)
    expect(s.store.state.shares![SHARE]).toMatchObject({ mergedUpTo: 0, closed: false })

    const draft = applyCheckIns(startCall(s.store.state, 'e1', ['p1', 'p2'], s.clock.now), s.sync.getSnapshot().replies)
    expect(draft).toMatchObject({ marks: { p1: 'present', p2: 'present' }, checkedInUpTo: newest })
    s.clock.now += 1_000
    s.store.mutate(finishMutation(draft, s.clock.now))
    await vi.waitFor(() => expect(s.store.state.shares).toBeUndefined())
    expect(s.store.state.events.e1).toMatchObject({ calledAt: s.clock.now, present: ['p1', 'p2'] })
    expect(await s.backend.readShare(SHARE)).toMatchObject({ closed: true, foldedUpTo: newest })
    expect((await storedSnapshot(s)).present).toEqual(['p1', 'p2'])
    expect(storedReplies(s.backend)).toEqual([])
    expect(s.sync.getSnapshot().replies).toEqual([])
  })

  it('cleans up a finished call link after a late check-in', async () => {
    const s = await setup({ kind: 'call' })
    const first = await reply(s, payload('p1', 'here'))
    // Accepted by the server after Finish was pressed, before the link was closed on it.
    s.backend.heldBack.add(s.clock.now + 1_000)
    const late = await reply(s, payload('p2', 'here', 'phone2'))
    await vi.waitFor(() => expect(s.sync.getSnapshot().replies).toHaveLength(1))

    const draft = applyCheckIns(startCall(s.store.state, 'e1', ['p1', 'p2'], s.clock.now), s.sync.getSnapshot().replies)
    expect(draft.checkedInUpTo).toBe(first)
    s.clock.now += 1_000
    s.store.mutate(finishMutation(draft, s.clock.now))
    await vi.waitFor(() => expect(s.store.state.shares).toBeUndefined())
    // The late check-in is presence, not an absence.
    expect(s.store.state.events.e1.present).toEqual(['p1', 'p2'])
    expect(s.store.state.events.e1.absent ?? []).toEqual([])
    expect(await s.backend.readShare(SHARE)).toMatchObject({ closed: true, foldedUpTo: late })
    expect(storedReplies(s.backend)).toEqual([])
  })

  it('keeps the check-ins of a closed call link until a call is finished', async () => {
    const s = await setup({ kind: 'call' })
    const at = await reply(s, payload('p1', 'here'))
    await vi.waitFor(() => expect(s.sync.getSnapshot().replies).toHaveLength(1))
    s.store.mutate(closeShare(SHARE))
    await sleep(30)
    expect(s.store.state.shares![SHARE]).toMatchObject({ closed: true, mergedUpTo: 0 })
    expect(storedReplies(s.backend)).toHaveLength(1)
    expect(s.sync.getSnapshot().replies).toHaveLength(1)

    // The call opened later takes the waiting check-in, and Finish settles the link.
    const draft = applyCheckIns(startCall(s.store.state, 'e1', ['p1', 'p2'], s.clock.now), s.sync.getSnapshot().replies)
    s.clock.now += 1_000
    s.store.mutate(finishMutation(draft, s.clock.now))
    await vi.waitFor(() => expect(s.store.state.shares).toBeUndefined())
    expect(s.store.state.events.e1).toMatchObject({ present: ['p1'], absent: ['p2'] })
    expect(await s.backend.readShare(SHARE)).toMatchObject({ closed: true, foldedUpTo: at })
    expect(storedReplies(s.backend)).toEqual([])
  })

  it("cleans up a deleted event's unfinished call link with check-ins", async () => {
    const s = await setup({ kind: 'call' })
    const at = await reply(s, payload('p1', 'here'))
    await vi.waitFor(() => expect(s.sync.getSnapshot().replies).toHaveLength(1))
    s.store.mutate(deleteEvent('e1'))
    await vi.waitFor(() => expect(s.store.state.shares).toBeUndefined())
    expect(await s.backend.readShare(SHARE)).toMatchObject({ closed: true, foldedUpTo: at })
    expect(storedReplies(s.backend)).toEqual([])
    expect(s.backend.active).toBe(0)
  })

  it('builds call snapshots from server pages only', async () => {
    const s = await setup({ kind: 'call' })
    await reply(s, payload('p1', 'here'))
    await vi.waitFor(async () => expect((await storedSnapshot(s)).present).toEqual(['p1']))
    const rev = (await s.backend.readShare(SHARE))!.rev

    // A cached page with an extra check-in: shown on this device, not written to the link.
    s.backend.fromServer = false
    await reply(s, payload('p2', 'here', 'phone2'))
    await vi.waitFor(() => expect(s.sync.getSnapshot().replies).toHaveLength(2))
    await sleep(30)
    expect((await s.backend.readShare(SHARE))!.rev).toBe(rev)
    expect((await storedSnapshot(s)).present).toEqual(['p1'])

    s.backend.fromServer = true
    s.backend.resend()
    await vi.waitFor(async () => expect((await storedSnapshot(s)).present).toEqual(['p1', 'p2']))
    expect((await s.backend.readShare(SHARE))!.rev).toBe(rev + 1)
  })

  it('folds a signed personal reply and ignores a forged one', async () => {
    const s = await setup({ state: createPersonalLink('p1', SECRET)(baseState()) })
    const good = await personalReply(s, 'p1', 'yes', SECRET)
    await personalReply(s, 'p1', 'no', OTHER)
    // A shared reply for a name with a personal link is ignored too.
    const last = await reply(s, payload('p1', 'no', 'phone2'))
    await vi.waitFor(() => expect(s.store.state.shares![SHARE].mergedUpTo).toBe(last))
    expect(s.store.state.events.e1.yes).toEqual(['p1'])
    expect(s.store.state.events.e1.no).toBeUndefined()
    expect(s.store.state.events.e1.replyLog).toEqual({ p1: { via: 'personal', at: good, device: 'phone1', sentAt: good } })
  })

  it('ignores a signed reply replayed a day later', async () => {
    const s = await setup({ state: createPersonalLink('p1', SECRET)(baseState()) })
    // Within a day of the server time, a slow clock is still accepted.
    const slow = await personalReply(s, 'p1', 'no', SECRET, 23 * HOUR)
    const replayed = await personalReply(s, 'p1', 'yes', SECRET, 25 * HOUR)
    await vi.waitFor(() => expect(s.store.state.shares![SHARE].mergedUpTo).toBe(replayed))
    expect(s.store.state.events.e1.yes).toBeUndefined()
    expect(s.store.state.events.e1.no).toEqual(['p1'])
    expect(s.store.state.events.e1.replyLog!.p1.at).toBe(slow)
  })

  it('ignores a signed reply replayed within a day after a newer one', async () => {
    const s = await setup({ state: createPersonalLink('p1', SECRET)(baseState()) })
    // Anyone with the shared link can read a reply's ciphertext and add it again.
    s.clock.now += 1_000
    const sentAt = s.clock.now
    const mac = await signReply(SECRET, { shareId: SHARE, personId: 'p1', answer: 'yes', device: 'phone1', sentAt })
    const sealed = await sealReply({ shareKey: await importShareKey(s.shareKey) }, SHARE, { personId: 'p1', answer: 'yes', device: 'phone1', via: 'personal', mac, sentAt })
    await s.backend.addReply(SHARE, sealed)
    const no = await personalReply(s, 'p1', 'no', SECRET)
    await vi.waitFor(() => expect(s.store.state.shares![SHARE].mergedUpTo).toBe(no))
    s.clock.now += HOUR
    await s.backend.addReply(SHARE, sealed)
    await vi.waitFor(() => expect(s.store.state.shares![SHARE].mergedUpTo).toBe(s.clock.now))
    expect(s.store.state.events.e1.no).toEqual(['p1'])
    expect(s.store.state.events.e1.yes).toBeUndefined()
    expect(s.store.state.events.e1.replyLog!.p1).toEqual({ via: 'personal', at: no, device: 'phone1', sentAt: no })

    // A reply sent afterwards is taken.
    const yes = await personalReply(s, 'p1', 'yes', SECRET)
    await vi.waitFor(() => expect(s.store.state.events.e1.yes).toEqual(['p1']))
    expect(s.store.state.events.e1.replyLog!.p1).toEqual({ via: 'personal', at: yes, device: 'phone1', sentAt: yes })
  })

  it('folds a signed personal reply whose link reached the server after the state this device saves on', async () => {
    const { s, store } = await rebasingSetup()
    // Another organizer has created p1's link; this device still shows the state before it.
    const fresh = createPersonalLink('p1', SECRET)(store.state)
    // A shared reply in the same millisecond and page, sorted first: it must not take mergedUpTo past the personal one.
    s.clock.now += 1_000
    const at = s.clock.now
    const key = await importShareKey(s.shareKey)
    const mac = await signReply(SECRET, { shareId: SHARE, personId: 'p1', answer: 'yes', device: 'phone1', sentAt: at })
    const shared = await sealReply({ shareKey: key }, SHARE, payload('p2', 'yes', 'phone2'))
    const personal = await sealReply({ shareKey: key }, SHARE, { personId: 'p1', answer: 'yes', device: 'phone1', via: 'personal', mac, sentAt: at })
    await Promise.all([s.backend.addReply(SHARE, shared), s.backend.addReply(SHARE, personal)])
    await vi.waitFor(() => expect(store.state.shares![SHARE].mergedUpTo).toBe(at))
    expect(store.state.events.e1.yes).toEqual(['p2'])

    // The save is denied on its stale revision and rebased on the state with the link.
    store.receive(fresh)
    await vi.waitFor(() => expect([...(store.state.events.e1.yes ?? [])].sort()).toEqual(['p1', 'p2']))
    expect(store.state.events.e1.replyLog!.p1).toEqual({ via: 'personal', at, device: 'phone1', sentAt: at })
    expect(store.state.shares![SHARE].mergedUpTo).toBe(at)
  })

  it('listens again from a lower cursor when a rebase cuts the fold back below it', async () => {
    const { s, store } = await rebasingSetup()
    const fresh = createPersonalLink('p1', SECRET)(store.state)
    // A full page sent while no organizer app is open, with p1's signed answer in the middle.
    s.sync.stop()
    const key = await importShareKey(s.shareKey)
    const times: number[] = []
    for (let i = 0; i < REPLY_PAGE; i++) {
      s.clock.now += 1_000
      const sentAt = s.clock.now
      const p: ReplyPayload =
        i === 5
          ? { personId: 'p1', answer: 'yes', device: 'phone1', via: 'personal', sentAt, mac: await signReply(SECRET, { shareId: SHARE, personId: 'p1', answer: 'yes', device: 'phone1', sentAt }) }
          : payload('p2', i % 2 ? 'yes' : 'no', 'phone2')
      await s.backend.addReply(SHARE, await sealReply({ shareKey: key }, SHARE, p))
      times.push(s.clock.now)
    }
    const watches = s.backend.watches.length
    startSync(s.backend, store, s.clock)
    // Folded on the state without p1's link, then listening again after the full page.
    await vi.waitFor(() => expect(s.backend.watches.slice(watches)).toEqual([0, times[REPLY_PAGE - 1]]))
    expect(store.state.shares![SHARE].mergedUpTo).toBe(times[REPLY_PAGE - 1])

    // The rebase cuts the fold at p1's reply, below where the listener starts.
    store.receive(fresh)
    await vi.waitFor(() => expect(store.state.events.e1.yes).toContain('p1'))
    // Once, from the cut: no restart loop.
    expect(s.backend.watches.slice(watches)).toEqual([0, times[REPLY_PAGE - 1], times[4]])
    expect(store.state.events.e1.replyLog!.p1).toMatchObject({ via: 'personal', at: times[5] })
    expect(store.state.shares![SHARE].mergedUpTo).toBe(times[REPLY_PAGE - 1])
  })

  it('folds a forged personal reply away after such a rebase, and goes on folding', async () => {
    const { s, store } = await rebasingSetup()
    const fresh = createPersonalLink('p1', SECRET)(store.state)
    const forged = await personalReply(s, 'p1', 'no', OTHER)
    await vi.waitFor(() => expect(store.state.shares![SHARE].mergedUpTo).toBe(forged))
    store.receive(fresh)
    await vi.waitFor(() => expect(store.state.personalLinks).toBeDefined())
    const at = await reply(s, payload('p2', 'yes', 'phone2'))
    await vi.waitFor(() => expect(store.state.shares![SHARE].mergedUpTo).toBe(at))
    expect(store.state.events.e1.yes).toEqual(['p2'])
    expect(store.state.events.e1.no).toBeUndefined()
  })

  it('folds a forged personal reply away at once on a confirmed state', async () => {
    const s = await setup({ state: createPersonalLink('p1', SECRET)(baseState()) })
    const at = await personalReply(s, 'p1', 'no', OTHER)
    await vi.waitFor(() => expect(s.store.state.shares![SHARE].mergedUpTo).toBe(at))
    expect(s.store.state.events.e1.no).toBeUndefined()
  })

  it('checks a personal reply again when the link is re-created', async () => {
    const s = await setup({ state: createPersonalLink('p1', SECRET)(baseState()) })
    // Only a reader is watching, so the reply stays pending.
    s.sync.stop()
    const reader = new FakeStore(s.store.state, false)
    const readerSync = startSync(s.backend, reader, s.clock, { docId: 'D'.repeat(22), key: generateKeyString(), access: 'read' })
    await personalReply(s, 'p1', 'yes', SECRET)
    await vi.waitFor(() => expect(readerSync.getSnapshot().replies[0]?.signedWith).toBe(SECRET))

    reader.set(createPersonalLink('p1', OTHER)(revokePersonalLink('p1')(reader.state)))
    s.backend.resend()
    await vi.waitFor(() => expect(readerSync.getSnapshot().replies[0].signedWith).toBeUndefined())
    expect(readerSync.getSnapshot().replies[0]).toMatchObject({ personId: 'p1', answer: 'yes', via: 'personal' })
  })

  it('stops listening while the tab stays hidden, and catches up when it is shown', async () => {
    const handlers = new Map<string, () => void>()
    const page = { visibilityState: 'visible' }
    vi.stubGlobal('document', page)
    vi.stubGlobal('addEventListener', (type: string, handler: () => void) => handlers.set(type, handler))
    vi.stubGlobal('removeEventListener', (type: string) => handlers.delete(type))
    try {
      const s = await setup({ options: { pauseAfterMs: 0 } })
      expect(s.backend.active).toBe(1)
      page.visibilityState = 'hidden'
      handlers.get('visibilitychange')!()
      await vi.waitFor(() => expect(s.backend.active).toBe(0))
      const at = await reply(s, payload('p1', 'yes'))
      await sleep(20)
      expect(s.store.state.shares![SHARE].mergedUpTo).toBe(0)

      page.visibilityState = 'visible'
      handlers.get('visibilitychange')!()
      await vi.waitFor(() => expect(s.store.state.shares![SHARE].mergedUpTo).toBe(at))
      expect(s.backend.active).toBe(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
