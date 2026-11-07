import { encodeBase64Url } from '../storage/base64url'

/** Random base64url id; 6 bytes give 8 characters. */
export function randomId(bytes = 6): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(bytes)))
}
