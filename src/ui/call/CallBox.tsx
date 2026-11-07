import { useState } from 'react'
import { canCall, isCalled, statusCounts } from '../../domain/attendance'
import { todayIso } from '../../domain/dates'
import { pruneDraft, progress } from '../../domain/call'
import { isListedAt } from '../../domain/leave'
import type { EventEntry } from '../../domain/selectors'
import { closeShare } from '../../domain/shares'
import type { DashboardState, Mutation } from '../../domain/types'
import { useI18n } from '../../i18n/context'
import { isDemoRef, type DashboardRef } from '../../storage/link'
import { useCanEdit } from '../canEdit'
import { CallIcon, QrIcon } from '../components/icons'
import { button, cx } from '../components/styles'
import { CallLinkSheet } from '../replies/CallLinkSheet'
import { useOpenCallLink } from '../replies/linkHooks'
import { beginCall, resumeCall, type CallContext } from './actions'
import { useCallDraft } from './callDraftStore'

interface Props {
  dashboardRef: DashboardRef
  state: DashboardState
  event: EventEntry
  context: CallContext
  /** People the call would cover; none, nothing to start. */
  scopeSize: number
  /** A people filter limits the call to some of the people. */
  filtered: boolean
  mutate: (mutation: Mutation) => void
}

/**
 * The call on top of an event page: to do (or redo), in progress on this
 * device, or done. Absent before the day of the event. Readers only see a
 * call that is done, without the buttons to redo it or show its QR code.
 */
export function CallBox({ dashboardRef, state, event, context, scopeSize, filtered, mutate }: Props) {
  const { t, lang, formatDate } = useI18n()
  const canEdit = useCanEdit()
  const [stored, , remove] = useCallDraft(dashboardRef.docId, event.id)
  const [qrOpen, setQrOpen] = useState(false)
  const openLink = useOpenCallLink(state, event.id)
  const qrLive = Boolean(openLink)
  if (!canCall(event, todayIso())) return null
  // A draft on this device belongs to its editors, and a call still to do concerns only them.
  if (!canEdit && event.calledAt === undefined) return null

  // The roll-call QR code, for editors; the demo has a presence link but no call links.
  const withQr = canEdit && !isDemoRef(dashboardRef)
  const qrSheet = withQr && <CallLinkSheet open={qrOpen} onClose={() => setQrOpen(false)} state={state} event={event} mutate={mutate} />
  // Nobody to check in: no QR code to show, unless one is still open and has to be closed.
  const noPeople = Object.keys(state.people).length === 0
  /** Opens the QR sheet; a dot tells the QR code is open. `labelClass` hides the label where only the icon shows. */
  const qrButton = (className: string, label: string, labelClass: string) =>
    withQr && (
      <button type="button" className={className} title={t('callLink.open')} aria-haspopup="dialog" disabled={noPeople && !qrLive} onClick={() => setQrOpen(true)}>
        {qrLive && <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-success" />}
        <QrIcon small />
        <span className={labelClass}>{label}</span>
      </button>
    )
  // Labelled from sm, an icon on phones.
  const boxQrButton = qrButton(cx(button(), 'min-h-9 shrink-0 px-2.5'), t('callLink.open'), 'max-sm:sr-only')

  // A finished draft only waits for the server to confirm it: the event already shows as called.
  const pending = canEdit && stored && stored.finishedAt === undefined ? pruneDraft(state, stored) : null
  const start = () => beginCall(dashboardRef, state, event.id, lang, context)
  const startLabel = filtered ? t('call.startFiltered', { count: scopeSize }) : t(isCalled(event) ? 'call.redo' : 'call.start')

  // Abandoning the call also closes its QR code: nobody is left to receive the check-ins.
  const abandon = () => {
    if (!window.confirm(t(openLink ? 'call.abandonConfirmQr' : 'call.abandonConfirm'))) return
    if (openLink) mutate(closeShare(openLink[0]))
    remove()
  }

  if (pending) {
    const { marked, total } = progress(pending)
    return (
      <section className="space-y-2.5 rounded-xl border border-warning/30 bg-today p-3" aria-label={t('call.pendingTitle')}>
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 text-sm">
            <b className="block text-warning">{t('call.pendingTitle')}</b>
            <span className="text-muted">{t('call.pendingDetail', { marked, total })}</span>
          </p>
          {boxQrButton}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className={cx(button(), 'flex-1')}
            onClick={abandon}
          >
            {t('call.abandon')}
          </button>
          <button type="button" className={cx(button('primary'), 'flex-[2]')} onClick={() => resumeCall(dashboardRef, event.id, context)}>
            {t('call.resume')}
          </button>
        </div>
        {qrSheet}
      </section>
    )
  }

  if (event.calledAt !== undefined) {
    const calledAt = new Date(event.calledAt)
    const time = new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit' }).format(calledAt)
    const date = todayIso(calledAt)
    // People who left before the event and were not called are no longer part of the group.
    const everyone = Object.keys(state.people).filter((id) => isListedAt(state, event, id))
    const { present, absent } = statusCounts(event, everyone)
    const called = present + absent
    // A call on a filtered group (or before somebody joined) leaves others out: they count by their reply.
    const others = everyone.length - called
    return (
      <section className="space-y-2.5 rounded-xl border border-line bg-surface p-3 text-sm" aria-label={t('call.doneAt', { time })}>
        <p className="flex items-start gap-2">
          <span className="text-success">
            <CallIcon small />
          </span>
          <span className="min-w-0 flex-1">
            <b>{date === todayIso() ? t('call.doneAt', { time }) : t('call.doneOn', { date: formatDate(date, { day: 'numeric', month: 'short' }), time })}</b>{' '}
            <span className="text-muted">· {t('call.doneCount', { count: present, present, called })}</span>
          </span>
        </p>
        {others > 0 && <p className="pl-6 text-xs text-muted">{t('call.doneOthers', { count: others })}</p>}
        {canEdit && (
          <div className="flex gap-2">
            {qrButton(cx(button(), 'flex-1'), t('callLink.short'), '')}
            <button type="button" className={cx(button(), 'flex-1')} disabled={scopeSize === 0} onClick={start}>
              <CallIcon small />
              {t('call.redo')}
            </button>
          </div>
        )}
        {qrSheet}
      </section>
    )
  }

  return (
    <section className="space-y-2.5 rounded-xl border border-warning/30 bg-today p-3" aria-label={t('call.notDone')}>
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-sm">
          <b className="block text-warning">{t('call.notDone')}</b>
          {!filtered && <span className="text-muted">{t('call.notDoneHint')}</span>}
        </p>
        {boxQrButton}
      </div>
      <button type="button" className={cx(button('primary'), 'w-full')} disabled={scopeSize === 0} onClick={start}>
        <CallIcon small />
        {startLabel}
      </button>
      {qrSheet}
    </section>
  )
}
