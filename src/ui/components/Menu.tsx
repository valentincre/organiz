import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Popover } from './Popover'
import { button, cx } from './styles'
import { CheckIcon } from './icons'

export interface MenuItem {
  label: string
  onSelect: () => void
  /** Set for a choice among several (a radio item). */
  checked?: boolean
  disabled?: boolean
  /** Draws a line above the item. */
  separated?: boolean
}

interface Props {
  /** Accessible name, also the tooltip. */
  label: string
  icon: ReactNode
  /** Visible text next to the icon, hidden on phones. */
  text?: string
  /** Optional heading inside the menu. */
  heading?: string
  items: MenuItem[]
  active?: boolean
}

/** A button that opens a small list of actions or choices below it, aligned on its right edge. */
export function Menu({ label, icon, text, heading, items, active = false }: Props) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const entries = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')]
    if (entries.length === 0) return
    event.preventDefault()
    const index = entries.indexOf(document.activeElement as HTMLButtonElement)
    entries[(index + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length].focus()
  }

  return (
    <div className="shrink-0">
      <button
        ref={trigger}
        type="button"
        className={cx(button(open || active ? 'active' : 'default'), text ? 'px-3 max-sm:w-10 max-sm:px-0' : 'w-10 px-0')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={text ? undefined : label}
        title={label}
        onClick={() => setOpen(!open)}
      >
        {icon}
        {text && <span className="max-sm:sr-only">{text}</span>}
      </button>
      {open && (
        <Popover anchor={trigger} onClose={() => setOpen(false)} role="menu" label={label} id={id} className="min-w-56">
          {/* The popover lives at the end of the page, so arrow keys are handled inside it. */}
          <div onKeyDown={onKeyDown}>
            {heading && <p className="px-2.5 pt-1.5 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">{heading}</p>}
            {items.map((item) => (
              <div key={item.label}>
                {item.separated && <hr className="my-1 border-line" />}
                <button
                  type="button"
                  role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
                  aria-checked={item.checked}
                  disabled={item.disabled}
                  className={cx(
                    'flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2.5 text-left text-sm hover:bg-surface-muted focus-visible:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-55',
                    item.checked && 'text-accent',
                  )}
                  onClick={() => {
                    setOpen(false)
                    item.onSelect()
                  }}
                >
                  {item.checked !== undefined && (
                    <span className="inline-flex w-4 justify-center">{item.checked && <CheckIcon small />}</span>
                  )}
                  {item.label}
                </button>
              </div>
            ))}
          </div>
        </Popover>
      )}
    </div>
  )
}
