import { useMemo } from 'react'
import { LIMITS } from '../domain/limits'
import type { IsoDate } from '../domain/types'
import { useI18n } from '../i18n/context'
import { cx, inputBase } from './components/styles'

interface Props {
  /** First possible date, also the earliest end date. */
  from: IsoDate
  days: number[]
  onDaysChange: (days: number[]) => void
  until: IsoDate
  onUntilChange: (until: IsoDate) => void
  /** Dates the repetition creates. */
  dates: IsoDate[]
  /** Summary of what is created, given the count and the last date. */
  summary: (count: number, last: string) => string
}

/** Weekdays (0 = Monday), end date and a one-line summary of a weekly repetition. */
export function RepeatFields({ from, days, onDaysChange, until, onUntilChange, dates, summary }: Props) {
  const { t, lang, formatDate } = useI18n()
  // 2024-01-01 is a Monday.
  const names = useMemo(() => {
    const format = new Intl.DateTimeFormat(lang, { weekday: 'long', timeZone: 'UTC' })
    return Array.from({ length: 7 }, (_, index) => format.format(Date.UTC(2024, 0, 1 + index)))
  }, [lang])

  return (
    <>
      <div className="flex flex-wrap gap-1" role="group" aria-label={t('event.repeatDays')}>
        {names.map((name, index) => (
          <button
            key={name}
            type="button"
            aria-pressed={days.includes(index)}
            aria-label={name}
            title={name}
            className={cx(
              'size-8 cursor-pointer rounded-full border text-sm font-semibold uppercase',
              days.includes(index) ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-muted hover:text-text',
            )}
            onClick={() => onDaysChange(days.includes(index) ? days.filter((d) => d !== index) : [...days, index])}
          >
            {name.charAt(0)}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm text-muted">
        {t('event.until')}
        <input type="date" className={cx(inputBase, 'min-w-0 flex-1 text-text')} value={until} min={from} onChange={(e) => onUntilChange(e.target.value)} />
      </label>
      <p className="text-sm text-muted" aria-live="polite">
        {dates.length === 0 ? t('event.repeatNone') : summary(dates.length, formatDate(dates.at(-1)!, { dateStyle: 'medium' }))}
        {dates.length >= LIMITS.series && ` ${t('event.repeatLimit', { count: LIMITS.series })}`}
      </p>
    </>
  )
}
