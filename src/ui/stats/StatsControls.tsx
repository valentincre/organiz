import { useEffect, useRef } from 'react'
import type { Filter } from '../../domain/filters'
import { sortedProperties } from '../../domain/properties'
import { PERIOD_PRESETS, presetOf, presetPeriod } from '../../domain/statPeriod'
import type { StatPeriod } from '../../domain/stats'
import type { DashboardState, IsoDate } from '../../domain/types'
import { useI18n } from '../../i18n/context'
import { cx, input } from '../components/styles'
import { FilterBar } from '../properties/FilterBar'

interface FilterProps {
  filter: Filter
  onChange: (filter: Filter) => void
}

interface Props {
  state: DashboardState
  /** The resolved period: an inverted one is already swapped. */
  period: StatPeriod
  today: IsoDate
  onDates: (from: IsoDate | undefined, to: IsoDate | undefined) => void
  people: FilterProps
  events: FilterProps
}

/**
 * The period and the page filters, shared by the Statistics page and its people page.
 * Phones: both dates on one row, the presets on one row that scrolls sideways, the two
 * filters side by side when they fit. Wider screens: dates and presets on one row.
 */
export function StatsControls({ state, period, today, onDates, people, events }: Props) {
  const { t } = useI18n()
  const preset = presetOf(period, today)
  const dateLabel = 'grid min-w-0 flex-1 gap-1 text-xs font-medium text-muted sm:w-44 sm:flex-none'
  // Small text on phones: two dates side by side fit in 320 px, Firefox's field included.
  const dateInput = cx(input, 'min-w-0 text-sm sm:text-base')
  const presetRow = useRef<HTMLDivElement>(null)

  // Phones: bring the chosen preset into the row's view; only the row scrolls, never the page.
  useEffect(() => {
    const row = presetRow.current
    const pill = row?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (!row || !pill) return
    const box = row.getBoundingClientRect()
    const rect = pill.getBoundingClientRect()
    if (rect.left < box.left || rect.right > box.right) row.scrollLeft += rect.left - box.left - (box.width - rect.width) / 2
  }, [preset])

  return (
    <div className="space-y-3">
      <div className="space-y-3 sm:flex sm:flex-wrap sm:items-end sm:gap-x-4 sm:gap-y-3 sm:space-y-0">
        <div className="flex gap-2 sm:gap-3">
          <label className={dateLabel}>
            {t('range.from')}
            <input type="date" className={dateInput} value={period.from} onChange={(e) => onDates(e.target.value || undefined, period.to)} />
          </label>
          <label className={dateLabel}>
            {t('range.to')}
            <input type="date" className={dateInput} value={period.to} onChange={(e) => onDates(period.from, e.target.value || undefined)} />
          </label>
        </div>
        {/* One row on phones, scrolled sideways (the padding keeps the focus ring inside it); centred on the date fields on wider screens. */}
        <div
          ref={presetRow}
          role="group"
          aria-label={t('statsPage.presets')}
          className="flex gap-2 max-sm:-m-1 max-sm:overflow-x-auto max-sm:p-1 sm:flex-wrap sm:pb-1"
        >
          {PERIOD_PRESETS.map((id) => {
            const { from, to } = presetPeriod(id, today)
            return (
              <button
                key={id}
                type="button"
                aria-pressed={preset === id}
                className={cx(
                  'inline-flex min-h-8 shrink-0 cursor-pointer items-center rounded-full border px-3 text-sm whitespace-nowrap',
                  preset === id ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface hover:bg-surface-muted',
                )}
                onClick={() => onDates(from, to)}
              >
                {t(`statsPage.preset.${id}`)}
              </button>
            )
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <FilterBar
          properties={sortedProperties(state, 'person')}
          filter={people.filter}
          onChange={people.onChange}
          items={Object.values(state.people).map((person) => person.values)}
          leading={<span className="text-sm font-medium text-muted">{t('statsPage.peopleFilter')}</span>}
        />
        <FilterBar
          properties={sortedProperties(state, 'event')}
          filter={events.filter}
          onChange={events.onChange}
          items={Object.values(state.events).map((event) => event.values)}
          leading={<span className="text-sm font-medium text-muted">{t('statsPage.eventsFilter')}</span>}
        />
      </div>
    </div>
  )
}
