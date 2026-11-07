import { useRef, useState } from 'react'
import { matchesSearch } from '../domain/matching'
import type { IncomingReply } from '../domain/replies'
import type { ShareSnapshot } from '../domain/shareSnapshot'
import type { PersonId } from '../domain/types'
import { useI18n } from '../i18n/context'
import { InfoIcon, SpinnerIcon } from '../ui/components/icons'
import { InfoNote } from '../ui/components/InfoNote'
import { SearchInput } from '../ui/components/SearchInput'
import { button, cardFrame, cx } from '../ui/components/styles'
import { useToast } from '../ui/components/toast'
import { answeredFor, type Answered } from './replyMemory'

/** Beyond this many names, a search field is shown above the list. */
const SEARCH_FROM = 10

interface Props {
  shareId: string
  snapshot: ShareSnapshot
  open: boolean
  /** Public links: the people present, check-ins included. */
  present: Set<PersonId>
  send: (personId: PersonId, answer: IncomingReply['answer']) => Promise<'sent' | 'closed'>
}

/** The body of a roll-call link: the names to tap to check in, and this device's check-ins with Undo. */
export function CallCheckIn({ shareId, snapshot, open, present: livePresent, send }: Props) {
  const i18n = useI18n()
  const { t } = i18n
  const toast = useToast()
  const isPublic = snapshot.visibility === 'public'
  const [remembered, setRemembered] = useState<Answered[]>(() => answeredFor(shareId))
  const [sending, setSending] = useState<PersonId | null>(null)
  const [notSaved, setNotSaved] = useState(false)
  const [query, setQuery] = useState('')
  const mineRef = useRef<HTMLElement>(null)

  const names = new Map(snapshot.people.map((person) => [person.id, person.name]))
  // This device's own check-ins and undos win over the live presence, which may have stopped being watched.
  const checkedIn = remembered.filter((entry) => entry.answer === 'here' && names.has(entry.personId))
  const present = new Set(livePresent)
  for (const entry of remembered) {
    if (entry.answer === 'here') present.add(entry.personId)
    else if (entry.answer === 'notHere') present.delete(entry.personId)
  }
  const count = snapshot.people.filter((person) => present.has(person.id)).length
  const shown = query.trim() ? snapshot.people.filter((person) => matchesSearch(person.name, query)) : snapshot.people

  const choose = async (personId: PersonId, answer: 'here' | 'notHere') => {
    if (sending) return
    setSending(personId)
    try {
      const result = await send(personId, answer)
      if (result === 'closed') setNotSaved(true)
      else setRemembered(answeredFor(shareId))
    } catch (error) {
      console.error('Check-in failed', error)
      toast(t('reply.page.sendFailed'))
    } finally {
      setSending(null)
    }
  }

  const tap = (personId: PersonId) => {
    // Already present on a public page: nothing to send, only show this device's card when there is one.
    if (isPublic && present.has(personId)) {
      if (checkedIn.some((entry) => entry.personId === personId)) mineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    void choose(personId, 'here')
  }

  const rowClass = 'flex min-h-touch w-full items-center gap-3 px-4 py-2 text-left'

  return (
    <>
      {!open ? (
        <div className="flex gap-2 rounded-lg border border-line bg-surface-muted px-3 py-2.5 text-sm" role="status">
          <span className="mt-px shrink-0 text-muted">
            <InfoIcon small />
          </span>
          <span>
            {t('reply.call.closed')}
            {notSaved && <strong className="mt-1 block text-danger">{t('reply.page.notSaved')}</strong>}
          </span>
        </div>
      ) : (
        !isPublic && <InfoNote>{t('reply.call.privateNote')}</InfoNote>
      )}

      {checkedIn.length > 0 && (
        <section ref={mineRef} className={cx(cardFrame, 'scroll-mt-4 px-3 py-2')}>
          <ul className="divide-y divide-line">
            {checkedIn.map(({ personId, at }) => {
              const name = names.get(personId)!
              const time = new Date(at).toLocaleTimeString(i18n.lang, { hour: '2-digit', minute: '2-digit' })
              return (
                <li key={personId} className="flex items-center gap-x-3 py-1.5">
                  <span className="min-w-0 flex-1 font-medium [overflow-wrap:anywhere]">{t('reply.call.presentAt', { name, time })}</span>
                  {open && (
                    <span className="flex items-center gap-2">
                      {sending === personId && (
                        <span className="text-muted" role="status" aria-label={t('reply.page.sending')}>
                          <SpinnerIcon small />
                        </span>
                      )}
                      <button
                        type="button"
                        className={button()}
                        disabled={sending !== null}
                        aria-label={`${t('reply.call.undo')}: ${name}`}
                        onClick={() => void choose(personId, 'notHere')}
                      >
                        {t('reply.call.undo')}
                      </button>
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {isPublic && (
        <p className="text-center text-lg font-semibold tabular-nums">{t('reply.call.count', { count, total: snapshot.people.length })}</p>
      )}

      {(open || isPublic) && (
        <section className="space-y-3">
          {open && <h2 className="text-lg font-semibold">{t('reply.call.tap')}</h2>}
          {snapshot.people.length > SEARCH_FROM && <SearchInput value={query} onChange={setQuery} label={t('reply.page.search')} />}
          {shown.length === 0 ? (
            <p className="py-6 text-center text-muted">{t('reply.page.noMatch')}</p>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
              {shown.map((person) => {
                const here = present.has(person.id)
                const content = (
                  <>
                    <span className="min-w-0 flex-1 font-medium [overflow-wrap:anywhere]">{person.name}</span>
                    {sending === person.id && (
                      <span className="text-muted" role="status" aria-label={t('reply.page.sending')}>
                        <SpinnerIcon small />
                      </span>
                    )}
                    {isPublic && (
                      <span
                        className={cx(
                          'inline-flex h-7 shrink-0 items-center rounded-full px-3 text-[13px] font-semibold whitespace-nowrap',
                          here ? 'bg-success-soft text-success' : 'text-muted',
                        )}
                      >
                        {t(here ? 'reply.call.present' : 'reply.call.notYet')}
                      </span>
                    )}
                  </>
                )
                return (
                  <li key={person.id}>
                    {open ? (
                      <button
                        type="button"
                        className={cx(rowClass, 'cursor-pointer text-text hover:bg-surface-muted')}
                        disabled={sending !== null}
                        onClick={() => tap(person.id)}
                      >
                        {content}
                      </button>
                    ) : (
                      <div className={rowClass}>{content}</div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}
    </>
  )
}
