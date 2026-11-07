import { useEffect, useRef } from 'react'
import { markOf, type CallDraft, type Mark } from '../../domain/call'
import { hasKey } from '../../domain/limits'
import { replyOf } from '../../domain/attendance'
import type { DashboardState, EventId, PersonId, PropertyDef, PropertyId } from '../../domain/types'
import { useI18n } from '../../i18n/context'
import { BackIcon, CheckIcon, CloseIcon } from '../components/icons'
import { button, cx } from '../components/styles'
import { PersonValues } from '../PersonValues'
import { ReplyLabel } from '../ReplyLabel'

interface Props {
  state: DashboardState
  eventId: EventId
  draft: CallDraft
  properties: (PropertyDef & { id: PropertyId })[]
  /** Shows the keyboard shortcuts (wide screens, where a keyboard is likely). */
  showKeys: boolean
  onMark: (id: PersonId, mark: Mark) => void
  onPrevious: () => void
  onJump: (id: PersonId) => void
  onFinish: () => void
}

const nameOf = (state: DashboardState, id: PersonId) => (hasKey(state.people, id) ? state.people[id].name : '')

function Kbd({ children, className }: { children: string; className?: string }) {
  return <kbd className={cx('rounded-[5px] border border-b-2 border-current/40 px-1.5 text-xs font-normal opacity-80', className)}>{children}</kbd>
}

/** The roll call one person at a time: big Present / Absent buttons, a way back, and a strip to jump to anybody. */
export function OneByOne({ state, eventId, draft, properties, showKeys, onMark, onPrevious, onJump, onFinish }: Props) {
  const { t } = useI18n()
  const { current } = draft
  const event = hasKey(state.events, eventId) ? state.events[eventId] : undefined
  const last = draft.history.at(-1)
  const lastMark = last === undefined ? undefined : markOf(draft, last)
  const currentMark = current === null ? undefined : markOf(draft, current)
  const strip = useRef<HTMLDivElement>(null)

  // The strip follows the person shown.
  useEffect(() => {
    strip.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [current])

  return (
    <div className="space-y-3">
      {current === null ? (
        <div className="space-y-3 rounded-2xl border border-line bg-surface px-4 py-6 text-center">
          <p className="text-lg font-semibold">{t('call.allMarked')}</p>
          <button type="button" className={cx(button('primary'), 'min-h-12 px-6')} onClick={onFinish}>
            {t('call.finishLong')}
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-col items-center gap-1.5 rounded-2xl border border-line bg-surface px-4 py-5 text-center">
            <span className="text-[13px] text-muted tabular-nums">
              {t('call.position', { position: draft.scope.indexOf(current) + 1, total: draft.scope.length })}
            </span>
            <h2 className="text-3xl font-bold [overflow-wrap:anywhere]">{nameOf(state, current)}</h2>
            <PersonValues state={state} properties={properties} values={state.people[current]?.values} />
            <span className="mt-0.5 inline-flex items-center gap-1 text-sm text-muted">
              <ReplyLabel reply={event ? replyOf(event, current) : undefined} />
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              aria-pressed={currentMark === 'absent'}
              className="inline-flex h-16 cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-danger bg-surface text-[17px] font-bold text-danger hover:bg-danger-soft aria-pressed:bg-danger-soft"
              onClick={() => onMark(current, 'absent')}
            >
              <CloseIcon />
              {t('sheet.stateAbsent')}
              {showKeys && <Kbd>A</Kbd>}
            </button>
            <button
              type="button"
              aria-pressed={currentMark === 'present'}
              className="inline-flex h-16 cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-success bg-success text-[17px] font-bold text-on-accent hover:opacity-90 aria-pressed:ring-2 aria-pressed:ring-text aria-pressed:ring-offset-2 aria-pressed:ring-offset-bg"
              onClick={() => onMark(current, 'present')}
            >
              <CheckIcon />
              {t('sheet.statePresent')}
              {showKeys && <Kbd>P</Kbd>}
            </button>
          </div>
        </>
      )}

      {last !== undefined && (
        <button type="button" className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 px-0.5 text-sm text-accent hover:text-accent-hover" onClick={onPrevious}>
          <BackIcon small />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {t('call.previous', { name: nameOf(state, last) })}
            {' · '}
            <span className={lastMark === 'present' ? 'text-success' : 'text-danger'}>{t(lastMark === 'present' ? 'sheet.statePresent' : 'sheet.stateAbsent')}</span>
          </span>
        </button>
      )}

      {showKeys && (
        <p className="flex flex-wrap items-center gap-x-1 gap-y-1 text-[13px] text-muted">
          <Kbd>←</Kbd> {t('call.keyPrevious')} · <Kbd>/</Kbd> {t('call.keySearch')} · <Kbd>{t('call.keyEnter')}</Kbd> {t('call.keyFinish')}
        </p>
      )}

      {/* `relative`: the screen-reader texts of the chips are absolutely positioned and must stay inside the scrolling strip. */}
      <div ref={strip} role="group" aria-label={t('call.people')} className="relative flex gap-1.5 overflow-x-auto pb-2">
        {draft.scope.map((id) => {
          const value = markOf(draft, id)
          return (
            <button
              key={id}
              type="button"
              aria-current={id === current}
              className={cx(
                'inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-[13px] whitespace-nowrap',
                id === current ? 'border-accent bg-accent-soft text-accent' : 'border-line text-text hover:bg-surface-muted',
              )}
              onClick={() => onJump(id)}
            >
              <span className={cx('size-2 shrink-0 rounded-full', value === 'present' ? 'bg-success' : value === 'absent' ? 'bg-danger' : 'bg-muted/50')} aria-hidden="true" />
              {nameOf(state, id).split(/\s+/)[0]}
              <span className="sr-only">
                {' '}
                {t(value === 'present' ? 'sheet.statePresent' : value === 'absent' ? 'sheet.stateAbsent' : 'call.markNone')}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
