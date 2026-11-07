import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { I18nContext, type I18n } from './context'
import { detectLang, formatDate, formatMonth, translate, weekdayNames, type Lang } from './translate'

const STORAGE_KEY = 'organiz.lang'

function readSavedLang(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

interface Props {
  /** Language set by the page itself (the /en/ and /fr/ home pages); otherwise the saved or browser language. */
  initialLang?: Lang
  children: ReactNode
}

export function I18nProvider({ initialLang, children }: Props) {
  const [lang, setLangState] = useState<Lang>(() => initialLang ?? detectLang(readSavedLang(), navigator.language))

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const value = useMemo<I18n>(
    () => ({
      lang,
      setLang: (next) => {
        setLangState(next)
        try {
          localStorage.setItem(STORAGE_KEY, next)
        } catch {
          // Storage may be unavailable (private mode); the choice then lasts for this visit.
        }
      },
      t: (key, params) => translate(lang, key, params),
      formatDate: (date, options) => formatDate(lang, date, options),
      formatMonth: (month) => formatMonth(lang, month),
      weekdays: weekdayNames(lang),
    }),
    [lang],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
