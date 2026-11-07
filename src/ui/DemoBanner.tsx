import { useI18n } from '../i18n/context'
import { homePath } from '../i18n/translate'
import { button, cx } from './components/styles'

export function DemoBanner() {
  const { t, lang } = useI18n()
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-accent/40 bg-accent-soft p-4" role="note">
      <div className="min-w-60 flex-1">
        <p className="font-semibold">{t('demo.title')}</p>
        <p className="text-sm">{t('demo.body')}</p>
      </div>
      <a href={homePath(lang)} className={cx(button('primary'), 'shrink-0')}>
        {t('demo.create')}
      </a>
    </div>
  )
}
