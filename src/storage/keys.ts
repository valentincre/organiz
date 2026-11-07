import { decodeBase64Url, encodeBase64Url } from './base64url'
import { DecryptError } from './crypto'
import { encodeHex } from './hex'

const KEY_BYTES = 32
const ENC_INFO = 'organiz/enc/v2'
const WRITE_INFO = 'organiz/write/v2'

export interface EditKeys {
  /** Encrypts and decrypts the dashboard. */
  encKey: CryptoKey
  /** `encKey` as carried in the read link. */
  encKeyString: string
  /** Signs the write proofs; never leaves the editor's device. */
  writeKey: CryptoKey
}

const utf8 = (text: string) => new TextEncoder().encode(text)

function decodeKeyBytes(encoded: string): Uint8Array<ArrayBuffer> {
  let raw: Uint8Array<ArrayBuffer>
  try {
    raw = decodeBase64Url(encoded)
  } catch {
    throw new DecryptError()
  }
  if (raw.length !== KEY_BYTES) throw new DecryptError()
  return raw
}

const importEncKey = (raw: Uint8Array<ArrayBuffer>) =>
  crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])

/** Splits the edit link's secret into two independent keys, so the read link cannot yield write access. */
export async function deriveEditKeys(secret: string, docId: string): Promise<EditKeys> {
  const master = await crypto.subtle.importKey('raw', decodeKeyBytes(secret), 'HKDF', false, ['deriveBits'])
  const derive = (info: string) =>
    crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: utf8(docId), info: utf8(info) }, master, KEY_BYTES * 8)
  const encBits = new Uint8Array(await derive(ENC_INFO))
  const writeBits = await derive(WRITE_INFO)
  return {
    encKey: await importEncKey(encBits),
    encKeyString: encodeBase64Url(encBits),
    writeKey: await crypto.subtle.importKey('raw', writeBits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
  }
}

export async function importReadKey(encKeyString: string): Promise<CryptoKey> {
  return importEncKey(decodeKeyBytes(encKeyString))
}

/** The secret that authorizes saving revision `rev`; the previous save committed to its hash. */
export async function proofFor(writeKey: CryptoKey, docId: string, rev: number): Promise<string> {
  const mac = await crypto.subtle.sign('HMAC', writeKey, utf8(`${docId}:${rev}`))
  return encodeBase64Url(new Uint8Array(mac))
}

/** The proof for saving revision `rev` of a share document; the `share:` prefix keeps it apart from dashboard proofs. */
export const shareProofFor = (writeKey: CryptoKey, shareId: string, rev: number): Promise<string> => proofFor(writeKey, `share:${shareId}`, rev)

/** The proof for saving revision `rev` of the hub document; the `hub:` prefix keeps it apart from dashboard and share proofs. */
export const hubProofFor = (writeKey: CryptoKey, hubId: string, rev: number): Promise<string> => proofFor(writeKey, `hub:${hubId}`, rev)

/**
 * SHA-256 of the UTF-8 proof in lowercase hex, exactly what the rules compute with
 * `hashing.sha256(proof).toHexString().lower()`: hex has a single canonical form.
 */
export async function commitmentOf(proof: string): Promise<string> {
  return encodeHex(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(proof))))
}
