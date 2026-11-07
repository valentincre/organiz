import { describe, expect, it, vi } from 'vitest'
import { DEMO_REF, isValidReplyRef } from '../storage/link'
import { importShareKey, openSnapshot, sealReply } from '../storage/shareCrypto'
import { ShareSync } from '../storage/shareSync'
import { DemoSession } from './DemoSession'
import { DEMO_SHARE, demoShareBackend, demoShareSyncOptions } from './demoShares'

describe('demo reply link', () => {
  it('has a fixed id and a key drawn once per page load', async () => {
    expect(DEMO_SHARE.id).toHaveLength(22)
    expect(isValidReplyRef(DEMO_SHARE.id, DEMO_SHARE.key)).toBe(true)
    // The same backend for the dashboard and the reply page.
    expect(demoShareBackend()).toBe(demoShareBackend())

    vi.resetModules()
    const reloaded = await import('./demoShares')
    expect(reloaded.DEMO_SHARE.id).toBe(DEMO_SHARE.id)
    expect(reloaded.DEMO_SHARE.key).not.toBe(DEMO_SHARE.key)
  })

  it('a demo ShareSync creates the share document and folds a reply', async () => {
    const session = new DemoSession('Demo', undefined, 'en', DEMO_SHARE)
    const backend = demoShareBackend()
    const sync = new ShareSync(backend, DEMO_REF, session, { locale: 'en', ...demoShareSyncOptions })
    sync.start()
    try {
      // Created without a proof of work or a key derived from the (empty) demo key.
      await vi.waitFor(async () => expect(await backend.readShare(DEMO_SHARE.id)).not.toBeNull())
      const shareKey = await importShareKey(DEMO_SHARE.key)
      const snapshot = await openSnapshot(shareKey, DEMO_SHARE.id, (await backend.readShare(DEMO_SHARE.id))!.sealed)
      expect(snapshot).toMatchObject({ kind: 'presence', visibility: 'public' })

      const next = session.getSnapshot().state!.events.next
      const answered = new Set([...(next.yes ?? []), ...(next.no ?? [])])
      const personId = Object.keys(session.getSnapshot().state!.people).find((id) => !answered.has(id))!
      await backend.addReply(DEMO_SHARE.id, await sealReply({ shareKey }, DEMO_SHARE.id, { personId, answer: 'yes', device: 'phone1', via: 'shared' }))

      await vi.waitFor(() => expect(session.getSnapshot().state!.events.next.yes).toContain(personId))
      expect(session.getSnapshot().state!.events.next.replyLog![personId]).toMatchObject({ via: 'shared', device: 'phone1' })
    } finally {
      sync.stop()
    }
  })
})
