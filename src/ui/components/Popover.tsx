import { useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { PopoverRoot } from './popoverRoot'
import { cx } from './styles'

interface Props {
  /** The element it opens under; focus goes back to it on Escape. */
  anchor: RefObject<HTMLElement | null>
  onClose: () => void
  /** Aligned on the anchor's left or right edge. */
  align?: 'start' | 'end'
  role?: 'menu' | 'dialog'
  label: string
  id?: string
  className?: string
  children: ReactNode
}

/**
 * A floating box under an element, shown in the browser's top layer, so no
 * sticky bar, scrolling box or list can paint over it, and attached to the
 * document's body so it never takes room in the page (or to the Dialog it is
 * in, see PopoverRoot: everything outside a modal dialog is inert). Rendered only while
 * open; follows its element when the page scrolls or the list below it
 * changes, and closes on a click outside or Escape.
 */
export function Popover({ anchor, onClose, align = 'end', role = 'dialog', label, id, className, children }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const dialog = useContext(PopoverRoot)
  const close = useRef(onClose)
  const place = useRef(() => {})
  useLayoutEffect(() => {
    close.current = onClose
    // Under the anchor and inside the screen; above it when there is no room below.
    place.current = () => {
      const element = box.current
      const target = anchor.current
      if (!element || !target) return
      const rect = target.getBoundingClientRect()
      // Gone from the page, or scrolled out of sight: nothing left to point at.
      if (!target.isConnected || rect.bottom < 0 || rect.top > window.innerHeight) return close.current()
      const preferred = align === 'end' ? rect.right - element.offsetWidth : rect.left
      const left = Math.max(8, Math.min(preferred, window.innerWidth - element.offsetWidth - 8))
      const below = rect.bottom + 4 + element.offsetHeight <= window.innerHeight - 8
      element.style.left = `${left}px`
      element.style.top = `${below ? rect.bottom + 4 : Math.max(8, rect.top - 4 - element.offsetHeight)}px`
    }
  })

  // Inside a modal dialog, in the dialog: everything outside it is inert. Known from the Dialog
  // itself, not from the anchor, whose ref is not set yet when both mount together (a new filter
  // pill that opens at once): the popover would then go to the body and could not be clicked.
  const [container] = useState<Element>(() => dialog?.current ?? document.body)

  useLayoutEffect(() => {
    box.current?.showPopover()
    place.current()
    box.current?.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled), [tabindex="0"]')?.focus()
  }, [container])

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target as Node
      if (!box.current?.contains(target) && !anchor.current?.contains(target)) close.current()
    }
    // Follow the anchor: scrolling, resizing, or the page getting shorter
    // when a filter hides rows, all move it.
    let frame = 0
    const follow = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => place.current())
    }
    const observer = new ResizeObserver(follow)
    observer.observe(document.body)
    if (box.current) observer.observe(box.current)
    document.addEventListener('pointerdown', outside)
    window.addEventListener('scroll', follow, true)
    window.addEventListener('resize', follow)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('scroll', follow, true)
      window.removeEventListener('resize', follow)
    }
  }, [anchor])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close.current()
      anchor.current?.focus()
    }
  }

  return createPortal(
    <div
      ref={box}
      id={id}
      popover="manual"
      role={role}
      aria-label={label}
      className={cx('fixed inset-auto m-0 rounded-lg border border-line bg-surface p-1 text-text shadow-lg', className)}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>,
    container,
  )
}
