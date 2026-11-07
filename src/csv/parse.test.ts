import { describe, expect, it } from 'vitest'
import { decodeText } from './decode'
import { extractNames, guessHasHeader, guessNameColumns, parseTable } from './parse'

/** Encodes text as Windows-1252 (Latin-1 subset is enough here). */
const latin1 = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0))

describe('decodeText', () => {
  it('reads UTF-8 and drops the BOM', () => {
    const bytes = new TextEncoder().encode('﻿Hélène')
    expect(decodeText(bytes)).toBe('Hélène')
  })

  it('falls back to Windows-1252 for Excel exports', () => {
    expect(decodeText(latin1('Nom;Prénom\nLefèvre;Hélène'))).toBe('Nom;Prénom\nLefèvre;Hélène')
  })
})

describe('parseTable', () => {
  it('detects semicolons and pads short rows', () => {
    expect(parseTable('Nom;Prénom;Email\nDupont;Jean\n\n;;\nMartin;Marie;m@x.fr\n')).toEqual([
      ['Nom', 'Prénom', 'Email'],
      ['Dupont', 'Jean', ''],
      ['Martin', 'Marie', 'm@x.fr'],
    ])
  })

  it('reads a plain pasted list as one column', () => {
    expect(parseTable('  Jean Dupont \nMarie Martin\n')).toEqual([['Jean Dupont'], ['Marie Martin']])
  })

  it('handles quoted commas and tabs', () => {
    expect(parseTable('"Dupont, Jean",x\n"Martin, Marie",y')).toEqual([
      ['Dupont, Jean', 'x'],
      ['Martin, Marie', 'y'],
    ])
    expect(parseTable('First name\tLast name\nJean\tDupont')).toEqual([
      ['First name', 'Last name'],
      ['Jean', 'Dupont'],
    ])
  })

  it('returns an empty table for empty input', () => {
    expect(parseTable('  \n ')).toEqual([])
  })
})

describe('column guessing', () => {
  it('finds first and last name columns, first name first', () => {
    const table = parseTable('Email;Nom;Prénom\nj@x.fr;Dupont;Jean')
    expect(guessHasHeader(table)).toBe(true)
    expect(guessNameColumns(table, true)).toEqual([2, 1])
    expect(extractNames(table, [2, 1], true)).toEqual(['Jean Dupont'])
  })

  it('prefers a full name column', () => {
    const table = parseTable('Date,Full Name,Phone\n2026-10-10,Jean Dupont,06')
    expect(guessNameColumns(table, true)).toEqual([1])
  })

  it('treats a list without known titles as data', () => {
    const table = parseTable('Jean Dupont\nMarie Martin')
    expect(guessHasHeader(table)).toBe(false)
    expect(guessNameColumns(table, false)).toEqual([0])
    expect(extractNames(table, [0], false)).toEqual(['Jean Dupont', 'Marie Martin'])
  })

  it('skips rows where the chosen columns are empty', () => {
    const table = parseTable('Prénom;Nom\nJean;Dupont\n;\nMarie;')
    expect(extractNames(table, [0, 1], true)).toEqual(['Jean Dupont', 'Marie'])
  })
})
