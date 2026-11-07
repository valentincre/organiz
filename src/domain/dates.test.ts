import { describe, expect, it } from 'vitest'
import { addMonths, isInRange, isValidIso, monthGrid, monthOf, monthsBetween, parseTime, plusHour, todayIso } from './dates'

describe('dates', () => {
  it('validates ISO dates', () => {
    expect(isValidIso('2026-10-10')).toBe(true)
    expect(isValidIso('2028-02-29')).toBe(true)
    expect(isValidIso('2026-02-29')).toBe(false)
    expect(isValidIso('2026-13-01')).toBe(false)
    expect(isValidIso('2026-1-01')).toBe(false)
  })

  it('formats today in local time', () => {
    expect(todayIso(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05')
  })

  it('adds months across years', () => {
    expect(addMonths({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 })
    expect(addMonths({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 })
    expect(addMonths({ year: 2026, month: 5 }, -18)).toEqual({ year: 2024, month: 11 })
    expect(monthOf('2026-10-10')).toEqual({ year: 2026, month: 9 })
  })

  it('builds a Monday-first 6-week grid', () => {
    // March 2026 starts on a Sunday: six days of February come first.
    const march = monthGrid({ year: 2026, month: 2 })
    expect(march).toHaveLength(42)
    expect(march[0]).toEqual({ date: '2026-02-23', inMonth: false })
    expect(march[6]).toEqual({ date: '2026-03-01', inMonth: true })
    expect(march.filter((c) => c.inMonth)).toHaveLength(31)

    // June 2026 starts on a Monday.
    expect(monthGrid({ year: 2026, month: 5 })[0]).toEqual({ date: '2026-06-01', inMonth: true })

    // Leap February.
    expect(monthGrid({ year: 2028, month: 1 }).filter((c) => c.inMonth).at(-1)?.date).toBe('2028-02-29')
  })
})

describe('parseTime', () => {
  it('reads the usual ways of typing a time', () => {
    for (const [text, time] of [
      ['18', '18:00'],
      ['9', '09:00'],
      ['18h', '18:00'],
      ['18H30', '18:30'],
      ['18:30', '18:30'],
      [' 18.30 ', '18:30'],
      ['18 h 30', '18:30'],
      ['1830', '18:30'],
      ['930', '09:30'],
      ['0', '00:00'],
      ['23:59', '23:59'],
      ['6pm', '18:00'],
      ['6:30 PM', '18:30'],
      ['12 am', '00:00'],
      ['12:15 p.m.', '12:15'],
    ]) {
      expect(parseTime(text), text).toBe(time)
    }
  })

  it('rejects anything else', () => {
    for (const text of ['', '24', '18:60', '18:3', '12345', 'midi', '18h30m', '-1', '13pm', '0am']) {
      expect(parseTime(text), text).toBeNull()
    }
  })
})

describe('ranges', () => {
  it('lists months between two months', () => {
    expect(monthsBetween({ year: 2026, month: 10 }, { year: 2027, month: 1 })).toEqual([
      { year: 2026, month: 10 },
      { year: 2026, month: 11 },
      { year: 2027, month: 0 },
      { year: 2027, month: 1 },
    ])
    expect(monthsBetween({ year: 2026, month: 5 }, { year: 2026, month: 5 })).toHaveLength(1)
    expect(monthsBetween({ year: 2026, month: 5 }, { year: 2026, month: 4 })).toEqual([])
  })

  it('tests inclusive, optionally open ranges', () => {
    expect(isInRange('2026-10-10', '2026-10-10', '2026-10-10')).toBe(true)
    expect(isInRange('2026-10-09', '2026-10-10')).toBe(false)
    expect(isInRange('2030-01-01', '2026-10-10')).toBe(true)
    expect(isInRange('2026-10-11', undefined, '2026-10-10')).toBe(false)
    expect(isInRange('2000-01-01')).toBe(true)
  })
})

describe('plusHour', () => {
  it('adds an hour, clamped to the last hour of the day', () => {
    expect(plusHour('18:00')).toBe('19:00')
    expect(plusHour('23:30')).toBe('23:30')
  })
})
