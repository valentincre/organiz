import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { foldAll } from '../domain/replies'
import { useI18n } from '../i18n/context'
import { navigate, viewPath, type DashboardView } from '../router'
import { isDemoRef, type DashboardRef } from '../storage/link'
import { useDashboard } from '../storage/useDashboard'
import { DashboardLayout } from './DashboardLayout'
import { AttendanceSheet } from './AttendanceSheet'
import { CanEditContext, readerView } from './canEdit'
import { CallPage } from './call/CallPage'
import { useCallDraft } from './call/callDraftStore'
import { useCallDraftSync } from './call/useCallDraftSync'
import { useCheckInSync } from './call/useCheckInSync'
import { PersonPage } from './PersonPage'
import { CalendarPage } from './CalendarPage'
import { ErrorPage } from './ErrorPage'
import { PeoplePage } from './PeoplePage'
import { StatsPage } from './stats/StatsPage'
import { useEventDraft } from './useEventDraft'
import { useShareSync } from './useShareSync'

// Papa Parse is only needed once someone imports a file.
const CsvImportDialog = lazy(() => import('./CsvImport/CsvImportDialog').then((m) => ({ default: m.CsvImportDialog })))

const FIRESTORE_ORIGIN = 'https://firestore.googleapis.com'

/** Opens the connection to Firestore early, while the session derives its keys and reads the cache. */
function preconnectFirestore(): void {
  if (document.head.querySelector(`link[rel="preconnect"][href="${FIRESTORE_ORIGIN}"]`)) return
  const link = document.createElement('link')
  link.rel = 'preconnect'
  link.href = FIRESTORE_ORIGIN
  // Firestore's requests are CORS without credentials: the connection must match them to be reused.
  link.crossOrigin = 'anonymous'
  document.head.append(link)
}

interface Props {
  dashboardRef: DashboardRef
  view: DashboardView
}

export function DashboardPage({ dashboardRef, view: requestedView }: Props) {
  const { t, lang } = useI18n()
  const demo = isDemoRef(dashboardRef)
  useEffect(() => {
    if (!demo) preconnectFirestore()
  }, [demo])
  const { state, loadError, saving, writing, saveError, session } = useDashboard(dashboardRef, { name: t('demo.name'), lang })
  const { canEdit } = session
  // Replies not folded yet are shown on top of the dashboard; edits still apply to the dashboard itself.
  const replies = useShareSync(dashboardRef, session, lang)
  const viewState = useMemo(() => state && foldAll(state, replies), [state, replies])
  // A reader asking for an edit-only view gets its event (or day) at once; the address then follows, in place.
  const view = canEdit ? requestedView : readerView(requestedView)
  const redirect = view === requestedView ? null : viewPath(dashboardRef, view)
  useEffect(() => {
    if (redirect) navigate(redirect, { replace: true })
  }, [redirect])
  const [importing, setImporting] = useState(false)
  useCallDraftSync(dashboardRef.docId, state, session, saving, saveError !== null)
  useCheckInSync(dashboardRef.docId, state, replies, canEdit)
  const eventPage = useEventDraft(dashboardRef, view, state ?? undefined, session.mutate)
  const [callDraft] = useCallDraft(dashboardRef.docId, eventPage?.eventId ?? '')

  // Unsaved edits are lost if the tab closes: let the browser ask first.
  const unsaved = saving || saveError !== null
  useEffect(() => {
    if (!unsaved) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsaved])

  useEffect(() => {
    document.title = state ? `${state.name} · ${t('app.name')}` : t('app.name')
  }, [state, t])

  if (loadError && (!state || loadError !== 'network')) return <ErrorPage kind={loadError} />
  if (!viewState) return <p className="flex min-h-screen items-center justify-center text-muted">{t('app.loading')}</p>

  return (
    <CanEditContext value={canEdit}>
      {view.tab === 'call' ? (
        // The roll call has its own screen, without the app header.
        <CallPage dashboardRef={dashboardRef} state={viewState} view={view} mutate={session.mutate} />
      ) : (
        <DashboardLayout
          dashboardRef={dashboardRef}
          view={view}
          state={viewState}
          session={session}
          writing={writing}
          saveError={saveError}
        >
          {view.tab === 'people' ? (
            <PeoplePage dashboardRef={dashboardRef} view={view} state={viewState} mutate={session.mutate} onImport={() => setImporting(true)} />
          ) : view.tab === 'calendar' ? (
            <CalendarPage dashboardRef={dashboardRef} state={viewState} view={view} mutate={session.mutate} />
          ) : view.tab === 'stats' ? (
            <StatsPage dashboardRef={dashboardRef} state={viewState} view={view} mutate={session.mutate} canEdit={canEdit} />
          ) : view.tab === 'person' ? (
            <PersonPage key={view.personId} dashboardRef={dashboardRef} state={viewState} view={view} mutate={session.mutate} />
          ) : (
            eventPage && (
              // One element for saved events and drafts, so the page stays mounted when a draft is saved.
              <AttendanceSheet
                dashboardRef={dashboardRef}
                state={viewState}
                view={view as Extract<DashboardView, { tab: 'sheet' | 'draft' }>}
                eventId={eventPage.eventId}
                draft={eventPage.draft}
                mutate={eventPage.mutate}
                onImport={() => setImporting(true)}
              />
            )
          )}
          {importing && (view.tab === 'people' || eventPage) && (
            <Suspense>
              <CsvImportDialog
                open
                onClose={() => setImporting(false)}
                state={viewState}
                eventId={eventPage?.eventId}
                callInProgress={Boolean(callDraft && callDraft.finishedAt === undefined)}
                mutate={eventPage ? eventPage.mutate : session.mutate}
              />
            </Suspense>
          )}
        </DashboardLayout>
      )}
    </CanEditContext>
  )
}
