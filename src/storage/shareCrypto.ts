import type { PersonId } from '../domain/types'
import type { IncomingReply } from '../domain/replies'
import { isShareSnapshot, type ShareSnapshot } from '../domain/shareSnapshot'
import { isId } from '../domain/validate'
import { decodeBase64Url, encodeBase64Url } from './base64url'
import { DecryptError } from './crypto'
import { openJson, sealJson, TooLargeError, type Sealed } from './envelope'

const KEY_BYTES = 32
const MAX_SNAPSHOT_BYTES = 2_000_000
const MAX_REPLY_BYTES = 1_000
/** Largest snapshot ciphertext accepted, mirrored in the Firestore rules. */
export const MAX_SHARE_CIPHERTEXT_BYTES = 500_000
const EPK = /^[A-Za-z0-9_-]{87}$/
const REPLY_INFO = 'organiz/reply/v1'
const CURVE = 'P-256'
const ANSWERS = new Set(['yes', 'no', 'none', 'here', 'notHere'])

const snapshotAad = (shareId: string) => `organiz/share/v1:${shareId}`
const replyAad = (shareId: string) => `organiz/reply/v1:${shareId}`
const utf8 = (text: string) => new TextEncoder().encode(text)

/** A reply as stored: for a private link, `epk` is the sender's ephemeral public key (raw P-256, base64url). */
export interface SealedReply extends Sealed {
  epk?: string
}

export interface ReplyPayload {
  personId: PersonId
  answer: IncomingReply['answer']
  device: string
  via: 'shared' | 'personal'
  /** Personal links: the MAC of the signed fields (see personalCrypto). */
  mac?: string
  /** Personal links: the sender's clock when the reply was sent (ms), covered by the MAC. */
  sentAt?: number
}

const isReplyPayload = (value: unknown): value is ReplyPayload => {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    isId(v.personId) &&
    typeof v.answer === 'string' &&
    ANSWERS.has(v.answer) &&
    isId(v.device) &&
    (v.via === 'shared' || v.via === 'personal') &&
    (v.mac === undefined || (typeof v.mac === 'string' && v.mac.length <= 100)) &&
    (v.sentAt === undefined || (typeof v.sentAt === 'number' && Number.isFinite(v.sentAt)))
  )
}

/** The share key, 32 random bytes in base64url; `DecryptError` for anything else. */
export async function importShareKey(key: string): Promise<CryptoKey> {
  try {
    const raw = decodeBase64Url(key)
    if (raw.length !== KEY_BYTES) throw new DecryptError()
    return await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
  } catch {
    throw new DecryptError()
  }
}

export async function sealSnapshot(shareKey: CryptoKey, shareId: string, snapshot: ShareSnapshot): Promise<Sealed> {
  const sealed = await sealJson(shareKey, snapshotAad(shareId), snapshot, MAX_SNAPSHOT_BYTES)
  if (sealed.ct.byteLength >= MAX_SHARE_CIPHERTEXT_BYTES) throw new TooLargeError()
  return sealed
}

export async function openSnapshot(shareKey: CryptoKey, shareId: string, sealed: Sealed): Promise<ShareSnapshot> {
  const value = await openJson(shareKey, snapshotAad(shareId), sealed, MAX_SNAPSHOT_BYTES)
  if (!isShareSnapshot(value)) throw new DecryptError()
  return value
}

/** AES key shared by a reply's sender and the organizers: ECDH, then HKDF bound to the share. */
async function replyKey(privateKey: CryptoKey, publicKey: CryptoKey, shareId: string): Promise<CryptoKey> {
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256)
  const master = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: utf8(shareId), info: utf8(REPLY_INFO) },
    master,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Public links: encrypted with the share key. Private links: to the organizers' public key, through a fresh ephemeral key pair. */
export async function sealReply(
  to: { shareKey: CryptoKey } | { publicKey: string },
  shareId: string,
  payload: ReplyPayload,
): Promise<SealedReply> {
  if ('shareKey' in to) return sealJson(to.shareKey, replyAad(shareId), payload, MAX_REPLY_BYTES)
  let organizer: CryptoKey
  try {
    organizer = await crypto.subtle.importKey('jwk', JSON.parse(to.publicKey), { name: 'ECDH', namedCurve: CURVE }, false, [])
  } catch {
    throw new DecryptError()
  }
  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: CURVE }, false, ['deriveBits'])
  const key = await replyKey(ephemeral.privateKey, organizer, shareId)
  const sealed = await sealJson(key, replyAad(shareId), payload, MAX_REPLY_BYTES)
  return { ...sealed, epk: encodeBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey))) }
}

/**
 * A reply with an `epk` needs the organizers' private key. One without is opened with the share
 * key even when a private key is supplied, so replies from before a public to private switch stay readable.
 */
export async function openReply(
  keys: { shareKey: CryptoKey; privateKey?: CryptoKey },
  shareId: string,
  sealed: SealedReply,
): Promise<ReplyPayload> {
  let key = keys.shareKey
  if (sealed.epk !== undefined) {
    if (!keys.privateKey || !EPK.test(sealed.epk)) throw new DecryptError()
    try {
      const sender = await crypto.subtle.importKey('raw', decodeBase64Url(sealed.epk), { name: 'ECDH', namedCurve: CURVE }, false, [])
      key = await replyKey(keys.privateKey, sender, shareId)
    } catch {
      throw new DecryptError()
    }
  }
  const value = await openJson(key, replyAad(shareId), sealed, MAX_REPLY_BYTES)
  if (!isReplyPayload(value)) throw new DecryptError()
  const { personId, answer, device, via, mac, sentAt } = value
  return { personId, answer, device, via, ...(mac !== undefined && { mac }), ...(sentAt !== undefined && { sentAt }) }
}

/** A new organizer key pair as JWK JSON strings. */
export async function generateOrganizerKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: CURVE }, true, ['deriveBits'])
  const jwk = async (key: CryptoKey) => JSON.stringify(await crypto.subtle.exportKey('jwk', key))
  return { publicKey: await jwk(pair.publicKey), privateKey: await jwk(pair.privateKey) }
}

export async function importOrganizerKey(privateKey: string): Promise<CryptoKey> {
  try {
    return await crypto.subtle.importKey('jwk', JSON.parse(privateKey), { name: 'ECDH', namedCurve: CURVE }, false, ['deriveBits'])
  } catch {
    throw new DecryptError()
  }
}
