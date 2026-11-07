import { describe, expect, it } from 'vitest'
import { decodeBase64Url } from './base64url'
import { generateKeyString } from './crypto'

describe('crypto', () => {
  it('generates a fresh 32-byte secret for each link', () => {
    const secret = generateKeyString()
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(decodeBase64Url(secret)).toHaveLength(32)
    expect(generateKeyString()).not.toBe(secret)
  })
})
