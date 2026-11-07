import { useEffect, useRef, useState } from 'react'
import type { IncomingReply } from '../domain/replies'
import type { ShareSnapshot } from '../domain/shareSnapshot'
import type { Answer, PersonId, Reply } from '../domain/types'
import { demoShareBackend } from '../demo/demoShares'
import { useI18n } from '../i18n/context'
import { dashboardPath, DEMO_REF } from '../storage/link'
import type { ShareBackend } from '../storage/shareBackend'
import { ErrorPage } from '../ui/ErrorPage'
import { eventTime, eventTitle } from '../ui/eventFormat'
import { ChoicePill } from '../ui/components/ChoicePill'
import { BackIcon, InfoIcon, LockIcon, SpinnerIcon } from '../ui/components/icons'
import { InfoNote } from '../ui/components/InfoNote'
import { button, card, cardFrame, cx, linkButton } from '../ui/components/styles'
import { useToast } from '../ui/components/toast'
import { AnswerSheet } from './AnswerSheet'
import { CallCheckIn } from './CallCheckIn'
import { AnswerTag, NameList } from './NameList'
import { Centered, Counter, EventProperties, PageHeader } from './ReplyChrome'
import { answeredFor, forgetNames, type Answered } from './replyMemory'
import { useShare } from './useShare'

interface Props {
  shareId: string
  /** The share key of the link (`key` is taken by React). */
  shareKey: string
  /** Where the share lives; default Firestore, or the demo's memory backend for a demo link. */
  backend?: ShareBackend
  /** A link of the demo: its replies go to the demo dashboard in this tab. */
  demo?: boolean
}

/** The standalone page of a reply link: the event, the names, and Coming / No for the respondent. */
export function ReplyPage({ shareId, shareKey, backend, demo = false }: Props) {
  const { t } = useI18n()
  const view = useShare(shareId, shareKey, backend ?? (demo ? demoShareBackend() : undefined))

  useEffect(() => {
    if (view.status !== 'ready') document.title = t('app.name')
  }, [view.status, t])

  switch (view.status) {
    case 'loading':
      return <Centered>{t('app.loading')}</Centered>
    case 'bad-link':
      return <ErrorPage kind="invalid-link" />
    case 'missing':
      return (
        <Centered>
          {demo && <DemoNotice className="max-w-md text-left text-text" />}
          <div className={cx(card, 'max-w-md text-text')}>{t('reply.page.missing')}</div>
        </Centered>
      )
    case 'ready':
      return (
        <ReadyPage
          shareId={shareId}
          snapshot={view.snapshot}
          open={view.open}
          answers={view.answers}
          present={view.present}
          send={view.send}
          demo={demo}
        />
      )
  }
}

/** On a demo link: where its replies go, and the way back to the demo. */
function DemoNotice({ className }: { className?: string }) {
  const { t } = useI18n()
  return (
    <div className={cx('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-accent/40 bg-accent-soft px-3 py-2.5 text-sm', className)} role="note">
      <p className="min-w-48 flex-1">{t('reply.page.demo')}</p>
      <a href={`#${dashboardPath(DEMO_REF)}`} className={cx(button(), 'shrink-0')}>
        <BackIcon small />
        {t('reply.page.demoBack')}
      </a>
    </div>
  )
}

interface ReadyProps {
  shareId: string
  snapshot: ShareSnapshot
  open: boolean
  answers: Record<PersonId, Reply>
  present: Set<PersonId>
  send: (personId: PersonId, answer: IncomingReply['answer']) => Promise<'sent' | 'closed'>
  demo: boolean
}

/** Answers this phone sent that the live answers have not shown yet, valid while `base` is current. */
interface Pending {
  base: Record<PersonId, Reply>
  overrides: Record<PersonId, Answer>
}

const withOverrides = (answers: Record<PersonId, Reply>, overrides: Record<PersonId, Answer>): Record<PersonId, Reply> => {
  const result = { ...answers }
  for (const [id, answer] of Object.entries(overrides)) {
    if (answer === 'none') delete result[id]
    else result[id] = answer
  }
  return result
}

function ReadyPage({ shareId, snapshot, open, answers: liveAnswers, present, send, demo }: ReadyProps) {
  const i18n = useI18n()
  const { t, formatDate } = i18n
  const toast = useToast()
  const isPublic = snapshot.visibility === 'public'
  const isCall = snapshot.kind === 'call'
  const [remembered, setRemembered] = useState<Answered[]>(() => answeredFor(shareId))
  const [picked, setPicked] = useState<PersonId | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [sending, setSending] = useState<PersonId | null>(null)
  const [notSaved, setNotSaved] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const liveRef = useRef(liveAnswers)
  const listRef = useRef<HTMLElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    liveRef.current = liveAnswers
  }, [liveAnswers])

  const title = eventTitle(snapshot.event, i18n)
  useEffect(() => {
    document.title = `${title} · ${t('app.name')}`
  }, [title, t])

  // A reply this phone sent shows at once; the next live update replaces it.
  const answers = pending && pending.base === liveAnswers ? withOverrides(liveAnswers, pending.overrides) : liveAnswers
  const names = new Map(snapshot.people.map((person) => [person.id, person.name]))
  const lockedIds = new Set(snapshot.people.filter((person) => person.locked).map((person) => person.id))
  const mine = remembered.filter((entry) => names.has(entry.personId))
  const mineIds = new Set(mine.map((entry) => entry.personId))
  const rememberedAnswer = (id: PersonId): Reply | null => {
    const answer = remembered.find((entry) => entry.personId === id)?.answer
    return answer === 'yes' || answer === 'no' ? answer : null
  }
  const shownAnswer = (id: PersonId): Reply | null => (isPublic ? (answers[id] ?? null) : rememberedAnswer(id))

  const choose = async (personId: PersonId, answer: Answer) => {
    if (sending) return
    setSending(personId)
    try {
      const result = await send(personId, answer)
      if (result === 'closed') {
        setNotSaved(true)
        setPicked(null)
        return
      }
      setRemembered(answeredFor(shareId))
      if (isPublic) {
        const base = liveRef.current
        setPending((current) => ({ base, overrides: { ...(current?.base === base ? current.overrides : {}), [personId]: answer } }))
        setPicked(null)
      } else if (picked === personId) {
        setConfirmed(true)
      }
    } catch (error) {
      console.error('Reply failed', error)
      toast(t('reply.page.sendFailed'))
    } finally {
      setSending(null)
    }
  }

  const pick = (personId: PersonId) => {
    setConfirmed(false)
    setPicked(personId)
  }

  /** "Answer for someone else as well": to the names, the search field focused when there is one. */
  const toNames = () => {
    setPicked(null)
    listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    searchRef.current?.focus({ preventScroll: true })
  }

  const forget = () => {
    forgetNames(shareId)
    setRemembered(answeredFor(shareId))
  }

  const yes = Object.values(answers).filter((answer) => answer === 'yes').length
  const no = Object.values(answers).filter((answer) => answer === 'no').length

  return (
    <div className="min-h-screen">
      <PageHeader>{snapshot.dashboard}</PageHeader>

      <main className="mx-auto max-w-xl space-y-5 px-4 pb-12">
        {demo && <DemoNotice />}
        <section className={cx(card, 'space-y-3')}>
          <span
            className={cx(
              'inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold',
              open ? 'bg-success-soft text-success' : 'bg-surface-muted text-muted',
            )}
          >
            {t(isCall ? (open ? 'reply.call.open' : 'reply.call.closedTag') : open ? 'reply.page.open' : 'reply.page.closedTag')}
          </span>
          <div>
            <h1 className="text-2xl font-bold [overflow-wrap:anywhere]">{title}</h1>
            <p className="text-muted first-letter:uppercase">
              {formatDate(snapshot.event.date, { dateStyle: 'full' })} · {eventTime(snapshot.event, i18n)}
            </p>
          </div>
          <EventProperties properties={snapshot.event.properties} />
        </section>

        {isCall ? (
          <CallCheckIn shareId={shareId} snapshot={snapshot} open={open} present={present} send={send} />
        ) : (
          <>
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
            ) : isPublic ? (
              <InfoNote>{t('reply.page.publicNote')}</InfoNote>
            ) : (
              <div className="flex gap-2 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-[13px] leading-snug">
                <span className="mt-px shrink-0 text-accent">
                  <LockIcon small />
                </span>
                <span>{t('reply.page.privateNote')}</span>
              </div>
            )}

            {/* The names this phone answered for. A closed private link shows nothing more. */}
            {mine.length > 0 && (open || isPublic) && (
              <section className={cx(cardFrame, 'px-3 py-2')}>
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="text-sm font-semibold text-muted">{t('reply.page.yourReply', { count: mine.length })}</h2>
                  <button type="button" className={cx(linkButton, 'text-xs text-muted')} onClick={forget}>
                    {t('reply.page.forget')}
                  </button>
                </div>
                <ul className="divide-y divide-line">
                  {mine.map(({ personId }) => {
                    const name = names.get(personId)!
                    const locked = lockedIds.has(personId)
                    return (
                      <li key={personId} className="flex flex-wrap items-center gap-x-3 py-1.5">
                        <span className="min-w-0 flex-1 font-medium [overflow-wrap:anywhere]">{name}</span>
                        {locked ? (
                          <>
                            {isPublic && <AnswerTag answer={answers[personId]} />}
                            <p className="flex w-full items-center gap-1.5 pb-0.5 text-xs text-muted">
                              <LockIcon small />
                              {t('reply.page.lockedMine', { name })}
                            </p>
                          </>
                        ) : isPublic ? (
                          <>
                            <AnswerTag answer={answers[personId]} />
                            {open && (
                              <button
                                type="button"
                                className={button()}
                                aria-label={t('reply.page.changeOf', { name })}
                                onClick={() => pick(personId)}
                              >
                                {t('reply.page.change')}
                              </button>
                            )}
                          </>
                        ) : (
                          <span className="flex items-center gap-2">
                            {sending === personId && (
                              <span className="text-muted" role="status" aria-label={t('reply.page.sending')}>
                                <SpinnerIcon small />
                              </span>
                            )}
                            <ChoicePill
                              value={rememberedAnswer(personId)}
                              options={[
                                { value: 'yes', label: t('reply.yes') },
                                { value: 'no', label: t('reply.no') },
                              ]}
                              clearable
                              disabled={sending !== null}
                              label={t('reply.title', { name })}
                              onChange={(reply) => void choose(personId, reply ?? 'none')}
                            />
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </section>
            )}

            {isPublic && (
              <div className="grid grid-cols-3 gap-2 text-center">
                <Counter value={yes} label={t('reply.page.coming')} tone="text-success" />
                <Counter value={no} label={t('reply.page.notComing')} tone="text-danger" />
                <Counter value={snapshot.people.length - yes - no} label={t('reply.page.noReply')} tone="text-muted" />
              </div>
            )}

            {(open || isPublic) && (
              <section ref={listRef} className="scroll-mt-4 space-y-3">
                <h2 className="text-lg font-semibold">
                  {t(
                    open && mine.length > 0 ? 'reply.page.another' : !isPublic ? 'reply.page.whoAreYou' : open ? 'reply.page.tapName' : 'reply.page.replies',
                  )}
                </h2>
                <NameList
                  people={snapshot.people}
                  answers={isPublic ? answers : undefined}
                  mine={mineIds}
                  onPick={open ? pick : undefined}
                  searchRef={searchRef}
                />
              </section>
            )}
          </>
        )}
      </main>

      {picked !== null && open && names.has(picked) && (
        <AnswerSheet
          name={names.get(picked)!}
          value={shownAnswer(picked)}
          sending={sending === picked}
          confirmed={confirmed}
          onChoose={(answer) => void choose(picked, answer)}
          onChange={() => setConfirmed(false)}
          onAnother={toNames}
          onClose={() => setPicked(null)}
        />
      )}
    </div>
  )
}
