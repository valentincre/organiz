import { useMemo } from 'react'
import { noteFor, type PersonStats, type StatPeriod } from '../../domain/stats'
import type { DashboardState, IsoDate, PersonId } from '../../domain/types'
import { useI18n } from '../../i18n/context'
import { ChevronIcon } from '../components/icons'
import { cardFrame, cx } from '../components/styles'
import { PersonStatRow } from './PersonStatRow'
import { mostPresent } from './statsView'

interface Props {
  state: DashboardState
  /** The people listed for the period. */
  rows: PersonStats[]
  arrival: Map<PersonId, IsoDate>
  period: StatPeriod
  /** The people page, with the same period and filters. */
  seeAllHref: string
  /** Shown instead of the rows when nobody is listed. */
  emptyText: string
  onOpen: (personId: PersonId) => void
}

/** The most present people of the period, and the way to everyone. */
export function PeoplePreview({ state, rows, arrival, period, seeAllHref, emptyText, onOpen }: Props) {
  const { t, lang } = useI18n()
  const preview = useMemo(() => {
    const collator = new Intl.Collator(lang, { sensitivity: 'base', numeric: true })
    return mostPresent(state, rows, collator)
  }, [state, rows, lang])

  return (
    <section className={cx(cardFrame, 'overflow-hidden')}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 px-4 pt-3 pb-2">
        <h2 className="font-semibold">{t('statsPage.people.title')}</h2>
        {preview.length > 0 && <span className="text-sm text-muted">{t('statsPage.people.most')}</span>}
      </div>
      {preview.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted">{emptyText}</p>
      ) : (
        <>
          <ul className="divide-y divide-line border-t border-line">
            {preview.map((stats) => {
              const person = state.people[stats.personId]
              const since = arrival.get(stats.personId) ?? period.from
              return (
                <PersonStatRow
                  key={stats.personId}
                  name={person.name}
                  stats={stats}
                  note={noteFor(person, since, stats, period)}
                  onOpen={() => onOpen(stats.personId)}
                />
              )
            })}
          </ul>
          <a href={seeAllHref} className="flex min-h-touch items-center justify-between gap-2 border-t border-line px-4 text-sm text-accent no-underline hover:bg-surface-muted">
            {t('statsPage.people.seeAll', { count: rows.length })}
            <ChevronIcon direction="right" small />
          </a>
        </>
      )}
    </section>
  )
}
