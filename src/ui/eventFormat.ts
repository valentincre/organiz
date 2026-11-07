import type { AppEvent, Time } from '../domain/types'
import type { I18n } from '../i18n/context'

export function formatTime(lang: string, time: Time): string {
  const [hours, minutes] = time.split(':').map(Number)
  return new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(
    Date.UTC(2000, 0, 1, hours, minutes),
  )
}

/** The event's name, or "Event on {date}" when it has none. */
export function eventTitle(event: Pick<AppEvent, 'name' | 'date'>, { t, formatDate }: I18n): string {
  return event.name || t('event.untitled', { date: formatDate(event.date, { day: 'numeric', month: 'long', year: 'numeric' }) })
}

/** "All day", "18:30" or "18:30 – 20:00". */
export function eventTime(event: Pick<AppEvent, 'start' | 'end'>, { t, lang }: I18n): string {
  if (!event.start) return t('event.allDay')
  const start = formatTime(lang, event.start)
  return event.end ? `${start} – ${formatTime(lang, event.end)}` : start
}

/** A duration such as "45 min", "1 h" or "1 h 30" ("1 h 30 min" in English). */
export function formatDuration(lang: string, minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest} min`
  if (rest === 0) return `${hours} h`
  return lang === 'fr' ? `${hours} h ${String(rest).padStart(2, '0')}` : `${hours} h ${rest} min`
}
