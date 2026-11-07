import { describe, expect, it } from 'vitest'
import { readerView } from './canEdit'

describe('readerView', () => {
  it('sends readers from edit-only views to the event', () => {
    expect(readerView({ tab: 'call', eventId: 'e1' })).toEqual({ tab: 'sheet', eventId: 'e1' })
    expect(readerView({ tab: 'draft', date: '2026-10-20' })).toEqual({ tab: 'calendar', date: '2026-10-20' })
    expect(readerView({ tab: 'people' })).toEqual({ tab: 'people' })
  })

  it('keeps the period and the filters', () => {
    const period = { kind: 'month' } as const
    const filters = { people: 'p', events: 'e' }
    expect(readerView({ tab: 'call', eventId: 'e1', period, filters })).toEqual({ tab: 'sheet', eventId: 'e1', period, filters })
    expect(readerView({ tab: 'draft', date: '2026-10-20', start: '18:00', period })).toEqual({ tab: 'calendar', date: '2026-10-20', period })
  })

  it('returns views readers can see unchanged', () => {
    const person = { tab: 'person', personId: 'p1', from: 'e1' } as const
    expect(readerView(person)).toBe(person)
    // Readers see who attends: the sheet shows it without its controls.
    const sheet = { tab: 'sheet', eventId: 'e1' } as const
    expect(readerView(sheet)).toBe(sheet)
  })
})
