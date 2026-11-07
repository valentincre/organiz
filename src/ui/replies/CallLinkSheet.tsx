import { useId, useState } from 'react'
import { slugify } from '../../domain/matching'
import { callVisibilityFor, closeShare, closesAtFor } from '../../domain/shares'
import type { AppEvent, DashboardState, EventId, Mutation, ShareEntry, ShareId, Visibility } from '../../domain/types'
import { useI18n } from '../../i18n/context'
import { buildReplyLink } from '../../storage/link'
import { generateOrganizerKeys } from '../../storage/shareCrypto'
import { Dialog } from '../components/Dialog'
import { CloseCircleIcon, SpinnerIcon } from '../components/icons'
import { button, cx } from '../components/styles'
import { eventTime, eventTitle } from '../eventFormat'
import { useCopiedMark } from '../useCopyLink'
import { needsOrganizerKeys, openCallLinkMutation } from './replyActions'
import { ClosingLine, LinkButtons, LinkField, LinkNotes, VisibilityChoice } from './ReplySheet'
import { QrImage } from './QrImage'
import { useLinkCreation, useOpenCallLink, useQrDownload } from './linkHooks'
import { useNowPassing } from './useNowPassing'

type EventWithId = AppEvent & { id: EventId }

interface Props {
  open: boolean
  onClose: () => void
  state: DashboardState
  event: EventWithId
  mutate: (mutation: Mutation) => void
}

/** The roll-call QR code people scan to check in: a modal, a sheet from the bottom on phones. */
export function CallLinkSheet({ open, onClose, ...panel }: Props) {
  const { t } = useI18n()
  return (
    <Dialog open={open} onClose={onClose} title={t('callLink.title')} closeLabel={t('replies.dismiss')} sheet>
      <CallLinkPanel {...panel} onClosed={onClose} />
    </Dialog>
  )
}

interface PanelProps extends Omit<Props, 'open' | 'onClose'> {
  /** The link was closed by hand. */
  onClosed: () => void
}

function CallLinkPanel({ state, event, mutate, onClosed }: PanelProps) {
  // The link just copied, here so the mark outlives the creation form (see ReplySheet).
  const [copied, markCopied] = useCopiedMark<ShareId>()
  const share = useOpenCallLink(state, event.id)
  if (share)
    return <OpenCallLink event={event} share={share} copied={copied === share[0]} onCopied={() => markCopied(share[0])} mutate={mutate} onClosed={onClosed} />
  // A finished or closed link is not reopened: a new one is created, as after "Redo the roll call".
  return <NewCallLink state={state} event={event} mutate={mutate} onCopied={markCopied} />
}

interface NewCallLinkProps {
  state: DashboardState
  event: EventWithId
  mutate: (mutation: Mutation) => void
  onCopied: (shareId: ShareId) => void
}

/**
 * Who sees the check-ins (the replies' choice when the event has a presence
 * link) and whether the link closes at the end of the event; then creates the
 * link and copies it.
 */
function NewCallLink({ state, event, mutate, onCopied }: NewCallLinkProps) {
  const { t } = useI18n()
  const sameAsReplies = callVisibilityFor(state, event.id)
  const [chosen, setChosen] = useState<Visibility>('public')
  const visibility = sameAsReplies ?? chosen
  const [autoCloseChosen, setAutoClose] = useState(true)
  // Once the event is over, closing at its end would give a link closed at once: it stays open until Finish or closed by hand.
  const end = closesAtFor('call', event)
  const ended = useNowPassing([end]) >= end
  const autoClose = autoCloseChosen && !ended
  const { busy, failed, create } = useLinkCreation({ state, eventId: event.id, kind: 'call', mutate, onCopied }, async (ids) => {
    // Only the first private link of the dashboard needs the organizers' key pair.
    const keys = needsOrganizerKeys(state, visibility) ? await generateOrganizerKeys() : undefined
    return openCallLinkMutation(state, event.id, { visibility, autoClose }, ids, keys)
  })

  return (
    <div className="space-y-4">
      {sameAsReplies ? (
        <p>
          <span className="block font-medium">{t('replies.visibility')}</span>
          <span className="text-muted">
            {t('callLink.sameAsReplies', { visibility: t(sameAsReplies === 'private' ? 'replies.private' : 'replies.public') })}
          </span>
        </p>
      ) : (
        <VisibilityChoice value={chosen} onChange={setChosen} />
      )}
      {!ended && (
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" className="size-4 accent-accent" checked={autoCloseChosen} onChange={(e) => setAutoClose(e.target.checked)} />
          {t('callLink.autoClose')}
        </label>
      )}
      {failed && (
        <p className="text-sm text-danger" role="alert">
          {t('callLink.failed')}
        </p>
      )}
      {/* Not disabled while busy: a disabled button drops the focus, and Escape no longer reaches the dialog. */}
      <button type="button" className={cx(button('primary'), 'w-full')} aria-busy={busy} onClick={create}>
        {busy && <SpinnerIcon small />}
        {t('callLink.create')}
      </button>
    </div>
  )
}

interface OpenCallLinkProps {
  event: EventWithId
  share: [ShareId, ShareEntry]
  /** The link was just copied, by its creation or by its Copy button. */
  copied: boolean
  onCopied: () => void
  mutate: (mutation: Mutation) => void
  onClosed: () => void
}

/** The open link: a QR code large enough to scan from a screen held up, the link itself, and closing it. */
function OpenCallLink({ event, share: [shareId, share], copied, onCopied, mutate, onClosed }: OpenCallLinkProps) {
  const i18n = useI18n()
  const { t, formatDate } = i18n
  const scanId = useId()
  const link = buildReplyLink(shareId, share.key, window.location.origin)
  const [downloadQr, qrFailed] = useQrDownload(link, `organiz-qr-call-${slugify(event.name) || 'event'}-${event.date}.png`)

  // Check-ins already made stay in the overlay, and count when the call is finished.
  const close = () => {
    if (!window.confirm(t('callLink.closeConfirm'))) return
    mutate(closeShare(shareId))
    onClosed()
  }

  return (
    <div className="space-y-4">
      <div className="text-center leading-tight">
        <p className="font-semibold">{eventTitle(event, i18n)}</p>
        <p className="text-sm text-muted">
          {formatDate(event.date, { weekday: 'long', day: 'numeric', month: 'long' })} · {eventTime(event, i18n)}
        </p>
      </div>
      <section className="space-y-3" aria-labelledby={scanId}>
        <QrImage link={link} alt={t('callLink.open')} className="mx-auto w-full max-w-xs" />
        <h3 id={scanId} className="text-center text-lg font-semibold">
          {t('callLink.scan')}
        </h3>
        <div className="flex flex-col gap-2 sm:flex-row">
          <LinkField link={link} labelledBy={scanId} copied={copied} onCopied={onCopied} className="sm:min-w-0 sm:flex-1" />
          <LinkButtons link={link} onDownload={downloadQr} />
        </div>
        <LinkNotes qrFailed={qrFailed} copied={copied} />
      </section>
      <ClosingLine closesAt={share.closesAt} />
      <div className="border-t border-line pt-4">
        <button type="button" className={button('danger')} onClick={close}>
          <CloseCircleIcon small />
          {t('callLink.close')}
        </button>
      </div>
    </div>
  )
}
