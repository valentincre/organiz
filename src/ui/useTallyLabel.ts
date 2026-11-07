import type { EventTally } from '../domain/attendance'
import { useI18n } from '../i18n/context'

/** One short text for an event's tally, where there is no room for a bar (day view, a day's accessible name). */
export function useTallyLabel() {
  const { t } = useI18n()
  return (tally: EventTally): string => {
    switch (tally.kind) {
      case 'replies':
        return tally.yes === 0 && tally.no === 0 ? t('events.upcomingTag') : t('calendar.replies', { count: tally.yes, no: tally.no })
      case 'expected':
        return t('calendar.expected', { count: tally.count })
      case 'present':
        return t('calendar.present', { count: tally.count })
    }
  }
}
