import { describe, expect, it } from 'vitest'
import { generateKeyString } from './crypto'
import { signReply, verifyReply, type SignedFields } from './personalCrypto'

const SECRET = generateKeyString()
const OTHER = generateKeyString()
const fields: SignedFields = { shareId: 's1', personId: 'p1', answer: 'yes', device: 'd1', sentAt: 1_000 }

describe('personal reply signatures', () => {
  it('verifies a signature with the same secret only', async () => {
    const mac = await signReply(SECRET, fields)
    expect(await verifyReply(SECRET, fields, mac)).toBe(true)
    expect(await verifyReply(OTHER, fields, mac)).toBe(false)
    expect(await verifyReply(SECRET, { ...fields, answer: 'no' }, mac)).toBe(false)
  })

  it('covers every signed field', async () => {
    const mac = await signReply(SECRET, fields)
    const changes: Partial<SignedFields>[] = [{ shareId: 's2' }, { personId: 'p2' }, { answer: 'none' }, { device: 'd2' }, { sentAt: 1_001 }]
    for (const change of changes) expect(await verifyReply(SECRET, { ...fields, ...change }, mac)).toBe(false)
  })

  it('is a deterministic base64url HMAC-SHA-256', async () => {
    const mac = await signReply(SECRET, fields)
    expect(mac).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(await signReply(SECRET, fields)).toBe(mac)
  })

  it('rejects a malformed MAC or secret without throwing', async () => {
    const mac = await signReply(SECRET, fields)
    expect(await verifyReply(SECRET, fields, '***')).toBe(false)
    expect(await verifyReply(SECRET, fields, mac.slice(0, 20))).toBe(false)
    expect(await verifyReply('not a key', fields, mac)).toBe(false)
  })
})
