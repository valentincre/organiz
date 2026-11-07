import { replyOf } from '../../domain/attendance'
import { markOf, type CallDraft, type Mark } from '../../domain/call'
import { hasKey } from '../../domain/limits'
import type { DashboardState, EventId, PersonId, PropertyDef, PropertyId } from '../../domain/types'
import { useI18n } from '../../i18n/context'
import { CheckIcon, CloseIcon } from '../components/icons'
import { cx } from '../components/styles'
import { PersonValues } from '../PersonValues'
import { ReplyLabel } from '../ReplyLabel'

interface Props {
  state: DashboardState
  eventId: EventId
  draft: CallDraft
  properties: (PropertyDef & { id: PropertyId })[]
  /** Highlights the person "one by one" is showing (wide screens, where both views are side by side). */
  highlightCurrent: boolean
  onCycle: (id: PersonId, next: Mark | null) => void
}

/** Tapping a row goes present → absent → not marked. */
const nextMark = (value: Mark | undefined): Mark | null => (value === undefined ? 'present' : value === 'present' ? 'absent' : null)

function MarkCircle({ mark }: { mark: Mark | undefined }) {
  const { t } = useI18n()
  return (
    <span
      className={cx(
        'flex size-[26px] shrink-0 items-center justify-center rounded-full border-2 text-on-accent',
        mark === 'present' ? 'border-success bg-success' : mark === 'absent' ? 'border-danger bg-danger' : 'border-muted/50',
      )}
    >
      {mark === 'present' && <CheckIcon small />}
      {mark === 'absent' && <CloseIcon small />}
      <span className="sr-only">{t(mark === 'present' ? 'sheet.statePresent' : mark === 'absent' ? 'sheet.stateAbsent' : 'call.markNone')}</span>
    </span>
  )
}

/** Everybody of the call in one list, to tick while looking at the room; two columns on wide screens. */
export function CallList({ state, eventId, draft, properties, highlightCurrent, onCycle }: Props) {
  const event = hasKey(state.events, eventId) ? state.events[eventId] : undefined
  return (
    <ul className="grid gap-px overflow-hidden rounded-xl border border-line bg-line lg:grid-cols-2 lg:[&>li:last-child:nth-child(odd)]:col-span-2">
      {draft.scope.map((id) => {
        const person = state.people[id]
        const value = markOf(draft, id)
        return (
          <li key={id} className="bg-surface">
            <button
              type="button"
              className={cx(
                'flex min-h-touch w-full cursor-pointer items-center gap-3 px-4 py-2 text-left hover:bg-surface-muted',
                highlightCurrent && id === draft.current && 'bg-accent-soft hover:bg-accent-soft',
              )}
              onClick={() => onCycle(id, nextMark(value))}
            >
              <MarkCircle mark={value} />
              <span className="min-w-0 flex-1">
                <span className="block [overflow-wrap:anywhere]">{person.name}</span>
                <PersonValues state={state} properties={properties} values={person.values} />
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted">
                <ReplyLabel reply={event ? replyOf(event, id) : undefined} />
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
