import { useEffect, useId, useRef, useState } from 'react'
import { closeShare } from '../../domain/shares'
import type { AppEvent, DashboardState, EventId, Mutation, ShareEntry, ShareId, Visibility } from '../../domain/types'
import { useI18n } from '../../i18n/context'
import { slugify } from '../../domain/matching'
import { buildReplyLink, demoReplyPath } from '../../storage/link'
import { generateOrganizerKeys } from '../../storage/shareCrypto'
import { Dialog } from '../components/Dialog'
import { CheckIcon, ChevronIcon, ClockIcon, CloseCircleIcon, CopyIcon, DownloadIcon, LinkIcon, LockIcon, ShareIcon, SpinnerIcon } from '../components/icons'
import { button, cx } from '../components/styles'
import { useCopiedMark, useCopyLink } from '../useCopyLink'
import { needsOrganizerKeys, openRepliesMutation, setVisibilityMutation } from './replyActions'
import { QrImage } from './QrImage'
import { useLinkCreation, useQrDownload } from './linkHooks'
import { PersonalLinksSheet } from './PersonalLinksSheet'

export interface ReplyPanelProps {
  state: DashboardState
  event: AppEvent & { id: EventId }
  /** The event's latest presence link, open or not. */
  share: [ShareId, ShareEntry] | undefined
  /** Whether that link still accepts replies. */
  isOpen: boolean
  /** A new link can only be requested before the event. */
  started: boolean
  mutate: (mutation: Mutation) => void
  /** The link was closed by hand. */
  onClosed: () => void
  /** The demo: its links open in this tab instead of being sent, and it has no personal links. */
  demo?: boolean
}

interface Props extends ReplyPanelProps {
  open: boolean
  onClose: () => void
}

/** The reply link's settings: a modal, a sheet from the bottom on phones. */
export function ReplySheet({ open, onClose, ...panel }: Props) {
  const { t } = useI18n()
  return (
    <Dialog open={open} onClose={onClose} title={t('replies.title')} closeLabel={t('replies.dismiss')} sheet>
      <ReplyPanel {...panel} />
    </Dialog>
  )
}

function ReplyPanel({ state, event, share, isOpen, started, mutate, onClosed, demo = false }: ReplyPanelProps) {
  const { t } = useI18n()
  // The link just copied, here so the mark outlives the creation form. Kept by id: a link
  // that lost to another organizer's, opened at the same time, is never marked as copied.
  const [copied, markCopied] = useCopiedMark<ShareId>()
  if (share && isOpen)
    return (
      <OpenLink
        state={state}
        event={event}
        share={share}
        copied={copied === share[0]}
        onCopied={() => markCopied(share[0])}
        mutate={mutate}
        onClosed={onClosed}
        demo={demo}
      />
    )
  return (
    <div className="space-y-4">
      {share && <p className="text-muted">{t('replies.closedNote')}</p>}
      {!started && <NewLink state={state} eventId={event.id} again={Boolean(share)} mutate={mutate} onCopied={markCopied} demo={demo} />}
      {!demo && <PersonalLinksEntry state={state} mutate={mutate} />}
    </div>
  )
}

/** "Personal links · n people", below the shared link: opens everyone's personal link. */
function PersonalLinksEntry({ state, mutate }: { state: DashboardState; mutate: (mutation: Mutation) => void }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const count = Object.keys(state.personalLinks ?? {}).length
  return (
    <div className="border-t border-line pt-2">
      <button
        type="button"
        className="-mx-2 flex min-h-touch w-[calc(100%+1rem)] cursor-pointer items-center gap-3 rounded-md px-2 text-left hover:bg-surface-muted"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <LockIcon small className="shrink-0 text-muted" />
        <span className="min-w-0 flex-1 font-medium">{t('personal.links')}</span>
        <span className="shrink-0 text-sm text-muted">{t('personal.count', { count })}</span>
        <ChevronIcon direction="right" small className="shrink-0 text-muted" />
      </button>
      <PersonalLinksSheet open={open} onClose={() => setOpen(false)} state={state} mutate={mutate} />
    </div>
  )
}

interface NewLinkProps {
  state: DashboardState
  eventId: EventId
  again: boolean
  mutate: (mutation: Mutation) => void
  /** The new link made it to the clipboard. */
  onCopied: (shareId: ShareId) => void
  /** The demo: the new link is not copied. */
  demo: boolean
}

/** Asks how replies are shown and whether the link closes by itself, then creates it and copies it. */
function NewLink({ state, eventId, again, mutate, onCopied, demo }: NewLinkProps) {
  const { t } = useI18n()
  const [visibility, setVisibility] = useState<Visibility>('public')
  const [autoClose, setAutoClose] = useState(true)
  const { busy, failed, create } = useLinkCreation({ state, eventId, kind: 'presence', mutate, onCopied, copy: !demo }, async (ids) => {
    // Only the first private link of the dashboard needs the organizers' key pair.
    const keys = needsOrganizerKeys(state, visibility) ? await generateOrganizerKeys() : undefined
    return openRepliesMutation(state, eventId, { visibility, autoClose }, ids, keys)
  })

  return (
    <div className="space-y-4">
      {again && <h3 className="font-semibold">{t('replies.again')}</h3>}
      <VisibilityChoice value={visibility} onChange={setVisibility} />
      <label className="flex cursor-pointer items-center gap-2">
        <input type="checkbox" className="size-4 accent-accent" checked={autoClose} onChange={(e) => setAutoClose(e.target.checked)} />
        {t('replies.autoClose')}
      </label>
      {failed && (
        <p className="text-sm text-danger" role="alert">
          {t('replies.failed')}
        </p>
      )}
      {/* Not disabled while busy: a disabled button drops the focus, and Escape no longer reaches the dialog. */}
      <button type="button" className={cx(button('primary'), 'w-full')} aria-busy={busy} onClick={create}>
        {busy && <SpinnerIcon small />}
        {t('replies.create')}
      </button>
    </div>
  )
}

interface OpenLinkProps {
  state: DashboardState
  event: AppEvent
  share: [ShareId, ShareEntry]
  /** The link was just copied, by its creation or by its Copy button. */
  copied: boolean
  onCopied: () => void
  mutate: (mutation: Mutation) => void
  onClosed: () => void
  /** The demo: a button to its reply page, in this tab, instead of the link to send. */
  demo: boolean
}

/** An open link: its visibility, when it closes, the link to send, and closing it. */
function OpenLink({ state, event, share: [shareId, share], copied, onCopied, mutate, onClosed, demo }: OpenLinkProps) {
  const { t } = useI18n()
  const [changing, setChanging] = useState(false)
  const linkId = useId()
  const link = buildReplyLink(shareId, share.key, window.location.origin)
  const [downloadQr, qrFailed] = useQrDownload(link, `organiz-qr-${slugify(event.name) || 'event'}-${event.date}.png`)

  const changeVisibility = async (visibility: Visibility) => {
    if (changing) return
    setChanging(true)
    try {
      const keys = needsOrganizerKeys(state, visibility) ? await generateOrganizerKeys() : undefined
      mutate(setVisibilityMutation(state, shareId, visibility, keys))
    } finally {
      setChanging(false)
    }
  }

  const close = () => {
    if (!window.confirm(t('replies.closeConfirm'))) return
    mutate(closeShare(shareId))
    onClosed()
  }

  return (
    <div className="space-y-4">
      <VisibilityChoice
        value={share.visibility}
        onChange={changeVisibility}
        // Those who replied were told their answer stays private.
        publicLocked={share.visibility === 'private' && share.replied === true}
      />
      <ClosingLine closesAt={share.closesAt} />
      <section className="space-y-2" aria-labelledby={linkId}>
        <h3 id={linkId} className="font-semibold">
          {t('replies.link')}
        </h3>
        {demo ? (
          <>
            <a href={`#${demoReplyPath(shareId, share.key)}`} className={cx(button('primary'), 'w-full sm:w-auto')}>
              <LinkIcon small />
              {t('replies.demoOpen')}
            </a>
            <p className="text-sm text-muted">{t('replies.demoHint')}</p>
          </>
        ) : (
          <>
            {/* Phones: link, QR code, then the buttons across the width. From sm: QR code, then link and buttons on one line. */}
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <div className="sm:order-1 sm:basis-full">
                <QrImage link={link} className="mx-auto w-44" />
              </div>
              <LinkField link={link} labelledBy={linkId} copied={copied} onCopied={onCopied} className="max-sm:order-first sm:order-2 sm:min-w-0 sm:flex-1" />
              <LinkButtons link={link} onDownload={downloadQr} className="sm:order-3" />
            </div>
            <LinkNotes qrFailed={qrFailed} copied={copied} />
          </>
        )}
      </section>
      {!demo && <PersonalLinksEntry state={state} mutate={mutate} />}
      <div className="border-t border-line pt-4">
        <button type="button" className={button('danger')} onClick={close}>
          <CloseCircleIcon small />
          {t('replies.closeReplies')}
        </button>
      </div>
    </div>
  )
}

/** When an open link closes: by itself at `closesAt`, or only by hand. */
export function ClosingLine({ closesAt }: { closesAt: number | null }) {
  const { t, lang } = useI18n()
  const closing =
    closesAt === null
      ? t('replies.staysOpen')
      : t('replies.closesAt', {
          date: new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short' }).format(closesAt),
          time: new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit' }).format(closesAt),
        })
  return (
    <p className="flex items-center gap-2 text-sm text-muted">
      <ClockIcon small />
      {closing}
    </p>
  )
}

interface LinkFieldProps {
  link: string
  /** The id of the text that names the field. */
  labelledBy: string
  /** The link was just copied, by its creation or by this button. */
  copied: boolean
  onCopied: () => void
  className?: string
}

/** The link in a read-only field, with its Copy button. Takes the focus when nothing has it (the form that had it is gone). */
export function LinkField({ link, labelledBy, copied, onCopied, className }: LinkFieldProps) {
  const { t } = useI18n()
  const copy = useCopyLink(onCopied)
  const copyButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (document.activeElement === null || document.activeElement === document.body) copyButton.current?.focus()
  }, [])
  return (
    // One field: the input and the button share a single border, with one line between them.
    <div className={cx('flex overflow-hidden rounded-md border border-line bg-surface', className)}>
      <input className="min-h-10 min-w-0 flex-1 bg-transparent px-2.5 py-1.5 font-mono text-sm text-text" aria-labelledby={labelledBy} readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
      <button
        ref={copyButton}
        type="button"
        className="inline-flex min-h-10 cursor-pointer items-center justify-center border-l border-line px-3 text-text hover:bg-surface-muted"
        aria-label={t(copied ? 'share.copiedButton' : 'replies.copy')}
        title={t(copied ? 'share.copiedButton' : 'replies.copy')}
        onClick={() => copy(link)}
      >
        {copied ? <CheckIcon small className="text-success" /> : <CopyIcon small />}
      </button>
    </div>
  )
}

/** Share (where the browser has a share sheet, phones mostly) and Download of the QR code; across the width on phones. */
export function LinkButtons({ link, onDownload, className }: { link: string; onDownload: () => void; className?: string }) {
  const { t } = useI18n()
  const canShare = typeof navigator.share === 'function'
  return (
    <div className={cx('flex gap-2 [&>*]:flex-1 sm:[&>*]:flex-none', className)}>
      {canShare && (
        // Rejects when the person closes the share sheet: nothing to report.
        <button type="button" className={button()} onClick={() => navigator.share({ url: link }).catch(() => {})}>
          <ShareIcon small />
          {t('share.share')}
        </button>
      )}
      <button type="button" className={button()} onClick={onDownload}>
        <DownloadIcon small />
        {t('replies.download')}
      </button>
    </div>
  )
}

/** Below the link: a failed QR download, and "Link copied" for screen readers. */
export function LinkNotes({ qrFailed, copied }: { qrFailed: boolean; copied: boolean }) {
  const { t } = useI18n()
  return (
    <>
      {qrFailed && (
        <p className="text-sm text-danger" role="alert">
          {t('replies.qrFailed')}
        </p>
      )}
      <p className="sr-only" role="status">
        {copied && t('replies.copied')}
      </p>
    </>
  )
}

interface ChoiceProps {
  value: Visibility
  onChange: (visibility: Visibility) => void
  /** Public can no longer be chosen. */
  publicLocked?: boolean
}

/** Public | Private as two radio cards, each with what it means for respondents. */
export function VisibilityChoice({ value, onChange, publicLocked = false }: ChoiceProps) {
  const { t } = useI18n()
  const name = useId()
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 font-medium">{t('replies.visibility')}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {(['public', 'private'] as const).map((option) => {
          const locked = option === 'public' && publicLocked
          return (
            <label
              key={option}
              className={cx(
                'flex gap-2 rounded-lg border p-2.5',
                value === option ? 'border-accent bg-accent-soft' : 'border-line',
                locked ? 'cursor-not-allowed opacity-70' : 'cursor-pointer',
              )}
            >
              <input
                type="radio"
                name={name}
                className="mt-1 accent-accent"
                checked={value === option}
                disabled={locked}
                onChange={() => onChange(option)}
              />
              <span>
                <span className="block font-medium">{t(option === 'public' ? 'replies.public' : 'replies.private')}</span>
                <span className="block text-sm text-muted">
                  {locked ? t('replies.repliedPrivately') : t(option === 'public' ? 'replies.publicHint' : 'replies.privateHint')}
                </span>
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
