/**
 * Bytes of an uploaded file to text. UTF-8 first (its BOM is dropped);
 * otherwise Windows-1252, the usual encoding of CSV files saved by Excel
 * in French or other Western European locales.
 */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}
