import type { Answer, PersonId } from '../domain/types'
import { decodeBase64Url, encodeBase64Url } from './base64url'

const MAC_INFO = 'organiz/personal/mac/v1'
const SECRET_BYTES = 32
const MAC_BYTES = 32

/** What a personal reply's MAC covers. */
export interface SignedFields {
  shareId: string
  personId: PersonId
  answer: Answer
  device: string
  sentAt: number
}

const utf8 = (text: string) => new TextEncoder().encode(text)

/** One fixed encoding of the fields, so the sender and the organizers MAC the same bytes. */
const canonical = ({ shareId, personId, answer, device, sentAt }: SignedFields) => utf8(JSON.stringify([shareId, personId, answer, device, sentAt]))

/** The HMAC key of a person's secret (32 bytes, base64url), through HKDF: the secret itself is never a MAC key. */
async function macKey(secret: string): Promise<CryptoKey> {
  const raw = decodeBase64Url(secret)
  if (raw.length !== SECRET_BYTES) throw new Error('A personal secret is 32 bytes')
  const master = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8(MAC_INFO) },
    master,
    { name: 'HMAC', hash: 'SHA-256', length: MAC_BYTES * 8 },
    false,
    ['sign', 'verify'],
  )
}

/** HMAC-SHA-256 with a key derived from the person's secret (HKDF, info 'organiz/personal/mac/v1'), base64url. */
export async function signReply(secret: string, fields: SignedFields): Promise<string> {
  const mac = await crypto.subtle.sign('HMAC', await macKey(secret), canonical(fields))
  return encodeBase64Url(new Uint8Array(mac))
}

/** False for a wrong or malformed MAC or secret; the comparison is Web Crypto's, in constant time. */
export async function verifyReply(secret: string, fields: SignedFields, mac: string): Promise<boolean> {
  try {
    const bytes = decodeBase64Url(mac)
    if (bytes.length !== MAC_BYTES) return false
    return await crypto.subtle.verify('HMAC', await macKey(secret), bytes, canonical(fields))
  } catch {
    return false
  }
}
