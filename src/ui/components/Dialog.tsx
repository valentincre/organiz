import { useEffect, useId, useRef, type ReactNode } from 'react'
import { CloseIcon } from './icons'
import { PopoverRoot } from './popoverRoot'
import { cx } from './styles'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  closeLabel: string
  /** Phones: slides up from the bottom edge, full width, instead of floating in the middle. */
  sheet?: boolean
  /** A small box, for a few lines or a picture. */
  narrow?: boolean
  /** Actions kept at the bottom, outside the scrolling content. */
  footer?: ReactNode
  children: ReactNode
}

/** Modal built on the native <dialog>: focus trap, Escape and backdrop come for free. */
export function Dialog({ open, onClose, title, closeLabel, sheet = false, narrow = false, footer, children }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  // Unique: a dialog can open over another one.
  const titleId = useId()

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (open && !element.open) element.showModal()
    if (!open && element.open) element.close()
  }, [open])

  return (
    <dialog
      ref={dialog}
      // React passes a nested dialog's close up to this one: only its own closing counts.
      onClose={(event) => event.target === event.currentTarget && onClose()}
      aria-labelledby={titleId}
      className={cx(
        'm-auto max-h-[92vh] w-[calc(100%-1.5rem)] rounded-xl border border-line bg-surface p-0 text-text shadow-2xl backdrop:bg-black/50',
        narrow ? 'max-w-sm' : 'max-w-2xl',
        sheet && 'max-sm:mb-0 max-sm:w-full max-sm:max-w-none max-sm:rounded-b-none',
      )}
    >
      {open && (
        <div className="flex max-h-[92vh] flex-col">
          <div className="flex items-center gap-2 border-b border-line px-5 py-3">
            <h2 id={titleId} className="mr-auto text-lg font-semibold">
              {title}
            </h2>
            <button
              type="button"
              className="inline-flex size-9 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-surface-muted hover:text-text"
              aria-label={closeLabel}
              onClick={onClose}
            >
              <CloseIcon />
            </button>
          </div>
          {/* Popovers opened inside go in the dialog: everything outside a modal dialog is inert. */}
          <PopoverRoot value={dialog}>
            <div className="overflow-y-auto px-5 py-4">{children}</div>
            {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
          </PopoverRoot>
        </div>
      )}
    </dialog>
  )
}
