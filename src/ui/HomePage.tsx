import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { APP_VERSION, SOURCE_URL, releaseUrl } from '../appInfo'
import { LIMITS } from '../domain/limits'
import type { DashboardState } from '../domain/types'
import { useI18n } from '../i18n/context'
import type { MessageKey } from '../i18n/en'
import { homePath } from '../i18n/translate'
import { navigate, viewPath } from '../router'
import { parseBackup } from '../storage/backup'
import { MAX_PLAINTEXT_BYTES, TooLargeError } from '../storage/envelope'
import { CalendarIcon, CheckIcon, DownloadIcon, LinkIcon, LockIcon, PersonIcon, TagIcon } from './components/icons'
import { LangSwitch } from './components/LangSwitch'
import { ThemeToggle } from './components/ThemeToggle'
import { button, card, cx, input } from './components/styles'
import { useToast } from './components/toast'
import { markJustCreated } from './newDashboard'
import { usePreparedDashboard } from './usePreparedDashboard'

// Firestore is loaded only when someone is about to create a dashboard.
const loadStorage = () => Promise.all([import('../storage/dashboardStore'), import('../storage/firebase')])

/** The state in a backup file, or null when it cannot be read or is not a backup. */
async function readBackup(file: File): Promise<DashboardState | null> {
  try {
    return parseBackup(await file.text())
  } catch {
    return null
  }
}

const features: { key: string; icon: ReactNode }[] = [
  { key: 'take', icon: <CheckIcon /> },
  { key: 'calendar', icon: <CalendarIcon /> },
  { key: 'person', icon: <PersonIcon /> },
  { key: 'fields', icon: <TagIcon /> },
  { key: 'csv', icon: <DownloadIcon /> },
  { key: 'share', icon: <LinkIcon /> },
]
const steps = ['create', 'fill', 'take']
const uses = ['sports', 'associations', 'schools', 'music', 'training', 'youth']
const faq = ['free', 'account', 'storage', 'lost', 'excel', 'mobile']

const section = 'mx-auto max-w-5xl px-4 py-12'
const sectionTitle = 'mb-6 text-2xl font-bold sm:text-3xl'

const VERSION_LABEL = `v${APP_VERSION}`
const RELEASE_URL = releaseUrl(APP_VERSION, SOURCE_URL)

export function HomePage() {
  const { t, lang } = useI18n()
  const toast = useToast()
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const { prepare, ready, discard } = usePreparedDashboard()
  // Keys built from the lists above are valid message keys.
  const tk = (key: string) => t(key as MessageKey)

  useEffect(() => {
    document.title = t('seo.title')
  }, [t])

  /** Creates a dashboard, empty or from a restored `state`, and opens it with the "save this link" banner. */
  const create = async (dashboardName: string, state?: DashboardState) => {
    if (creating) return
    setCreating(true)
    try {
      const [[{ createDashboard }, { dbReady }], prepared] = await Promise.all([loadStorage(), prepare()])
      const ref = await createDashboard(await dbReady, dashboardName, { ...prepared, state })
      markJustCreated(ref.docId)
      navigate(viewPath(ref, { tab: 'calendar' }))
    } catch (error) {
      console.error('Create failed', error)
      // Even a failed write may have created the dashboard (its answer lost): retrying with
      // the same id would then be denied forever.
      discard()
      // Only a restored state can be too large to store.
      toast(t(error instanceof TooLargeError ? 'home.restoreTooLarge' : 'home.createFailed'))
      setCreating(false)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (name.trim()) void create(name)
  }

  const restore = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Clearing the input lets the same file be picked again.
    event.target.value = ''
    if (!file || creating) return
    // A bigger file could not be stored anyway (see `sealState`), and is not worth reading.
    if (file.size > MAX_PLAINTEXT_BYTES) {
      toast(t('home.restoreTooLarge'))
      return
    }
    const state = await readBackup(file)
    if (state) await create(state.name, state)
    else toast(t('home.restoreFailed'))
  }

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <a href={homePath(lang)} className="text-lg font-bold text-accent no-underline">
          {t('app.name')}
        </a>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <LangSwitch hrefFor={homePath} />
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-5xl items-center gap-8 px-4 pt-6 pb-12 md:grid-cols-[1.15fr_1fr]">
          <div>
            <h1 className="mb-4 text-3xl font-bold tracking-tight text-balance sm:text-4xl">{t('home.title')}</h1>
            <p className="text-lg text-muted">{t('home.intro')}</p>
          </div>
          <div id="create" className="scroll-mt-4 space-y-4">
            <form className={cx(card, 'space-y-3')} onSubmit={submit}>
              <h2 className="text-lg font-semibold">{t('home.formTitle')}</h2>
              <label className="block text-sm font-medium" htmlFor="dashboard-name">
                {t('home.nameLabel')}
              </label>
              <input
                id="dashboard-name"
                className={input}
                placeholder={t('home.namePlaceholder')}
                value={name}
                maxLength={LIMITS.dashboardName}
                onFocus={() => void loadStorage()}
                onChange={(e) => {
                  setName(e.target.value)
                  // The proof of work takes a moment: it is searched for while the name is typed.
                  if (e.target.value.trim()) void prepare()
                }}
              />
              <button type="submit" className={cx(button('primary'), 'w-full')} disabled={!name.trim() || creating}>
                {creating ? t(ready ? 'home.creating' : 'home.preparing') : t('home.create')}
              </button>
            </form>
            <div className="text-center">
              <a href="#/demo" className={button()}>
                {t('home.demo')}
              </a>
              <p className="mt-2 text-sm text-muted">{t('home.demoHint')}</p>
            </div>
            <div className="text-center">
              <button
                type="button"
                className={button()}
                disabled={creating}
                onClick={() => {
                  // The proof of work is searched for while the file is chosen.
                  void loadStorage()
                  void prepare()
                  fileInput.current?.click()
                }}
              >
                {t('home.restore')}
              </button>
              <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={restore} />
            </div>
          </div>
        </section>

        <section className={cx(section, 'pt-0')}>
          <h2 className={sectionTitle}>{t('home.steps.title')}</h2>
          <ol className="grid gap-4 sm:grid-cols-3">
            {steps.map((key, index) => (
              <li key={key} className={card}>
                <span className="mb-3 inline-flex size-8 items-center justify-center rounded-full bg-accent font-bold text-on-accent">
                  {index + 1}
                </span>
                <h3 className="mb-1 font-semibold">{tk(`home.steps.${key}.title`)}</h3>
                <p className="text-muted">{tk(`home.steps.${key}.body`)}</p>
              </li>
            ))}
          </ol>
        </section>

        <div className="mx-auto max-w-5xl px-4">
          <img
            src={`/screens/${lang}-calendar.webp`}
            alt={t('home.screenshotAlt')}
            width={1200}
            height={750}
            loading="lazy"
            decoding="async"
            className="h-auto w-full rounded-xl border border-line shadow-sm"
          />
        </div>

        <section className={section}>
          <h2 className={sectionTitle}>{t('home.features.title')}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(({ key, icon }) => (
              <div key={key} className={card}>
                <div className="mb-3 inline-flex size-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
                  {icon}
                </div>
                <h3 className="mb-1 font-semibold">{tk(`home.features.${key}.title`)}</h3>
                <p className="text-muted">{tk(`home.features.${key}.body`)}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-4">
          <div className="flex flex-col gap-4 rounded-xl border border-accent/40 bg-accent-soft p-6 sm:flex-row">
            <div className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface text-accent">
              <LockIcon />
            </div>
            <div>
              <h2 className="mb-2 text-xl font-bold">{t('home.privacy.title')}</h2>
              <p>{t('home.privacy.body')}</p>
            </div>
          </div>
        </section>

        <section className={section}>
          <h2 className={sectionTitle}>{t('home.uses.title')}</h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {uses.map((key) => (
              <li key={key} className="flex gap-2 rounded-lg border border-line bg-surface p-3">
                <CheckIcon className="mt-0.5 text-accent" />
                {tk(`home.uses.${key}`)}
              </li>
            ))}
          </ul>
        </section>

        <section className={cx(section, 'pt-0')}>
          <h2 className={sectionTitle}>{t('home.faq.title')}</h2>
          <div className="divide-y divide-line rounded-xl border border-line bg-surface">
            {faq.map((key) => (
              <details key={key} className="group p-4">
                <summary className="cursor-pointer font-semibold marker:text-accent">{tk(`home.faq.${key}.q`)}</summary>
                <p className="mt-2 text-muted">{tk(`home.faq.${key}.a`)}</p>
              </details>
            ))}
          </div>
        </section>

        <section className={cx(section, 'pt-0 text-center')}>
          <h2 className="mb-4 text-2xl font-bold sm:text-3xl">{t('home.cta.title')}</h2>
          <div className="flex flex-wrap justify-center gap-2">
            <a href="#create" className={button('primary')}>
              {t('home.cta.button')}
            </a>
            <a href="#/demo" className={button()}>
              {t('home.demo')}
            </a>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-sm text-muted">
          <span className="flex flex-wrap items-center gap-x-3">
            <span>{t('home.footer')}</span>
            {RELEASE_URL ? (
              <a href={RELEASE_URL} rel="noopener" className="text-muted underline">
                {VERSION_LABEL}
              </a>
            ) : (
              <span>{VERSION_LABEL}</span>
            )}
            <a href={SOURCE_URL} rel="noopener" className="text-muted underline">
              {t('home.source')}
            </a>
          </span>
          <LangSwitch hrefFor={homePath} />
        </div>
      </footer>
    </div>
  )
}
