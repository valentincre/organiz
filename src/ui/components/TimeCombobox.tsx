import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { parseTime } from '../../domain/dates'
import { toMinutes } from '../../domain/dayLayout'
import type { Time } from '../../domain/types'
import { useI18n } from '../../i18n/context'
import { formatDuration, formatTime } from '../eventFormat'
import { cx, inputBase } from './styles'

/** Minutes between two suggested times. */
const STEP = 15
const DAY = 24 * 60
/** Height of the list, to open it upwards when there is no room below. */
const LIST_HEIGHT = 240
/** Widest list, with durations. */
const LIST_WIDTH = 170

const toTime = (minutes: number): Time =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

interface Props {
  label: string
  value: Time | ''
  invalid: boolean
  /** Called with a readable time, or '' when the field is emptied. */
  onCommit: (value: Time | '') => void
  /** For an end time: suggestions start after this time and show the duration. */
  after?: Time
  className?: string
}

/**
 * A time field with a list of suggested times, like calendar apps: native
 * time inputs look different in every browser and some add an icon that does
 * not fit a compact row. Any typed time ("18h30", "1830", "6:30 pm") works too.
 */
export function TimeCombobox({ label, value, invalid, onCommit, after, className }: Props) {
  const { lang } = useI18n()
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [position, setPosition] = useState<CSSProperties>({})

  const options = useMemo(() => {
    const startAt = after ? toMinutes(after) : -STEP
    const result: { time: Time; label: string; duration?: string }[] = []
    for (let minutes = startAt + STEP; minutes < DAY; minutes += STEP) {
      const time = toTime(minutes)
      result.push({ time, label: formatTime(lang, time), duration: after ? formatDuration(lang, minutes - startAt) : undefined })
    }
    return result
  }, [after, lang])

  const unreadable = draft !== null && draft.trim() !== '' && parseTime(draft) === null
  /** The first suggestion at or after a time, else the last one. */
  const indexFor = (time: Time | null) => {
    if (!time) return -1
    const index = options.findIndex((option) => option.time >= time)
    return index === -1 ? options.length - 1 : index
  }

  const openList = () => {
    const rect = input.current?.getBoundingClientRect()
    if (!rect) return
    // Fixed, so the list is not cut by a scrolling column; upwards when there is no room below.
    const below = window.innerHeight - rect.bottom > LIST_HEIGHT + 8 || rect.top < LIST_HEIGHT + 8
    // Aligned on the field's right edge when a list as wide as LIST_WIDTH would leave the screen.
    const fitsRight = rect.left + LIST_WIDTH <= window.innerWidth - 8
    setPosition({
      ...(fitsRight ? { left: rect.left } : { right: window.innerWidth - rect.right }),
      minWidth: rect.width,
      ...(below ? { top: rect.bottom + 4 } : { bottom: window.innerHeight - rect.top + 4 }),
    })
    setActive(indexFor(value || (after ? null : '18:00')))
    setOpen(true)
  }

  // Keep the active suggestion in view.
  useEffect(() => {
    if (!open || active < 0) return
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  // A fixed list would drift away from its field: close it when anything else scrolls.
  useEffect(() => {
    if (!open) return
    const close = (event: Event) => event.target !== list.current && setOpen(false)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  const commitText = () => {
    if (draft === null || unreadable) return
    onCommit(draft.trim() === '' ? '' : parseTime(draft)!)
    setDraft(null)
  }

  const select = (time: Time) => {
    setDraft(null)
    setOpen(false)
    onCommit(time)
  }

  const move = (step: number) => {
    if (!open) return openList()
    const next = Math.min(options.length - 1, Math.max(0, active + step))
    setActive(next)
    setDraft(options[next].label)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      move(event.key === 'ArrowDown' ? 1 : -1)
    } else if (event.key === 'Enter') {
      // Never submit the surrounding form from here.
      event.preventDefault()
      commitText()
      setOpen(false)
    } else if (event.key === 'Escape' && open) {
      event.preventDefault()
      setDraft(null)
      setOpen(false)
    }
  }

  return (
    <>
      <input
        ref={input}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
        aria-invalid={invalid || unreadable}
        autoComplete="off"
        maxLength={12}
        className={cx(inputBase, 'w-full min-w-0 max-w-24 px-1.5 text-center', (invalid || unreadable) && 'border-danger', className)}
        value={draft ?? (value ? formatTime(lang, value) : '')}
        onFocus={openList}
        onClick={() => !open && openList()}
        onChange={(e) => {
          setDraft(e.target.value)
          const typed = parseTime(e.target.value)
          if (typed) setActive(indexFor(typed))
          if (!open) openList()
        }}
        onBlur={() => {
          commitText()
          setOpen(false)
        }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul
          ref={list}
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          style={{ ...position, maxHeight: LIST_HEIGHT }}
          className="fixed z-30 overflow-y-auto rounded-md border border-line bg-surface py-1 text-sm shadow-lg"
          // Keep the focus in the field while clicking a suggestion.
          onMouseDown={(e) => e.preventDefault()}
        >
          {options.map((option, index) => (
            <li
              key={option.time}
              id={`${id}-${index}`}
              data-index={index}
              role="option"
              aria-selected={option.time === value}
              className={cx(
                'flex cursor-pointer gap-3 px-3 py-1.5 whitespace-nowrap',
                index === active && 'bg-accent-soft text-accent',
                option.time === value && 'font-semibold',
              )}
              onMouseEnter={() => setActive(index)}
              onClick={() => select(option.time)}
            >
              <span>{option.label}</span>
              {option.duration && <span className="ml-auto text-muted">{option.duration}</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
