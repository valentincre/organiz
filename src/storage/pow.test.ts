import { describe, expect, it } from 'vitest'
import { isValidPow, powInput, solvePow } from './pow'
import { sha256Hex } from './sha256'

const DOC = 'AAAAAAAAAAAAAAAAAAAAAA'
const OTHER_DOC = 'BBBBBBBBBBBBBBBBBBBBBB'

describe('proof of work', () => {
  it('finds a nonce that validates', () => {
    const nonce = solvePow(DOC, 3)
    expect(nonce.length).toBeLessThanOrEqual(16)
    expect(isValidPow(DOC, nonce, 3)).toBe(true)
    expect(sha256Hex(powInput(DOC, nonce)).startsWith('000')).toBe(true)
  })

  it('binds the work to the dashboard', () => {
    const nonce = solvePow(DOC, 3)
    expect(isValidPow(OTHER_DOC, nonce, 3)).toBe(false)
  })

  it('builds the hashed input from the dashboard id and the nonce', () => {
    expect(powInput(DOC, 'x1')).toBe(`organiz:${DOC}:x1`)
  })
})
