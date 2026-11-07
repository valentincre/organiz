import { useState } from 'react'
import { deviceNumbers, keepReply, keepTime } from '../../domain/replies'
import type { Answer, DashboardState, EventId, Mutation, PersonId, Reply, ReplyTrace } from '../../domain/types'
import { useI18n } from '../../i18n/context'
import { Dialog } from '../components/Dialog'
import { LinkIcon } from '../components/icons'
import { button, cx } from '../components/styles'
import { usePersonalLinkCreation } from './linkHooks'
import { personalLinkOf } from './personalActions'
import { useReplyTime } from './useReplyTime'

interface Props {
  open: boolean
  onClose: () => void
  eventId: EventId
  personId: PersonId
  name: string
  /** The person's current reply, which the trace describes. */
  reply: Reply | undefined
  trace: ReplyTrace
  state: DashboardState
  /** Offers a personal link to a person without one (organizers, not the demo). */
  withPersonalLink: boolean
  mutate: (mutation: Mutation) => void
}

const answerTone: Record<Answer, string> = {
  yes: 'bg-success-soft text-success',
  no: 'bg-danger-soft text-danger',
  none: 'bg-surface-muted text-muted',
}

/** Two phones gave different replies for one person with the shared link: the history, and which reply to keep. */
export function ConflictSheet({ open, onClose, eventId, personId, name, reply, trace, state, withPersonalLink, mutate }: Props) {
  const { t } = useI18n()
  const replyTime = useReplyTime()
  const numbers = deviceNumbers(trace)
  const history = [
    { answer: reply ?? ('none' as const), at: trace.at ?? 0, device: trace.device ?? '', counts: true },
    ...(trace.others ?? []).map((other) => ({ ...other, counts: false })),
  ].sort((a, b) => b.at - a.at)
  const keep = (kept: Reply) => {
    // The sheet may show replies not folded yet: Keep must stay later than all of them.
    mutate(keepReply(eventId, personId, kept, keepTime(trace)))
    onClose()
  }
  const answerLabel = (answer: Answer) => t(answer === 'yes' ? 'reply.yes' : answer === 'no' ? 'reply.no' : 'replies.noAnswer')

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('replies.conflictTitle')}
      closeLabel={t('replies.dismiss')}
      sheet
      footer={
        <>
          <button type="button" className={cx(button(), 'max-sm:flex-1')} onClick={() => keep('yes')}>
            {t('replies.keepYes')}
          </button>
          <button type="button" className={cx(button(), 'max-sm:flex-1')} onClick={() => keep('no')}>
            {t('replies.keepNo')}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p>{numbers.size > 2 ? t('replies.phones', { count: numbers.size, name }) : t('replies.twoPhones', { name })}</p>
        <ol className="divide-y divide-line rounded-lg border border-line" aria-label={t('replies.history')}>
          {history.map((entry, index) => (
            <li key={`${index}-${entry.device}-${entry.at}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <span className={cx('inline-flex h-7 items-center rounded-full px-3 text-[13px] font-semibold', answerTone[entry.answer])}>{answerLabel(entry.answer)}</span>
              <span className="min-w-0 flex-1 text-sm text-muted">
                {numbers.has(entry.device) ? `${t('replies.phone', { number: numbers.get(entry.device) ?? 0 })} · ` : ''}
                {replyTime(entry.at)}
              </span>
              {entry.counts && <span className="rounded-full border border-line px-2 py-0.5 text-xs font-medium text-text">{t('replies.counts')}</span>}
            </li>
          ))}
        </ol>
        <p className="text-sm text-muted">{t('replies.keepNote')}</p>
        {withPersonalLink && <CreatePersonalLink state={state} personId={personId} name={name} mutate={mutate} />}
      </div>
    </Dialog>
  )
}

interface CreateProps {
  state: DashboardState
  personId: PersonId
  name: string
  mutate: (mutation: Mutation) => void
}

/** "Create a personal link for {name}" while the person has none; once created and copied, says to send it. */
function CreatePersonalLink({ state, personId, name, mutate }: CreateProps) {
  const { t } = useI18n()
  const create = usePersonalLinkCreation(state, personId, mutate)
  // Kept by link text: a link replaced by another organizer's, made at the same time, was not the one copied.
  const [copiedLink, setCopiedLink] = useState<string | null>(null)
  const link = personalLinkOf(state, personId, window.location.origin)
  const copied = link !== null && copiedLink === link

  const onCreate = async () => {
    const created = await create()
    if (!created) return
    if (created.copied) setCopiedLink(created.link)
    else window.prompt(t('share.copyFailed'), created.link)
  }

  if (link && !copied) return null
  return (
    <div className="border-t border-line pt-4">
      {!link && (
        <button type="button" className={cx(button(), 'w-full py-2')} onClick={onCreate}>
          <LinkIcon small />
          {/* Its own span: buttons do not wrap, and a long name does not fit on one line on phones. */}
          <span className="text-center whitespace-normal">{t('personal.createFor', { name })}</span>
        </button>
      )}
      <p className={cx('text-sm', !copied && 'sr-only')} role="status">
        {copied && t('personal.copiedFor', { name })}
      </p>
    </div>
  )
}
