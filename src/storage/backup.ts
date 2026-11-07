import { slugify } from '../domain/matching'
import type { DashboardState, IsoDate } from '../domain/types'
import { isDashboardState } from '../domain/validate'

const FORMAT = 'organiz-backup'
const VERSION = 1

/** A full copy of a dashboard, to restore into a new one. */
export function backupJson(state: DashboardState): string {
  return JSON.stringify({ format: FORMAT, v: VERSION, state })
}

/**
 * A backup restored into a new dashboard: without its reply links, whose documents belong to
 * the old dashboard (the new one could never write or close them), nor the organizer keys of
 * those links. Where each reply came from stays in the events.
 */
function withoutLinks(state: DashboardState): DashboardState {
  const { shares: _shares, organizerKeys: _organizerKeys, hub: _hub, personalLinks: _personalLinks, ...rest } = state
  return rest
}

/** The state of a backup file, ready to restore, or null when the text is anything else. */
export function parseBackup(text: string): DashboardState | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const { format, v, state } = data as Record<string, unknown>
  return format === FORMAT && v === VERSION && isDashboardState(state) ? withoutLinks(state) : null
}

export const backupFileName = (name: string, today: IsoDate): string => `organiz-${slugify(name) || 'dashboard'}-${today}.json`
