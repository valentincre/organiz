import type { EventTally } from '../domain/attendance'
import { useI18n } from '../i18n/context'
import { CheckIcon } from './components/icons'
import { cx } from './components/styles'

interface Props {
  tally: EventTally
  /** Everyone on the dashboard. */
  total: number
  className?: string
}

/**
 * What an event shows in a list: the replies of an upcoming event ("✓ 9 yes ·
 * 2 no"), or "20 / 30" with a bar: pale for the "yes" of an event not called
 * yet, full for the people present after a call.
 */
export function AttendanceBar({ tally, total, className }: Props) {
  const { t } = useI18n()
  if (tally.kind === 'replies') {
    // Nobody replied yet: nothing to count.
    if (tally.yes === 0 && tally.no === 0) {
      return <span className={cx('rounded-full border border-line px-2 py-0.5 text-xs whitespace-nowrap text-muted', className)}>{t('events.upcomingTag')}</span>
    }
    return (
      <span className={cx('flex items-center gap-1.5 text-sm whitespace-nowrap', className)}>
        <span className="text-success">
          <CheckIcon small />
        </span>
        <span className="font-semibold tabular-nums">{tally.yes}</span>
        <span className="text-muted tabular-nums">{t('events.repliesTail', { count: tally.yes, no: tally.no })}</span>
      </span>
    )
  }
  const expected = tally.kind === 'expected'
  const { count } = tally
  const text = t(expected ? 'events.expected' : 'events.attendance', { count, total })
  const ratio = total > 0 ? Math.min(1, count / total) : 0
  return (
    <span className={cx('flex items-center gap-2 text-sm whitespace-nowrap', className)}>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-line" aria-hidden="true">
        <span className={cx('block h-full rounded-full', expected ? 'bg-success/40' : 'bg-success')} style={{ width: `${ratio * 100}%` }} />
      </span>
      <span className="text-muted tabular-nums">{text}</span>
    </span>
  )
}

/** "no roll call" next to an event that is past or today and was never called. */
export function NoCallTag({ tally }: { tally: EventTally }) {
  const { t } = useI18n()
  return tally.kind === 'expected' ? <span className="text-warning"> · {t('events.noCall')}</span> : null
}
