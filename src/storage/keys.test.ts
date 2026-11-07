import { describe, expect, it } from 'vitest'
import { decodeBase64Url, encodeBase64Url } from './base64url'
import { DecryptError } from './crypto'
import { commitmentOf, deriveEditKeys, hubProofFor, importReadKey, proofFor, shareProofFor } from './keys'

const S = encodeBase64Url(new Uint8Array(32).fill(7))
const DOC = 'AAAAAAAAAAAAAAAAAAAAAA'
const OTHER_DOC = 'BBBBBBBBBBBBBBBBBBBBBB'

describe('keys', () => {
  it('derives the same keys for the same secret and dashboard', async () => {
    expect((await deriveEditKeys(S, DOC)).encKeyString).toBe((await deriveEditKeys(S, DOC)).encKeyString)
  })

  it('derives different keys for another dashboard', async () => {
    expect((await deriveEditKeys(S, DOC)).encKeyString).not.toBe((await deriveEditKeys(S, OTHER_DOC)).encKeyString)
  })

  it('never reveals the secret or the write key in the read key', async () => {
    const keys = await deriveEditKeys(S, DOC)
    expect(keys.encKeyString).not.toBe(S)
    expect(keys.encKeyString).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('rejects a secret that is not 32 bytes', async () => {
    await expect(deriveEditKeys(S.slice(0, 40), DOC)).rejects.toBeInstanceOf(DecryptError)
  })

  it('gives one proof per dashboard and revision', async () => {
    const { writeKey } = await deriveEditKeys(S, DOC)
    const p1 = await proofFor(writeKey, DOC, 1)
    expect(p1).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(await proofFor(writeKey, DOC, 1)).toBe(p1)
    expect(await proofFor(writeKey, DOC, 2)).not.toBe(p1)
    expect(await proofFor(writeKey, OTHER_DOC, 1)).not.toBe(p1)
  })

  it('commits with the lowercase hex SHA-256 of the UTF-8 proof', async () => {
    expect(await commitmentOf('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  // Fixed vectors, checked once against Node's own HKDF, HMAC and SHA-256: a change to the
  // derivation (salt, infos, which output is which key), the proof message or an encoding would
  // break every existing link and dashboard, so it must show here first.
  describe('wire format', () => {
    it('derives the read key', async () => {
      expect((await deriveEditKeys(S, DOC)).encKeyString).toBe('fm1JKOJDY-9qfRWKFNqumGqwHA1GvMu3rr_Mjekl49k')
    })

    it('signs the proof of a revision and commits to it', async () => {
      const proof = await proofFor((await deriveEditKeys(S, DOC)).writeKey, DOC, 2)
      expect(proof).toBe('4ObYQWuXLYduQmZvs7d5smD6PDAY2Eo0FiyllkVLFDE')
      expect(await commitmentOf(proof)).toBe('746810bee2f763fdfcedb1163476401ea0d4bea2e80cd87b89408740436826d2')
    })

    it('keeps the write key apart from the read key', async () => {
      // Someone holding only the read link cannot sign with its key in place of the write key.
      const { encKeyString, writeKey } = await deriveEditKeys(S, DOC)
      const readKeyAsHmac = await crypto.subtle.importKey('raw', decodeBase64Url(encKeyString), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      expect(await proofFor(readKeyAsHmac, DOC, 2)).not.toBe(await proofFor(writeKey, DOC, 2))
    })
  })

  it('imports the read key and rejects a truncated one', async () => {
    const { encKeyString } = await deriveEditKeys(S, DOC)
    await expect(importReadKey(encKeyString)).resolves.toBeDefined()
    await expect(importReadKey(encKeyString.slice(0, 40))).rejects.toBeInstanceOf(DecryptError)
  })
})

describe('shareProofFor', () => {
  it('is the dashboard proof of the prefixed share id', async () => {
    const { writeKey } = await deriveEditKeys(S, DOC)
    expect(await shareProofFor(writeKey, 's1', 3)).toBe(await proofFor(writeKey, 'share:s1', 3))
    expect(await shareProofFor(writeKey, 's1', 3)).not.toBe(await shareProofFor(writeKey, 's1', 4))
    expect(await shareProofFor(writeKey, 's1', 3)).not.toBe(await shareProofFor(writeKey, 's2', 3))
  })
})

describe('hubProofFor', () => {
  it('is the dashboard proof of the prefixed hub id, apart from the share proof of the same id', async () => {
    const { writeKey } = await deriveEditKeys(S, DOC)
    expect(await hubProofFor(writeKey, 'h1', 3)).toBe(await proofFor(writeKey, 'hub:h1', 3))
    expect(await hubProofFor(writeKey, 'h1', 3)).not.toBe(await shareProofFor(writeKey, 'h1', 3))
    expect(await hubProofFor(writeKey, 'h1', 3)).not.toBe(await hubProofFor(writeKey, 'h1', 4))
  })
})
