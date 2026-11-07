import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { DemoSession } from '../demo/DemoSession'
import { DEMO_SHARE } from '../demo/demoShares'
import { DashboardSession, type DashboardStore } from './dashboardStore'
import { dbReady } from './firebase'
import { isDemoRef, type DashboardRef } from './link'

let demoSession: DemoSession | null = null

/**
 * Live session for the open dashboard; listening stops when the link changes
 * or the page unmounts. The demo lives in memory for the page's life: leaving it
 * for its reply page and coming back keeps its edits; a reload builds a new one.
 * Its seed (name and language) is the one of the first visit until that reload.
 */
export function useDashboard({ docId, key, access }: DashboardRef, demo: { name: string; lang: 'en' | 'fr' }) {
  const session = useMemo<DashboardStore>(
    () =>
      isDemoRef({ docId })
        ? (demoSession ??= new DemoSession(demo.name, undefined, demo.lang, DEMO_SHARE))
        : new DashboardSession(dbReady, { docId, key, access }),
    // The demo texts only seed the demo: switching language must not reset it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docId, key, access],
  )

  useEffect(() => {
    void session.start()
    return () => session.stop()
  }, [session])

  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot)
  return { ...snapshot, session }
}
