import { describe, expect, it } from 'vitest'
import { addEvent, addPerson, compose, emptyState } from '../../domain/mutations'
import { closesAtFor } from '../../domain/shares'
import { openCallLinkMutation, openRepliesMutation, setVisibilityMutation } from './replyActions'

const base = compose(addPerson('p1', 'Alice', 1), addEvent('e1', '2099-10-23', { start: '18:00' }, 1))(emptyState('Club'))
const ids = { shareId: 'S'.repeat(22), key: 'K'.repeat(43) }

describe('openRepliesMutation', () => {
  it('adds the organizer keys only for a first private link', () => {
    const keys = { publicKey: '{"k":1}', privateKey: '{"k":2}' }
    const priv = openRepliesMutation(base, 'e1', { visibility: 'private', autoClose: true }, ids, keys)(base)
    expect(priv.organizerKeys).toEqual(keys)
    expect(openRepliesMutation(base, 'e1', { visibility: 'public', autoClose: true }, ids)(base).organizerKeys).toBeUndefined()
  })

  it('opens a presence link with the chosen visibility and closing', () => {
    const next = openRepliesMutation(base, 'e1', { visibility: 'public', autoClose: false }, ids)(base)
    expect(next.shares?.[ids.shareId]).toMatchObject({ eventId: 'e1', kind: 'presence', key: ids.key, visibility: 'public', autoClose: false, closesAt: null })
  })

  it('keeps the keys already in the dashboard for a later private link', () => {
    const existing = { publicKey: '{"k":3}', privateKey: '{"k":4}' }
    const withKeys = { ...base, organizerKeys: existing }
    const next = openRepliesMutation(withKeys, 'e1', { visibility: 'private', autoClose: true }, ids)(withKeys)
    expect(next.organizerKeys).toBe(existing)
    expect(next.shares?.[ids.shareId]?.visibility).toBe('private')
  })

  it('refuses a private link without organizer keys', () => {
    expect(() => openRepliesMutation(base, 'e1', { visibility: 'private', autoClose: true }, ids)).toThrow()
  })
})

describe('setVisibilityMutation', () => {
  const keys = { publicKey: '{"k":1}', privateKey: '{"k":2}' }
  const opened = openRepliesMutation(base, 'e1', { visibility: 'public', autoClose: true }, ids)(base)

  it('saves the organizer keys when a public link becomes the first private one', () => {
    const next = setVisibilityMutation(opened, ids.shareId, 'private', keys)(opened)
    expect(next.organizerKeys).toEqual(keys)
    expect(next.shares?.[ids.shareId]?.visibility).toBe('private')
    expect(() => setVisibilityMutation(opened, ids.shareId, 'private')).toThrow()
  })

  it('needs no keys to go back to public', () => {
    const priv = setVisibilityMutation(opened, ids.shareId, 'private', keys)(opened)
    const next = setVisibilityMutation(priv, ids.shareId, 'public')(priv)
    expect(next.shares?.[ids.shareId]?.visibility).toBe('public')
  })
})

describe('openCallLinkMutation', () => {
  const keys = { publicKey: '{"k":1}', privateKey: '{"k":2}' }

  it('opens a call link, with organizer keys only for a first private one', () => {
    const s = openCallLinkMutation(base, 'e1', { visibility: 'public', autoClose: true }, ids)(base)
    expect(s.shares![ids.shareId]).toMatchObject({ kind: 'call', closesAt: closesAtFor('call', base.events.e1) })
    expect(s.organizerKeys).toBeUndefined()
    expect(openCallLinkMutation(base, 'e1', { visibility: 'private', autoClose: false }, ids, keys)(base).organizerKeys).toEqual(keys)
  })

  it('stays open until closed by hand without auto close, and refuses a first private link without keys', () => {
    const s = openCallLinkMutation(base, 'e1', { visibility: 'public', autoClose: false }, ids)(base)
    expect(s.shares![ids.shareId]).toMatchObject({ eventId: 'e1', kind: 'call', key: ids.key, visibility: 'public', closesAt: null })
    expect(() => openCallLinkMutation(base, 'e1', { visibility: 'private', autoClose: true }, ids)).toThrow()
  })
})
