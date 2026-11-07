import { hasConflict } from '../../domain/replies'
import type { ReplyTrace } from '../../domain/types'
import { useI18n } from '../../i18n/context'
import { ChevronIcon, WarningIcon } from '../components/icons'
import { cx } from '../components/styles'
import { useReplyTime } from './useReplyTime'

interface Props {
  trace: ReplyTrace
  /** Editors: a conflict shows "2 different replies" instead, and this opens the conflict sheet. */
  onOpenConflict?: () => void
  conflictOpen?: boolean
  className?: string
}

/** Where a person's reply came from and when: "shared link · today 14:32", "entered by hand · Mon 9:15". */
export function ReplyTraceLine({ trace, onOpenConflict, conflictOpen = false, className }: Props) {
  const { t } = useI18n()
  const replyTime = useReplyTime()
  if (onOpenConflict && hasConflict(trace)) {
    return (
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={conflictOpen}
        className={cx(
          'inline-flex cursor-pointer items-center gap-1 py-1 text-left text-xs font-medium text-warning underline decoration-dotted underline-offset-4',
          className,
        )}
        onClick={onOpenConflict}
      >
        <WarningIcon small />
        {/* Its own span, so on a narrow row the label wraps left-aligned beside the icons. */}
        <span className="min-w-0 text-left">{t('replies.differentReplies', { count: (trace.others?.length ?? 0) + 1 })}</span>
        <ChevronIcon direction="right" small />
      </button>
    )
  }
  const via = t(trace.via === 'shared' ? 'replies.viaShared' : trace.via === 'personal' ? 'replies.viaPersonal' : 'replies.viaHand')
  return (
    <span className={cx('inline-block py-1 text-xs text-muted', className)}>
      {/* A trimmed trace (event over, no link left) only says where the reply came from. */}
      {trace.at === undefined ? via : `${via} · ${replyTime(trace.at)}`}
    </span>
  )
}
