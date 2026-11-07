import { useEffect, useId, useRef, useState } from 'react'
import { hasKey } from '../../domain/limits'
import { slugify } from '../../domain/matching'
import { revokePersonalLink } from '../../domain/personalLinks'
import type { DashboardState, Mutation, PersonId } from '../../domain/types'
import { useI18n } from '../../i18n/context'
import { Dialog } from '../components/Dialog'
import { CheckIcon, CopyIcon, DownloadIcon, LinkIcon, MoreIcon } from '../components/icons'
import { Menu, type MenuItem } from '../components/Menu'
import { button, cx } from '../components/styles'
import { useCopiedMark, useCopyLink } from '../useCopyLink'
import { usePersonalLinkCreation, useQrDownload } from './linkHooks'
import { personalLinkOf } from './personalActions'
import { QrImage } from './QrImage'

interface Props {
  state: DashboardState
  personId: PersonId
  /** Shows the name before the actions; off where the page already names the person. */
  withName?: boolean
  mutate: (mutation: Mutation) => void
}

/**
 * One person's personal link: "Create link" (creates and copies it), or when it
 * exists, when it was created, Copy, and ⋯ with Share, the QR code and Revoke.
 * The link shown is always the one the state has, i.e. the one that works now.
 */
export function PersonalLinkRow({ state, personId, withName = true, mutate }: Props) {
  const { t, lang } = useI18n()
  const nameId = useId()
  const name = hasKey(state.people, personId) ? state.people[personId].name : ''
  const link = personalLinkOf(state, personId, window.location.origin)
  const createdAt = link && state.personalLinks?.[personId]?.createdAt
  // Kept by link text: a link replaced by another organizer's, made at the same time, is never shown as copied.
  const [copiedLink, markCopied] = useCopiedMark<string>()
  const copied = link !== null && copiedLink === link
  const copy = useCopyLink(() => link && markCopied(link))
  const create = usePersonalLinkCreation(state, personId, mutate)
  const [qrOpen, setQrOpen] = useState(false)

  // Creating or revoking swaps the buttons: the focus goes to the new one rather than to the page.
  const action = useRef<HTMLButtonElement>(null)
  const refocus = useRef(false)
  useEffect(() => {
    if (!refocus.current) return
    refocus.current = false
    if (document.activeElement === null || document.activeElement === document.body) action.current?.focus()
  }, [link])

  const onCreate = async () => {
    refocus.current = true
    const created = await create()
    if (created?.copied) markCopied(created.link)
  }

  const revoke = () => {
    if (!window.confirm(t('personal.revokeConfirm', { name }))) return
    refocus.current = true
    mutate(revokePersonalLink(personId))
  }

  const items: MenuItem[] = link
    ? [
        // Rejects when the person closes the share sheet: nothing to report.
        ...(typeof navigator.share === 'function' ? [{ label: t('share.share'), onSelect: () => void navigator.share({ url: link }).catch(() => {}) }] : []),
        { label: t('personal.showQr'), onSelect: () => setQrOpen(true) },
        { label: t('personal.revoke'), onSelect: revoke, separated: true },
      ]
    : []

  return (
    <div className="flex min-h-touch flex-wrap items-center gap-x-3 gap-y-2 py-2">
      {(withName || createdAt) && (
        <span className="min-w-0 flex-1">
          {withName && (
            <span id={nameId} className="block [overflow-wrap:anywhere]">
              {name}
            </span>
          )}
          {createdAt && (
            <span className="block text-sm text-muted">
              {t('personal.createdOn', { date: new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' }).format(createdAt) })}
            </span>
          )}
        </span>
      )}
      {link ? (
        <div className="flex shrink-0 gap-2">
          <button ref={action} type="button" className={button()} aria-describedby={withName ? nameId : undefined} onClick={() => copy(link)}>
            {copied ? <CheckIcon small className="text-success" /> : <CopyIcon small />}
            {t(copied ? 'share.copiedButton' : 'replies.copy')}
          </button>
          <Menu label={t('sheet.more')} icon={<MoreIcon />} items={items} />
        </div>
      ) : (
        <button ref={action} type="button" className={cx(button(), 'shrink-0')} aria-describedby={withName ? nameId : undefined} onClick={onCreate}>
          <LinkIcon small />
          {t('personal.create')}
        </button>
      )}
      <p className="sr-only" role="status">
        {copied && t('replies.copied')}
      </p>
      {/* Closed with the link: revoked meanwhile, there is nothing left to show. */}
      <Dialog open={qrOpen && link !== null} onClose={() => setQrOpen(false)} title={t('personal.section')} closeLabel={t('replies.dismiss')} narrow>
        {link && <PersonalQr link={link} name={name} />}
      </Dialog>
    </div>
  )
}

/** The link's QR code, to show on a screen or print; the file is named after the person, never the link. */
function PersonalQr({ link, name }: { link: string; name: string }) {
  const { t } = useI18n()
  const [download, failed] = useQrDownload(link, `organiz-qr-personal-${slugify(name) || 'person'}.png`)
  return (
    <div className="space-y-3">
      <p className="text-center font-semibold [overflow-wrap:anywhere]">{name}</p>
      <QrImage link={link} alt={t('personal.section')} className="mx-auto w-full max-w-xs" />
      <button type="button" className={cx(button(), 'w-full')} onClick={download}>
        <DownloadIcon small />
        {t('replies.download')}
      </button>
      {failed && (
        <p className="text-sm text-danger" role="alert">
          {t('replies.qrFailed')}
        </p>
      )}
    </div>
  )
}
