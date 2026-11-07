import { useEffect } from 'react'
import type { PersonId } from '../domain/types'
import { useI18n } from '../i18n/context'
import { ErrorPage } from '../ui/ErrorPage'
import { card, cx } from '../ui/components/styles'
import { PersonalEvent } from './PersonalEvent'
import { Centered, PageHeader } from './ReplyChrome'
import { usePersonal, type PersonalEventView } from './usePersonal'

interface Props {
  hubId: string
  hubKey: string
  personId: PersonId
  secret: string
}

/** The standalone page of a personal link: every open event, with the person's own Coming / No. */
export function PersonalPage({ hubId, hubKey, personId, secret }: Props) {
  const { t } = useI18n()
  const view = usePersonal(hubId, hubKey, personId, secret)

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
          <div className={cx(card, 'max-w-md text-text')}>{t('reply.page.missing')}</div>
        </Centered>
      )
    case 'revoked':
      return (
        <Centered>
          <div className={cx(card, 'max-w-md text-text')}>{t('personal.revoked')}</div>
        </Centered>
      )
    case 'ready':
      return <ReadyPage personId={personId} name={view.name} events={view.events} />
  }
}

function ReadyPage({ personId, name, events }: { personId: PersonId; name: string; events: PersonalEventView[] }) {
  const { t } = useI18n()
  const hello = t('personal.hello', { name })
  // Every snapshot of a dashboard carries its name.
  const dashboard = events[0]?.snapshot.dashboard ?? t('app.name')

  useEffect(() => {
    document.title = `${hello} · ${t('app.name')}`
  }, [hello, t])

  return (
    <div className="min-h-screen">
      <PageHeader>{t('personal.header', { dashboard })}</PageHeader>
      <main className="mx-auto max-w-xl space-y-5 px-4 pb-12">
        <h1 className="text-2xl font-bold [overflow-wrap:anywhere]">{hello}</h1>
        {events.length === 0 ? (
          <div className={cx(card, 'text-muted')}>{t('personal.none')}</div>
        ) : (
          events.map((event) => <PersonalEvent key={event.shareId} personId={personId} event={event} />)
        )}
      </main>
    </div>
  )
}
