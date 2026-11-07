import { useId, useState, type FormEvent } from 'react'
import { decodeFilter, encodeFilter, type Filter } from '../../domain/filters'
import { LIMITS } from '../../domain/limits'
import { filtersTooLong, isChartValid, parseSplit, splitKey, type PageStats } from '../../domain/statCharts'
import { sortedProperties } from '../../domain/properties'
import type { StatPeriod, StatScope } from '../../domain/stats'
import type { ChartShow, DashboardState, IsoDate, PropertyScope, StatChart } from '../../domain/types'
import { useI18n } from '../../i18n/context'
import type { MessageKey } from '../../i18n/en'
import { Dialog } from '../components/Dialog'
import { button, cx, input } from '../components/styles'
import { FilterBar } from '../properties/FilterBar'
import { ChartBody } from './ChartCard'
import { CHART_SHOWS, chartTitle } from './statsView'

type ChartChoices = Omit<StatChart, 'order'>

interface Props {
  state: DashboardState
  /** The chart being edited; a new one when absent. */
  chart?: ChartChoices
  period: StatPeriod
  scope: StatScope
  today: IsoDate
  page: PageStats
  emptyText: string | null
  onSave: (chart: ChartChoices) => void
  onClose: () => void
}

/** Adds or edits a composed chart: what it shows, how it is split, for whom, its name, with a live preview. */
export function ChartSheet({ state, chart, period, scope, today, page, emptyText, onSave, onClose }: Props) {
  const { t } = useI18n()
  const formId = useId()
  const [draft, setDraft] = useState<ChartChoices>(() =>
    // A split that no longer makes sense (its property changed kind) starts over as one number.
    chart
      ? {
          name: chart.name,
          show: chart.show,
          split: isChartValid(state, chart) ? chart.split : 'none',
          people: chart.people,
          events: chart.events,
        }
      : { show: 'rate', split: 'none' },
  )
  const peopleProperties = sortedProperties(state, 'person')
  const eventProperties = sortedProperties(state, 'event')
  const splittable = (of: PropertyScope) =>
    (of === 'person' ? peopleProperties : eventProperties).filter((p) => p.kind === 'choice' || p.kind === 'multi')
  const showEvents = draft.show !== 'newcomers' && eventProperties.length > 0
  const title = chartTitle(t, state, { ...draft, name: undefined })
  const tooLong = filtersTooLong(draft)

  const setShow = (show: ChartShow) =>
    // A split the new measure cannot take falls back to one number.
    setDraft({ ...draft, show, split: isChartValid(state, { show, split: draft.split }) ? draft.split : 'none' })
  const setFilter = (key: 'people' | 'events', filter: Filter) => setDraft({ ...draft, [key]: encodeFilter(filter) || undefined })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!tooLong) onSave({ ...draft, name: draft.name?.trim() || undefined })
  }
  const splitOption = (value: string, label: string) => (
    <option key={value} value={value} disabled={!isChartValid(state, { show: draft.show, split: parseSplit(value) })}>
      {label}
    </option>
  )

  return (
    <Dialog
      open
      onClose={onClose}
      title={t(chart ? 'statsPage.chart.editTitle' : 'statsPage.chart.add')}
      closeLabel={t('statsPage.sheet.close')}
      sheet
      footer={
        <>
          <button type="button" className={cx(button(), 'max-sm:flex-1')} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form={formId} disabled={tooLong} className={cx(button('primary'), 'max-sm:flex-1')}>
            {t(chart ? 'common.save' : 'statsPage.chart.addButton')}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium">
            {t('statsPage.chart.show')}
            <select className={input} value={draft.show} onChange={(e) => setShow(e.target.value as ChartShow)}>
              {CHART_SHOWS.map((show) => (
                <option key={show} value={show}>
                  {t(`chart.${show}` as MessageKey)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">
            {t('statsPage.chart.split')}
            <select className={input} value={splitKey(draft.split)} onChange={(e) => setDraft({ ...draft, split: parseSplit(e.target.value) })}>
              {splitOption('none', t('statsPage.chart.split.none'))}
              <optgroup label={t('statsPage.chart.split.time')}>
                {splitOption('month', t('statsPage.chart.split.month'))}
                {splitOption('week', t('statsPage.chart.split.week'))}
              </optgroup>
              {splittable('person').length > 0 && (
                <optgroup label={t('statsPage.chart.split.people')}>
                  {splittable('person').map((p) => splitOption(splitKey({ person: p.id }), p.name))}
                </optgroup>
              )}
              {splittable('event').length > 0 && (
                <optgroup label={t('statsPage.chart.split.events')}>
                  {splittable('event').map((p) => splitOption(splitKey({ event: p.id }), p.name))}
                </optgroup>
              )}
            </select>
          </label>
        </div>

        {(peopleProperties.length > 0 || showEvents) && (
          <div className="space-y-2">
            <p className="text-sm font-medium">
              {t('statsPage.chart.for')} <span className="font-normal text-muted">· {t('statsPage.chart.forHint')}</span>
            </p>
            <FilterBar
              properties={peopleProperties}
              filter={decodeFilter(draft.people, state.personProperties)}
              onChange={(filter) => setFilter('people', filter)}
              items={Object.values(state.people).map((person) => person.values)}
              leading={<span className="text-sm text-muted">{t('statsPage.peopleFilter')}</span>}
            />
            {showEvents && (
              <FilterBar
                properties={eventProperties}
                filter={decodeFilter(draft.events, state.eventProperties)}
                onChange={(filter) => setFilter('events', filter)}
                items={Object.values(state.events).map((event) => event.values)}
                leading={<span className="text-sm text-muted">{t('statsPage.eventsFilter')}</span>}
              />
            )}
            {tooLong && (
              <p className="text-sm text-danger" role="alert">
                {t('statsPage.chart.filtersTooLong')}
              </p>
            )}
          </div>
        )}

        <label className="grid gap-1 text-sm font-medium">
          {t('statsPage.chart.name')}
          <input
            className={input}
            value={draft.name ?? ''}
            maxLength={LIMITS.chartName}
            placeholder={title}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>

        <div className="space-y-2">
          <p className="text-sm font-medium">{t('statsPage.chart.preview')}</p>
          <div className="rounded-lg border border-line p-3">
            <p className="mb-3 font-semibold [overflow-wrap:anywhere]">{draft.name?.trim() || title}</p>
            <ChartBody
              state={state}
              chart={draft}
              period={period}
              scope={scope}
              today={today}
              page={page}
              title={draft.name?.trim() || title}
              emptyText={emptyText}
            />
          </div>
        </div>
      </form>
    </Dialog>
  )
}
