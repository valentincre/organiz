import { readFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app'
import {
  connectFirestoreEmulator,
  disableNetwork,
  doc,
  enableNetwork,
  getDoc,
  getDocFromCache,
  getFirestore,
  updateDoc,
  type Firestore,
} from 'firebase/firestore'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { addEvent, addPerson, renameDashboard, setReply } from '../src/domain/mutations'
import type { Mutation } from '../src/domain/types'
import { CACHE_LOG_KEY, readCacheLog } from '../src/storage/cacheExpiry'
import { generateKeyString } from '../src/storage/crypto'
import {
  DashboardSession,
  createDashboard,
  newDocId,
  type DashboardSnapshot,
  type SaveDelay,
} from '../src/storage/dashboardStore'
import { MAX_PLAINTEXT_BYTES } from '../src/storage/envelope'
import type { DashboardRef } from '../src/storage/link'
import { solvePow } from '../src/storage/pow'

let env: RulesTestEnvironment
const apps: FirebaseApp[] = []

/** A separate Firebase app per simulated browser, so each has its own cache. */
function browser(name: string): Firestore {
  const app = initializeApp({ projectId: 'demo-organiz', apiKey: 'test' }, `${name}-${apps.length}`)
  apps.push(app)
  const db = getFirestore(app)
  connectFirestoreEmulator(db, '127.0.0.1', 8180)
  return db
}

function create(name = 'Club'): Promise<DashboardRef> {
  const docId = newDocId()
  return createDashboard(browser('creator'), name, { docId, nonce: solvePow(docId) })
}

function waitFor(session: DashboardSession, predicate: (s: DashboardSnapshot) => boolean): Promise<DashboardSnapshot> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out, last snapshot: ${JSON.stringify(session.getSnapshot())}`)),
      15_000,
    )
    const check = () => {
      const snapshot = session.getSnapshot()
      if (predicate(snapshot)) {
        clearTimeout(timer)
        unsubscribe()
        resolve(snapshot)
      }
    }
    const unsubscribe = session.subscribe(check)
    check()
  })
}

/** Writes happen as soon as an edit is made, unless a test is about the delay. */
const IMMEDIATE: SaveDelay = { idle: 0, max: 0 }

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Number of writes the server has seen for a dashboard: the revision starts at 1 and grows with each one. */
const revisionOf = async ({ docId }: DashboardRef): Promise<number> => {
  let rev = 0
  await env.withSecurityRulesDisabled(async (context) => {
    rev = (await getDoc(doc(context.firestore(), 'dashboards', docId))).data()?.rev
  })
  return rev
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-organiz',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8180 },
  })
  await env.clearFirestore()
})

afterAll(async () => {
  await Promise.all(apps.map((app) => deleteApp(app)))
  await env.cleanup()
})

describe('DashboardSession', () => {
  it('loads a created dashboard', async () => {
    const ref = await create()
    expect(ref.access).toBe('edit')
    const session = new DashboardSession(browser('reader'), ref, { saveDelay: IMMEDIATE })
    void session.start()
    const snapshot = await waitFor(session, (s) => s.state !== null)
    expect(snapshot.state).toEqual({ v: 3, name: 'Club', people: {}, events: {}, personProperties: {}, eventProperties: {} })
    expect(session.canEdit).toBe(true)
    expect(session.readLink).toMatchObject({ docId: ref.docId, access: 'read' })
    session.stop()
  })

  it('reports a wrong key and a missing dashboard', async () => {
    const ref = await create()
    const wrongKey = new DashboardSession(browser('wrong-key'), { ...ref, key: generateKeyString() }, { saveDelay: IMMEDIATE })
    void wrongKey.start()
    expect((await waitFor(wrongKey, (s) => s.loadError !== null)).loadError).toBe('bad-key')
    wrongKey.stop()

    const missing = new DashboardSession(browser('missing'), { ...ref, docId: 'B'.repeat(22) }, { saveDelay: IMMEDIATE })
    void missing.start()
    expect((await waitFor(missing, (s) => s.loadError !== null)).loadError).toBe('not-found')
    missing.stop()
  })

  it('merges concurrent edits from two browsers', async () => {
    const ref = await create()
    const alice = new DashboardSession(browser('alice'), ref, { saveDelay: IMMEDIATE })
    const bob = new DashboardSession(browser('bob'), ref, { saveDelay: IMMEDIATE })
    void alice.start()
    void bob.start()
    await waitFor(alice, (s) => s.state !== null)
    await waitFor(bob, (s) => s.state !== null)

    alice.mutate(addPerson('a', 'Alice', 1))
    bob.mutate(addPerson('b', 'Bob', 2))
    // Both open the same event; creating it twice is harmless.
    alice.mutate(addEvent('e1', '2026-10-10', {}, 5))
    bob.mutate(addEvent('e1', '2026-10-10', {}, 5))
    alice.mutate(setReply('e1', 'a', 'yes'))
    bob.mutate(setReply('e1', 'b', 'yes'))
    bob.mutate(renameDashboard('Team'))

    const expected = {
      v: 3,
      name: 'Team',
      people: { a: { name: 'Alice', createdAt: 1 }, b: { name: 'Bob', createdAt: 2 } },
      events: { e1: { date: '2026-10-10', name: '', createdAt: 5, yes: ['a', 'b'] } },
      personProperties: {},
      eventProperties: {},
    }
    // Key order depends on which save landed first, so compare structurally.
    const settled = (s: DashboardSnapshot) => !s.saving && isDeepStrictEqual(s.state, expected)
    expect((await waitFor(alice, settled)).saveError).toBeNull()
    expect((await waitFor(bob, settled)).saveError).toBeNull()
    alice.stop()
    bob.stop()
  })

  it('reports an uncached dashboard opened offline as a connection problem, and loads it once online', async () => {
    const ref = await create()
    const db = browser('offline-first-visit')
    await disableNetwork(db)
    const session = new DashboardSession(db, ref, { saveDelay: IMMEDIATE })
    void session.start()
    // The cache does not have it, which does not mean the server does not.
    expect((await waitFor(session, (s) => s.loadError !== null)).loadError).toBe('network')
    await enableNetwork(db)
    expect(await waitFor(session, (s) => s.state !== null)).toMatchObject({ loadError: null, state: { name: 'Club' } })
    session.stop()
  })

  it('applies edits optimistically before the server confirms', async () => {
    const ref = await create()
    const session = new DashboardSession(browser('optimistic'), ref, { saveDelay: IMMEDIATE })
    void session.start()
    await waitFor(session, (s) => s.state !== null)
    session.mutate(addPerson('x', 'Xavier', 1))
    const snapshot = session.getSnapshot()
    expect(snapshot.saving).toBe(true)
    expect(snapshot.state?.people.x?.name).toBe('Xavier')
    await waitFor(session, (s) => !s.saving)
    session.stop()
  })

  it('records the dashboard as opened, for the cache expiry', async () => {
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) }
    vi.stubGlobal('localStorage', storage)
    const ref = await create()
    const session = new DashboardSession(browser('opened'), ref)
    await session.start()
    expect(Object.keys(readCacheLog(storage as Storage))).toEqual([ref.docId])
    expect(values.has(CACHE_LOG_KEY)).toBe(true)
    session.stop()
    vi.unstubAllGlobals()
  })

  it('reports a Firestore that failed to start', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ref: DashboardRef = { docId: newDocId(), key: generateKeyString(), access: 'edit' }
    const session = new DashboardSession(Promise.reject(new Error('IndexedDB unavailable')), ref)
    await session.start()
    expect(session.getSnapshot()).toMatchObject({ state: null, loadError: 'network' })
    session.stop()
    error.mockRestore()
  })

  it('saves edits made before the first load once it arrives', async () => {
    const ref = await create()
    const session = new DashboardSession(browser('early'), ref, { saveDelay: IMMEDIATE })
    session.mutate(addPerson('a', 'Alice', 1))
    void session.start()
    const s = await waitFor(session, (s) => s.state !== null && !s.saving)
    expect(s.state!.people.a?.name).toBe('Alice')
    expect(await revisionOf(ref)).toBe(2)
    session.stop()
  })

  it('shows a write left pending by an earlier visit until the server confirms it', async () => {
    const ref = await create()
    const db = browser('offline')
    // The earlier visit saves offline. It keeps listening, so that this memory
    // cache keeps the document, as the persistent cache does across a reload.
    const earlier = new DashboardSession(db, ref, { saveDelay: IMMEDIATE })
    void earlier.start()
    await waitFor(earlier, (s) => s.state !== null)
    await disableNetwork(db)
    earlier.mutate(addPerson('a', 'Alice', 1))
    const cached = doc(db, 'dashboards', ref.docId)
    await vi.waitFor(async () => expect((await getDocFromCache(cached)).metadata.hasPendingWrites).toBe(true))

    const later = new DashboardSession(db, ref, { saveDelay: IMMEDIATE })
    void later.start()
    const shown = await waitFor(later, (s) => s.state !== null)
    expect(shown).toMatchObject({ saving: false, confirmed: false, state: { people: { a: { name: 'Alice' } } } })
    expect(await revisionOf(ref)).toBe(1)

    // Saved on top of the revision the server confirms, never on the pending one.
    later.mutate(addPerson('b', 'Bob', 2))
    await enableNetwork(db)
    const s = await waitFor(later, (s) => !s.saving)
    expect(s.confirmed).toBe(true)
    expect(Object.keys(s.state!.people).sort()).toEqual(['a', 'b'])
    expect(await revisionOf(ref)).toBe(3)
    earlier.stop()
    later.stop()
  })

  describe('with two editors open', () => {
    let ref: DashboardRef
    let alice: DashboardSession
    let bob: DashboardSession

    beforeEach(async () => {
      ref = await create()
      alice = new DashboardSession(browser('alice'), ref, { saveDelay: IMMEDIATE })
      bob = new DashboardSession(browser('bob'), ref, { saveDelay: IMMEDIATE })
      void alice.start()
      void bob.start()
      await waitFor(alice, (s) => s.state !== null)
      await waitFor(bob, (s) => s.state !== null)
    })

    afterEach(() => {
      alice.stop()
      bob.stop()
      vi.restoreAllMocks()
    })

    it('rebases an edit made on a stale revision', async () => {
      // alice is paused (no snapshots), bob saves, then alice saves on her stale revision.
      alice.pause()
      bob.mutate(addPerson('b', 'Bob', 2))
      await waitFor(bob, (s) => !s.saving)
      alice.mutate(addPerson('a', 'Alice', 1))
      const s = await waitFor(alice, (s) => !s.saving)
      expect(s.saveError).toBeNull()
      expect(Object.keys(s.state!.people).sort()).toEqual(['a', 'b'])
      expect(await revisionOf(ref)).toBe(3)
    })

    it('a reader sees live edits and cannot write', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const editor = new DashboardSession(browser('ed'), ref, { saveDelay: IMMEDIATE })
      void editor.start()
      await waitFor(editor, (s) => s.state !== null)
      const reader = new DashboardSession(browser('rd'), editor.readLink!, { saveDelay: IMMEDIATE })
      void reader.start()
      expect(reader.canEdit).toBe(false)
      expect(reader.readLink).toEqual(editor.readLink)
      editor.mutate(renameDashboard('Team'))
      expect((await waitFor(reader, (s) => s.state?.name === 'Team')).state!.name).toBe('Team')
      reader.mutate(renameDashboard('Hacked'))
      reader.mutate(renameDashboard('Hacked again'))
      expect(reader.getSnapshot()).toMatchObject({ saving: false, state: { name: 'Team' } })
      // Firebase logs its own warnings too.
      expect(warn.mock.calls.filter(([message]) => String(message).includes('read-only'))).toHaveLength(1)
      await sleep(300)
      expect(await revisionOf(ref)).toBe(2)
      editor.stop()
      reader.stop()
    })

    it('reports a truncated read key', async () => {
      const reader = new DashboardSession(browser('bad'), { ...ref, access: 'read', key: 'x'.repeat(43) })
      void reader.start()
      expect((await waitFor(reader, (s) => s.loadError !== null)).loadError).toBe('bad-key')
      reader.stop()
    })

    it('stops receiving while paused and catches up on resume', async () => {
      alice.pause()
      bob.mutate(renameDashboard('Later'))
      await waitFor(bob, (s) => !s.saving)
      await sleep(300)
      expect(alice.getSnapshot().state!.name).not.toBe('Later')
      alice.resume()
      await waitFor(alice, (s) => s.state?.name === 'Later')
    })

    it('reports a save the rules refuse, once, and keeps the edit', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      // A commitment no proof opens: the revision is free, but the write is still denied.
      await env.withSecurityRulesDisabled((context) => updateDoc(doc(context.firestore(), 'dashboards', ref.docId), { next: 'x'.repeat(64) }))
      alice.mutate(addPerson('a', 'Alice', 1))
      const s = await waitFor(alice, (s) => s.saveError !== null)
      expect(s).toMatchObject({ saveError: 'failed', saving: true, writing: false })
      expect(s.state!.people.a?.name).toBe('Alice')
      await sleep(200)
      // Not retried until asked (`retry`, or going back online).
      expect(error.mock.calls.filter(([message]) => message === 'Save failed')).toHaveLength(1)
      expect(await revisionOf(ref)).toBe(1)
    })

    it('reports a state too large to save, retries it only after another edit, and saves once it fits', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      const saveFailures = () => error.mock.calls.filter(([message]) => message === 'Save failed').length
      // Compresses to almost nothing, but readers could not decompress it.
      const bloat: Mutation = (state) => ({ ...state, name: 'x'.repeat(MAX_PLAINTEXT_BYTES) })
      alice.mutate(bloat)
      const s = await waitFor(alice, (s) => s.saveError !== null)
      expect(s).toMatchObject({ saveError: 'too-large', saving: true, writing: false })

      // The same edits would fail the same way: neither the retry button nor going back online tries again.
      alice.retry()
      await sleep(200)
      expect(saveFailures()).toBe(1)
      expect(await revisionOf(ref)).toBe(1)

      // Another edit may make it fit, so it is tried once.
      alice.mutate(addPerson('a', 'Alice', 1))
      await vi.waitFor(() => expect(saveFailures()).toBe(2))
      expect(alice.getSnapshot().saveError).toBe('too-large')

      alice.mutate(renameDashboard('Team'))
      const saved = await waitFor(alice, (s) => !s.saving)
      expect(saved).toMatchObject({ saveError: null, state: { name: 'Team', people: { a: { name: 'Alice' } } } })
      expect(saveFailures()).toBe(2)
      expect(await revisionOf(ref)).toBe(2)
    })
  })

  describe('save delay and page events', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    async function openSession(name: string, options: { saveDelay: SaveDelay; pauseAfterMs?: number }) {
      const ref = await create()
      const session = new DashboardSession(browser(name), ref, options)
      void session.start()
      await waitFor(session, (s) => s.state !== null)
      return { ref, session }
    }

    /** Replaces the page's events and visibility, to fire them by hand. */
    function stubPage() {
      const listeners = new Map<string, () => void>()
      const document = { visibilityState: 'visible' }
      vi.stubGlobal('document', document)
      vi.stubGlobal('addEventListener', (type: string, listener: () => void) => listeners.set(type, listener))
      vi.stubGlobal('removeEventListener', (type: string) => listeners.delete(type))
      return {
        listeners,
        fire: (type: string) => listeners.get(type)?.(),
        setVisibility(state: 'visible' | 'hidden') {
          document.visibilityState = state
          listeners.get('visibilitychange')?.()
        },
      }
    }

    it('saves a burst of edits in one write once they stop', async () => {
      const { ref, session } = await openSession('burst', { saveDelay: { idle: 300, max: 5000 } })
      session.mutate(addPerson('a', 'Alice', 1))
      session.mutate(addPerson('b', 'Bob', 2))
      session.mutate(addPerson('c', 'Chloé', 3))
      // Pending, shown at once, but not written and not "writing" yet.
      expect(session.getSnapshot()).toMatchObject({ saving: true, writing: false })
      expect(Object.keys(session.getSnapshot().state!.people)).toHaveLength(3)
      expect(await revisionOf(ref)).toBe(1)

      await waitFor(session, (s) => !s.saving)
      expect(await revisionOf(ref)).toBe(2)
      session.stop()
    })

    it('waits for the idle delay again after each edit', async () => {
      const { ref, session } = await openSession('idle', { saveDelay: { idle: 400, max: 5000 } })
      session.mutate(addPerson('a', 'Alice', 1))
      await sleep(250)
      session.mutate(addPerson('b', 'Bob', 2))
      await sleep(250)
      // 500 ms after the first edit, but only 250 after the last one.
      expect(await revisionOf(ref)).toBe(1)
      await waitFor(session, (s) => !s.saving)
      expect(await revisionOf(ref)).toBe(2)
      session.stop()
    })

    it('saves at the latest after the max delay, even while edits keep coming', async () => {
      const { ref, session } = await openSession('max', { saveDelay: { idle: 400, max: 800 } })
      for (let i = 0; i < 15; i++) {
        session.mutate(addPerson(`p${i}`, `Person ${i}`, i))
        await sleep(100)
      }
      // The idle delay never elapsed (an edit every 100 ms for 1.5 s), so only `max` can have written.
      expect(await revisionOf(ref)).toBeGreaterThan(1)
      expect(session.getSnapshot().saving).toBe(true)
      await waitFor(session, (s) => !s.saving)
      session.stop()
    })

    it('writes at once on flushNow and on mutate with now', async () => {
      const { ref, session } = await openSession('now', { saveDelay: { idle: 60_000, max: 60_000 } })
      session.mutate(addPerson('a', 'Alice', 1))
      session.flushNow()
      await waitFor(session, (s) => !s.saving)
      expect(await revisionOf(ref)).toBe(2)

      session.mutate(addPerson('b', 'Bob', 2), { now: true })
      await waitFor(session, (s) => !s.saving)
      expect(await revisionOf(ref)).toBe(3)
      session.stop()
    })

    it('writes pending edits when listening stops', async () => {
      const { ref, session } = await openSession('stop', { saveDelay: { idle: 60_000, max: 60_000 } })
      session.mutate(addPerson('a', 'Alice', 1))
      session.stop()
      await vi.waitFor(async () => expect(await revisionOf(ref)).toBe(2))
    })

    it('writes pending edits when the page goes to the background or is hidden', async () => {
      const page = stubPage()
      const { ref, session } = await openSession('background', { saveDelay: { idle: 60_000, max: 60_000 } })

      session.mutate(addPerson('a', 'Alice', 1))
      // Coming back to the foreground writes nothing.
      page.setVisibility('visible')
      expect(session.getSnapshot().writing).toBe(false)
      expect(await revisionOf(ref)).toBe(1)

      page.setVisibility('hidden')
      await waitFor(session, (s) => !s.saving)
      expect(await revisionOf(ref)).toBe(2)

      session.mutate(addPerson('b', 'Bob', 2))
      page.fire('pagehide')
      await waitFor(session, (s) => !s.saving)
      expect(await revisionOf(ref)).toBe(3)

      session.stop()
      expect(page.listeners.has('visibilitychange') || page.listeners.has('pagehide')).toBe(false)
    })

    it('pauses listening once hidden for pauseAfterMs, and resumes when visible again', async () => {
      const page = stubPage()
      const { session } = await openSession('hidden', { saveDelay: IMMEDIATE, pauseAfterMs: 100 })
      const pause = vi.spyOn(session, 'pause')
      const resume = vi.spyOn(session, 'resume')

      // Back before the delay: never paused.
      page.setVisibility('hidden')
      page.setVisibility('visible')
      await sleep(150)
      expect(pause).not.toHaveBeenCalled()

      page.setVisibility('hidden')
      await vi.waitFor(() => expect(pause).toHaveBeenCalledOnce())
      page.setVisibility('visible')
      expect(resume).toHaveBeenCalled()

      // Stopping while hidden cancels the pending pause.
      page.setVisibility('hidden')
      session.stop()
      await sleep(150)
      expect(pause).toHaveBeenCalledOnce()
    })
  })
})
