import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app'
import { collection, connectFirestoreEmulator, doc, getDoc, getDocs, getFirestore, type Firestore, type Timestamp } from 'firebase/firestore'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { addEvent, addPerson, compose, setReply } from '../src/domain/mutations'
import { addShare, closeShare } from '../src/domain/shares'
import type { DashboardState } from '../src/domain/types'
import { generateKeyString } from '../src/storage/crypto'
import { createDashboard, DashboardSession, newDocId, type SaveDelay } from '../src/storage/dashboardStore'
import { FirestoreShareBackend } from '../src/storage/firestoreShares'
import type { DashboardRef } from '../src/storage/link'
import { solvePow } from '../src/storage/pow'
import { importShareKey, sealReply, type ReplyPayload } from '../src/storage/shareCrypto'
import { ShareSync } from '../src/storage/shareSync'

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

/** One organizer's app: a dashboard session and its share sync, in its own browser. */
function organizer(name: string, ref: DashboardRef): { session: DashboardSession; sync: ShareSync } {
  const db = browser(name)
  const session = new DashboardSession(db, ref, { saveDelay: IMMEDIATE })
  const sync = new ShareSync(new FirestoreShareBackend(Promise.resolve(db)), ref, session, {
    locale: 'en',
    delay: IMMEDIATE,
    solvePow: async (shareId) => solvePow(shareId),
  })
  running.push(sync, session)
  void session.start()
  sync.start()
  return { session, sync }
}

async function until(check: () => boolean | Promise<boolean>, what: string, timeout = 15_000): Promise<void> {
  const end = Date.now() + timeout
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

const idle = ({ session, sync }: { session: DashboardSession; sync: ShareSync }) => {
  const snapshot = session.getSnapshot()
  return snapshot.state !== null && !snapshot.saving && sync.getSnapshot().replies.length === 0
}

/** A respondent's phone: its own browser, sending replies through the share backend. */
function respondent(shareId: string, key: string) {
  const backend = new FirestoreShareBackend(Promise.resolve(browser('respondent')))
  return {
    send: async (personId: string, answer: ReplyPayload['answer'], device: string) =>
      backend.addReply(shareId, await sealReply({ shareKey: await importShareKey(key) }, shareId, { personId, answer, device, via: 'shared' })),
    shareReady: async () => (await backend.readShare(shareId)) !== null,
  }
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

/** The `createdAt` (ms) of every reply stored on the server. */
async function storedReplies(shareId: string): Promise<number[]> {
  let times: number[] = []
  await env.withSecurityRulesDisabled(async (context) => {
    const snap = await getDocs(collection(context.firestore(), 'shares', shareId, 'replies'))
    times = snap.docs.map((d) => (d.data().createdAt as Timestamp).toMillis())
  })
  return times
}

const newestReply = async (shareId: string) => Math.max(...(await storedReplies(shareId)))

const answerOf = (state: DashboardState, personId: string) =>
  state.events.e1.yes?.includes(personId) ? 'yes' : state.events.e1.no?.includes(personId) ? 'no' : 'none'

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

describe('ShareSync on Firestore', () => {
  it('two organizers fold the same replies once', async () => {
    const ref = await createClub()
    const alice = organizer('alice', ref)
    const bob = organizer('bob', ref)
    await until(() => alice.session.getSnapshot().state !== null && bob.session.getSnapshot().state !== null, 'both loaded')

    const shareId = newDocId()
    const key = generateKeyString()
    alice.session.mutate(addShare(shareId, { eventId: 'e1', kind: 'presence', key, visibility: 'public', autoClose: true }))
    const phone = respondent(shareId, key)
    await until(phone.shareReady, 'the share document')
    await until(() => bob.session.getSnapshot().state?.shares?.[shareId] !== undefined, 'bob to see the link')

    await phone.send('p1', 'yes', 'phoneA')
    await phone.send('p2', 'yes', 'phoneB')
    await phone.send('p1', 'no', 'phoneA')
    const newest = await newestReply(shareId)

    await until(
      () =>
        idle(alice) &&
        idle(bob) &&
        alice.session.getSnapshot().state!.shares![shareId].mergedUpTo === newest &&
        bob.session.getSnapshot().state!.shares![shareId].mergedUpTo === newest,
      'both to fold every reply',
    )
    for (const { session } of [alice, bob]) {
      const { state, saveError } = session.getSnapshot()
      expect(saveError).toBeNull()
      expect(answerOf(state!, 'p1')).toBe('no')
      expect(answerOf(state!, 'p2')).toBe('yes')
      expect(state!.events.e1.yes).toEqual(['p2'])
      expect(state!.events.e1.no).toEqual(['p1'])
      expect(state!.shares![shareId]).toMatchObject({ mergedUpTo: newest, replied: true })
      for (const trace of Object.values(state!.events.e1.replyLog!)) expect(trace.others).toBeUndefined()
    }
  })

  it('a reply sent after a hand edit wins, an older one does not', async () => {
    const ref = await createClub()
    const alice = organizer('alice', ref)
    await until(() => alice.session.getSnapshot().state !== null, 'loaded')
    const shareId = newDocId()
    const key = generateKeyString()
    alice.session.mutate(addShare(shareId, { eventId: 'e1', kind: 'presence', key, visibility: 'public', autoClose: true }))
    const phone = respondent(shareId, key)
    await until(phone.shareReady, 'the share document')

    // A hand edit, then a newer reply: the reply wins.
    alice.session.mutate(setReply('e1', 'p1', 'yes', Date.now()))
    await until(() => idle(alice), 'the hand edit to save')
    await new Promise((resolve) => setTimeout(resolve, 5))
    await phone.send('p1', 'no', 'phoneA')
    const first = await newestReply(shareId)
    await until(() => idle(alice) && alice.session.getSnapshot().state!.shares![shareId].mergedUpTo === first, 'the reply to fold')
    expect(answerOf(alice.session.getSnapshot().state!, 'p1')).toBe('no')
    expect(alice.session.getSnapshot().state!.events.e1.replyLog!.p1).toMatchObject({ via: 'shared', device: 'phoneA' })

    // A reply sent while the organizer's app was offline, then an offline hand edit made after it:
    // when the app folds the reply later, the hand edit stays.
    alice.sync.stop()
    await phone.send('p2', 'yes', 'phoneB')
    const second = await newestReply(shareId)
    await new Promise((resolve) => setTimeout(resolve, 5))
    alice.session.mutate(setReply('e1', 'p2', 'no', Date.now()))
    await until(() => idle(alice), 'the hand edit to save')
    alice.sync.start()
    await until(() => idle(alice) && alice.session.getSnapshot().state!.shares![shareId].mergedUpTo === second, 'the older reply to fold')
    const state = alice.session.getSnapshot().state!
    expect(answerOf(state, 'p2')).toBe('no')
    expect(state.events.e1.replyLog!.p2).toMatchObject({ via: 'hand' })
    expect(answerOf(state, 'p1')).toBe('no')
    expect(alice.session.getSnapshot().saveError).toBeNull()
  })

  it('closes a link, deletes its folded replies and forgets it', async () => {
    const ref = await createClub()
    const alice = organizer('alice', ref)
    await until(() => alice.session.getSnapshot().state !== null, 'loaded')
    const shareId = newDocId()
    const key = generateKeyString()
    alice.session.mutate(addShare(shareId, { eventId: 'e1', kind: 'presence', key, visibility: 'public', autoClose: false }))
    const phone = respondent(shareId, key)
    await until(phone.shareReady, 'the share document')
    await phone.send('p1', 'yes', 'phoneA')
    await phone.send('p2', 'no', 'phoneB')
    const newest = await newestReply(shareId)
    await until(() => idle(alice) && alice.session.getSnapshot().state!.shares![shareId].mergedUpTo === newest, 'the replies to fold')

    alice.session.mutate(closeShare(shareId))
    await until(() => idle(alice) && alice.session.getSnapshot().state!.shares === undefined, 'the link to be forgotten')
    expect(await storedReplies(shareId)).toEqual([])
    await env.withSecurityRulesDisabled(async (context) => {
      const share = (await getDoc(doc(context.firestore(), 'shares', shareId))).data()!
      expect(share.closed).toBe(true)
      expect(share.foldedUpTo.toMillis()).toBe(newest)
    })
    const state = alice.session.getSnapshot().state!
    expect(answerOf(state, 'p1')).toBe('yes')
    expect(answerOf(state, 'p2')).toBe('no')
    await expect(phone.send('p1', 'no', 'phoneA')).rejects.toThrow()
  })
})
