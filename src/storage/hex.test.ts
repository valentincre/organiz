import { describe, expect, it } from 'vitest'
import { encodeHex } from './hex'

describe('encodeHex', () => {
  it('writes two lowercase digits per byte', () => {
    expect(encodeHex(new Uint8Array([0x00, 0x01, 0x0f, 0xab, 0xff]))).toBe('00010fabff')
    expect(encodeHex(new Uint8Array())).toBe('')
  })
})
