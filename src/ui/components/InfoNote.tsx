import type { ReactNode } from 'react'
import { InfoIcon } from './icons'
import { cx } from './styles'

/** A short explanation set apart from the content: an icon and a tinted box. */
export function InfoNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex gap-2 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-[13px] leading-snug', className)}>
      <span className="mt-px shrink-0 text-accent">
        <InfoIcon small />
      </span>
      <span>{children}</span>
    </div>
  )
}
