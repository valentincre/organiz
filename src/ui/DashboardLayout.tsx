import { useState, type ReactNode } from 'react'
import { LIMITS } from '../domain/limits'
import { renameDashboard } from '../domain/mutations'
import type { DashboardState } from '../domain/types'
import { useI18n } from '../i18n/context'
import { viewPath, type DashboardView } from '../router'
import type { DashboardStore, SaveError } from '../storage/dashboardStore'
import { buildShareLink, isDemoRef, type DashboardRef } from '../storage/link'
import { EditableTitle } from './components/EditableTitle'
import { LangSwitch } from './components/LangSwitch'
import { ThemeToggle } from './components/ThemeToggle'
import { SaveStatus } from './components/SaveStatus'
import { DownloadIcon, LinkIcon, LockIcon, ShareIcon } from './components/icons'
import { button, cx } from './components/styles'
import { useCanEdit } from './canEdit'
import { clearJustCreated, isJustCreated } from './newDashboard'
import { ExportDialog } from './ExportDialog'
import { DemoBanner } from './DemoBanner'
import { SaveLinkBanner } from './SaveLinkBanner'
import { ShareDialog } from './ShareDialog'
import { useCopyLink } from './useCopyLink'

interface Props {
  dashboardRef: DashboardRef
  view: DashboardView
  state: DashboardState
  session: DashboardStore
  writing: boolean
  saveError: SaveError | null
  children: ReactNode
}

export function DashboardLayout({ dashboardRef, view, state, session, writing, saveError, children }: Props) {
  const { t } = useI18n()
  const canEdit = useCanEdit()
  const copy = useCopyLink()
  const [exportOpen, setExportOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [showSaveLink, setShowSaveLink] = useState(() => isJustCreated(dashboardRef.docId))

  // Editors choose between both links; readers, and the demo (it has no read link), copy the one they opened.
  const ownLink = buildShareLink(dashboardRef, window.location.origin)
  const readLink = canEdit && session.readLink ? buildShareLink(session.readLink, window.location.origin) : null

  const tabs = [
    { id: 'calendar', label: t('tabs.calendar'), href: `#${viewPath(dashboardRef, { tab: 'calendar' })}` },
    { id: 'people', label: t('tabs.people'), href: `#${viewPath(dashboardRef, { tab: 'people' })}` },
    {
      id: 'stats',
      label: t('tabs.stats'),
      // From the people page, the tab goes back to the Statistics page with the same period and filters.
      href: `#${viewPath(dashboardRef, view.tab === 'stats' ? { tab: 'stats', from: view.from, to: view.to, filters: view.filters } : { tab: 'stats' })}`,
    },
  ] as const
  const activeTab = view.tab === 'people' || view.tab === 'person' ? 'people' : view.tab === 'stats' ? 'stats' : 'calendar'

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-3 pb-1">
          {/* On phones the title takes the first row and the actions a compact second row. */}
          <div className="flex min-w-0 flex-1 basis-full items-center gap-2 sm:basis-0">
            <EditableTitle
              value={state.name}
              onChange={(name) => session.mutate(renameDashboard(name))}
              label={t('dashboard.name')}
              editLabel={t('dashboard.rename')}
              maxLength={LIMITS.dashboardName}
            />
            {!canEdit && (
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-xs font-semibold text-muted"
                title={t('share.readHint')}
              >
                <LockIcon small />
                {t('share.readOnlyBadge')}
              </span>
            )}
            <SaveStatus writing={writing} saveError={saveError} onRetry={session.retry} />
          </div>
          <div className="flex items-center gap-2">
            {readLink ? (
              <button type="button" className={cx(button('primary'), 'px-3')} aria-haspopup="dialog" onClick={() => setShareOpen(true)}>
                <ShareIcon />
                <span className="max-[359px]:sr-only">{t('share.button')}</span>
              </button>
            ) : (
              <button type="button" className={cx(button('primary'), 'px-3')} onClick={() => copy(ownLink, dashboardRef.access)}>
                <LinkIcon />
                <span className="max-[359px]:sr-only">{t('share.copy')}</span>
              </button>
            )}
            <button
              type="button"
              className={cx(button(), 'max-sm:w-10 max-sm:px-0')}
              title={t('export.hint')}
              aria-label={t('export.hint')}
              onClick={() => setExportOpen(true)}
            >
              <DownloadIcon />
              <span className="max-sm:hidden">{t('export.button')}</span>
            </button>
            <ThemeToggle />
            <LangSwitch />
          </div>
        </div>
        {/* Three tabs do not fit 320 px in every language: phones scroll them sideways. */}
        <nav className="mx-auto flex max-w-5xl gap-1 px-4 max-sm:overflow-x-auto">
          {tabs.map((tab) => (
            <a
              key={tab.id}
              href={tab.href}
              className={cx(
                'inline-flex min-h-touch shrink-0 items-center border-b-2 px-3.5 font-medium whitespace-nowrap no-underline max-sm:px-2.5',
                tab.id === activeTab ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-text',
              )}
              aria-current={tab.id === activeTab ? 'page' : undefined}
            >
              {tab.label}
            </a>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-5xl p-4">
        {isDemoRef(dashboardRef) && <DemoBanner />}
        {showSaveLink && canEdit && (
          <SaveLinkBanner
            editLink={ownLink}
            onDismiss={() => {
              clearJustCreated()
              setShowSaveLink(false)
            }}
          />
        )}
        {children}
      </main>
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} state={state} />
      {readLink && <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} editLink={ownLink} readLink={readLink} />}
    </div>
  )
}
