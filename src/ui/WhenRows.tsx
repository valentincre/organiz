import type { ReactNode } from 'react'
import type { Time } from '../domain/types'
import { useI18n } from '../i18n/context'
import { ChevronIcon } from './components/icons'
import { cx, inputBase } from './components/styles'
import { TimeCombobox } from './components/TimeCombobox'

/** A compact row led by an icon instead of a label. */
export function IconRow({ icon, children, className }: { icon: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-center gap-2.5', className)}>
      <span className="text-muted">{icon}</span>
      {children}
    </div>
  )
}

interface TimeRowProps {
  allDay: boolean
  onAllDayChange: (allDay: boolean) => void
  start: Time | ''
  end: Time | ''
  /** Called when a time field is left with a readable time (or emptied), with both times. */
  onTimesChange: (start: Time | '', end: Time | '') => void
  /** The times do not make a valid range. */
  invalid: boolean
}

/** "All day | Times" switch, followed by the start and end times when the event has times. */
export function TimeRow({ allDay, onAllDayChange, start, end, onTimesChange, invalid }: TimeRowProps) {
  const { t } = useI18n()
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
      <div className="inline-flex shrink-0 overflow-hidden rounded-md border border-line" role="group" aria-label={t('event.times')}>
        {([true, false] as const).map((value) => (
          <button
            key={String(value)}
            type="button"
            aria-pressed={allDay === value}
            className={cx(
              'min-h-10 cursor-pointer px-2 text-sm font-medium [&+&]:border-l [&+&]:border-line',
              allDay === value ? 'bg-accent-soft text-accent' : 'bg-surface text-muted hover:text-text',
            )}
            onClick={() => allDay !== value && onAllDayChange(value)}
          >
            {t(value ? 'event.allDayShort' : 'event.timesShort')}
          </button>
        ))}
      </div>
      {/* On narrow screens the times wrap below the switch rather than shrink. */}
      {!allDay && (
        <div className="flex min-w-32 flex-1 items-center gap-1.5">
          <TimeCombobox label={t('event.start')} value={start} invalid={invalid} onCommit={(value) => onTimesChange(value, end)} />
          <span className="text-muted" aria-hidden="true">
            –
          </span>
          <TimeCombobox
            label={t('event.end')}
            value={end}
            invalid={invalid}
            after={start || undefined}
            onCommit={(value) => onTimesChange(start, value)}
          />
        </div>
      )}
    </div>
  )
}

/** Field-like button that opens or closes the weekly repetition. */
export function RepeatToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { t } = useI18n()
  return (
    <button
      type="button"
      aria-expanded={open}
      className={cx(
        inputBase,
        'flex w-full cursor-pointer items-center justify-between text-left',
        open ? 'border-accent bg-accent-soft text-accent' : 'text-muted hover:text-text',
      )}
      onClick={onToggle}
    >
      {t(open ? 'event.repeatWeekly' : 'event.noRepeat')}
      <ChevronIcon direction={open ? 'down' : 'right'} small />
    </button>
  )
}
