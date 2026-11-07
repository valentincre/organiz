import { describe, expect, it } from 'vitest'
import type { PropertyOption } from '../domain/types'
import { guessKind, matchOption, parseDate, parseNumber, splitMulti } from './values'

describe('parseNumber', () => {
  it('reads French numbers', () => {
    expect(parseNumber('12,5', 'fr')).toBe(12.5)
    expect(parseNumber('1.234,5', 'fr')).toBe(1234.5)
    expect(parseNumber('1 234,5', 'fr')).toBe(1234.5)
    expect(parseNumber('1 234,5', 'fr')).toBe(1234.5)
    expect(parseNumber('1 234 567', 'fr')).toBe(1234567)
    expect(parseNumber('12.5', 'fr')).toBe(12.5)
    expect(parseNumber(' -3 ', 'fr')).toBe(-3)
    expect(parseNumber('+0,25', 'fr')).toBe(0.25)
  })

  it('reads English numbers', () => {
    expect(parseNumber('1,234.5', 'en')).toBe(1234.5)
    expect(parseNumber('1,234,567', 'en')).toBe(1234567)
    expect(parseNumber('12.5', 'en')).toBe(12.5)
    expect(parseNumber('-.5', 'en')).toBe(-0.5)
    expect(parseNumber('42', 'en')).toBe(42)
  })

  it('rejects anything else', () => {
    expect(parseNumber('', 'fr')).toBeNull()
    expect(parseNumber('   ', 'en')).toBeNull()
    expect(parseNumber('12a', 'en')).toBeNull()
    expect(parseNumber('1,2,3', 'fr')).toBeNull()
    expect(parseNumber('1.2.3', 'fr')).toBeNull()
    expect(parseNumber('1.2.3', 'en')).toBeNull()
    expect(parseNumber('1,2', 'en')).toBeNull()
    expect(parseNumber('12,', 'fr')).toBeNull()
    expect(parseNumber('-', 'en')).toBeNull()
    expect(parseNumber('--1', 'en')).toBeNull()
    expect(parseNumber('1e5', 'en')).toBeNull()
    expect(parseNumber('Infinity', 'en')).toBeNull()
  })
})

describe('parseDate', () => {
  it('reads ISO dates, with or without leading zeros', () => {
    expect(parseDate('2026-03-01', 'fr')).toBe('2026-03-01')
    expect(parseDate('2026-1-5', 'en')).toBe('2026-01-05')
  })

  it('reads day first in French and month first in English', () => {
    expect(parseDate('01/03/2026', 'fr')).toBe('2026-03-01')
    expect(parseDate('01/03/2026', 'en')).toBe('2026-01-03')
    expect(parseDate('1.3.2026', 'fr')).toBe('2026-03-01')
    expect(parseDate('3-1-2026', 'en')).toBe('2026-03-01')
  })

  it('expands two-digit years', () => {
    expect(parseDate('1/3/26', 'fr')).toBe('2026-03-01')
    expect(parseDate('1/3/49', 'fr')).toBe('2049-03-01')
    expect(parseDate('1/3/50', 'fr')).toBe('1950-03-01')
    expect(parseDate('12/31/99', 'en')).toBe('1999-12-31')
  })

  it('reads Excel serial numbers', () => {
    expect(parseDate('45000', 'fr')).toBe('2023-03-15')
    expect(parseDate('1', 'en')).toBe('1899-12-31')
    expect(parseDate('0', 'en')).toBeNull()
    expect(parseDate('80001', 'en')).toBeNull()
  })

  it('ignores a time after the date', () => {
    expect(parseDate('12/03/2026 18:30', 'fr')).toBe('2026-03-12')
    expect(parseDate('2026-03-12T18:30:00Z', 'en')).toBe('2026-03-12')
  })

  it('rejects impossible or malformed dates', () => {
    expect(parseDate('2026-02-30', 'fr')).toBeNull()
    expect(parseDate('31/04/2026', 'fr')).toBeNull()
    expect(parseDate('13/01/2026', 'en')).toBeNull()
    expect(parseDate('01/03-2026', 'fr')).toBeNull()
    expect(parseDate('1/3/226', 'fr')).toBeNull()
    expect(parseDate('12/03/2026 soon', 'fr')).toBeNull()
    expect(parseDate('March 1', 'en')).toBeNull()
    expect(parseDate('', 'en')).toBeNull()
  })
})

describe('splitMulti', () => {
  it('splits on every separator and trims', () => {
    expect(splitMulti('Piano, Guitare;Chant | Danse/Dessin\nThéâtre')).toEqual([
      'Piano',
      'Guitare',
      'Chant',
      'Danse',
      'Dessin',
      'Théâtre',
    ])
  })

  it('drops empty parts and duplicates, keeping the first spelling', () => {
    expect(splitMulti(' Élève ,, eleve; ÉLÈVE ; Prof ;')).toEqual(['Élève', 'Prof'])
    expect(splitMulti('  ')).toEqual([])
  })
})

describe('matchOption', () => {
  const options: Record<string, PropertyOption> = {
    a: { label: 'Débutant', order: 0, color: 'blue' },
    b: { label: 'Confirmé', order: 1, color: 'green' },
  }

  it('ignores case and accents', () => {
    expect(matchOption('DEBUTANT', options)).toBe('a')
    expect(matchOption(' confirme ', options)).toBe('b')
  })

  it('returns null when nothing matches', () => {
    expect(matchOption('Expert', options)).toBeNull()
  })
})

describe('guessKind', () => {
  it('falls back to text for an empty column', () => {
    expect(guessKind(['', '  '], 'fr')).toBe('text')
  })

  it('detects numbers, including plain integers', () => {
    expect(guessKind(['12', '', '1 234,5', '-3'], 'fr')).toBe('number')
    expect(guessKind(['12', '45000'], 'en')).toBe('number')
  })

  it('detects dates', () => {
    expect(guessKind(['2026-03-01', '01/03/2026'], 'fr')).toBe('date')
    expect(guessKind(['3/1/2026', '45000'], 'en')).toBe('date')
  })

  it('detects multiple values', () => {
    expect(guessKind(['Piano, Chant', 'Piano', 'chant; Danse'], 'fr')).toBe('multi')
  })

  it('detects choices', () => {
    expect(guessKind(['Débutant', 'debutant', 'Confirmé'], 'fr')).toBe('choice')
    expect(guessKind(['a@x.fr', 'b@x.fr', 'c@x.fr', 'd@x.fr', 'e@x.fr'], 'fr')).toBe('text')
  })

  it('keeps text when values are too many or too long', () => {
    const many = Array.from({ length: 21 }, (_, i) => `Person ${String.fromCharCode(65 + i)}`)
    expect(guessKind(many, 'en')).toBe('text')
    expect(guessKind(['x'.repeat(51)], 'en')).toBe('text')
    const manyParts = [Array.from({ length: 21 }, (_, i) => `tag${String.fromCharCode(65 + i)}`).join(', ')]
    expect(guessKind(manyParts, 'en')).toBe('text')
  })
})
