import { hasKey } from './limits'
import { compareEvents } from './selectors'
import type { DashboardState, PersonId, Reply, ShareId } from './types'

/** What a person's personal page needs: their name and current replies to the open presence links. */
export interface HubPerson {
  name: string
  replies: Record<ShareId, { answer: Reply; at: number }>
}

export interface HubContent {
  v: 1
  /** Open presence links (not closed), oldest event first: what a personal page shows. */
  shares: { shareId: ShareId; key: string }[]
  people: Record<PersonId, HubPerson>
}

/**
 * Null when the state has no hub. Replies come from the event lists; `at` from the reply trace (0 without one).
 * Shares closed in the state are left out, but not those whose time has passed: pages check the
 * time themselves, so the content does not depend on the clock.
 */
export function buildHubContent(state: DashboardState): HubContent | null {
  if (!state.hub) return null
  const open = Object.entries(state.shares ?? {})
    .filter(([, share]) => share.kind === 'presence' && !share.closed && hasKey(state.events, share.eventId))
    .map(([shareId, share]) => ({ shareId, share, event: { id: share.eventId, ...state.events[share.eventId] } }))
    .sort((a, b) => compareEvents(a.event, b.event) || a.share.createdAt - b.share.createdAt || (a.shareId < b.shareId ? -1 : a.shareId > b.shareId ? 1 : 0))
  const people: Record<PersonId, HubPerson> = {}
  for (const personId of Object.keys(state.personalLinks ?? {})) {
    if (!hasKey(state.people, personId)) continue
    const replies: HubPerson['replies'] = {}
    for (const { shareId, event } of open) {
      const answer: Reply | undefined = event.yes?.includes(personId) ? 'yes' : event.no?.includes(personId) ? 'no' : undefined
      if (!answer) continue
      const trace = event.replyLog && hasKey(event.replyLog, personId) ? event.replyLog[personId] : undefined
      replies[shareId] = { answer, at: trace?.at ?? 0 }
    }
    people[personId] = { name: state.people[personId].name, replies }
  }
  return { v: 1, shares: open.map(({ shareId, share }) => ({ shareId, key: share.key })), people }
}
