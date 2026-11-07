import { useRef, type KeyboardEvent } from 'react'
import { useCanEdit } from '../canEdit'
import { cx } from './styles'

interface Option<T extends string> {
  value: T
  label: string
}

interface Props<T extends string> {
  value: T | null
  /** The positive choice first (green when selected), then the negative one (red). */
  options: readonly [Option<T>, Option<T>]
  /** Tapping the active option clears it (replies); otherwise it does nothing (presence). */
  clearable?: boolean
  /** Accessible group name: the person on an event page, the event on a person's page. */
  label: string
  /** The larger pill of a sheet or dialog, as wide as its container. */
  large?: boolean
  /** Shown but not usable, e.g. while a reply is being sent. */
  disabled?: boolean
  onChange: (value: T | null) => void
}

const selectedTone = ['bg-success-soft text-success', 'bg-danger-soft text-danger'] as const

/**
 * Two-choice segmented pill (Yes | No, Present | Absent) with the semantics of a radio group.
 * Readers only see the chosen option, as a label of the same color, and nothing when none is.
 */
export function ChoicePill<T extends string>({ value, options, clearable = false, label, large = false, disabled = false, onChange }: Props<T>) {
  const canEdit = useCanEdit()
  const group = useRef<HTMLDivElement>(null)
  const size = large ? 'h-11 flex-1 text-[15px]' : 'h-7 px-3 text-[13px]'

  if (!canEdit) {
    const index = options.findIndex((option) => option.value === value)
    if (index < 0) return null
    return (
      <span className={cx('inline-flex shrink-0 items-center justify-center rounded-full font-semibold', size, selectedTone[index])}>
        {options[index].label}
      </span>
    )
  }

  const choose = (option: Option<T>) => {
    if (option.value !== value) onChange(option.value)
    else if (clearable) onChange(null)
  }

  // Arrow keys move between the two options and choose, as in any radio group.
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    const other = 1 - index
    group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[other]?.focus()
    onChange(options[other].value)
  }

  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label={label}
      className={cx('flex shrink-0 overflow-hidden rounded-full border border-line', large ? 'w-full' : 'inline-flex')}
    >
      {options.map((option, index) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            // One tab stop per group: the chosen option, or the first when none is.
            tabIndex={selected || (value === null && index === 0) ? 0 : -1}
            className={cx(
              'cursor-pointer font-semibold select-none disabled:cursor-not-allowed disabled:opacity-55',
              size,
              index > 0 && 'border-l border-line',
              selected ? selectedTone[index] : 'text-muted hover:bg-surface-muted',
            )}
            onClick={() => choose(option)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
