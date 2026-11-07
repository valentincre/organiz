import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { matchesSearch } from '../../domain/matching'
import { sortedProperties } from '../../domain/properties'
import { noteFor, type PersonStats, type StatPeriod } from '../../domain/stats'
import type { DashboardState, IsoDate, PersonId } from '../../domain/types'
import { useI18n } from '../../i18n/context'
import { viewPath, type DashboardView } from '../../router'
import type { DashboardRef } from '../../storage/link'
import { SearchInput } from '../components/SearchInput'
import { cardFrame, cx, inputBase } from '../components/styles'
import { BackLink } from '../SplitPage'
import { PersonStatRow } from './PersonStatRow'
import { PersonStatsSheet } from './PersonStatsSheet'
import { sortPeopleRows } from './statsView'

type StatsView = Extract<DashboardView, { tab: 'stats' }>

interface Props {
  dashboardRef: DashboardRef
  state: DashboardState
  view: StatsView
  period: StatPeriod
  /** The people listed for the period (see listedPeople). */
  rows: PersonStats[]
  stats: Map<PersonId, PersonStats>
  arrival: Map<PersonId, IsoDate>
  /** The period and the page filters (StatsControls), the same as on the Statistics page. */
  controls: ReactNode
  /** Shown instead of the rows when nobody is listed. */
  emptyText: string
}

/** Everyone listed for the period, searchable and sortable, each row opening their sheet. */
export function StatsPeoplePage({ dashboardRef, state, view, period, rows, stats, arrival, controls, emptyText }: Props) {
  const { t, lang, formatDate } = useI18n()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('rate')
  const [openId, setOpenId] = useState<PersonId | null>(null)
  const open = openId === null ? undefined : stats.get(openId)
  const properties = sortedProperties(state, 'person')
  // Opened from the preview, far down the Statistics page: start at the top, where the period and filters are.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  const sorted = useMemo(() => sortPeopleRows(state, rows, sort, new Intl.Collator(lang, { sensitivity: 'base', numeric: true })), [state, rows, sort, lang])
  const visible = useMemo(() => sorted.filter((row) => matchesSearch(state.people[row.personId].name, query)), [sorted, state.people, query])
  // The same period and filters as the page it came from.
  const backHref = `#${viewPath(dashboardRef, { ...view, page: undefined, from: period.from, to: period.to })}`
  const date = (value: IsoDate) => formatDate(value, { dateStyle: 'medium' })

  return (
    <div className="space-y-4">
      <BackLink href={backHref} label={t('tabs.stats')} />
      <div>
        <h2 className="text-lg font-semibold">{t('statsPage.people.title')}</h2>
        <p className="text-sm text-muted">{t('statsPage.people.page.summary', { from: date(period.from), to: date(period.to), count: rows.length })}</p>
      </div>
      {controls}
      <div className="flex flex-wrap gap-2">
        <div className="min-w-48 flex-1">
          <SearchInput value={query} onChange={setQuery} label={t('people.search')} />
        </div>
        <select className={inputBase} aria-label={t('people.sort.label')} value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="rate">{t('statsPage.people.page.sortRate')}</option>
          <option value="name">{t('people.sort.name')}</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <section className={cx(cardFrame, 'overflow-hidden')}>
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-muted">{emptyText}</p>
        ) : visible.length === 0 ? (
          <p className="p-4 text-center text-sm text-muted">{t('people.noResults', { query })}</p>
        ) : (
          <ul className="divide-y divide-line">
            {visible.map((row) => {
              const person = state.people[row.personId]
              return (
                <PersonStatRow
                  key={row.personId}
                  name={person.name}
                  stats={row}
                  note={noteFor(person, arrival.get(row.personId) ?? period.from, row, period)}
                  onOpen={() => setOpenId(row.personId)}
                />
              )
            })}
          </ul>
        )}
      </section>
      {open && (
        <PersonStatsSheet
          state={state}
          personId={open.personId}
          stats={open}
          arrival={arrival.get(open.personId) ?? period.from}
          period={period}
          dashboardRef={dashboardRef}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  )
}
