import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { demoShareBackend, demoShareSyncOptions } from '../demo/demoShares'
import type { IncomingReply } from '../domain/replies'
import type { DashboardStore } from '../storage/dashboardStore'
import { dbReady } from '../storage/firebase'
import { FirestoreHubBackend } from '../storage/firestoreHubs'
import { FirestoreShareBackend } from '../storage/firestoreShares'
import { HubSync } from '../storage/hubSync'
import { isDemoRef, type DashboardRef } from '../storage/link'
import { ShareSync } from '../storage/shareSync'

let backend: FirestoreShareBackend | null = null
let hubBackend: FirestoreHubBackend | null = null

/**
 * Keeps the reply links of the open dashboard in step with it (see ShareSync), and returns the
 * replies not folded yet, to show on top of the dashboard. Editors also keep the hub of personal
 * links current (see HubSync). The demo's links live in this tab (see demoShares), with no hub.
 */
export function useShareSync({ docId, key, access }: DashboardRef, store: DashboardStore, locale: string): IncomingReply[] {
  const sync = useMemo(() => {
    if (isDemoRef({ docId })) return new ShareSync(demoShareBackend(), { docId, key, access }, store, { locale, ...demoShareSyncOptions })
    backend ??= new FirestoreShareBackend(dbReady)
    return new ShareSync(backend, { docId, key, access }, store, { locale })
  }, [docId, key, access, store, locale])

  const hubSync = useMemo(() => {
    if (isDemoRef({ docId }) || access !== 'edit') return null
    hubBackend ??= new FirestoreHubBackend(dbReady)
    return new HubSync(hubBackend, { docId, key, access }, store)
  }, [docId, key, access, store])

  useEffect(() => {
    sync.start()
    return () => sync.stop()
  }, [sync])

  useEffect(() => {
    if (!hubSync) return
    hubSync.start()
    return () => hubSync.stop()
  }, [hubSync])

  return useSyncExternalStore(sync.subscribe, () => sync.getSnapshot().replies)
}
