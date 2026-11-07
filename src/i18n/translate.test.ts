import { describe, expect, it } from 'vitest'
import { en } from './en'
import { fr } from './fr'
import { detectLang, formatDate, formatMonth, translate, weekdayNames } from './translate'

describe('i18n', () => {
  it('has the same placeholders in both languages', () => {
    const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(fr[key]), key).toEqual(placeholders(en[key]))
      expect(fr[key].includes('|'), key).toBe(en[key].includes('|'))
    }
  })

  it('interpolates params', () => {
    expect(translate('en', 'app.name')).toBe('Organiz')
  })

  it('detects the language', () => {
    expect(detectLang('en', 'fr-FR')).toBe('en')
    expect(detectLang(null, 'fr-CA')).toBe('fr')
    expect(detectLang('xx', 'de-DE')).toBe('en')
  })

  it('formats dates without time zone shifts', () => {
    expect(formatDate('fr', '2026-10-10')).toBe('10 octobre 2026')
    expect(formatDate('en', '2026-01-01')).toBe('January 1, 2026')
    expect(formatMonth('fr', { year: 2026, month: 9 })).toBe('octobre 2026')
    expect(weekdayNames('en')[0]).toBe('Mon')
  })
})

describe('plurals', () => {
  it('picks the form from count, French treating 0 and 1 as singular', () => {
    expect(translate('en', 'csv.doneCreated', { count: 1 })).toBe('1 new person created.')
    expect(translate('en', 'csv.doneCreated', { count: 0 })).toBe('0 new people created.')
    expect(translate('fr', 'csv.doneCreated', { count: 1 })).toBe('1 nouvelle personne créée.')
    expect(translate('fr', 'csv.doneCreated', { count: 3 })).toBe('3 nouvelles personnes créées.')
  })
})
