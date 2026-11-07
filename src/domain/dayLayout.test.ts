import { describe, expect, it } from 'vitest'
import { DEFAULT_DURATION, firstHourToShow, layoutDay, toMinutes } from './dayLayout'

describe('toMinutes', () => {
  it('converts HH:MM to minutes from midnight', () => {
    expect(toMinutes('00:00')).toBe(0)
    expect(toMinutes('09:05')).toBe(545)
    expect(toMinutes('18:30')).toBe(1110)
  })
})

describe('layoutDay', () => {
  it('returns nothing for an empty day', () => {
    expect(layoutDay([])).toEqual([])
  })

  it('keeps separate events in one column each', () => {
    const placed = layoutDay([
      { id: 'b', start: '14:00', end: '15:00' },
      { id: 'a', start: '09:00', end: '10:30' },
    ])
    expect(placed).toEqual([
      { id: 'a', top: 540, height: 90, column: 0, columns: 1 },
      { id: 'b', top: 840, height: 60, column: 0, columns: 1 },
    ])
  })

  it('puts two overlapping events side by side', () => {
    const placed = layoutDay([
      { id: 'a', start: '09:00', end: '10:00' },
      { id: 'b', start: '09:30', end: '11:00' },
    ])
    expect(placed.map(({ id, column, columns }) => ({ id, column, columns }))).toEqual([
      { id: 'a', column: 0, columns: 2 },
      { id: 'b', column: 1, columns: 2 },
    ])
  })

  it('groups transitive overlaps into one cluster and reuses free columns', () => {
    // A overlaps B, B overlaps C, A ends when C starts.
    const placed = layoutDay([
      { id: 'c', start: '10:00', end: '11:00' },
      { id: 'a', start: '09:00', end: '10:00' },
      { id: 'b', start: '09:30', end: '10:30' },
    ])
    expect(placed.map(({ id, column, columns }) => ({ id, column, columns }))).toEqual([
      { id: 'a', column: 0, columns: 2 },
      { id: 'b', column: 1, columns: 2 },
      { id: 'c', column: 0, columns: 2 },
    ])
  })

  it('does not treat touching events as overlapping', () => {
    const placed = layoutDay([
      { id: 'a', start: '09:00', end: '10:00' },
      { id: 'b', start: '10:00', end: '11:00' },
    ])
    expect(placed.every((item) => item.column === 0 && item.columns === 1)).toBe(true)
  })

  it('gives a default duration to events without an end', () => {
    expect(layoutDay([{ id: 'a', start: '18:30' }])).toEqual([
      { id: 'a', top: 1110, height: DEFAULT_DURATION, column: 0, columns: 1 },
    ])
    // The default duration counts for overlaps too.
    const placed = layoutDay([
      { id: 'a', start: '09:00' },
      { id: 'b', start: '09:45', end: '10:00' },
    ])
    expect(placed.map((item) => item.columns)).toEqual([2, 2])
  })

  it('uses the minimum visual height for overlaps', () => {
    const items = [
      { id: 'a', start: '09:00', end: '09:05' },
      { id: 'b', start: '09:10', end: '09:30' },
    ]
    const placed = layoutDay(items)
    expect(placed[0]).toEqual({ id: 'a', top: 540, height: 20, column: 0, columns: 2 })
    expect(placed[1]).toEqual({ id: 'b', top: 550, height: 20, column: 1, columns: 2 })

    const unclamped = layoutDay(items, 5)
    expect(unclamped.map(({ height, column, columns }) => ({ height, column, columns }))).toEqual([
      { height: 5, column: 0, columns: 1 },
      { height: 20, column: 0, columns: 1 },
    ])
  })

  it('clamps events at midnight', () => {
    expect(layoutDay([{ id: 'a', start: '23:30' }])).toEqual([
      { id: 'a', top: 1410, height: 30, column: 0, columns: 1 },
    ])
    // The minimum height does not extend past midnight either.
    expect(layoutDay([{ id: 'b', start: '23:55', end: '23:58' }])[0].height).toBe(5)
  })

  it('orders equal starts longest first, then by id', () => {
    const placed = layoutDay([
      { id: 'z', start: '09:00', end: '09:30' },
      { id: 'b', start: '09:00', end: '10:00' },
      { id: 'a', start: '09:00', end: '10:00' },
    ])
    expect(placed.map(({ id, column, columns }) => ({ id, column, columns }))).toEqual([
      { id: 'a', column: 0, columns: 3 },
      { id: 'b', column: 1, columns: 3 },
      { id: 'z', column: 2, columns: 3 },
    ])
  })

  it('treats an end before the start as a zero-length event', () => {
    expect(layoutDay([{ id: 'a', start: '10:00', end: '09:00' }])).toEqual([
      { id: 'a', top: 600, height: 20, column: 0, columns: 1 },
    ])
  })
})

describe('firstHourToShow', () => {
  it('falls back when the day is empty', () => {
    expect(firstHourToShow([])).toBe(7)
    expect(firstHourToShow([], 8)).toBe(8)
  })

  it('shows one hour before the earliest event', () => {
    expect(firstHourToShow([{ id: 'a', start: '18:30' }, { id: 'b', start: '09:15' }])).toBe(8)
    expect(firstHourToShow([{ id: 'a', start: '20:00' }])).toBe(19)
  })

  it('never goes before midnight', () => {
    expect(firstHourToShow([{ id: 'a', start: '00:30' }])).toBe(0)
  })
})
