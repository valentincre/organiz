import { describe, expect, it } from 'vitest'
import { breakdown, compareByProperty, decodeFilter, encodeFilter, matchesFilter, type Filter } from './filters'
import { addPerson, compose, emptyState } from './mutations'
import { addProperty, setValue } from './properties'
import type { PropertyValues } from './types'

const state = compose(
  addProperty('person', 'player', 'choice', 'Joueur', [
    { id: 'yes', label: 'Oui', color: 'green' },
    { id: 'no', label: 'Non', color: 'gray' },
  ]),
  addProperty('person', 'role', 'multi', 'Poste', [
    { id: 'def', label: 'Défenseur', color: 'blue' },
    { id: 'att', label: 'Attaquant', color: 'red' },
  ]),
  addProperty('person', 'license', 'number', 'Licence'),
  addProperty('person', 'born', 'date', 'Né le'),
  addProperty('person', 'note', 'text', 'Remarque'),
  addPerson('a', 'Alice'),
  addPerson('b', 'Bob'),
  addPerson('c', 'Chloé'),
  setValue('person', 'a', 'player', 'yes'),
  setValue('person', 'a', 'role', ['def', 'att']),
  setValue('person', 'a', 'license', 12),
  setValue('person', 'a', 'born', '2012-05-01'),
  setValue('person', 'a', 'note', 'Allergie aux arachides'),
  setValue('person', 'b', 'player', 'no'),
  setValue('person', 'b', 'license', 3.5),
)(emptyState('Club'))

const defs = state.personProperties
const ids = (filter: Filter) =>
  Object.entries(state.people)
    .filter(([, person]) => matchesFilter(defs, person.values, filter))
    .map(([id]) => id)

describe('filters', () => {
  it('matches each kind of condition', () => {
    expect(ids([{ type: 'options', propertyId: 'player', optionIds: ['yes', 'no'] }])).toEqual(['a', 'b'])
    expect(ids([{ type: 'options', propertyId: 'role', optionIds: ['att'] }])).toEqual(['a'])
    expect(ids([{ type: 'text', propertyId: 'note', query: 'ARACHIDE' }])).toEqual(['a'])
    expect(ids([{ type: 'range', propertyId: 'license', min: '4' }])).toEqual(['a'])
    expect(ids([{ type: 'range', propertyId: 'born', max: '2012-12-31' }])).toEqual(['a'])
    expect(ids([{ type: 'empty', propertyId: 'player' }])).toEqual(['c'])
    expect(ids([{ type: 'filled', propertyId: 'license' }])).toEqual(['a', 'b'])
  })

  it('combines conditions with AND and ignores unknown properties', () => {
    expect(
      ids([
        { type: 'filled', propertyId: 'player' },
        { type: 'range', propertyId: 'license', max: '5' },
        { type: 'empty', propertyId: 'gone' },
      ]),
    ).toEqual(['b'])
  })

  it('round-trips through the URL and drops what no longer exists', () => {
    const filter: Filter = [
      { type: 'options', propertyId: 'player', optionIds: ['yes', 'no'] },
      { type: 'text', propertyId: 'note', query: 'a, b ~ c' },
      { type: 'range', propertyId: 'license', min: '1', max: '5' },
      { type: 'range', propertyId: 'born', min: '2010-01-01' },
      { type: 'empty', propertyId: 'role' },
      { type: 'filled', propertyId: 'note' },
    ]
    expect(decodeFilter(encodeFilter(filter), defs)).toEqual(filter)
    expect(decodeFilter('player:yes|gone,gone:x,license~x,born>=bad,note~%E0', defs)).toEqual([
      { type: 'options', propertyId: 'player', optionIds: ['yes'] },
    ])
    expect(decodeFilter(null, defs)).toEqual([])
  })
})

describe('sorting and breakdowns', () => {
  const collator = new Intl.Collator('fr')
  const values = (id: string): PropertyValues | undefined => state.people[id].values

  it('sorts by property with empty values last', () => {
    const order = (propertyId: string) => {
      const compare = compareByProperty(defs[propertyId], collator)
      return ['c', 'b', 'a'].sort((x, y) => compare(values(x)?.[propertyId], values(y)?.[propertyId]))
    }
    expect(order('player')).toEqual(['a', 'b', 'c'])
    expect(order('license')).toEqual(['b', 'a', 'c'])
    // Ties keep the previous order (stable sort).
    expect(order('role')).toEqual(['a', 'c', 'b'])
  })

  it('counts options and summarizes numbers', () => {
    const people = ['a', 'b', 'c'].map(values)
    expect(breakdown(defs, 'player', people)).toEqual({
      type: 'options',
      counts: [
        { optionId: 'yes', count: 1 },
        { optionId: 'no', count: 1 },
      ],
      empty: 1,
    })
    expect(breakdown(defs, 'license', people)).toEqual({ type: 'number', count: 2, min: 3.5, max: 12, average: 7.75, empty: 1 })
    expect(breakdown(defs, 'note', people)).toBeNull()
  })
})
