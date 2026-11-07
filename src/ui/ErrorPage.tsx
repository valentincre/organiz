import { useI18n } from '../i18n/context'
import type { MessageKey } from '../i18n/en'
import { homePath } from '../i18n/translate'
import type { LoadError } from '../storage/dashboardStore'
import { LangSwitch } from './components/LangSwitch'
import { ThemeToggle } from './components/ThemeToggle'
import { button, card, cx } from './components/styles'

export type ErrorKind = LoadError | 'invalid-link'

const messages: Record<ErrorKind, { title: MessageKey; body: MessageKey }> = {
  'invalid-link': { title: 'error.invalidLink.title', body: 'error.invalidLink.body' },
  'not-found': { title: 'error.notFound.title', body: 'error.notFound.body' },
  'bad-key': { title: 'error.badKey.title', body: 'error.badKey.body' },
  'newer-version': { title: 'error.newerVersion.title', body: 'error.newerVersion.body' },
  network: { title: 'error.network.title', body: 'error.network.body' },
}

export function ErrorPage({ kind }: { kind: ErrorKind }) {
  const { t, lang } = useI18n()
  const { title, body } = messages[kind]
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-4 text-center">
      <div className={cx(card, 'max-w-md')}>
        <h1 className="mb-2 text-xl font-bold">{t(title)}</h1>
        <p className="mb-4 text-muted">{t(body)}</p>
        <div className="flex flex-wrap justify-center gap-2">
          {(kind === 'network' || kind === 'newer-version') && (
            <button type="button" className={button('primary')} onClick={() => window.location.reload()}>
              {t('error.reload')}
            </button>
          )}
          <a className={button()} href={homePath(lang)}>
            {t('error.home')}
          </a>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <LangSwitch />
      </div>
    </main>
  )
}
