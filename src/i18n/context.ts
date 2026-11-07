import { createContext, useContext } from 'react'
import type { YearMonth } from '../domain/dates'
import type { IsoDate } from '../domain/types'
import type { MessageKey } from './en'
import type { Lang, Params } from './translate'

export interface I18n {
  lang: Lang
  setLang: (lang: Lang) => void
  t: (key: MessageKey, params?: Params) => string
  formatDate: (date: IsoDate, options?: Intl.DateTimeFormatOptions) => string
  formatMonth: (month: YearMonth) => string
  weekdays: string[]
}

export const I18nContext = createContext<I18n | null>(null)

export function useI18n(): I18n {
  const i18n = useContext(I18nContext)
  if (!i18n) throw new Error('useI18n must be used inside I18nProvider')
  return i18n
}
