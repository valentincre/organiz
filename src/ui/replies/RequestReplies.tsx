import { useState } from 'react'
import { hasStarted } from '../../domain/attendance'
import { newReplies } from '../../domain/replies'
import { closesAtFor, isShareOpen, sharesOf } from '../../domain/shares'
import type { AppEvent, DashboardState, EventId, Mutation } from '../../domain/types'
import { useI18n } from '../../i18n/context'
import { isDemoRef, type DashboardRef } from '../../storage/link'
import { useCanEdit } from '../canEdit'
import { ChevronIcon, LinkIcon } from '../components/icons'
import { button, cx } from '../components/styles'
import { ReplySheet } from './ReplySheet'
import { useNowPassing } from './useNowPassing'

interface Props {
  dashboardRef: DashboardRef
  state: DashboardState
  event: AppEvent & { id: EventId }
  mutate: (mutation: Mutation) => void
}

/**
 * Below the event's title: "Request replies" before the event, then a summary
 * row of its reply link that opens the link's settings. Editors only; the demo's
 * links work in its tab only.
 */
export function RequestReplies({ dashboardRef, ...props }: Props) {
  const canEdit = useCanEdit()
  if (!canEdit) return null
  return <RepliesRow {...props} demo={isDemoRef(dashboardRef)} />
}

function RepliesRow({ state, event, mutate, demo }: Omit<Props, 'dashboardRef'> & { demo: boolean }) {
  const { t } = useI18n()
  const [sheetOpen, setSheetOpen] = useState(false)
  const presence = sharesOf(state, event.id).filter(([, share]) => share.kind === 'presence')
  // The event's start (when it is "started") and each link's closing time change what is shown.
  const now = useNowPassing([closesAtFor('presence', event), ...presence.map(([, share]) => share.closesAt)])
  const open = presence.find(([, share]) => isShareOpen(share, now))
  const latest = open ?? presence.reduce<(typeof presence)[number] | undefined>((last, entry) => (!last || entry[1].createdAt > last[1].createdAt ? entry : last), undefined)
  const started = hasStarted(event, new Date(now))

  // Replies are asked before the event; once it has started the roll call takes over.
  if (!latest && started) return null

  const fresh = newReplies(event).length
  const label = !latest
    ? null
    : open
      ? [t('replies.open'), t(open[1].visibility === 'private' ? 'replies.private' : 'replies.public'), fresh > 0 && t('replies.new', { count: fresh })]
          .filter(Boolean)
          .join(' · ')
      : t('replies.closed')

  return (
    <div className="mt-2">
      <button
        type="button"
        className={cx(button(), 'max-w-full')}
        aria-haspopup="dialog"
        onClick={() => setSheetOpen(true)}
      >
        {label === null ? (
          <>
            <LinkIcon small />
            {t('replies.request')}
          </>
        ) : (
          <>
            <span aria-hidden="true" className={cx('size-2 shrink-0 rounded-full', open ? 'bg-success' : 'bg-muted')} />
            <span className={cx('truncate', !open && 'text-muted')}>{label}</span>
            <ChevronIcon direction="down" small className="text-muted" />
          </>
        )}
      </button>
      <ReplySheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        state={state}
        event={event}
        share={latest}
        isOpen={Boolean(open)}
        started={started}
        mutate={mutate}
        onClosed={() => setSheetOpen(false)}
        demo={demo}
      />
    </div>
  )
}
