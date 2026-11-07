import { lazy, Suspense } from 'react'
import { I18nProvider } from './i18n/I18nProvider'
import { useI18n } from './i18n/context'
import type { Lang } from './i18n/translate'
import { parseRoute, useHash } from './router'
import { ToastProvider } from './ui/components/ToastProvider'
import { ErrorPage } from './ui/ErrorPage'
import { HomePage } from './ui/HomePage'

// Firestore and the dashboard screens load only when a dashboard is opened,
// so the home page stays light.
const DashboardPage = lazy(() => import('./ui/DashboardPage').then((m) => ({ default: m.DashboardPage })))
const ReplyPage = lazy(() => import('./reply/ReplyPage').then((m) => ({ default: m.ReplyPage })))
const PersonalPage = lazy(() => import('./reply/PersonalPage').then((m) => ({ default: m.PersonalPage })))

function Loading() {
  const { t } = useI18n()
  return <p className="flex min-h-screen items-center justify-center text-muted">{t('app.loading')}</p>
}

function Routes() {
  const route = parseRoute(useHash())
  switch (route.name) {
    case 'home':
      return <HomePage />
    case 'invalid-link':
      return <ErrorPage kind="invalid-link" />
    case 'dashboard':
      return (
        <Suspense fallback={<Loading />}>
          <DashboardPage key={`${route.ref.docId}/${route.ref.key}`} dashboardRef={route.ref} view={route.view} />
        </Suspense>
      )
    case 'reply':
      return (
        <Suspense fallback={<Loading />}>
          <ReplyPage
            key={`${route.shareId}/${route.key}`}
            shareId={route.shareId}
            shareKey={route.key}
            demo={route.demo}
          />
        </Suspense>
      )
    case 'personal':
      return (
        <Suspense fallback={<Loading />}>
          <PersonalPage
            key={`${route.hubId}/${route.hubKey}/${route.personId}/${route.secret}`}
            hubId={route.hubId}
            hubKey={route.hubKey}
            personId={route.personId}
            secret={route.secret}
          />
        </Suspense>
      )
  }
}

export default function App({ initialLang }: { initialLang?: Lang }) {
  return (
    <I18nProvider initialLang={initialLang}>
      <ToastProvider>
        <Routes />
      </ToastProvider>
    </I18nProvider>
  )
}
