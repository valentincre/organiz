import { describe, expect, it } from 'vitest'
import { LIMITS } from './limits'
import { addEvent, addPerson, compose, emptyState } from './mutations'
import {
  addOption,
  addProperty,
  chartsSplitBy,
  convertToMulti,
  deleteOption,
  deleteProperty,
  moveProperty,
  renameOption,
  renameProperty,
  setOptionColor,
  setOptionValue,
  setValue,
  sortedOptions,
  sortedProperties,
} from './properties'
import type { DashboardState } from './types'

const base = compose(
  addPerson('a', 'Alice'),
  addPerson('b', 'Bob'),
  addEvent('e1', '2026-10-10'),
  addProperty('person', 'player', 'choice', 'Joueur', [
    { id: 'yes', label: 'Oui', color: 'green' },
    { id: 'no', label: 'Non', color: 'gray' },
  ], 1),
  addProperty('person', 'role', 'multi', 'Poste', [
    { id: 'def', label: 'Défenseur', color: 'blue' },
    { id: 'att', label: 'Attaquant', color: 'red' },
  ], 2),
  addProperty('person', 'license', 'number', 'Licence', [], 3),
  addProperty('person', 'born', 'date', 'Né le', [], 4),
  addProperty('person', 'note', 'text', 'Remarque', [], 5),
  addProperty('event', 'type', 'choice', 'Type', [{ id: 'match', label: 'Match', color: 'amber' }], 1),
)(emptyState('Club'))

describe('property definitions', () => {
  it('creates properties with ordered options, in both scopes', () => {
    expect(sortedProperties(base, 'person').map((p) => p.id)).toEqual(['player', 'role', 'license', 'born', 'note'])
    expect(sortedOptions(base.personProperties.player).map((o) => o.label)).toEqual(['Oui', 'Non'])
    expect(base.personProperties.license.options).toBeUndefined()
    expect(sortedProperties(base, 'event').map((p) => p.name)).toEqual(['Type'])
    expect(addProperty('person', 'player', 'text', 'Again')(base)).toBe(base)
    expect(addProperty('person', 'x', 'text', '  ')(base)).toBe(base)
  })

  it('renames, reorders and edits options', () => {
    const edited = compose(
      renameProperty('person', 'player', 'Licencié'),
      moveProperty('person', 'player', 10),
      renameOption('person', 'player', 'yes', 'Oui !'),
      setOptionColor('person', 'player', 'yes', 'teal'),
      addOption('person', 'player', 'maybe', 'Peut-être', 'amber', 5),
    )(base)
    expect(sortedProperties(edited, 'person').at(-1)?.name).toBe('Licencié')
    expect(edited.personProperties.player.options?.yes).toEqual({ label: 'Oui !', color: 'teal', order: 0 })
    expect(sortedOptions(edited.personProperties.player).map((o) => o.id)).toEqual(['yes', 'no', 'maybe'])
    expect(addOption('person', 'license', 'o', 'X', 'blue')(base)).toBe(base)
  })

  it('respects the limits', () => {
    let state = base
    for (let i = 0; i < LIMITS.eventProperties + 5; i++) state = addProperty('event', `p${i}`, 'text', `P${i}`)(state)
    expect(Object.keys(state.eventProperties)).toHaveLength(LIMITS.eventProperties)
  })
})

describe('charts split by a deleted property', () => {
  const chart = { show: 'rate' as const, order: 0 }
  const withCharts: DashboardState = {
    ...base,
    statCharts: {
      byPlayer: { ...chart, split: { person: 'player' } },
      byType: { ...chart, split: { event: 'type' } },
      byMonth: { ...chart, split: 'month' },
    },
  }

  it('drops the charts split by a deleted person property', () => {
    expect(Object.keys(deleteProperty('person', 'player')(withCharts).statCharts ?? {}).sort()).toEqual(['byMonth', 'byType'])
  })

  it('drops the charts split by a deleted event property', () => {
    expect(Object.keys(deleteProperty('event', 'type')(withCharts).statCharts ?? {}).sort()).toEqual(['byMonth', 'byPlayer'])
  })

  it('lists the charts a deletion would drop, in their order on the page', () => {
    const state: DashboardState = { ...withCharts, statCharts: { ...withCharts.statCharts, again: { ...chart, order: -1, split: { person: 'player' } } } }
    expect(chartsSplitBy(state, 'person', 'player')).toEqual(['again', 'byPlayer'])
    expect(chartsSplitBy(state, 'event', 'player')).toEqual([])
    expect(chartsSplitBy(base, 'person', 'player')).toEqual([])
  })

  it('removes statCharts once it is empty', () => {
    const only: DashboardState = { ...base, statCharts: { byPlayer: withCharts.statCharts!.byPlayer } }
    expect('statCharts' in deleteProperty('person', 'player')(only)).toBe(false)
  })
})

describe('values', () => {
  it('stores only values that fit the kind', () => {
    const set = compose(
      setValue('person', 'a', 'player', 'yes'),
      setValue('person', 'a', 'license', 1234),
      setValue('person', 'a', 'born', '2012-05-01'),
      setValue('person', 'a', 'note', '  Allergique  '),
      setValue('person', 'a', 'role', ['att', 'def', 'att', 'gone']),
    )(base)
    expect(set.people.a.values).toEqual({ player: 'yes', license: 1234, born: '2012-05-01', note: 'Allergique', role: ['att', 'def'] })
    expect(setValue('person', 'b', 'player', 'gone')(base)).toBe(base)
    expect(setValue('person', 'b', 'license', Number.NaN)(base)).toBe(base)
    expect(setValue('person', 'b', 'born', '2012-02-30')(base)).toBe(base)
    expect(setValue('person', 'b', 'nope', 'x')(base)).toBe(base)
    expect(setValue('person', 'zz', 'note', 'x')(base)).toBe(base)
  })

  it('clears a value with null or empty text', () => {
    const set = setValue('person', 'a', 'note', 'x')(base)
    expect(setValue('person', 'a', 'note', null)(set).people.a.values).toBeUndefined()
    expect(setValue('person', 'a', 'note', '   ')(set).people.a.values).toBeUndefined()
  })

  it('ticks multi options one by one so concurrent edits merge', () => {
    const mine = setOptionValue('person', 'a', 'role', 'def', true)
    const theirs = setOptionValue('person', 'a', 'role', 'att', true)(base)
    expect(mine(theirs).people.a.values?.role).toEqual(['att', 'def'])
    const both = mine(theirs)
    expect(setOptionValue('person', 'a', 'role', 'att', false)(both).people.a.values?.role).toEqual(['def'])
    expect(setOptionValue('person', 'a', 'player', 'yes', true)(base)).toBe(base)
  })

  it('sets event values with the same rules', () => {
    expect(setValue('event', 'e1', 'type', 'match')(base).events.e1.values).toEqual({ type: 'match' })
  })

  it('cascades deletions to the values', () => {
    const set = compose(
      setValue('person', 'a', 'player', 'yes'),
      setValue('person', 'b', 'player', 'no'),
      setValue('person', 'a', 'role', ['def', 'att']),
      setValue('person', 'b', 'role', ['def']),
    )(base)
    const noYes = deleteOption('person', 'player', 'yes')(set)
    expect(noYes.people.a.values).toEqual({ role: ['att', 'def'] })
    expect(noYes.people.b.values).toEqual({ player: 'no', role: ['def'] })
    const noDef = deleteOption('person', 'role', 'def')(set)
    expect(noDef.people.a.values?.role).toEqual(['att'])
    expect(noDef.people.b.values).toEqual({ player: 'no' })
    const noRole = deleteProperty('person', 'role')(set)
    expect(noRole.personProperties.role).toBeUndefined()
    expect(noRole.people.a.values).toEqual({ player: 'yes' })
  })

  it('ignores a value set after its option was deleted concurrently', () => {
    const deleted = deleteOption('person', 'player', 'yes')(base)
    expect(setValue('person', 'a', 'player', 'yes')(deleted)).toBe(deleted)
  })

  it('turns a single choice into a multiple choice', () => {
    const set = setValue('person', 'a', 'player', 'yes')(base)
    const converted = convertToMulti('person', 'player')(set)
    expect(converted.personProperties.player.kind).toBe('multi')
    expect(converted.people.a.values?.player).toEqual(['yes'])
    expect(convertToMulti('person', 'license')(set)).toBe(set)
  })
})
