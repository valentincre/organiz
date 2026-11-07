import type { ReactNode } from 'react'
import type { ShareSnapshot } from '../domain/shareSnapshot'
import { useI18n } from '../i18n/context'
import { homePath } from '../i18n/translate'
import { LangSwitch } from '../ui/components/LangSwitch'
import { ThemeToggle } from '../ui/components/ThemeToggle'
import { cardFrame, cx } from '../ui/components/styles'

// Parts shared by the respondent pages (reply link, personal link), which load without the dashboard code.

export function Toggles() {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <ThemeToggle />
      <LangSwitch />
    </div>
  )
}

/** A page with one message in the middle: loading, missing, revoked. */
export function Centered({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-4 text-center text-muted">
      {children}
      <Toggles />
    </main>
  )
}

/** "Organiz · {children}", with the theme and language toggles. */
export function PageHeader({ children }: { children: ReactNode }) {
  const { t, lang } = useI18n()
  return (
    <header className="mx-auto flex max-w-xl items-center justify-between gap-3 px-4 py-4">
      <p className="min-w-0 text-sm [overflow-wrap:anywhere] text-muted">
        <a href={homePath(lang)} className="font-semibold text-accent no-underline hover:underline">
          {t('app.name')}
        </a>{' '}
        · {children}
      </p>
      <Toggles />
    </header>
  )
}

/** An event's properties, one row each. */
export function EventProperties({ properties }: { properties: ShareSnapshot['event']['properties'] }) {
  if (properties.length === 0) return null
  return (
    <dl className="divide-y divide-line border-t border-line text-sm">
      {properties.map((property, index) => (
        <div key={index} className="flex gap-3 py-2">
          <dt className="w-2/5 shrink-0 text-muted [overflow-wrap:anywhere]">{property.name}</dt>
          <dd className="min-w-0 flex-1 [overflow-wrap:anywhere]">{property.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Counter({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div className={cx(cardFrame, 'px-2 py-3')}>
      <div className={cx('text-2xl font-bold tabular-nums', tone)}>{value}</div>
      <div className="text-sm text-muted">{label}</div>
    </div>
  )
}
