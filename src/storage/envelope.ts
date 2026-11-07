import type { DashboardState } from '../domain/types'
import { isDashboardState, isNewerVersion } from '../domain/validate'
import { decodeBase64Url, encodeBase64Url } from './base64url'
import { DecryptError, NewerVersionError } from './crypto'

const ALGORITHM = 'AES-GCM'
const IV_BYTES = 12

/** Largest ciphertext accepted, mirrored in the Firestore rules. */
export const MAX_CIPHERTEXT_BYTES = 900_000
/** Largest decompressed payload; guards readers against a compression bomb. */
export const MAX_PLAINTEXT_BYTES = 5_000_000

/** The stored form of an encrypted state: base64url IV and raw ciphertext. */
export interface Sealed {
  iv: string
  ct: Uint8Array<ArrayBuffer>
}

export class TooLargeError extends Error {
  constructor() {
    super('Dashboard is too large to be saved')
    this.name = 'TooLargeError'
  }
}

// The context (document or share id) is authenticated with the data as AAD,
// so a ciphertext copied into another document fails to decrypt.
const stateAad = (docId: string) => `organiz/v2:${docId}`

async function readAll(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new DecryptError()
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function gzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return readAll(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')), Infinity)
}

async function gunzip(bytes: Uint8Array<ArrayBuffer>, maxBytes: number): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new TextDecoder().decode(await readAll(stream, maxBytes))
}

/** Compresses and encrypts, with no size check: callers apply the limits. */
async function sealBytes(encKey: CryptoKey, aad: string, plaintext: Uint8Array<ArrayBuffer>): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv, additionalData: new TextEncoder().encode(aad) },
    encKey,
    await gzip(plaintext),
  )
  return { iv: encodeBase64Url(iv), ct: new Uint8Array(ciphertext) }
}

/**
 * Serializes, compresses and encrypts any JSON value, or throws `TooLargeError` when its
 * serialization exceeds `maxPlaintext` bytes: `openJson` refuses to decompress more than that.
 */
export async function sealJson(key: CryptoKey, aad: string, value: unknown, maxPlaintext: number): Promise<Sealed> {
  const plaintext = new TextEncoder().encode(JSON.stringify(value))
  if (plaintext.byteLength > maxPlaintext) throw new TooLargeError()
  return sealBytes(key, aad, plaintext)
}

/** Decrypts and decompresses (at most `maxPlaintext` bytes) a JSON value; `DecryptError` on any failure. */
export async function openJson(key: CryptoKey, aad: string, { iv, ct }: Sealed, maxPlaintext: number): Promise<unknown> {
  try {
    const compressed = await crypto.subtle.decrypt({ name: ALGORITHM, iv: decodeBase64Url(iv), additionalData: new TextEncoder().encode(aad) }, key, ct)
    return JSON.parse(await gunzip(new Uint8Array(compressed), maxPlaintext))
  } catch {
    throw new DecryptError()
  }
}

/**
 * Seals a state for storage, or throws `TooLargeError` when it must not be stored: when the
 * rules would refuse the ciphertext, or when readers would refuse to decompress it. The second
 * matters even when the state compresses well: it would be saved, then unreadable for everyone.
 */
export async function sealState(encKey: CryptoKey, docId: string, state: DashboardState): Promise<Sealed> {
  const sealed = await sealJson(encKey, stateAad(docId), state, MAX_PLAINTEXT_BYTES)
  if (sealed.ct.byteLength >= MAX_CIPHERTEXT_BYTES) throw new TooLargeError()
  return sealed
}

/**
 * Test-only: seals arbitrary text the way `sealState` does, but deliberately without its size
 * limits, to build what a modified client could store (not a valid state, or a compression bomb).
 */
export const sealRawForTest = (encKey: CryptoKey, docId: string, text: string): Promise<Sealed> =>
  sealBytes(encKey, stateAad(docId), new TextEncoder().encode(text))

export async function openState(encKey: CryptoKey, docId: string, sealed: Sealed): Promise<DashboardState> {
  const value = await openJson(encKey, stateAad(docId), sealed, MAX_PLAINTEXT_BYTES)
  if (isNewerVersion(value)) throw new NewerVersionError()
  if (!isDashboardState(value)) throw new DecryptError()
  return value
}
