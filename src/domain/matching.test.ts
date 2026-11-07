import { describe, expect, it } from 'vitest'
import { findPersonByName, levenshtein, matchesSearch, matchNames, normalizeName } from './matching'
import { addPerson, compose, emptyState } from './mutations'

describe('normalizeName', () => {
  it.each([
    ['Jean Dupont', 'dupont jean'],
    ['DUPONT  jean', 'dupont jean'],
    ['  Jean   Dupont ', 'dupont jean'],
    ['Hélène Lefèvre', 'helene lefevre'],
    ['Jean-Pierre Dupont', 'dupont jean pierre'],
    ["Anne-Sophie D'Arc", 'anne arc d sophie'],
    ['Cœur Œuvre', 'coeur oeuvre'],
    ['Ünal Çelik', 'celik unal'],
    ['  ', ''],
  ])('%s → %s', (input, expected) => {
    expect(normalizeName(input)).toBe(expected)
  })
})

describe('levenshtein', () => {
  it('counts edits', () => {
    expect(levenshtein('', '')).toBe(0)
    expect(levenshtein('abc', '')).toBe(3)
    expect(levenshtein('kitten', 'sitting')).toBe(3)
    expect(levenshtein('dupont', 'dupond')).toBe(1)
  })
})

const state = compose(
  addPerson('jd', 'Jean Dupont'),
  addPerson('hl', 'Hélène Lefèvre'),
  addPerson('mm', 'Marie Martin'),
  addPerson('mt', 'Marc Martin'),
)(emptyState('Club'))

describe('findPersonByName', () => {
  it('finds a person regardless of formatting', () => {
    expect(findPersonByName(state, 'LEFEVRE helene')).toBe('hl')
    expect(findPersonByName(state, 'Paul Dupont')).toBeUndefined()
    expect(findPersonByName(state, ' ')).toBeUndefined()
  })
})

describe('matchNames', () => {
  it('classifies matched, suggested and unknown names', () => {
    const { results, duplicates } = matchNames(
      ['DUPONT Jean', 'Helene Lefevre', 'Marie Martinn', 'Paul Bernard', 'jean dupont', '', '  '],
      state,
    )
    expect(results).toEqual([
      { kind: 'matched', input: 'DUPONT Jean', personId: 'jd' },
      { kind: 'matched', input: 'Helene Lefevre', personId: 'hl' },
      { kind: 'suggested', input: 'Marie Martinn', personId: 'mm', distance: 1 },
      { kind: 'unknown', input: 'Paul Bernard' },
    ])
    expect(duplicates).toEqual(['jean dupont'])
  })

  it('does not suggest a distant name', () => {
    const { results } = matchNames(['Max Martin'], state)
    // "martin max" vs "marc martin": too many edits.
    expect(results[0].kind).toBe('unknown')
  })

  it('suggests nothing when there are no people', () => {
    expect(matchNames(['Jean Dupont'], emptyState('Empty')).results).toEqual([
      { kind: 'unknown', input: 'Jean Dupont' },
    ])
  })
})

describe('matchesSearch', () => {
  it('matches words in any order, ignoring accents and case', () => {
    expect(matchesSearch('Hélène Lefèvre', 'lef hel')).toBe(true)
    expect(matchesSearch('Hélène Lefèvre', 'HELENE')).toBe(true)
    expect(matchesSearch('Hélène Lefèvre', 'helena')).toBe(false)
    expect(matchesSearch('Jean-Pierre Dupont', 'jean pierre')).toBe(true)
    expect(matchesSearch('Anyone', '  ')).toBe(true)
  })
})
