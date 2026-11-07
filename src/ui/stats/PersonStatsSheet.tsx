import { sortedProperties } from '../../domain/properties'
import type { PersonStats, StatPeriod } from '../../domain/stats'
import type { DashboardState, IsoDate, PersonId } from '../../domain/types'
import { useI18n } from '../../i18n/context'
import { viewPath } from '../../router'
import type { DashboardRef } from '../../storage/link'
import { Dialog } from '../components/Dialog'
import { ChevronIcon } from '../components/icons'
import { cx } from '../components/styles'
import { ValueView } from '../properties/ValueView'
import { StatTile } from './StatNumbers'
import { useStatFormat } from './useStats'

interface Props {
  state: DashboardState
  personId: PersonId
  stats: PersonStats
  arrival: IsoDate
  period: StatPeriod
  dashboardRef: DashboardRef
  onClose: () => void
}

/** One person's numbers over the period, over the page: properties, arrival, rates and their expected events. */
export function PersonStatsSheet({ state, personId, stats, arrival, period, dashboardRef, onClose }: Props) {
  const { t, formatDate } = useI18n()
  const format = useStatFormat()
  const person = state.people[personId]
  const date = (value: IsoDate) => formatDate(value, { dateStyle: 'medium' })
  const of = (count: number, total: number) => t('statsPage.sheet.of', { count: format.number(count), total: format.number(total) })
  const properties = sortedProperties(state, 'person').filter((p) => person.values?.[p.id] !== undefined)

  return (
    <Dialog open onClose={onClose} title={person.name} closeLabel={t('statsPage.sheet.close')} sheet>
      <div className="space-y-4">
        <div className="space-y-2">
          {properties.length > 0 && (
            <p className="flex flex-wrap gap-x-3 gap-y-1">
              {properties.map((p) => (
                <ValueView key={p.id} defs={state.personProperties} propertyId={p.id} values={person.values} compact withName />
              ))}
            </p>
          )}
          <p className="text-sm text-muted">
            {t('statsPage.sheet.arrived', { date: date(arrival) })}
            {person.leftOn && ` · ${t('statsPage.sheet.left', { date: date(person.leftOn) })}`}
          </p>
          <p className="text-sm text-muted">
            {date(period.from)} – {date(period.to)} · {t('statsPage.sheet.counted', { count: stats.expected })}
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-2">
          <StatTile
            label={t('statsPage.sheet.present')}
            value={format.rate(stats.present / stats.expected)}
            detail={of(stats.present, stats.expected)}
            tone="text-success"
          />
          <StatTile
            label={t('statsPage.sheet.absent')}
            value={format.number(stats.absent)}
            detail={t('statsPage.sheet.absentDetail', { count: format.number(stats.yesThenAbsent) })}
            tone={stats.absent > 0 ? 'text-danger' : undefined}
          />
          <StatTile label={t('statsPage.sheet.replied')} value={format.rate(stats.replied / stats.expected)} detail={of(stats.replied, stats.expected)} />
          <StatTile
            label={t('statsPage.sheet.keptWord')}
            value={format.rate(stats.yesCalled > 0 ? stats.keptWord / stats.yesCalled : null)}
            detail={
              stats.yesCalled > 0
                ? t('statsPage.sheet.keptWordDetail', { kept: format.number(stats.keptWord), count: format.number(stats.yesCalled) })
                : t('statsPage.sheet.noYes')
            }
          />
        </dl>

        <div className="space-y-2">
          <div
            role="img"
            aria-label={t('statsPage.sheet.strip', { present: format.number(stats.present), absent: format.number(stats.absent) })}
            className="flex flex-wrap gap-1"
          >
            {stats.strip.map((item) => (
              <span
                key={item.eventId}
                title={`${date(item.date)} · ${t(item.present ? 'statsPage.sheet.legendPresent' : 'statsPage.sheet.legendAbsent')}`}
                className={cx('size-3.5 rounded-sm', item.present ? 'bg-success' : 'bg-danger')}
              />
            ))}
          </div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted" aria-hidden="true">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-success" />
              {t('statsPage.sheet.legendPresent')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-danger" />
              {t('statsPage.sheet.legendAbsent')}
            </span>
            <span className="ml-auto">{t('statsPage.sheet.oldestFirst')}</span>
          </p>
        </div>

        <a href={`#${viewPath(dashboardRef, { tab: 'person', personId })}`} className="inline-flex min-h-touch items-center gap-1 text-accent">
          {t('statsPage.sheet.openPage')}
          <ChevronIcon direction="right" small />
        </a>
      </div>
    </Dialog>
  )
}
