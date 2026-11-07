import { describe, expect, it } from 'vitest'
import { addEvent, addPerson, compose, emptyState, recordCall, setReplies, setReply } from '../domain/mutations'
import { addProperty, setValue } from '../domain/properties'
import { buildAttendanceCsv, buildEventsCsv, buildPeopleCsv, exportFileName, neutralizeFormula } from './exportCsv'
import { parseTable } from './parse'

const headers = { name: 'Nom', total: 'Total', date: 'Date', start: 'Début', end: 'Fin', event: 'Événement', yes: 'Oui', no: 'Non', called: 'Appel fait', present: 'Présents' }
const fr = { locale: 'fr', delimiter: ';' as const, headers }

const state = compose(
  addPerson('b', 'Zoé Roux'),
  addPerson('a', 'Dupont; "Jean"'),
  addEvent('oct', '2026-10-10', { name: 'Match', start: '15:00', end: '17:00' }),
  addEvent('sep', '2026-09-05'),
  setReplies('oct', ['a', 'b'], 'yes'),
  setReplies('sep', ['a'], 'yes'),
  addProperty('person', 'license', 'number', 'Licence'),
  addProperty('person', 'role', 'multi', 'Poste', [
    { id: 'def', label: 'Défenseur', color: 'blue' },
    { id: 'att', label: 'Attaquant', color: 'red' },
  ]),
  addProperty('event', 'notes', 'text', 'Notes'),
  setValue('person', 'a', 'license', 12.5),
  setValue('person', 'a', 'role', ['att', 'def']),
  setValue('event', 'oct', 'notes', 'Gagné 3-1\nBon match'),
)(emptyState('Club de foot U12'))

describe('buildAttendanceCsv', () => {
  it('writes a people × events matrix, oldest first, with escaping', () => {
    expect(buildAttendanceCsv(state, fr)).toBe(
      ['Nom;Total;2026-09-05;2026-10-10 15:00 Match', '"Dupont; ""Jean""";2;1;1', 'Zoé Roux;1;;1', ''].join('\r\n'),
    )
  })

  it('marks the people counted as present: real presence after a call, a yes before', () => {
    const called = recordCall('oct', ['b'], ['a'], 1)(state)
    expect(buildAttendanceCsv(called, fr)).toBe(
      ['Nom;Total;2026-09-05;2026-10-10 15:00 Match', '"Dupont; ""Jean""";1;1;', 'Zoé Roux;1;;1', ''].join('\r\n'),
    )
  })

  it('limits the columns and totals to the given period', () => {
    expect(buildAttendanceCsv(state, { ...fr, from: '2026-10-01' })).toBe(
      ['Nom;Total;2026-10-10 15:00 Match', '"Dupont; ""Jean""";1;1', 'Zoé Roux;1;1', ''].join('\r\n'),
    )
  })

  it('can be read back by the importer', () => {
    const csv = buildAttendanceCsv(state, { ...fr, delimiter: ',' })
    expect(parseTable(csv).map((row) => row[0])).toEqual(['Nom', 'Dupont; "Jean"', 'Zoé Roux'])
  })
})

describe('buildEventsCsv', () => {
  it('writes one row per event and keeps multi-line notes in one cell', () => {
    const csv = buildEventsCsv(state, fr)
    expect(csv).toBe(
      [
        'Date;Début;Fin;Événement;Oui;Non;Appel fait;Présents;Notes',
        '2026-09-05;;;;1;0;;1;',
        '2026-10-10;15:00;17:00;Match;2;0;;2;"Gagné 3-1\nBon match"',
        '',
      ].join('\r\n'),
    )
    expect(parseTable(csv)[2][8]).toBe('Gagné 3-1\nBon match')
  })

  it('writes the replies, the time of the roll call and the people counted as present', () => {
    // Zoé said no but came; Dupont said yes and was absent.
    const calledAt = new Date(2026, 9, 10, 17, 5).getTime()
    const called = compose(setReply('oct', 'b', 'no'), recordCall('oct', ['b'], ['a'], calledAt))(state)
    const [, , october] = buildEventsCsv(called, fr).split('\r\n')
    expect(october).toBe('2026-10-10;15:00;17:00;Match;1;1;2026-10-10 17:05;1;"Gagné 3-1\nBon match"')
  })
})

describe('buildPeopleCsv', () => {
  it('writes properties with option labels and the locale decimal separator', () => {
    expect(buildPeopleCsv(state, fr)).toBe(
      ['Nom;Total;Licence;Poste', '"Dupont; ""Jean""";2;12,5;Défenseur, Attaquant', 'Zoé Roux;1;;', ''].join('\r\n'),
    )
  })
})

describe('neutralizeFormula', () => {
  it('keeps cells that would run as spreadsheet formulas as text', () => {
    for (const cell of ['=HYPERLINK("http://x")', '+1', '-2+3', '@SUM(A1)', '\t=1', '\r=1']) {
      expect(neutralizeFormula(cell)).toBe(`'${cell}`)
    }
    expect(neutralizeFormula('Jean-Pierre')).toBe('Jean-Pierre')
    expect(neutralizeFormula('2026-10-10')).toBe('2026-10-10')
  })

  it('applies to exported names', () => {
    const evil = addPerson('e', '=cmd|calc')(state)
    expect(buildAttendanceCsv(evil, { ...fr, delimiter: ',' })).toContain("\r\n'=cmd|calc,0,,\r\n")
  })
})

describe('exportFileName', () => {
  it('slugifies the dashboard name and the kind', () => {
    expect(exportFileName('Club de foot U12', 'présences', '2026-10-10')).toBe('organiz-club-de-foot-u12-presences-2026-10-10.csv')
    expect(exportFileName('!!!', 'people', '2026-10-10')).toBe('organiz-dashboard-people-2026-10-10.csv')
  })
})
