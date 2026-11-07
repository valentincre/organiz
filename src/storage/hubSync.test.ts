import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildHubContent, type HubContent } from '../domain/hub'
import { addEvent, addPerson, compose, emptyState, renamePerson, setReply } from '../domain/mutations'
import { createPersonalLink, revokePersonalLink, setHub } from '../domain/personalLinks'
import { addProperty, renameProperty } from '../domain/properties'
import { addShare } from '../domain/shares'
import type { DashboardState, Mutation } from '../domain/types'
import { generateKeyString } from './crypto'
import type { DashboardSnapshot, DashboardStore, SaveDelay } from './dashboardStore'
import type { Sealed } from './envelope'
import type { HubBackend, StoredHub } from './hubBackend'
import { openHub, openHubPerson } from './hubCrypto'
import { HubSync } from './hubSync'
import type { DashboardRef } from './link'
import { MemoryHubBackend } from './memoryHubs'
import { importShareKey } from './shareCrypto'

const HUB = 'H'.repeat(22)
const OTHER_HUB = 'K'.repeat(22)
const SHARE = 'S'.repeat(22)
const IMMEDIATE: SaveDelay = { idle: 0, max: 0 }
const HUB_KEY = generateKeyString()
const SECRETS: Record<string, string> = { p1: generateKeyString(), p2: generateKeyString() }

/** A store that applies each edit at once, like a saved session. */
class FakeStore implements DashboardStore {
  readonly readLink = null
  readonly canEdit: boolean
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
    if (this.canEdit) this.set(mutation(this.state))
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

/** The memory backend, counting calls; `readHub` can be made to miss a hub, `createHub` and `updateHub` to fail. */
class TestBackend implements HubBackend {
  readonly inner = new MemoryHubBackend()
  readonly created: string[] = []
  reads = 0
  writes = 0
  /** Called before each call; throwing makes it fail. */
  before: ((call: 'read' | 'create' | 'update') => void) | null = null
  /** The next reads report no hub, as if read before another app created it. */
  missingReads = 0

  async createHub(hubId: string, sealed: Sealed, auth: { nonce: string; next: string }) {
    this.before?.('create')
    await this.inner.createHub(hubId, sealed, auth)
    this.created.push(hubId)
  }
  async updateHub(hubId: string, sealed: Sealed, auth: { rev: number; proof: string; next: string }) {
    this.before?.('update')
    const result = await this.inner.updateHub(hubId, sealed, auth)
    if (result === 'ok') this.writes++
    return result
  }
  async readHub(hubId: string): Promise<StoredHub | null> {
    this.before?.('read')
    this.reads++
    if (this.missingReads > 0) {
      this.missingReads--
      return null
    }
    return this.inner.readHub(hubId)
  }
  watchHub(...args: Parameters<HubBackend['watchHub']>) {
    return this.inner.watchHub(...args)
  }
}

const baseState = (): DashboardState =>
  compose(
    addPerson('p1', 'Alice', 1),
    addPerson('p2', 'Bob', 2),
    addEvent('e1', '2026-11-02', { name: 'Training', start: '18:00', end: '20:00' }, 3),
    addShare(SHARE, { eventId: 'e1', kind: 'presence', key: generateKeyString(), visibility: 'public', autoClose: false }, 4),
  )(emptyState('Club'))

const withLinks = (...people: string[]): Mutation =>
  compose(setHub({ id: HUB, key: HUB_KEY }), ...people.map((p) => createPersonalLink(p, SECRETS[p], 5)))

const editRef = (): DashboardRef => ({ docId: 'D'.repeat(22), key: generateKeyString(), access: 'edit' })

const syncs: HubSync[] = []
afterEach(() => {
  for (const sync of syncs.splice(0)) sync.stop()
})

function startSync(backend: HubBackend, store: DashboardStore, ref = editRef()): HubSync {
  const sync = new HubSync(backend, ref, store, { delay: IMMEDIATE, solvePow: async () => 'nonce' })
  syncs.push(sync)
  sync.start()
  return sync
}

/** The hub as a personal page sees it: every entry opened with its person's secret. */
async function readContent(backend: HubBackend, hubId = HUB, secrets = SECRETS): Promise<{ rev: number; content: HubContent }> {
  const stored = (await backend.readHub(hubId))!
  const { shares, sealedPeople } = await openHub(await importShareKey(HUB_KEY), hubId, stored.sealed)
  const people: HubContent['people'] = {}
  for (const [personId, entry] of Object.entries(sealedPeople)) people[personId] = await openHubPerson(secrets[personId], hubId, personId, entry)
  return { rev: stored.rev, content: { v: 1, shares, people } }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('HubSync', () => {
  it('does nothing without a hub', async () => {
    const backend = new TestBackend()
    const store = new FakeStore(baseState())
    startSync(backend, store)
    store.mutate(renamePerson('p1', 'Alicia'))
    await sleep(20)
    expect(backend.reads).toBe(0)
  })

  it('creates the hub once a personal link is saved', async () => {
    const backend = new TestBackend()
    const store = new FakeStore(baseState())
    startSync(backend, store)
    store.setStatus({ saving: true })
    store.mutate(withLinks('p1'))
    await sleep(20)
    expect(backend.created).toEqual([])

    store.setStatus({ saving: false })
    await vi.waitFor(async () => expect(await backend.readHub(HUB)).not.toBeNull())
    const { rev, content } = await readContent(backend)
    expect(rev).toBe(1)
    expect(content).toEqual(buildHubContent(store.state))
    expect(content.people).toEqual({ p1: { name: 'Alice', replies: {} } })
    expect(content.shares).toEqual([{ shareId: SHARE, key: store.state.shares![SHARE].key }])
  })

  it('rewrites the hub when a linked person replies, not on unrelated edits', async () => {
    const backend = new TestBackend()
    const store = new FakeStore(withLinks('p1')(baseState()))
    startSync(backend, store)
    await vi.waitFor(async () => expect(await backend.readHub(HUB)).not.toBeNull())

    store.mutate(setReply('e1', 'p1', 'yes', 1_000))
    await vi.waitFor(async () => expect((await backend.readHub(HUB))!.rev).toBe(2))
    expect((await readContent(backend)).content.people.p1.replies).toEqual({ [SHARE]: { answer: 'yes', at: 1_000 } })

    store.mutate(compose(addProperty('event', 'level', 'text', 'Level', [], 6), renameProperty('event', 'level', 'Grade')))
    store.mutate(setReply('e1', 'p2', 'no', 2_000))
    await sleep(30)
    expect((await backend.readHub(HUB))!.rev).toBe(2)
  })

  it('drops a revoked person from the hub', async () => {
    const backend = new TestBackend()
    const store = new FakeStore(withLinks('p1', 'p2')(baseState()))
    startSync(backend, store)
    await vi.waitFor(async () => expect(await backend.readHub(HUB)).not.toBeNull())

    store.mutate(revokePersonalLink('p1'))
    await vi.waitFor(async () => expect((await backend.readHub(HUB))!.rev).toBe(2))
    const { sealedPeople } = await openHub(await importShareKey(HUB_KEY), HUB, (await backend.readHub(HUB))!.sealed)
    expect(Object.keys(sealedPeople)).toEqual(['p2'])
  })

  it('reseals an entry whose link was made again, even with the same content', async () => {
    const backend = new TestBackend()
    const store = new FakeStore(withLinks('p1')(baseState()))
    startSync(backend, store)
    await vi.waitFor(async () => expect(await backend.readHub(HUB)).not.toBeNull())

    const secret = generateKeyString()
    store.mutate(compose(revokePersonalLink('p1'), createPersonalLink('p1', secret, 6)))
    await vi.waitFor(async () => expect((await backend.readHub(HUB))!.rev).toBe(2))
    expect((await readContent(backend, HUB, { p1: secret })).content.people.p1.name).toBe('Alice')
  })

  it('a reader never writes', async () => {
    const backend = new TestBackend()
    const store = new FakeStore(withLinks('p1')(baseState()), false)
    startSync(backend, store, { docId: 'D'.repeat(22), key: generateKeyString(), access: 'read' })
    await sleep(30)
    expect(backend.reads).toBe(0)
    expect(await backend.readHub(HUB)).toBeNull()
  })

  it('leaves an existing hub with the same content alone', async () => {
    const backend = new TestBackend()
    const state = withLinks('p1')(baseState())
    startSync(backend, new FakeStore(state))
    await vi.waitFor(async () => expect(await backend.readHub(HUB)).not.toBeNull())
    syncs.splice(0).forEach((sync) => sync.stop())

    // Another organizer's app opens the same dashboard.
    startSync(backend, new FakeStore(state))
    await vi.waitFor(() => expect(backend.reads).toBeGreaterThan(1))
    await sleep(30)
    expect((await backend.readHub(HUB))!.rev).toBe(1)
    expect(backend.writes).toBe(0)
  })

  it('reads again when another app created the hub first, and brings it up to date', async () => {
    const backend = new TestBackend()
    const state = withLinks('p1')(baseState())
    startSync(backend, new FakeStore(state))
    await vi.waitFor(async () => expect(await backend.readHub(HUB)).not.toBeNull())
    syncs.splice(0).forEach((sync) => sync.stop())

    // This app reads before the other one created it, and holds a newer state.
    backend.missingReads = 1
    const errors = vi.spyOn(console, 'error')
    startSync(backend, new FakeStore(renamePerson('p1', 'Alicia')(state)))
    await vi.waitFor(async () => expect((await backend.readHub(HUB))!.rev).toBe(2))
    expect(backend.created).toEqual([HUB])
    expect((await readContent(backend)).content.people.p1.name).toBe('Alicia')
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })

  it('reads again after a conflict, and writes the next revision', async () => {
    const backend = new TestBackend()
    const store = new FakeStore(withLinks('p1')(baseState()))
    startSync(backend, store)
    await vi.waitFor(async () => expect(await backend.readHub(HUB)).not.toBeNull())

    // Another organizer's app wrote revision 2 meanwhile.
    const stored = (await backend.inner.readHub(HUB))!
    await backend.inner.updateHub(HUB, stored.sealed, { rev: 2, proof: 'p', next: 'n' })
    store.mutate(renamePerson('p1', 'Alicia'))
    await vi.waitFor(async () => expect((await backend.readHub(HUB))!.rev).toBe(3))
    expect((await readContent(backend)).content.people.p1.name).toBe('Alicia')
  })

  it('never creates a hub id that lost to another organizer', async () => {
    const backend = new TestBackend()
    const store = new FakeStore(baseState())
    startSync(backend, store)
    // This app's own hub, not saved yet.
    store.setStatus({ saving: true })
    store.mutate(compose(setHub({ id: OTHER_HUB, key: generateKeyString() }), createPersonalLink('p2', SECRETS.p2, 5)))
    await sleep(20)

    // The save is rebased on another organizer's state, whose hub was saved first.
    store.set(compose(withLinks('p1'), createPersonalLink('p2', SECRETS.p2, 5))(baseState()))
    store.setStatus({ saving: false })
    await vi.waitFor(async () => expect(await backend.readHub(HUB)).not.toBeNull())
    await sleep(20)
    expect(backend.created).toEqual([HUB])
    expect(await backend.readHub(OTHER_HUB)).toBeNull()
    expect(Object.keys((await readContent(backend)).content.people)).toEqual(['p1', 'p2'])
  })

  it('tries a failed write again as soon as the content changes', async () => {
    const backend = new TestBackend()
    const store = new FakeStore(withLinks('p1')(baseState()))
    startSync(backend, store)
    await vi.waitFor(async () => expect(await backend.readHub(HUB)).not.toBeNull())

    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    backend.before = (call) => {
      if (call === 'update') throw new Error('offline')
    }
    store.mutate(renamePerson('p1', 'Alicia'))
    await vi.waitFor(() => expect(errors).toHaveBeenCalledTimes(1))
    await sleep(20)
    expect(errors).toHaveBeenCalledTimes(1)

    backend.before = null
    store.mutate(renamePerson('p1', 'Alicette'))
    await vi.waitFor(async () => expect((await backend.readHub(HUB))!.rev).toBe(2))
    expect((await readContent(backend)).content.people.p1.name).toBe('Alicette')
    errors.mockRestore()
  })

  it('tries a failed creation again after 30 s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      const backend = new TestBackend()
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
      backend.before = (call) => {
        if (call === 'create') throw new Error('offline')
      }
      startSync(backend, new FakeStore(withLinks('p1')(baseState())))
      await vi.waitFor(() => expect(errors).toHaveBeenCalledTimes(1))
      backend.before = null
      await vi.advanceTimersByTimeAsync(29_000)
      expect(await backend.readHub(HUB)).toBeNull()
      await vi.advanceTimersByTimeAsync(2_000)
      await vi.waitFor(async () => expect(await backend.readHub(HUB)).not.toBeNull())
      errors.mockRestore()
    } finally {
      vi.useRealTimers()
    }
  })
})
