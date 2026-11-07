import { eventTally } from '../domain/attendance'
import { todayIso } from '../domain/dates'
import type { EventEntry } from '../domain/selectors'
import type { IsoDate } from '../domain/types'
import { useI18n } from '../i18n/context'
import { useTallyLabel } from './useTallyLabel'

/** Accessible summary of a day: its events, or the replies, expected or present people of its only event. */
export function useDayLabel() {
  const { t, formatDate } = useI18n()
  const tallyLabel = useTallyLabel()
  return (date: IsoDate, events: EventEntry[] | undefined) => {
    const day = formatDate(date, { dateStyle: 'full' })
    if (!events) return day
    return events.length === 1
      ? `${day}, ${tallyLabel(eventTally(events[0], todayIso()))}`
      : `${day}, ${t('calendar.events', { count: events.length })}`
  }
}
