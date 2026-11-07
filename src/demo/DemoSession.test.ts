import { describe, expect, it, vi } from 'vitest'
import { addPerson } from '../domain/mutations'
import { DemoSession } from './DemoSession'

describe('DemoSession', () => {
  it('starts filled and applies edits in memory', () => {
    const session = new DemoSession('Demo', '2026-10-10')
    const listener = vi.fn()
    session.subscribe(listener)
    expect(Object.keys(session.getSnapshot().state!.people)).toHaveLength(30)

    session.mutate(addPerson('new', 'Nouveau Venu'))
    expect(session.getSnapshot().state!.people.new.name).toBe('Nouveau Venu')
    expect(session.getSnapshot().saving).toBe(false)
    expect(listener).toHaveBeenCalledTimes(1)

    // No-op edits do not notify.
    session.mutate(addPerson('new', 'Other'))
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
