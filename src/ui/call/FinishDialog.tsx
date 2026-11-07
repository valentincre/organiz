import { replyOf } from '../../domain/attendance'
import { callSummary, type CallDraft } from '../../domain/call'
import { hasKey } from '../../domain/limits'
import type { DashboardState, PersonId } from '../../domain/types'
import { useI18n } from '../../i18n/context'
import { Dialog } from '../components/Dialog'
import { button } from '../components/styles'
import { ReplyLabel } from '../ReplyLabel'

interface Props {
  open: boolean
  state: DashboardState
  draft: CallDraft
  onClose: () => void
  onConfirm: () => void
}

/** What finishing records, and the gaps with what people said, before the one write. */
export function FinishDialog({ open, state, draft, onClose, onConfirm }: Props) {
  const { t } = useI18n()
  const summary = callSummary(state, draft)
  const event = hasKey(state.events, draft.eventId) ? state.events[draft.eventId] : undefined

  const group = (title: string, ids: PersonId[]) =>
    ids.length > 0 && (
      <section className="space-y-1.5">
        <h3 className="font-semibold">{title}</h3>
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
          {ids.map((id) => (
            <li key={id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{state.people[id].name}</span>
              <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted">
                <ReplyLabel reply={event ? replyOf(event, id) : undefined} />
              </span>
            </li>
          ))}
        </ul>
      </section>
    )

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('call.finishTitle')}
      closeLabel={t('reply.close')}
      sheet
      footer={
        <>
          <button type="button" className={button()} onClick={onClose}>
            {t('call.continue')}
          </button>
          <button type="button" className={button('primary')} onClick={onConfirm}>
            {t('call.finishConfirm')}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-line px-3 py-2">
            <b className="block text-2xl text-success tabular-nums">{summary.present}</b>
            {t('call.statPresent', { count: summary.present })}
          </div>
          <div className="rounded-lg border border-line px-3 py-2">
            <b className="block text-2xl text-danger tabular-nums">{summary.absent}</b>
            {t('call.statAbsent', { count: summary.absent })}
            {summary.unmarked > 0 && <span className="text-muted"> {t('call.statUnmarked', { count: summary.unmarked })}</span>}
          </div>
        </div>
        {group(t('call.unannounced', { count: summary.unannounced.length }), summary.unannounced)}
        {group(t('call.saidYesAbsent', { count: summary.saidYesAbsent.length }), summary.saidYesAbsent)}
      </div>
    </Dialog>
  )
}
