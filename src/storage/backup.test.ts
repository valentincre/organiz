import { describe, expect, it } from 'vitest'
import { buildDemoState } from '../demo/demoData'
import { addEvent, addPerson, compose, emptyState, setReply } from '../domain/mutations'
import { createPersonalLink, setHub } from '../domain/personalLinks'
import { addShare, setOrganizerKeys } from '../domain/shares'
import { backupFileName, backupJson, parseBackup } from './backup'

describe('backup', () => {
  it('round-trips a state', () => {
    const state = buildDemoState('Club', '2026-10-20', 'en')
    expect(parseBackup(backupJson(state))).toEqual(state)
  })

  it('restores without the reply links and their keys, keeping where replies came from', () => {
    const state = compose(
      addPerson('p1', 'Alice', 1),
      addEvent('e1', '2026-10-23', {}, 1),
      setOrganizerKeys({ publicKey: '{"kty":"EC"}', privateKey: '{"kty":"EC","d":"x"}' }),
      addShare('S'.repeat(22), { eventId: 'e1', kind: 'presence', key: 'K'.repeat(43), visibility: 'public', autoClose: false }, 1),
      setReply('e1', 'p1', 'yes', 5),
    )(emptyState('Club'))
    expect(state.shares).toBeDefined()
    expect(state.events.e1.replyLog).toEqual({ p1: { via: 'hand', at: 5 } })
    const { shares: _shares, organizerKeys: _keys, ...expected } = state
    expect(parseBackup(backupJson(state))).toEqual(expected)
  })

  it('restores without the hub and personal links', () => {
    const state = compose(
      addPerson('p1', 'Alice', 1),
      setHub({ id: 'h'.repeat(22), key: 'k'.repeat(43) }),
      createPersonalLink('p1', 's'.repeat(43), 2),
    )(emptyState('Club'))
    expect(state.hub).toBeDefined()
    expect(state.personalLinks).toBeDefined()
    const { hub: _hub, personalLinks: _links, ...expected } = state
    expect(parseBackup(backupJson(state))).toEqual(expected)
  })

  it('rejects other files', () => {
    const wrap = (value: unknown) => JSON.stringify(value)
    expect(parseBackup('not json')).toBeNull()
    expect(parseBackup('')).toBeNull()
    expect(parseBackup('null')).toBeNull()
    expect(parseBackup('[]')).toBeNull()
    expect(parseBackup('"organiz-backup"')).toBeNull()
    expect(parseBackup(wrap({ format: 'other', v: 1, state: emptyState('x') }))).toBeNull()
    expect(parseBackup(wrap({ format: 'organiz-backup', v: 2, state: emptyState('x') }))).toBeNull()
    expect(parseBackup(wrap({ format: 'organiz-backup', v: 1 }))).toBeNull()
    expect(parseBackup(wrap({ format: 'organiz-backup', v: 1, state: null }))).toBeNull()
    expect(parseBackup(wrap({ format: 'organiz-backup', v: 1, state: { v: 3 } }))).toBeNull()
  })

  it('names the file after the dashboard and the day', () => {
    expect(backupFileName('Club U13 / Été', '2026-10-20')).toBe('organiz-club-u13-ete-2026-10-20.json')
    expect(backupFileName('!!!', '2026-10-20')).toBe('organiz-dashboard-2026-10-20.json')
  })
})
