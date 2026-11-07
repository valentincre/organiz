/** Two lowercase hex digits for each byte value. */
export const BYTE_HEX: readonly string[] = Array.from({ length: 256 }, (_, byte) => byte.toString(16).padStart(2, '0'))

export function encodeHex(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) hex += BYTE_HEX[byte]
  return hex
}
