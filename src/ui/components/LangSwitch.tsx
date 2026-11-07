import { useI18n } from '../../i18n/context'
import { LANGS, type Lang } from '../../i18n/translate'
import { cx } from './styles'

interface Props {
  /** When set, each language is a link to that URL (the home pages); otherwise it switches in place. */
  hrefFor?: (lang: Lang) => string
}

export function LangSwitch({ hrefFor }: Props) {
  const { lang, setLang, t } = useI18n()
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-line" role="group" aria-label={t('lang.label')}>
      {LANGS.map((code) => {
        const className = cx(
          'inline-flex min-h-10 min-w-10 cursor-pointer items-center justify-center text-xs font-semibold no-underline',
          code === lang ? 'bg-accent-soft text-accent' : 'bg-surface text-muted hover:text-text',
        )
        // The link saves the choice too, so "/" opens this language next time.
        return hrefFor ? (
          <a
            key={code}
            href={hrefFor(code)}
            hrefLang={code}
            lang={code}
            aria-current={code === lang ? 'page' : undefined}
            className={className}
            onClick={() => setLang(code)}
          >
            {code.toUpperCase()}
          </a>
        ) : (
          <button key={code} type="button" aria-pressed={code === lang} className={className} onClick={() => setLang(code)}>
            {code.toUpperCase()}
          </button>
        )
      })}
    </div>
  )
}
