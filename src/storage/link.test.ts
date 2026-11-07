import { describe, expect, it } from 'vitest'
import { randomId } from '../domain/ids'
import { generateKeyString } from './crypto'
import { buildPersonalLink, buildReplyLink, buildShareLink, dashboardPath, isValidPersonalRef, isValidRef, personalPath, readRefOf, replyPath } from './link'

describe('link', () => {
  it('validates generated ids and keys', () => {
    const ref = { docId: randomId(16), key: generateKeyString(), access: 'edit' as const }
    expect(isValidRef(ref)).toBe(true)
    expect(isValidRef({ ...ref, key: ref.key.slice(1) })).toBe(false)
    expect(isValidRef({ ...ref, docId: ref.docId + 'x' })).toBe(false)
  })

  it('builds a link with the key in the fragment', () => {
    expect(buildShareLink({ docId: 'D', key: 'K', access: 'edit' }, 'https://app.web.app')).toBe('https://app.web.app/#/d/D/K')
  })

  it('builds read paths', () => {
    expect(dashboardPath({ docId: 'D', key: 'K', access: 'read' })).toBe('/v/D/K')
  })

  it('builds reply paths and links from the origin', () => {
    const DOC = 'A'.repeat(22)
    const KEY = 'B'.repeat(43)
    expect(replyPath(DOC, KEY)).toBe(`/r/${DOC}/${KEY}`)
    expect(buildReplyLink(DOC, KEY, 'http://localhost:5173')).toBe(`http://localhost:5173/#/r/${DOC}/${KEY}`)
  })

  it('builds personal paths and links from the origin', () => {
    const DOC = 'A'.repeat(22)
    const KEY = 'B'.repeat(43)
    const ref = { hubId: DOC, hubKey: KEY, personId: 'p1', secret: KEY }
    expect(personalPath(ref)).toBe(`/p/${DOC}/${KEY}/p1/${KEY}`)
    expect(buildPersonalLink(ref, 'http://localhost:5173')).toBe(`http://localhost:5173/#/p/${DOC}/${KEY}/p1/${KEY}`)
  })

  it('validates personal refs', () => {
    const ref = { hubId: randomId(16), hubKey: generateKeyString(), personId: randomId(16), secret: generateKeyString() }
    expect(isValidPersonalRef(ref)).toBe(true)
    expect(isValidPersonalRef({ ...ref, hubId: ref.hubId + 'x' })).toBe(false)
    expect(isValidPersonalRef({ ...ref, hubKey: ref.hubKey.slice(1) })).toBe(false)
    expect(isValidPersonalRef({ ...ref, secret: 'short' })).toBe(false)
    expect(isValidPersonalRef({ ...ref, personId: '' })).toBe(false)
    expect(isValidPersonalRef({ ...ref, personId: 'a.b' })).toBe(false)
    expect(isValidPersonalRef({ ...ref, personId: 'constructor' })).toBe(false)
  })

  it('derives the read ref of an edit ref', () => {
    expect(readRefOf({ docId: 'D', key: 'S', access: 'edit' }, 'E')).toEqual({ docId: 'D', key: 'E', access: 'read' })
  })
})
