import { describe, expect, it } from 'vitest'
import { addPerson, compose, emptyState } from '../domain/mutations'
import { addProperty, setValue } from '../domain/properties'
import { parseColumn, valueMutations } from './importPlan'

const state = compose(
  addPerson('a', 'Alice'),
  addPerson('b', 'Bob'),
  addProperty('person', 'role', 'multi', 'Poste', [{ id: 'def', label: 'Défenseur', color: 'blue' }]),
  setValue('person', 'b', 'role', ['def']),
)(emptyState('Club'))

const records = [
  { name: 'Alice', row: ['Alice', 'defenseur, Ailier', '12,5', '01/03/2012', 'U13'] },
  { name: 'Bob', row: ['Bob', 'Ailier', 'n/a', '', 'U15'] },
  { name: 'Chloé', row: ['Chloé', '', '3', '15/09/2013', 'u13'] },
]

let next = 0
const makeId = () => `id${next++}`

describe('parseColumn', () => {
  it('matches options of an existing property and lists the new ones', () => {
    const column = parseColumn(state, { column: 1, target: { type: 'existing', propertyId: 'role' } }, records, 'fr', makeId)
    expect(column.kind).toBe('multi')
    expect(column.newOptions).toEqual([{ id: expect.any(String), label: 'Ailier' }])
    const ailier = column.newOptions[0].id
    expect(column.values).toEqual([[ailier, 'def'].sort(), [ailier], null])
  })

  it('reads numbers and dates in the locale format and reports unreadable cells', () => {
    const numbers = parseColumn(state, { column: 2, target: { type: 'new', name: 'Licence', kind: 'number' } }, records, 'fr', makeId)
    expect(numbers.values).toEqual([12.5, null, 3])
    expect(numbers.unreadable).toEqual(['n/a'])
    const dates = parseColumn(state, { column: 3, target: { type: 'new', name: 'Né le', kind: 'date' } }, records, 'fr', makeId)
    expect(dates.values).toEqual(['2012-03-01', null, '2013-09-15'])
  })

  it('creates the options of a new choice property once, ignoring case', () => {
    const column = parseColumn(state, { column: 4, target: { type: 'new', name: 'Catégorie', kind: 'choice' } }, records, 'fr', makeId)
    expect(column.newOptions.map((o) => o.label)).toEqual(['U13', 'U15'])
    expect(column.values[0]).toBe(column.values[2])
  })
})

describe('valueMutations', () => {
  const columns = [
    parseColumn(state, { column: 1, target: { type: 'existing', propertyId: 'role' } }, records, 'fr', makeId),
    parseColumn(state, { column: 4, target: { type: 'new', name: 'Catégorie', kind: 'choice' } }, records, 'fr', makeId),
  ]
  const people = ['a', 'b', null]
  const apply = (overwrite: boolean) => compose(...valueMutations(state, columns, people, overwrite))(state)

  it('creates properties and options, then fills the values', () => {
    const result = apply(false)
    const category = columns[1].propertyId
    expect(result.personProperties[category].kind).toBe('choice')
    expect(Object.values(result.personProperties.role.options!).map((o) => o.label)).toEqual(['Défenseur', 'Ailier'])
    expect(result.people.a.values?.role).toHaveLength(2)
    expect(result.people.a.values?.[category]).toBe(columns[1].values[0])
  })

  it('keeps existing values unless asked to overwrite', () => {
    expect(apply(false).people.b.values?.role).toEqual(['def'])
    expect(apply(true).people.b.values?.role).toEqual([columns[0].newOptions[0].id])
  })
})
