import { encodeBase64Url } from './base64url'

const KEY_BYTES = 32

/** The data cannot be read with this key (wrong or truncated link, corrupted data). */
export class DecryptError extends Error {
  constructor() {
    super('Unable to decrypt dashboard')
    this.name = 'DecryptError'
  }
}

/** The data was written by a newer version of the app; reloading picks it up. */
export class NewerVersionError extends Error {
  constructor() {
    super('Dashboard was saved by a newer version of the app')
    this.name = 'NewerVersionError'
  }
}

/** New random 256-bit secret, as the base64url string carried in the edit link. */
export function generateKeyString(): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(KEY_BYTES)))
}
