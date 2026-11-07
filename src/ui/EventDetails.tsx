import { useState } from 'react'
import { addDays, isValidIso, isValidTimeRange, weekdayOf } from '../domain/dates'
import { randomId } from '../domain/ids'
import { LIMITS } from '../domain/limits'
import {
  deleteEvent,
  deleteSeriesFrom,
  inSeriesScope,
  moveEvent,
  repeatDates,
  repeatEvent,
  setEventTime,
  type SeriesScope,
} from '../domain/mutations'
import { sortedProperties } from '../domain/properties'
import type { EventEntry } from '../domain/selectors'
import type { DashboardState, EventId, Mutation } from '../domain/types'
import { useI18n } from '../i18n/context'
import { useCanEdit } from './canEdit'
import { CalendarIcon, ClockIcon, InfoIcon, RepeatIcon, TagIcon } from './components/icons'
import { button, cx, inputBase } from './components/styles'
import { useToast } from './components/toast'
import { eventTitle } from './eventFormat'
import { ValuesEditor } from './properties/ValuesEditor'
import { RepeatFields } from './RepeatFields'
import { IconRow, RepeatToggle, TimeRow } from './WhenRows'

interface Props {
  state: DashboardState
  event: EventEntry
  /** A new event, not saved yet: there is nothing to delete. */
  draft?: boolean
  mutate: (mutation: Mutation) => void
  scope: SeriesScope
  onScopeChange: (scope: SeriesScope) => void
  /** Called before the event is deleted, to leave its page. */
  onDeleted: () => void
  /** Opens the event properties dialog (owned by the page, so it survives a layout change). */
  onManageProperties: () => void
}

/**
 * Date, times, series scope, properties and deletion of an event; each field is saved when changed or left.
 * Readers get the series and the properties as text: the date and times are in the page header.
 */
export function EventDetails({ state, event, draft, mutate, scope, onScopeChange, onDeleted, onManageProperties }: Props) {
  const i18n = useI18n()
  const { t } = i18n
  const canEdit = useCanEdit()
  const [dateDraft, setDateDraft] = useState<string | null>(null)
  const [timesDraft, setTimesDraft] = useState<{ start: string; end: string } | null>(null)
  const allDay = !event.start && !timesDraft
  const start = timesDraft?.start ?? event.start ?? ''
  const end = timesDraft?.end ?? event.end ?? ''
  const timesValid = start !== '' && isValidTimeRange(start, end || undefined)
  const apply = (change: (id: EventId) => Mutation) => mutate(inSeriesScope(event, scope, change))

  // Times are saved together once they make a valid range; until then they are kept as a draft.
  const changeTimes = (nextStart: string, nextEnd: string) => {
    if (nextStart !== '' && isValidTimeRange(nextStart, nextEnd || undefined)) {
      apply((id) => setEventTime(id, nextStart, nextEnd || undefined))
      setTimesDraft(null)
    } else {
      setTimesDraft({ start: nextStart, end: nextEnd })
    }
  }

  const remove = (following: boolean) => {
    const name = eventTitle(event, i18n)
    if (!window.confirm(t(following ? 'event.deleteFollowingConfirm' : 'event.deleteConfirm', { name }))) return
    onDeleted()
    mutate(following ? deleteSeriesFrom(event.seriesId!, event.date) : deleteEvent(event.id))
  }

  if (!canEdit) {
    return (
      <div className="space-y-5">
        {event.seriesId && (
          <IconRow icon={<RepeatIcon />}>
            <span className="text-muted">{t('event.inSeries')}</span>
          </IconRow>
        )}
        <section className="space-y-3">
          <h3 className="font-semibold">{t('event.properties')}</h3>
          {sortedProperties(state, 'event').length > 0 ? (
            <ValuesEditor state={state} scope="event" targetId={event.id} values={event.values} mutate={mutate} />
          ) : (
            <p className="text-sm text-muted">{t('event.noPropertiesRead')}</p>
          )}
        </section>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {event.seriesId && (
        <fieldset className="space-y-1 rounded-lg border border-line p-3 text-sm">
          <legend className="px-1 font-medium">{t('event.applyTo')}</legend>
          {(['one', 'following'] as const).map((value) => (
            <label key={value} className="flex min-h-8 cursor-pointer items-center gap-2">
              <input type="radio" name="scope" className="accent-accent" checked={scope === value} onChange={() => onScopeChange(value)} />
              {t(value === 'one' ? 'event.thisOne' : 'event.thisAndFollowing')}
            </label>
          ))}
          <p className="text-muted">{t('event.applyToHint')}</p>
        </fieldset>
      )}
      <section className="space-y-2.5">
        <h3 className="font-semibold">{t('event.when')}</h3>
        <IconRow icon={<CalendarIcon />}>
          <input
            type="date"
            className={cx(inputBase, 'min-w-0 flex-1')}
            aria-label={t('event.date')}
            required
            value={dateDraft ?? event.date}
            onChange={(e) => {
              setDateDraft(e.target.value)
              // Moving a date only moves this event, whatever the series scope.
              if (isValidIso(e.target.value)) mutate(moveEvent(event.id, e.target.value))
            }}
            onBlur={() => setDateDraft(null)}
          />
        </IconRow>
        <IconRow icon={<ClockIcon />}>
          <TimeRow
            allDay={allDay}
            onAllDayChange={(value) => {
              setTimesDraft(null)
              apply((id) => (value ? setEventTime(id) : setEventTime(id, '18:00', '19:00')))
            }}
            start={start}
            end={end}
            onTimesChange={changeTimes}
            invalid={!allDay && !timesValid}
          />
        </IconRow>
        {!allDay && !timesValid && (
          <p className="pl-7.5 text-sm text-danger" role="alert">
            {t(start === '' ? 'event.startRequired' : 'event.badTimes')}
          </p>
        )}
        {event.seriesId ? (
          <IconRow icon={<RepeatIcon />}>
            <span className="text-muted">{t('event.inSeries')}</span>
          </IconRow>
        ) : (
          <RepeatSection key={event.date} state={state} event={event} mutate={mutate} />
        )}
      </section>

      <section className="space-y-3 border-t border-line pt-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">{t('event.properties')}</h3>
          <button
            type="button"
            className={cx(button(), 'min-h-8 gap-1.5 px-2.5 text-sm')}
            title={t('event.propertiesButton')}
            onClick={onManageProperties}
          >
            <TagIcon small />
            {t('property.manage')}
          </button>
        </div>
        {sortedProperties(state, 'event').length > 0 ? (
          <ValuesEditor state={state} scope="event" targetId={event.id} values={event.values} mutate={mutate} apply={apply} />
        ) : (
          <p className="text-sm text-muted">{t('event.noProperties')}</p>
        )}
      </section>

      {draft && (
        <p className="flex items-start gap-2 rounded-lg border border-dashed border-accent/60 bg-accent-soft px-3 py-2 text-sm">
          <InfoIcon small className="mt-0.5" />
          {t('draft.notice')}
        </p>
      )}
      {!draft && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-4 text-sm">
          <button type="button" className="min-h-8 cursor-pointer text-danger underline-offset-2 hover:underline" onClick={() => remove(false)}>
            {t('event.delete')}
          </button>
          {event.seriesId && (
            <button type="button" className="min-h-8 cursor-pointer text-danger underline-offset-2 hover:underline" onClick={() => remove(true)}>
              {t('event.deleteFollowing')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** Repeats a lone event every week: an explicit action, since it creates many events at once. */
function RepeatSection({ state, event, mutate }: Pick<Props, 'state' | 'event' | 'mutate'>) {
  const { t } = useI18n()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [days, setDays] = useState(() => [weekdayOf(event.date)])
  const [until, setUntil] = useState(() => addDays(event.date, 7 * 12))
  // The event itself stays the first of the series; copies start the next day.
  const dates = repeatDates(addDays(event.date, 1), until, days)
  const fits = Object.keys(state.events).length + dates.length <= LIMITS.events

  const create = () => {
    mutate(repeatEvent(event.id, randomId(), dates.map((date) => ({ id: randomId(), date }))))
    toast(t('event.repeatDone', { count: dates.length }))
    setOpen(false)
  }

  return (
    <>
      <IconRow icon={<RepeatIcon />}>
        <RepeatToggle open={open} onToggle={() => setOpen(!open)} />
      </IconRow>
      {open && (
        <div className="space-y-2.5 pl-7.5">
          <RepeatFields
            from={event.date}
            days={days}
            onDaysChange={setDays}
            until={until}
            onUntilChange={setUntil}
            dates={dates}
            summary={(count, last) => t('event.repeatCopies', { count, last })}
          />
          <button type="button" className={cx(button('primary'), 'w-full')} disabled={dates.length === 0 || !fits} onClick={create}>
            {t('event.repeatCreate', { count: dates.length })}
          </button>
        </div>
      )}
    </>
  )
}
