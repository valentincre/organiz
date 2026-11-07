import type { ReactNode } from 'react'
import type { Overview } from '../../domain/stats'
import { useI18n } from '../../i18n/context'
import { cx } from '../components/styles'
import { useStatFormat } from './useStats'

interface TileProps {
  label: string
  value: string
  /** A line of context under the value. */
  detail?: ReactNode
  /** Color of the value, such as text-danger for absences. */
  tone?: string
}

/** One number with its label and context, inside a <dl>. */
export function StatTile({ label, value, detail, tone }: TileProps) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface px-3 py-2.5">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={cx('text-2xl font-semibold tabular-nums', tone)}>{value}</dd>
      {detail && <dd className="text-xs text-muted">{detail}</dd>}
    </div>
  )
}

interface Props {
  overview: Overview
}

/** The four fixed numbers of the period: attendance rate, events, absences, newcomers. */
export function StatNumbers({ overview }: Props) {
  const { t } = useI18n()
  const format = useStatFormat()
  const { rate, expected, absences, pastEvents, upcomingEvents, newcomers, total } = overview
  const noRecord = t('statsPage.numbers.noRecord')

  // No event at all in the period: nothing to count (spec 5.5).
  if (pastEvents + upcomingEvents === 0) {
    return (
      <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatTile label={t('statsPage.numbers.rate')} value="–" />
        <StatTile label={t('statsPage.numbers.events')} value="–" />
        <StatTile label={t('statsPage.numbers.absences')} value="–" />
        <StatTile label={t('statsPage.numbers.newcomers')} value="–" />
      </dl>
    )
  }

  return (
    <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      <StatTile
        label={t('statsPage.numbers.rate')}
        value={format.rate(rate)}
        detail={rate === null ? noRecord : t('statsPage.numbers.rateDetail')}
      />
      <StatTile
        label={t('statsPage.numbers.events')}
        value={format.number(pastEvents)}
        detail={t('statsPage.numbers.eventsDetail', { count: pastEvents, upcoming: format.number(upcomingEvents) })}
      />
      <StatTile
        label={t('statsPage.numbers.absences')}
        value={expected > 0 ? format.number(absences) : '–'}
        detail={expected > 0 ? t('statsPage.numbers.absencesDetail', { expected: format.number(expected) }) : noRecord}
        tone={absences > 0 ? 'text-danger' : undefined}
      />
      <StatTile
        label={t('statsPage.numbers.newcomers')}
        value={format.signed(newcomers)}
        detail={t('statsPage.numbers.newcomersDetail', { total: format.number(total) })}
      />
    </dl>
  )
}
