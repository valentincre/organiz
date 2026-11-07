import { readFileSync } from 'node:fs'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  Bytes,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  type Firestore,
} from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MAX_HUB_CIPHERTEXT_BYTES } from '../src/storage/hubCrypto'
import { commitmentOf, deriveEditKeys, hubProofFor, proofFor, shareProofFor, type EditKeys } from '../src/storage/keys'
import { isValidPow, POW_HEX_ZEROS, solvePow } from '../src/storage/pow'
import { MAX_SHARE_CIPHERTEXT_BYTES } from '../src/storage/shareCrypto'

const DOC_ID = 'AAAAAAAAAAAAAAAAAAAAAA' // 22 chars, like a real id
const OTHER_DOC_ID = 'BBBBBBBBBBBBBBBBBBBBBB'
const SECRET = 'A'.repeat(43) // 43 chars of base64url, like a real secret
const OTHER_SECRET = 'E'.repeat(43)
const SHARE_ID = 'CCCCCCCCCCCCCCCCCCCCCC'
const HUB_ID = 'DDDDDDDDDDDDDDDDDDDDDD'

let env: RulesTestEnvironment
let db: Firestore
let editKeys: EditKeys
let otherEditKeys: EditKeys
let nonce: string
let shareNonce: string
let hubNonce: string

const v2Envelope = (rev: number, { proof, next, ...overrides }: { proof: string; next: string } & Record<string, unknown>) => ({
  v: 2,
  iv: 'abcdefghijklmnop',
  ct: Bytes.fromUint8Array(new Uint8Array([1, 2, 3])),
  rev,
  updatedAt: serverTimestamp(),
  next,
  proof,
  ...overrides,
})

/** The create envelope: the proof field carries the proof of work and `next` commits to proof(2). */
const createEnvelope = async (overrides: Record<string, unknown> = {}) =>
  v2Envelope(1, { proof: nonce, next: await commitmentOf(await proofFor(editKeys.writeKey, DOC_ID, 2)), ...overrides })

/** The envelope of revision `rev` as the edit-key holder signs it: reveals proof(rev), commits to proof(rev + 1). */
const updateEnvelope = async (rev: number, overrides: Record<string, unknown> = {}) =>
  v2Envelope(rev, {
    proof: await proofFor(editKeys.writeKey, DOC_ID, rev),
    next: await commitmentOf(await proofFor(editKeys.writeKey, DOC_ID, rev + 1)),
    ...overrides,
  })

/** A nonce one hex zero short: pins the rules to `POW_HEX_ZEROS`, not to a lower difficulty. */
function nonceOneZeroShort(docId: string): string {
  for (let counter = 0; ; counter++) {
    const candidate = counter.toString(36)
    if (isValidPow(docId, candidate, POW_HEX_ZEROS - 1) && !isValidPow(docId, candidate)) return candidate
  }
}

const bytes = (size: number) => Bytes.fromUint8Array(new Uint8Array(size).fill(1))

const shareEnvelope = (rev: number, { proof, next, ...overrides }: { proof: string; next: string } & Record<string, unknown>) => ({
  v: 1,
  iv: 'abcdefghijklmnop',
  ct: bytes(3),
  closesAt: null,
  closed: false,
  foldedUpTo: null,
  rev,
  next,
  proof,
  updatedAt: serverTimestamp(),
  ...overrides,
})

/** The share's create envelope: `proof` carries the proof of work and `next` commits to the share proof of revision 2. */
const shareCreate = async (overrides: Record<string, unknown> = {}) =>
  shareEnvelope(1, { proof: shareNonce, next: await commitmentOf(await shareProofFor(editKeys.writeKey, SHARE_ID, 2)), ...overrides })

/** Revision `rev` of the share as the organizer signs it: reveals the share proof of `rev`, commits to `rev + 1`. */
const shareUpdate = async (rev: number, overrides: Record<string, unknown> = {}) =>
  shareEnvelope(rev, {
    proof: await shareProofFor(editKeys.writeKey, SHARE_ID, rev),
    next: await commitmentOf(await shareProofFor(editKeys.writeKey, SHARE_ID, rev + 1)),
    ...overrides,
  })

const hubEnvelope = (rev: number, { proof, next, ...overrides }: { proof: string; next: string } & Record<string, unknown>) => ({
  v: 1,
  iv: 'abcdefghijklmnop',
  ct: bytes(3),
  rev,
  next,
  proof,
  updatedAt: serverTimestamp(),
  ...overrides,
})

/** The hub's create envelope for `hubId`: `proof` carries the proof of work and `next` commits to the hub proof of revision 2. */
const hubCreate = async (overrides: Record<string, unknown> = {}, hubId = HUB_ID, powNonce = hubNonce) =>
  hubEnvelope(1, { proof: powNonce, next: await commitmentOf(await hubProofFor(editKeys.writeKey, hubId, 2)), ...overrides })

/** Revision `rev` of the hub as the organizer signs it: reveals the hub proof of `rev`, commits to `rev + 1`. */
const hubUpdate = async (rev: number, overrides: Record<string, unknown> = {}, hubId = HUB_ID) =>
  hubEnvelope(rev, {
    proof: await hubProofFor(editKeys.writeKey, hubId, rev),
    next: await commitmentOf(await hubProofFor(editKeys.writeKey, hubId, rev + 1)),
    ...overrides,
  })

const replyDoc = (overrides: Record<string, unknown> = {}) => ({
  createdAt: serverTimestamp(),
  iv: 'abcdefghijklmnop',
  ct: bytes(3),
  ...overrides,
})

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

beforeAll(async () => {
  editKeys = await deriveEditKeys(SECRET, DOC_ID)
  otherEditKeys = await deriveEditKeys(OTHER_SECRET, OTHER_DOC_ID)
  nonce = solvePow(DOC_ID)
  shareNonce = solvePow(SHARE_ID)
  hubNonce = solvePow(HUB_ID)
  env = await initializeTestEnvironment({
    projectId: 'demo-organiz',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8180 },
  })
  db = env.unauthenticatedContext().firestore() as unknown as Firestore
})

beforeEach(() => env.clearFirestore())
afterAll(() => env.cleanup())

describe('dashboards rules', () => {
  const dashboard = () => doc(db, 'dashboards', DOC_ID)

  it('allows creating a valid dashboard and reading it by id', async () => {
    await assertSucceeds(setDoc(dashboard(), await createEnvelope()))
    await assertSucceeds(getDoc(dashboard()))
  })

  it("accepts the client's commitment encoding", async () => {
    // `commitmentOf` must give exactly what `hashing.sha256(proof).toHexString().lower()` gives in the rules.
    const created = await createEnvelope()
    expect(created.next).toMatch(/^[0-9a-f]{64}$/)
    await assertSucceeds(setDoc(dashboard(), created))
    await assertSucceeds(setDoc(dashboard(), await updateEnvelope(2)))
  })

  it('creates only with a valid proof of work', async () => {
    const otherDocNonce = solvePow(OTHER_DOC_ID)
    await assertFails(setDoc(dashboard(), await createEnvelope({ proof: '0' })))
    await assertFails(setDoc(dashboard(), await createEnvelope({ proof: nonceOneZeroShort(DOC_ID) })))
    await assertFails(setDoc(dashboard(), await createEnvelope({ proof: otherDocNonce })))
    await assertFails(setDoc(dashboard(), await createEnvelope({ proof: nonce.padEnd(17, '0') })))
    await assertSucceeds(setDoc(dashboard(), await createEnvelope()))
  })

  it('rejects a create with a wrong id, rev or shape', async () => {
    await assertFails(setDoc(doc(db, 'dashboards', 'short'), await createEnvelope()))
    await assertFails(setDoc(dashboard(), { ...(await createEnvelope()), rev: 2 }))
    await assertFails(setDoc(dashboard(), await createEnvelope({ name: 'leak' })))
    await assertFails(setDoc(dashboard(), await createEnvelope({ iv: 'short' })))
    await assertFails(setDoc(dashboard(), await createEnvelope({ next: 'short' })))
    // The length of a base64 SHA-256, which commitments no longer use.
    await assertFails(setDoc(dashboard(), await createEnvelope({ next: 'x'.repeat(44) })))
    await assertFails(setDoc(dashboard(), await createEnvelope({ updatedAt: new Date() })))
    await assertFails(setDoc(dashboard(), await createEnvelope({ ct: 'ciphertext' })))
    await assertFails(setDoc(dashboard(), await createEnvelope({ ct: Bytes.fromUint8Array(new Uint8Array(900_000)) })))
  })

  it.each([
    ['an extra field', { name: 'leak' }],
    ['a ciphertext over the limit', { ct: Bytes.fromUint8Array(new Uint8Array(900_000)) }],
    ['a wrong envelope version', { v: 3 }],
    ['a malformed commitment', { next: 'short' }],
  ])('rejects an update with %s, even with the right proof and revision', async (_, overrides) => {
    await assertSucceeds(setDoc(dashboard(), await createEnvelope()))
    await assertFails(setDoc(dashboard(), await updateEnvelope(2, overrides)))
    await assertSucceeds(setDoc(dashboard(), await updateEnvelope(2)))
  })

  it('lets the edit-key holder chain three updates', async () => {
    await assertSucceeds(setDoc(dashboard(), await createEnvelope()))
    for (const rev of [2, 3, 4]) {
      await assertSucceeds(setDoc(dashboard(), await updateEnvelope(rev)))
    }
  })

  it('denies an update without the next proof', async () => {
    await assertSucceeds(setDoc(dashboard(), await createEnvelope()))
    await assertFails(setDoc(dashboard(), await updateEnvelope(2, { proof: 'not-the-proof' })))
    // The nonce revealed at creation is all a reader can see.
    await assertFails(setDoc(dashboard(), await updateEnvelope(2, { proof: nonce })))
    await assertFails(setDoc(dashboard(), await updateEnvelope(2, { proof: await proofFor(otherEditKeys.writeKey, OTHER_DOC_ID, 2) })))
    // Skipping a revision: proof(3) does not open the commitment to proof(2).
    await assertFails(setDoc(dashboard(), await updateEnvelope(2, { proof: await proofFor(editKeys.writeKey, DOC_ID, 3) })))
  })

  it('denies the right proof on a wrong revision', async () => {
    await assertSucceeds(setDoc(dashboard(), await createEnvelope()))
    const proof = await proofFor(editKeys.writeKey, DOC_ID, 2)
    // The proof opens the stored commitment, so only the revision check can deny these.
    await assertFails(setDoc(dashboard(), await updateEnvelope(3, { proof })))
    await assertFails(setDoc(dashboard(), await updateEnvelope(1, { proof })))
    await assertSucceeds(setDoc(dashboard(), await updateEnvelope(2)))
  })

  it('denies a second save made from the same revision', async () => {
    await assertSucceeds(setDoc(dashboard(), await createEnvelope()))
    const first = await updateEnvelope(2)
    const second = await updateEnvelope(2, { ct: Bytes.fromUint8Array(new Uint8Array([4, 5, 6])) })
    await assertSucceeds(setDoc(dashboard(), first))
    await assertFails(setDoc(dashboard(), second))
  })

  it('denies v1 envelopes', async () => {
    const v1 = { v: 1, iv: 'abcdefghijklmnop', ct: 'ciphertext', rev: 1, updatedAt: serverTimestamp() }
    await assertFails(setDoc(dashboard(), v1))
    await assertSucceeds(setDoc(dashboard(), await createEnvelope()))
    await assertFails(setDoc(dashboard(), { ...v1, rev: 2 }))
  })

  it('forbids listing and deleting', async () => {
    await assertSucceeds(setDoc(dashboard(), await createEnvelope()))
    await assertFails(getDocs(collection(db, 'dashboards')))
    await assertFails(deleteDoc(dashboard()))
  })

  it('denies every other collection', async () => {
    await assertFails(setDoc(doc(db, 'other', 'x'), { a: 1 }))
    await assertFails(getDoc(doc(db, 'other', 'x')))
  })
})

describe('shares rules', () => {
  const share = () => doc(db, 'shares', SHARE_ID)

  it('creates a share only with a proof of work and rev 1', async () => {
    await assertFails(setDoc(share(), await shareCreate({ proof: '0' })))
    await assertFails(setDoc(share(), await shareCreate({ proof: nonceOneZeroShort(SHARE_ID) })))
    await assertFails(setDoc(share(), await shareCreate({ proof: nonce })))
    await assertFails(setDoc(share(), await shareCreate({ rev: 2 })))
    await assertSucceeds(setDoc(share(), await shareCreate()))
    await assertSucceeds(getDoc(share()))
  })

  it('refuses a share created closed', async () => {
    await assertFails(setDoc(share(), await shareCreate({ closed: true })))
    await assertSucceeds(setDoc(share(), await shareCreate()))
  })

  it('rejects a share with a wrong id or shape', async () => {
    await assertFails(setDoc(doc(db, 'shares', 'short'), await shareCreate()))
    await assertFails(setDoc(share(), await shareCreate({ v: 2 })))
    await assertFails(setDoc(share(), await shareCreate({ name: 'leak' })))
    await assertFails(setDoc(share(), await shareCreate({ iv: 'short' })))
    await assertFails(setDoc(share(), await shareCreate({ next: 'short' })))
    await assertFails(setDoc(share(), await shareCreate({ updatedAt: new Date() })))
    await assertFails(setDoc(share(), await shareCreate({ ct: 'ciphertext' })))
    await assertFails(setDoc(share(), await shareCreate({ ct: bytes(0) })))
    await assertFails(setDoc(share(), await shareCreate({ ct: bytes(MAX_SHARE_CIPHERTEXT_BYTES) })))
    await assertFails(setDoc(share(), await shareCreate({ closesAt: 'tomorrow' })))
    await assertFails(setDoc(share(), await shareCreate({ closed: 'false' })))
    await assertFails(setDoc(share(), await shareCreate({ foldedUpTo: 0 })))
    const { closesAt: _closesAt, ...withoutClosesAt } = await shareCreate()
    await assertFails(setDoc(share(), withoutClosesAt))
    await assertSucceeds(
      setDoc(share(), await shareCreate({ ct: bytes(MAX_SHARE_CIPHERTEXT_BYTES - 1), closesAt: Timestamp.fromMillis(Date.now() + 60_000) })),
    )
  })

  it('forbids listing and deleting shares', async () => {
    await assertSucceeds(setDoc(share(), await shareCreate()))
    await assertFails(getDocs(collection(db, 'shares')))
    await assertFails(deleteDoc(share()))
  })

  it('lets the organizer update a share with the next proof', async () => {
    await assertSucceeds(setDoc(share(), await shareCreate()))
    await assertSucceeds(setDoc(share(), await shareUpdate(2)))
    await assertSucceeds(setDoc(share(), await shareUpdate(3, { closed: true, foldedUpTo: Timestamp.now() })))
    // Compare-and-swap: a second save from the same revision is denied.
    await assertFails(setDoc(share(), await shareUpdate(3)))
    await assertFails(setDoc(share(), await shareUpdate(4, { extra: 1 })))
  })

  it("denies an update with the dashboard's proof", async () => {
    await assertSucceeds(setDoc(share(), await shareCreate()))
    // Same write key, same id and revision, but without the `share:` prefix.
    await assertFails(setDoc(share(), await shareUpdate(2, { proof: await proofFor(editKeys.writeKey, SHARE_ID, 2) })))
    await assertSucceeds(setDoc(share(), await shareUpdate(2)))
  })

  it('denies an update with a proof already revealed', async () => {
    await assertSucceeds(setDoc(share(), await shareCreate()))
    await assertFails(setDoc(share(), await shareUpdate(2, { proof: shareNonce })))
    await assertSucceeds(setDoc(share(), await shareUpdate(2)))
    await assertFails(setDoc(share(), await shareUpdate(3, { proof: await shareProofFor(editKeys.writeKey, SHARE_ID, 2) })))
    await assertFails(setDoc(share(), await shareUpdate(3, { proof: await shareProofFor(otherEditKeys.writeKey, SHARE_ID, 3) })))
  })

  it('never reopens a closed share', async () => {
    await assertSucceeds(setDoc(share(), await shareCreate()))
    await assertSucceeds(setDoc(share(), await shareUpdate(2, { closed: true })))
    await assertFails(setDoc(share(), await shareUpdate(3, { closed: false })))
    await assertSucceeds(setDoc(share(), await shareUpdate(3, { closed: true })))
  })

  it('refuses to move closesAt once passed', { timeout: 30_000 }, async () => {
    // Wide margins: the writes before the closing time must land before it, even on a slow machine.
    const closesAt = Timestamp.fromMillis(Date.now() + 5_000)
    const later = Timestamp.fromMillis(Date.now() + 10_000)
    await assertSucceeds(setDoc(share(), await shareCreate({ closesAt })))
    // Before it passes, the organizer moves it freely.
    await assertSucceeds(setDoc(share(), await shareUpdate(2, { closesAt: later })))
    await sleep(11_000)
    await assertFails(setDoc(share(), await shareUpdate(3, { closesAt: Timestamp.fromMillis(Date.now() + 60_000) })))
    await assertFails(setDoc(share(), await shareUpdate(3, { closesAt: null })))
    await assertSucceeds(setDoc(share(), await shareUpdate(3, { closesAt: later, closed: true })))
  })
})

describe('hubs rules', () => {
  const hub = (id = HUB_ID) => doc(db, 'hubs', id)

  it('allows an organizer to create and update a hub', async () => {
    await assertSucceeds(setDoc(hub(), await hubCreate()))
    await assertSucceeds(getDoc(hub()))
    for (const rev of [2, 3, 4]) {
      await assertSucceeds(setDoc(hub(), await hubUpdate(rev, { ct: bytes(rev) })))
    }
    await assertSucceeds(setDoc(hub(), await hubUpdate(5, { ct: bytes(MAX_HUB_CIPHERTEXT_BYTES - 1) })))
  })

  it('refuses a hub without proof of work, with a wrong proof, a stale rev, an extra field, or a delete', async () => {
    // Proof of work.
    await assertFails(setDoc(hub(), await hubCreate({ proof: '0' })))
    await assertFails(setDoc(hub(), await hubCreate({ proof: nonceOneZeroShort(HUB_ID) })))
    await assertFails(setDoc(hub(), await hubCreate({ proof: nonce })))
    await assertFails(setDoc(hub(), await hubCreate({ proof: hubNonce.padEnd(17, '0') })))
    await assertFails(setDoc(hub(), await hubCreate({ rev: 2 })))
    await assertSucceeds(setDoc(hub(), await hubCreate()))
    // A second create is an update at the same revision.
    await assertFails(setDoc(hub(), await hubCreate()))
    // Wrong proofs: not a proof, the revealed nonce, another write key, a skipped revision.
    await assertFails(setDoc(hub(), await hubUpdate(2, { proof: 'not-the-proof' })))
    await assertFails(setDoc(hub(), await hubUpdate(2, { proof: hubNonce })))
    await assertFails(setDoc(hub(), await hubUpdate(2, { proof: await hubProofFor(otherEditKeys.writeKey, HUB_ID, 2) })))
    await assertFails(setDoc(hub(), await hubUpdate(2, { proof: await hubProofFor(editKeys.writeKey, HUB_ID, 3) })))
    // The right proof on a wrong revision.
    const proof = await hubProofFor(editKeys.writeKey, HUB_ID, 2)
    await assertFails(setDoc(hub(), await hubUpdate(3, { proof })))
    await assertFails(setDoc(hub(), await hubUpdate(1, { proof })))
    // Extra field.
    await assertFails(setDoc(hub(), await hubUpdate(2, { name: 'leak' })))
    await assertSucceeds(setDoc(hub(), await hubUpdate(2)))
    // Stale revision: a second save made from revision 1.
    await assertFails(setDoc(hub(), await hubUpdate(2, { ct: bytes(4) })))
    // Delete and list.
    await assertFails(deleteDoc(hub()))
    await assertFails(getDocs(collection(db, 'hubs')))
  })

  it('refuses a hub with a wrong id or shape', async () => {
    await assertFails(setDoc(doc(db, 'hubs', 'short'), await hubCreate()))
    await assertFails(setDoc(hub(), await hubCreate({ v: 2 })))
    await assertFails(setDoc(hub(), await hubCreate({ iv: 'short' })))
    await assertFails(setDoc(hub(), await hubCreate({ next: 'short' })))
    await assertFails(setDoc(hub(), await hubCreate({ updatedAt: new Date() })))
    await assertFails(setDoc(hub(), await hubCreate({ ct: 'ciphertext' })))
    await assertFails(setDoc(hub(), await hubCreate({ ct: bytes(0) })))
    await assertFails(setDoc(hub(), await hubCreate({ ct: bytes(MAX_HUB_CIPHERTEXT_BYTES) })))
    await assertFails(setDoc(hub(), await hubCreate({ rev: '1' })))
    // Share fields do not belong on a hub.
    await assertFails(setDoc(hub(), await hubCreate({ closed: false })))
    const { updatedAt: _updatedAt, ...withoutUpdatedAt } = await hubCreate()
    await assertFails(setDoc(hub(), withoutUpdatedAt))
    await assertSucceeds(setDoc(hub(), await hubCreate()))
    await assertFails(setDoc(hub(), await hubUpdate(2, { proof: 'x'.repeat(65) })))
    await assertFails(setDoc(hub(), await hubUpdate(2, { ct: bytes(MAX_HUB_CIPHERTEXT_BYTES) })))
    await assertFails(setDoc(hub(), await hubUpdate(2, { v: 2 })))
    await assertSucceeds(setDoc(hub(), await hubUpdate(2)))
  })

  it('refuses a share proof on a hub with the same id', async () => {
    // Same write key, same id and revision, but the `share:` prefix (or none, as for a dashboard).
    await assertSucceeds(setDoc(hub(SHARE_ID), await hubCreate({}, SHARE_ID, shareNonce)))
    await assertFails(setDoc(hub(SHARE_ID), await hubUpdate(2, { proof: await shareProofFor(editKeys.writeKey, SHARE_ID, 2) }, SHARE_ID)))
    await assertFails(setDoc(hub(SHARE_ID), await hubUpdate(2, { proof: await proofFor(editKeys.writeKey, SHARE_ID, 2) }, SHARE_ID)))
    await assertSucceeds(setDoc(hub(SHARE_ID), await hubUpdate(2, {}, SHARE_ID)))
    // And the other way round: a hub proof does not open a share with the same id.
    await assertSucceeds(setDoc(doc(db, 'shares', SHARE_ID), await shareCreate()))
    await assertFails(setDoc(doc(db, 'shares', SHARE_ID), await shareUpdate(2, { proof: await hubProofFor(editKeys.writeKey, SHARE_ID, 2) })))
    await assertSucceeds(setDoc(doc(db, 'shares', SHARE_ID), await shareUpdate(2)))
  })

  it('a personal link cannot write the hub', async () => {
    await assertSucceeds(setDoc(hub(), await hubCreate()))
    await assertSucceeds(setDoc(hub(), await hubUpdate(2)))
    // A personal-link holder reads the hub, so it sees the last revealed proof.
    const holder = env.unauthenticatedContext().firestore() as unknown as Firestore
    const revealed = (await getDoc(doc(holder, 'hubs', HUB_ID))).data()!.proof as string
    await assertFails(setDoc(doc(holder, 'hubs', HUB_ID), hubEnvelope(3, { proof: revealed, next: 'f'.repeat(64) })))
    await assertFails(deleteDoc(doc(holder, 'hubs', HUB_ID)))
  })
})

describe('replies rules', () => {
  const share = () => doc(db, 'shares', SHARE_ID)
  const replies = () => collection(db, 'shares', SHARE_ID, 'replies')
  const reply = (id: string) => doc(db, 'shares', SHARE_ID, 'replies', id)
  const EPK = 'B'.repeat(87) // raw P-256 public key in base64url

  it('accepts a reply to an open share', async () => {
    await assertSucceeds(setDoc(share(), await shareCreate()))
    await assertSucceeds(setDoc(reply('public'), replyDoc()))
    await assertSucceeds(setDoc(reply('private'), replyDoc({ epk: EPK })))
    await assertSucceeds(getDoc(reply('private')))
  })

  it('accepts a reply before closesAt', async () => {
    await assertSucceeds(setDoc(share(), await shareCreate({ closesAt: Timestamp.fromMillis(Date.now() + 60_000) })))
    await assertSucceeds(setDoc(reply('r1'), replyDoc()))
  })

  it('denies a reply to a closed share', async () => {
    await assertSucceeds(setDoc(share(), await shareCreate()))
    await assertSucceeds(setDoc(share(), await shareUpdate(2, { closed: true })))
    await assertFails(setDoc(reply('r1'), replyDoc()))
  })

  it('denies a reply to a share closed by time', async () => {
    await assertSucceeds(setDoc(share(), await shareCreate({ closesAt: Timestamp.fromMillis(Date.now() - 60_000) })))
    await assertFails(setDoc(reply('r1'), replyDoc()))
  })

  it('denies a reply to a missing share', async () => {
    await assertFails(setDoc(reply('r1'), replyDoc()))
  })

  it('denies a reply with a client createdAt, extra keys or a 2,001-byte ct', async () => {
    await assertSucceeds(setDoc(share(), await shareCreate()))
    // A minute off: the local emulator can answer within the same millisecond as `new Date()`.
    await assertFails(setDoc(reply('r1'), replyDoc({ createdAt: new Date(Date.now() - 60_000) })))
    await assertFails(setDoc(reply('r1'), replyDoc({ name: 'leak' })))
    await assertFails(setDoc(reply('r1'), replyDoc({ ct: bytes(2_001) })))
    await assertFails(setDoc(reply('r1'), replyDoc({ ct: bytes(0) })))
    await assertFails(setDoc(reply('r1'), replyDoc({ ct: 'ciphertext' })))
    await assertFails(setDoc(reply('r1'), replyDoc({ iv: 'short' })))
    await assertFails(setDoc(reply('r1'), replyDoc({ epk: 'x'.repeat(101) })))
    await assertFails(setDoc(reply('r1'), replyDoc({ epk: 42 })))
    const { createdAt: _createdAt, ...withoutCreatedAt } = replyDoc()
    await assertFails(setDoc(reply('r1'), withoutCreatedAt))
    await assertSucceeds(setDoc(reply('r1'), replyDoc({ ct: bytes(2_000), epk: 'x'.repeat(100) })))
  })

  it('denies updating a reply', async () => {
    await assertSucceeds(setDoc(share(), await shareCreate()))
    await assertSucceeds(setDoc(reply('r1'), replyDoc()))
    await assertFails(setDoc(reply('r1'), replyDoc({ ct: bytes(4) })))
  })

  it('lists replies only with a limit of at most 500', async () => {
    await assertSucceeds(setDoc(share(), await shareCreate()))
    await assertSucceeds(setDoc(reply('r1'), replyDoc()))
    await assertSucceeds(getDocs(query(replies(), limit(500))))
    await assertFails(getDocs(query(replies(), limit(501))))
    await assertFails(getDocs(replies()))
  })

  it('deletes only folded replies of a closed share', async () => {
    await assertSucceeds(setDoc(share(), await shareCreate()))
    await assertSucceeds(setDoc(reply('r1'), replyDoc()))
    await assertSucceeds(setDoc(reply('r2'), replyDoc({ epk: EPK })))
    const foldedUpTo = (await getDoc(reply('r2'))).get('createdAt') as Timestamp
    // Open share: nothing is folded yet.
    await assertFails(deleteDoc(reply('r1')))
    // Closed but not folded.
    await assertSucceeds(setDoc(share(), await shareUpdate(2, { closed: true })))
    await assertFails(deleteDoc(reply('r1')))
    await assertSucceeds(setDoc(share(), await shareUpdate(3, { closed: true, foldedUpTo })))
    // A reply the organizer has not folded yet (written around the rules, since the share is closed).
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'shares', SHARE_ID, 'replies', 'late'), replyDoc({ createdAt: Timestamp.fromMillis(foldedUpTo.toMillis() + 1_000) }))
    })
    await assertSucceeds(deleteDoc(reply('r1')))
    await assertSucceeds(deleteDoc(reply('r2')))
    await assertFails(deleteDoc(reply('late')))
  })

  it('a reply link cannot write the dashboard or the share', async () => {
    // The organizer's dashboard and share, each at revision 2, so a proof of each has been revealed.
    await assertSucceeds(setDoc(doc(db, 'dashboards', DOC_ID), await createEnvelope()))
    await assertSucceeds(setDoc(doc(db, 'dashboards', DOC_ID), await updateEnvelope(2)))
    await assertSucceeds(setDoc(share(), await shareCreate()))
    await assertSucceeds(setDoc(share(), await shareUpdate(2)))

    // A respondent holds only the share id and key, so it can read the share and see its last proof.
    const respondent = env.unauthenticatedContext().firestore() as unknown as Firestore
    const seen = (await getDoc(doc(respondent, 'shares', SHARE_ID))).data()!
    const revealed = seen.proof as string
    const forged = (rev: number) => ({ proof: revealed, next: 'f'.repeat(64), rev })
    await assertFails(setDoc(doc(respondent, 'shares', SHARE_ID), shareEnvelope(3, forged(3))))
    await assertFails(setDoc(doc(respondent, 'shares', SHARE_ID), shareEnvelope(3, { ...forged(3), closed: true })))
    await assertFails(setDoc(doc(respondent, 'dashboards', DOC_ID), v2Envelope(3, forged(3))))
    await assertFails(deleteDoc(doc(respondent, 'shares', SHARE_ID)))
    await assertFails(setDoc(doc(respondent, 'dashboards', DOC_ID, 'replies', 'r1'), replyDoc()))
    // Replying is all it can do.
    await assertSucceeds(setDoc(doc(respondent, 'shares', SHARE_ID, 'replies', 'r1'), replyDoc()))
  })
})
