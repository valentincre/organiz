import { describe, expect, it } from 'vitest'
import { encodeHex } from './hex'
import { sha256Hex } from './sha256'

describe('sha256Hex', () => {
  it('matches the standard vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('matches Web Crypto on multi-block and non-ASCII input', async () => {
    for (const text of ['é'.repeat(100), 'organiz:AAAAAAAAAAAAAAAAAAAAAA:zz9']) {
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
      expect(sha256Hex(text)).toBe(encodeHex(digest))
    }
  })

  it('matches Web Crypto around the padding boundaries', async () => {
    for (const length of [55, 56, 63, 64, 65, 119, 120]) {
      const text = 'a'.repeat(length)
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
      expect(sha256Hex(text)).toBe(encodeHex(digest))
    }
  })
})
