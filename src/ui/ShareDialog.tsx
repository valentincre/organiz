import { useId, type ReactNode } from 'react'
import { useI18n } from '../i18n/context'
import type { Access } from '../storage/link'
import { Dialog } from './components/Dialog'
import { CheckIcon, LinkIcon, LockIcon, PencilIcon, ShareIcon } from './components/icons'
import { button, cx, input } from './components/styles'
import { useCopiedMark, useCopyLink } from './useCopyLink'

interface Props {
  open: boolean
  onClose: () => void
  editLink: string
  readLink: string
}

/** The editors' Share button: the edit link and the read-only link, each to copy or to send. */
export function ShareDialog({ open, onClose, editLink, readLink }: Props) {
  const { t } = useI18n()
  return (
    <Dialog open={open} onClose={onClose} title={t('share.title')} closeLabel={t('share.close')}>
      <div className="space-y-5">
        <LinkSection icon={<PencilIcon small />} title={t('share.editLink')} hint={t('share.editHint')} link={editLink} access="edit" />
        <div className="border-t border-line pt-5">
          <LinkSection icon={<LockIcon small />} title={t('share.readLink')} hint={t('share.readHint')} link={readLink} access="read" />
        </div>
      </div>
    </Dialog>
  )
}

interface SectionProps {
  icon: ReactNode
  title: string
  hint: string
  link: string
  access: Access
}

function LinkSection({ icon, title, hint, link, access }: SectionProps) {
  const { t } = useI18n()
  // Confirmed here: the page's toast would sit under the modal's backdrop.
  const [copiedMark, markCopied] = useCopiedMark<true>()
  const copied = copiedMark !== null
  const copy = useCopyLink(() => markCopied(true))
  const titleId = useId()
  // The system share sheet where the browser has one (phones mostly); elsewhere only the copy is offered.
  const canShare = typeof navigator.share === 'function'

  return (
    <section className="space-y-2" aria-labelledby={titleId}>
      <div>
        <h3 id={titleId} className="flex items-center gap-2 font-semibold">
          {icon}
          {title}
        </h3>
        <p className="text-sm text-muted">{hint}</p>
      </div>
      <input
        className={cx(input, 'font-mono text-sm')}
        aria-labelledby={titleId}
        readOnly
        value={link}
        onFocus={(e) => e.currentTarget.select()}
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button()} aria-describedby={titleId} onClick={() => copy(link, access)}>
          {copied ? <CheckIcon small className="text-success" /> : <LinkIcon small />}
          {t(copied ? 'share.copiedButton' : 'share.copy')}
        </button>
        {canShare && (
          <button
            type="button"
            className={button()}
            aria-describedby={titleId}
            // Rejects when the person closes the share sheet: nothing to report.
            onClick={() => navigator.share({ url: link }).catch(() => {})}
          >
            <ShareIcon small />
            {t('share.share')}
          </button>
        )}
      </div>
      <p className="sr-only" role="status">
        {copied && t(access === 'edit' ? 'share.copied' : 'share.copiedRead')}
      </p>
    </section>
  )
}
