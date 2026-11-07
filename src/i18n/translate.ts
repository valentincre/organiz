import { parseIso, type YearMonth } from '../domain/dates'
import type { IsoDate } from '../domain/types'
import { en, type MessageKey, type Messages } from './en'
import { fr } from './fr'

export type Lang = 'en' | 'fr'
export const LANGS: Lang[] = ['fr', 'en']
export type Params = Record<string, string | number>

const catalogs: Record<Lang, Messages> = { en, fr }

/**
 * Looks up a message and fills `{param}` placeholders. A message can hold
 * plural forms as "one|other", chosen from the `count` param.
 */
export function translate(lang: Lang, key: MessageKey, params: Params = {}): string {
  let message: string = catalogs[lang][key]
  if (message.includes('|') && typeof params.count === 'number') {
    const [one, other] = message.split('|')
    message = new Intl.PluralRules(lang).select(params.count) === 'one' ? one : other
  }
  return message.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  )
}

/** Dates are stored as UTC midnight, so they are always formatted in UTC. */
export function formatDate(lang: Lang, date: IsoDate, options: Intl.DateTimeFormatOptions = { dateStyle: 'long' }): string {
  return new Intl.DateTimeFormat(lang, { ...options, timeZone: 'UTC' }).format(parseIso(date))
}

export function formatMonth(lang: Lang, { year, month }: YearMonth): string {
  return new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month, 1)),
  )
}

/** Short weekday names starting on Monday. */
export function weekdayNames(lang: Lang): string[] {
  const format = new Intl.DateTimeFormat(lang, { weekday: 'short', timeZone: 'UTC' })
  // 2024-01-01 is a Monday.
  return Array.from({ length: 7 }, (_, i) => format.format(new Date(Date.UTC(2024, 0, 1 + i))))
}

/** Indexable home page of a language. */
export const homePath = (lang: Lang): string => `/${lang}/`

/** Language of a home page path ("/fr/", "/en"), if any. */
export function langFromPath(pathname: string): Lang | undefined {
  const match = /^\/(en|fr)\/?$/.exec(pathname)
  return match ? (match[1] as Lang) : undefined
}

export function detectLang(saved: string | null, browserLang: string): Lang {
  if (saved === 'fr' || saved === 'en') return saved
  return browserLang.toLowerCase().startsWith('fr') ? 'fr' : 'en'
}
