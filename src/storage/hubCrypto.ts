import type { HubContent, HubPerson } from '../domain/hub'
import { hasKey, LIMITS } from '../domain/limits'
import type { PersonId } from '../domain/types'
import { isId } from '../domain/validate'
import { decodeBase64Url, encodeBase64Url } from './base64url'
import { DecryptError } from './crypto'
import { openJson, sealJson, TooLargeError, type Sealed } from './envelope'

const SECRET_BYTES = 32
const MAX_HUB_BYTES = 2_000_000
const MAX_PERSON_BYTES = 100_000
/** Largest hub ciphertext accepted, mirrored in the Firestore rules. */
export const MAX_HUB_CIPHERTEXT_BYTES = 500_000
const PERSON_INFO = 'organiz/hub/person/v1'
const KEY = /^[A-Za-z0-9_-]{43}$/
const IV = /^[A-Za-z0-9_-]{16}$/
const B64URL = /^[A-Za-z0-9_-]+$/

const hubAad = (hubId: string) => `organiz/hub/v1:${hubId}`
const personAad = (hubId: string, personId: PersonId) => `${PERSON_INFO}:${hubId}:${personId}`
const utf8 = (text: string) => new TextEncoder().encode(text)

/** A person's entry in the hub: sealed with their own key, the ciphertext in base64url. */
export interface SealedPerson {
  iv: string
  ct: string
}

/** The hub as any holder of the hub key reads it: the open links, and one sealed entry per person. */
export interface OpenedHub {
  shares: HubContent['shares']
  sealedPeople: Record<PersonId, SealedPerson>
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** AES key of one person's entry: HKDF of their secret, bound to the hub. */
async function personKey(secret: string, hubId: string): Promise<CryptoKey> {
  const raw = decodeBase64Url(secret)
  if (raw.length !== SECRET_BYTES) throw new Error('A personal secret is 32 bytes')
  const master = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: utf8(hubId), info: utf8(PERSON_INFO) },
    master,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/**
 * Seals each person's entry with a key derived from their secret, so the holder of one personal
 * link cannot read another person's replies, then the whole with the hub key. Throws when a person
 * has no secret, and `TooLargeError` when the rules or readers would refuse the result.
 */
export async function sealHub(hubKey: CryptoKey, hubId: string, content: HubContent, secrets: Record<PersonId, string>): Promise<Sealed> {
  const people: Record<PersonId, SealedPerson> = {}
  for (const [personId, person] of Object.entries(content.people)) {
    if (!hasKey(secrets, personId)) throw new Error(`No personal secret for ${personId}`)
    const sealed = await sealJson(await personKey(secrets[personId], hubId), personAad(hubId, personId), person, MAX_PERSON_BYTES)
    people[personId] = { iv: sealed.iv, ct: encodeBase64Url(sealed.ct) }
  }
  const sealed = await sealJson(hubKey, hubAad(hubId), { v: 1, shares: content.shares, people }, MAX_HUB_BYTES)
  if (sealed.ct.byteLength >= MAX_HUB_CIPHERTEXT_BYTES) throw new TooLargeError()
  return sealed
}

const isSealedPerson = (value: unknown): value is SealedPerson =>
  isObject(value) &&
  typeof value.iv === 'string' &&
  IV.test(value.iv) &&
  typeof value.ct === 'string' &&
  value.ct.length <= MAX_HUB_CIPHERTEXT_BYTES * 2 &&
  B64URL.test(value.ct)

/** Opens the outer layer with the hub key; `DecryptError` on any failure or unexpected shape. */
export async function openHub(hubKey: CryptoKey, hubId: string, sealed: Sealed): Promise<OpenedHub> {
  const value = await openJson(hubKey, hubAad(hubId), sealed, MAX_HUB_BYTES)
  if (!isObject(value) || value.v !== 1 || !Array.isArray(value.shares) || !isObject(value.people)) throw new DecryptError()
  const { shares: rawShares, people: rawPeople } = value
  if (rawShares.length > LIMITS.shares || Object.keys(rawPeople).length > LIMITS.people) throw new DecryptError()
  const shares: OpenedHub['shares'] = []
  for (const share of rawShares) {
    if (!isObject(share) || !isId(share.shareId) || typeof share.key !== 'string' || !KEY.test(share.key)) throw new DecryptError()
    shares.push({ shareId: share.shareId, key: share.key })
  }
  if (new Set(shares.map((share) => share.shareId)).size !== shares.length) throw new DecryptError()
  const sealedPeople: Record<PersonId, SealedPerson> = {}
  for (const [personId, entry] of Object.entries(rawPeople)) {
    if (!isId(personId) || !isSealedPerson(entry)) throw new DecryptError()
    sealedPeople[personId] = { iv: entry.iv, ct: entry.ct }
  }
  return { shares, sealedPeople }
}

/** Opens one person's entry with their secret; `DecryptError` for another person's entry, a wrong secret or an unexpected shape. */
export async function openHubPerson(secret: string, hubId: string, personId: PersonId, entry: SealedPerson): Promise<HubPerson> {
  let key: CryptoKey
  let ct: Uint8Array<ArrayBuffer>
  try {
    key = await personKey(secret, hubId)
    ct = decodeBase64Url(entry.ct)
  } catch {
    throw new DecryptError()
  }
  const value = await openJson(key, personAad(hubId, personId), { iv: entry.iv, ct }, MAX_PERSON_BYTES)
  if (!isObject(value) || typeof value.name !== 'string' || value.name.length < 1 || value.name.length > LIMITS.personName) throw new DecryptError()
  if (!isObject(value.replies) || Object.keys(value.replies).length > LIMITS.shares) throw new DecryptError()
  const replies: HubPerson['replies'] = {}
  for (const [shareId, reply] of Object.entries(value.replies)) {
    if (!isId(shareId) || !isObject(reply) || (reply.answer !== 'yes' && reply.answer !== 'no') || !Number.isFinite(reply.at)) throw new DecryptError()
    replies[shareId] = { answer: reply.answer, at: reply.at as number }
  }
  return { name: value.name, replies }
}
