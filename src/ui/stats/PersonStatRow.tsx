import type { PersonNote, PersonStats } from '../../domain/stats'
import { useI18n } from '../../i18n/context'
import { cx } from '../components/styles'
import { rateOf, rateTone } from './statsView'
import { useStatFormat } from './useStats'

interface Props {
  name: string
  stats: PersonStats
  note: PersonNote | null
  onOpen: () => void
}

const toneBar = { low: 'bg-danger', mid: 'bg-warning', high: 'bg-success' } as const

/** A person's attendance over the period: name, "present / expected", a note, a bar and the rate; opens their sheet. */
export function PersonStatRow({ name, stats, note, onOpen }: Props) {
  const { t, formatDate } = useI18n()
  const format = useStatFormat()
  const rate = rateOf(stats)
  const short = (date: string) => formatDate(date, { day: 'numeric', month: 'short' })
  const noteText =
    note === null
      ? null
      : note.kind === 'left'
        ? t('statsPage.note.left', { date: short(note.date) })
        : note.kind === 'arrived'
          ? t('statsPage.note.arrived', { date: short(note.date) })
          : note.kind === 'yesThenAbsent'
            ? t('statsPage.note.yesThenAbsent', { count: format.number(note.count) })
            : t(`statsPage.note.${note.kind}`)

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="grid min-h-touch w-full cursor-pointer grid-cols-[minmax(0,1fr)_4rem_2.75rem] items-center gap-3 px-4 py-2 text-left text-text hover:bg-surface-muted sm:grid-cols-[minmax(0,1fr)_10rem_3rem]"
      >
        <span className="min-w-0">
          <span className="block font-medium [overflow-wrap:anywhere]">{name}</span>
          <span className="block text-xs text-muted">
            <span aria-hidden="true" className="tabular-nums">
              {format.number(stats.present)} / {format.number(stats.expected)}
            </span>
            <span className="sr-only">{t('statsPage.row.presentOf', { present: format.number(stats.present), count: stats.expected })}</span>
            {noteText && ` · ${noteText}`}
          </span>
        </span>
        <span className="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
          <span className={cx('block h-full rounded-full', toneBar[rateTone(rate)])} style={{ width: `${rate * 100}%` }} />
        </span>
        <span className="text-right font-semibold tabular-nums">{format.rate(rate)}</span>
      </button>
    </li>
  )
}
