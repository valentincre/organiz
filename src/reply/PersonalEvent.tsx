import { useId, useState } from 'react'
import type { Answer, PersonId, Reply } from '../domain/types'
import { useI18n } from '../i18n/context'
import { eventTime, eventTitle } from '../ui/eventFormat'
import { ChoicePill } from '../ui/components/ChoicePill'
import { ChevronIcon, InfoIcon, LockIcon, SpinnerIcon } from '../ui/components/icons'
import { button, card, cx } from '../ui/components/styles'
import { useToast } from '../ui/components/toast'
import { AnswerTag, NameList } from './NameList'
import { Counter, EventProperties } from './ReplyChrome'
import type { PersonalEventView } from './usePersonal'

interface Props {
  personId: PersonId
  event: PersonalEventView
}

/** One open event of a personal page: its details, the person's own Coming / No, and who is coming on a public link. */
export function PersonalEvent({ personId, event }: Props) {
  const i18n = useI18n()
  const { t, formatDate } = i18n
  const toast = useToast()
  const { snapshot, open, answer } = event
  const isPublic = snapshot.visibility === 'public'
  const [sending, setSending] = useState(false)
  const [notSaved, setNotSaved] = useState(false)
  const [showNames, setShowNames] = useState(false)
  const namesId = useId()
  const title = eventTitle(snapshot.event, i18n)

  const choose = async (next: Answer) => {
    if (sending) return
    setSending(true)
    try {
      if ((await event.send(next)) === 'closed') setNotSaved(true)
    } catch (error) {
      console.error('Personal reply failed', error)
      toast(t('reply.page.sendFailed'))
    } finally {
      setSending(false)
    }
  }

  // The names and answers of the load; the person's own row shows their current answer.
  const answers: Record<PersonId, Reply> = { ...snapshot.answers }
  if (answer) answers[personId] = answer
  else delete answers[personId]
  const yes = Object.values(answers).filter((value) => value === 'yes').length
  const no = Object.values(answers).filter((value) => value === 'no').length

  return (
    <section className={cx(card, 'space-y-3')}>
      <div>
        <h2 className="text-xl font-bold [overflow-wrap:anywhere]">{title}</h2>
        <p className="text-muted first-letter:uppercase">
          {formatDate(snapshot.event.date, { dateStyle: 'full' })} · {eventTime(snapshot.event, i18n)}
        </p>
      </div>
      <EventProperties properties={snapshot.event.properties} />

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        <span className="font-semibold">{t('personal.coming')}</span>
        {open ? (
          <span className="flex items-center gap-2">
            {sending && (
              <span className="text-muted" role="status" aria-label={t('reply.page.sending')}>
                <SpinnerIcon small />
              </span>
            )}
            <ChoicePill
              value={answer}
              options={[
                { value: 'yes', label: t('reply.yes') },
                { value: 'no', label: t('reply.no') },
              ]}
              clearable
              disabled={sending}
              label={`${title} · ${t('personal.coming')}`}
              onChange={(reply) => void choose(reply ?? 'none')}
            />
          </span>
        ) : (
          <AnswerTag answer={answer ?? undefined} />
        )}
      </div>

      {!open ? (
        <div className="flex gap-2 rounded-lg border border-line bg-surface-muted px-3 py-2.5 text-sm" role="status">
          <span className="mt-px shrink-0 text-muted">
            <InfoIcon small />
          </span>
          <span>
            {t('reply.page.closed')}
            {notSaved && <strong className="mt-1 block text-danger">{t('reply.page.notSaved')}</strong>}
          </span>
        </div>
      ) : isPublic ? null : (
        <div className="flex gap-2 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-[13px] leading-snug">
          <span className="mt-px shrink-0 text-accent">
            <LockIcon small />
          </span>
          <span>{t('personal.privateNote')}</span>
        </div>
      )}

      {isPublic && (
        <>
          <button
            type="button"
            className={cx(button(showNames ? 'active' : 'default'), 'w-full justify-between')}
            aria-expanded={showNames}
            aria-controls={namesId}
            onClick={() => setShowNames(!showNames)}
          >
            {t('personal.seeWho')}
            <span className={cx('transition-transform', showNames && 'rotate-180')}>
              <ChevronIcon direction="down" small />
            </span>
          </button>
          {showNames && (
            <div id={namesId} className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <Counter value={yes} label={t('reply.page.coming')} tone="text-success" />
                <Counter value={no} label={t('reply.page.notComing')} tone="text-danger" />
                <Counter value={snapshot.people.length - yes - no} label={t('reply.page.noReply')} tone="text-muted" />
              </div>
              <NameList people={snapshot.people} answers={answers} mine={new Set([personId])} />
            </div>
          )}
        </>
      )}
    </section>
  )
}
