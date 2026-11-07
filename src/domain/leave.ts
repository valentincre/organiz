import { presenceOf, replyOf } from './attendance'
import { hasKey } from './limits'
import type { AppEvent, DashboardState, IsoDate, Person, PersonId } from './types'

// A person's leave date: inclusive, so an event on that
// day still has them. Nothing is deleted or refused; they are only no longer offered afterwards.

/** Left the group before the date; false on the leave day itself. */
export const hasLeftBy = (person: Person, date: IsoDate): boolean => person.leftOn !== undefined && person.leftOn < date

/** Whether an event lists the person: not left by its date, or with a reply or a presence on it. */
export function isListedAt(state: DashboardState, event: AppEvent, id: PersonId): boolean {
  if (!hasKey(state.people, id)) return false
  return !hasLeftBy(state.people[id], event.date) || replyOf(event, id) !== undefined || presenceOf(event, id) !== undefined
}
