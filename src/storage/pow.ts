import { sha256Hex } from './sha256'

/** Leading hex zeros required (16 bits); mirrored in `firestore.rules`. */
export const POW_HEX_ZEROS = 4

export const powInput = (docId: string, nonce: string) => `organiz:${docId}:${nonce}`

export const isValidPow = (docId: string, nonce: string, zeros = POW_HEX_ZEROS) =>
  sha256Hex(powInput(docId, nonce)).startsWith('0'.repeat(zeros))

/** Counts nonces up, in base36, until one passes. Binding the work to `docId` stops it being reused. */
export function solvePow(docId: string, zeros = POW_HEX_ZEROS): string {
  for (let counter = 0; ; counter++) {
    const nonce = counter.toString(36)
    if (isValidPow(docId, nonce, zeros)) return nonce
  }
}
