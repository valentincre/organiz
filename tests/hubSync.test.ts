import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app'
import { collection, connectFirestoreEmulator, getDocs, getFirestore, type Firestore } from 'firebase/firestore'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { addEvent, addPerson, compose } from '../src/domain/mutations'
import { createPersonalLink, setHub } from '../src/domain/personalLinks'
import { generateKeyString } from '../src/storage/crypto'
import { createDashboard, DashboardSession, newDocId, type SaveDelay } from '../src/storage/dashboardStore'
import { FirestoreHubBackend } from '../src/storage/firestoreHubs'
import { openHub } from '../src/storage/hubCrypto'
import { HubSync } from '../src/storage/hubSync'
import type { DashboardRef } from '../src/storage/link'
import { solvePow } from '../src/storage/pow'
import { importShareKey } from '../src/storage/shareCrypto'

// The emulator port is overridable so a private emulator can run beside `npm run emulators`.
const PORT = Number(process.env.FIRESTORE_EMULATOR_PORT ?? 8180)
/** Writes happen as soon as an edit is made. */
const IMMEDIATE: SaveDelay = { idle: 0, max: 0 }

let env: RulesTestEnvironment
const apps: FirebaseApp[] = []
const running: { stop(): void }[] = []

/** A separate Firebase app per simulated browser, so each has its own cache. */
function browser(name: string): Firestore {
  const app = initializeApp({ projectId: 'demo-organiz', apiKey: 'test' }, `${name}-${apps.length}`)
  apps.push(app)
  const db = getFirestore(app)
  connectFirestoreEmulator(db, '127.0.0.1', PORT)
  return db
}

/** One organizer's app: a dashboard session and its hub sync, in its own browser. */
function organizer(name: string, ref: DashboardRef): { session: DashboardSession; sync: HubSync; backend: FirestoreHubBackend } {
  const db = browser(name)
  const session = new DashboardSession(db, ref, { saveDelay: IMMEDIATE })
  const backend = new FirestoreHubBackend(Promise.resolve(db))
  const sync = new HubSync(backend, ref, session, { delay: IMMEDIATE, solvePow: async (hubId) => solvePow(hubId) })
  running.push(sync, session)
  void session.start()
  sync.start()
  return { session, sync, backend }
}

async function until(check: () => boolean | Promise<boolean>, what: string, timeout = 15_000): Promise<void> {
  const end = Date.now() + timeout
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

const idle = ({ session }: { session: DashboardSession }) => {
  const snapshot = session.getSnapshot()
  return snapshot.state !== null && snapshot.confirmed && !snapshot.saving
}

async function createClub(): Promise<DashboardRef> {
  const docId = newDocId()
  const state = compose(
    addPerson('p1', 'Alice', 1),
    addPerson('p2', 'Bob', 2),
    addEvent('e1', '2030-06-01', { name: 'Training', start: '18:00', end: '20:00' }, 3),
  )({ v: 3, name: 'Club', people: {}, events: {}, personProperties: {}, eventProperties: {} })
  return createDashboard(browser('creator'), 'Club', { docId, nonce: solvePow(docId), state })
}

/** The ids of every hub document stored on the server. */
async function storedHubs(): Promise<string[]> {
  let ids: string[] = []
  await env.withSecurityRulesDisabled(async (context) => {
    ids = (await getDocs(collection(context.firestore(), 'hubs'))).docs.map((d) => d.id)
  })
  return ids
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-organiz',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: PORT },
  })
})
beforeEach(() => env.clearFirestore())
afterEach(() => {
  for (const item of running.splice(0)) item.stop()
})
afterAll(async () => {
  await Promise.all(apps.map((app) => deleteApp(app)))
  await env.cleanup()
})

describe('HubSync on Firestore', () => {
  it('two organizers creating the first personal link end with one hub', async () => {
    const ref = await createClub()
    const alice = organizer('alice', ref)
    const bob = organizer('bob', ref)
    await until(() => idle(alice) && idle(bob), 'both loaded')

    // Each app makes its own hub for its first personal link, at once.
    const hubs = { alice: { id: newDocId(), key: generateKeyString() }, bob: { id: newDocId(), key: generateKeyString() } }
    alice.session.mutate(compose(setHub(hubs.alice), createPersonalLink('p1', generateKeyString())))
    bob.session.mutate(compose(setHub(hubs.bob), createPersonalLink('p2', generateKeyString())))

    const hubOf = (o: { session: DashboardSession }) => o.session.getSnapshot().state?.hub
    const linked = (o: { session: DashboardSession }) => Object.keys(o.session.getSnapshot().state?.personalLinks ?? {}).sort().join()
    await until(() => idle(alice) && idle(bob) && hubOf(alice)?.id === hubOf(bob)?.id && linked(alice) === 'p1,p2' && linked(bob) === 'p1,p2', 'both to agree')
    const hub = hubOf(alice)!
    const lost = hub.id === hubs.alice.id ? hubs.bob.id : hubs.alice.id
    expect([hubs.alice.id, hubs.bob.id]).toContain(hub.id)

    const listsBoth = async () => {
      const stored = await alice.backend.readHub(hub.id)
      if (!stored) return false
      const { sealedPeople } = await openHub(await importShareKey(hub.key), hub.id, stored.sealed)
      return Object.keys(sealedPeople).sort().join() === 'p1,p2'
    }
    await until(listsBoth, 'the hub to list both people')
    // The losing id was never written, and nothing more is on its way.
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(await storedHubs()).toEqual([hub.id])
    expect(await bob.backend.readHub(lost)).toBeNull()
    expect(alice.session.getSnapshot().saveError).toBeNull()
    expect(bob.session.getSnapshot().saveError).toBeNull()
  })
})
