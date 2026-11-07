import { addDays, todayIso } from '../../domain/dates'
import { useI18n } from '../../i18n/context'

/** When a reply came in, relative to today like the roll call's "done at": "today 14:32", "Mon 9:15", "12 Oct 9:15". */
export function useReplyTime(): (at: number) => string {
  const { t, lang, formatDate } = useI18n()
  return (at) => {
    const moment = new Date(at)
    const time = new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit' }).format(moment)
    const day = todayIso(moment)
    const today = todayIso()
    if (day === today) return t('replies.today', { time })
    // Within the past week the weekday is enough.
    const label = day < today && day > addDays(today, -7) ? new Intl.DateTimeFormat(lang, { weekday: 'short' }).format(moment) : formatDate(day, { day: 'numeric', month: 'short' })
    return t('replies.dayTime', { day: label, time })
  }
}
