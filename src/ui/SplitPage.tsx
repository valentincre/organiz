import { useState, type ReactNode } from 'react'
import { useCanEdit } from './canEdit'
import { BackIcon, ChevronIcon, PencilIcon } from './components/icons'
import { button, card, cx } from './components/styles'
import { useMediaQuery } from './useMediaQuery'

interface Props {
  back: { href: string; label: string }
  /** Name and subtitle, above the details. */
  header: ReactNode
  /** The editor of the item (an event, a person). */
  details: ReactNode
  /** Phones: what the folded details show, next to their title. */
  summary: ReactNode
  /** The attendance list on the right. */
  children: ReactNode
  /** Keeps the folded details open on phones, e.g. while a dialog opened from them is shown. */
  expanded?: boolean
}

/**
 * Page of one event or one person. Desktop: the item on the left, kept in
 * view (its details scroll on their own below the back link and the name,
 * then the page scrolls), the attendance list on the right. Phones: one
 * column, with the details folded under a summary.
 */
export function SplitPage({ back, header, details, summary, children, expanded = false }: Props) {
  const canEdit = useCanEdit()
  const wide = useMediaQuery('(min-width: 64rem)')
  const [open, setOpen] = useState(false)
  // Opened for a dialog, the details stay open once it closes, where the user left off.
  if (expanded && !open) setOpen(true)
  return (
    <div className="mx-auto max-w-2xl space-y-4 lg:grid lg:max-w-none lg:grid-cols-[24rem_minmax(0,1fr)] lg:items-start lg:gap-8 lg:space-y-0">
      <aside className="space-y-3 lg:sticky lg:top-4 lg:flex lg:max-h-[calc(100dvh-2rem)] lg:flex-col">
        <div className="space-y-3">
          <BackLink {...back} />
          {header}
        </div>
        <div className="lg:-mx-2 lg:min-h-0 lg:overflow-y-auto lg:px-2 lg:pb-2">
          {wide ? (
            <section className={card}>{details}</section>
          ) : (
            <details
              className="group rounded-lg border border-line bg-surface"
              open={open}
              onToggle={(e) => setOpen(e.currentTarget.open)}
            >
              <summary className="flex cursor-pointer list-none items-start gap-3 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">{summary}</span>
                {/* Says the summary opens an editor (the details, for readers); hidden once open. */}
                <span className="shrink-0 pt-0.5 text-muted group-open:hidden" aria-hidden="true">
                  {canEdit ? <PencilIcon small /> : <ChevronIcon direction="down" small />}
                </span>
              </summary>
              <div className="border-t border-line p-3">{details}</div>
            </details>
          )}
        </div>
      </aside>
      <div className="min-w-0 space-y-3">{children}</div>
    </div>
  )
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} className={cx(button(), 'gap-2 pl-2.5')}>
      <BackIcon small />
      {label}
    </a>
  )
}
