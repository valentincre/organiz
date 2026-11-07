import { describe, expect, it } from 'vitest'
import { decodeBase64Url, encodeBase64Url } from './base64url'

describe('base64url', () => {
  it('round-trips every length without padding', () => {
    for (let length = 0; length < 40; length++) {
      const bytes = crypto.getRandomValues(new Uint8Array(length))
      const text = encodeBase64Url(bytes)
      expect(text).toMatch(/^[A-Za-z0-9_-]*$/)
      expect(decodeBase64Url(text)).toEqual(bytes)
    }
  })

  it('rejects invalid input', () => {
    expect(() => decodeBase64Url('ab+c')).toThrow()
    expect(() => decodeBase64Url('abcde')).toThrow()
  })

  it('uses the URL-safe alphabet', () => {
    expect(encodeBase64Url(new Uint8Array([0xfb, 0xff]))).toBe('-_8')
  })
})
