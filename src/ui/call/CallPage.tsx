import { useEffect, useMemo, useRef, useState } from 'react'
import { canCall } from '../../domain/attendance'
import { addToCall, isUntouched, jumpTo, mark, previous, progress, pruneDraft, type CallDraft, type Mark } from '../../domain/call'
import { todayIso } from '../../domain/dates'
import { randomId } from '../../domain/ids'
import { hasKey } from '../../domain/limits'
import { addPerson } from '../../domain/mutations'
import { sortedProperties } from '../../domain/properties'
import type { DashboardState, Mutation, PersonId } from '../../domain/types'
import { useI18n } from '../../i18n/context'
import { navigate, viewPath, type DashboardView } from '../../router'
import { isDemoRef, type DashboardRef } from '../../storage/link'
import { useCanEdit } from '../canEdit'
import { CloseIcon, QrIcon, SearchIcon } from '../components/icons'
import { InfoNote } from '../components/InfoNote'
import { SearchInput } from '../components/SearchInput'
import { button, cx } from '../components/styles'
import { eventTime, eventTitle } from '../eventFormat'
import { CallLinkSheet } from '../replies/CallLinkSheet'
import { useOpenCallLink } from '../replies/linkHooks'
import { useMediaQuery } from '../useMediaQuery'
import { readCallDraft, useCallDraft, useCallMode } from './callDraftStore'
import { CallList } from './CallList'
import { CallSearch } from './CallSearch'
import { FinishDialog } from './FinishDialog'
import { OneByOne } from './OneByOne'
import { useCallKeys } from './useCallKeys'

interface Props {
  dashboardRef: DashboardRef
  state: DashboardState
  view: Extract<DashboardView, { tab: 'call' }>
  mutate: (mutation: Mutation) => void
}

/**
 * The roll call of an event, on its own screen. Every action changes a draft
 * kept on this device; nothing reaches the server until the call is finished
 * (except a new person added from the search).
 */
export function CallPage({ dashboardRef, state, view, mutate }: Props) {
  const i18n = useI18n()
  const { t, formatDate } = i18n
  const { eventId, period, filters } = view
  const [stored, save, remove] = useCallDraft(dashboardRef.docId, eventId)
  const [mode, setMode] = useCallMode()
  const wide = useMediaQuery('(min-width: 64rem)')
  const [query, setQuery] = useState('')
  // Phones: the search field is folded into a button until asked for.
  const [searching, setSearching] = useState(false)
  const [finishing, setFinishing] = useState(false)
  // The roll-call QR code, for editors; the demo has a presence link but no call links.
  const withQr = useCanEdit() && !isDemoRef(dashboardRef)
  const [showingQr, setShowingQr] = useState(false)
  const qrLive = Boolean(useOpenCallLink(state, eventId))
  const searchField = useRef<HTMLInputElement>(null)

  const event = hasKey(state.events, eventId) ? state.events[eventId] : undefined
  const draft = useMemo(() => (stored ? pruneDraft(state, stored) : null), [stored, state])
  const eventPage = viewPath(dashboardRef, { tab: 'sheet', eventId, period, filters })
  // Nothing to call before the day, for an event that is gone, or without a draft to continue: back to the event.
  const ready = Boolean(event && canCall(event, todayIso()) && draft && draft.finishedAt === undefined && draft.scope.length > 0)
  useEffect(() => {
    if (!ready) navigate(eventPage, { replace: true })
  }, [ready, eventPage])

  // The latest draft from the device, so two quick actions never work from an outdated one.
  const update = (change: (draft: CallDraft) => CallDraft) => {
    const latest = readCallDraft(dashboardRef.docId, eventId)
    if (!latest || latest.finishedAt !== undefined) return
    const base = pruneDraft(state, latest)
    const next = change(base)
    if (next !== base) save(next)
  }
  const markPerson = (id: PersonId, value: Mark | null) => update((d) => mark(d, id, value))
  const markCurrent = (value: Mark) => update((d) => (d.current === null ? d : mark(d, d.current, value)))

  const openSearch = () => {
    if (wide) searchField.current?.focus()
    else setSearching(true)
  }
  const closeSearch = () => {
    setQuery('')
    setSearching(false)
  }
  // Phones: the field opens with the keyboard.
  useEffect(() => {
    if (searching) searchField.current?.focus()
  }, [searching])

  const showKeys = wide
  useCallKeys(
    {
      present: () => markCurrent('present'),
      absent: () => markCurrent('absent'),
      previous: () => update(previous),
      search: openSearch,
      finish: () => setFinishing(true),
    },
    ready && !finishing && (wide || mode === 'one'),
  )

  if (!event || !draft || !ready) return null

  const properties = sortedProperties(state, 'person')
  const { marked, present, absent, total } = progress(draft)
  const typed = query.trim() !== ''
  const addExisting = (id: PersonId) => {
    update((d) => addToCall(d, id))
    closeSearch()
  }
  const addNew = (name: string) => {
    const id = randomId()
    mutate(addPerson(id, name))
    update((d) => addToCall(d, id))
    closeSearch()
  }
  // Leaving a call nobody touched (e.g. right after "Redo") keeps no draft: nothing is in progress.
  const quit = () => {
    if (isUntouched(state, draft)) remove()
    navigate(eventPage, { replace: true })
  }
  const finish = () => {
    save({ ...draft, finishedAt: Date.now() })
    navigate(eventPage, { replace: true })
  }

  const searchBox = (
    <div className="flex gap-2">
      <div className="min-w-0 flex-1">
        <SearchInput
          value={query}
          onChange={setQuery}
          label={t('call.search')}
          inputRef={searchField}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              closeSearch()
              // Back to the shortcuts: they are ignored while a field has the focus.
              e.currentTarget.blur()
            }
          }}
        />
      </div>
      {!wide && (
        <button type="button" className={cx(button(), 'w-10 shrink-0 px-0')} aria-label={t('call.searchClose')} title={t('call.searchClose')} onClick={closeSearch}>
          <CloseIcon />
        </button>
      )}
    </div>
  )
  const results = (
    <CallSearch
      state={state}
      draft={draft}
      properties={properties}
      query={query}
      onMark={markPerson}
      onAddExisting={addExisting}
      onAddNew={addNew}
    />
  )
  const oneByOne = (
    <OneByOne
      state={state}
      eventId={eventId}
      draft={draft}
      properties={properties}
      showKeys={showKeys}
      onMark={(id, value) => markPerson(id, value)}
      onPrevious={() => update(previous)}
      onJump={(id) => update((d) => jumpTo(d, id))}
      onFinish={() => setFinishing(true)}
    />
  )
  const list = <CallList state={state} eventId={eventId} draft={draft} properties={properties} highlightCurrent={wide} onCycle={markPerson} />

  const progressBar = (
    <div className="space-y-1.5">
      <div className="flex justify-between gap-2 text-[13px]">
        <span>
          <b>{marked}</b>
          <span className="text-muted">{t('call.progressOf', { total })}</span>
        </span>
        <span>
          <span className="text-success">{t('sheet.countPresent', { count: present })}</span>
          {' · '}
          <span className="text-danger">{t('sheet.countAbsent', { count: absent })}</span>
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={marked}
        aria-label={t('call.progressOf', { total }).trim()}
      >
        <div className="h-full rounded-full bg-accent" style={{ width: `${(marked / total) * 100}%` }} />
      </div>
    </div>
  )

  const modes = [
    { value: 'one', label: t('call.modeOne') },
    { value: 'list', label: t('call.modeList') },
  ] as const

  return (
    <div>
      <header className="sticky top-0 z-10 border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-3 py-2 sm:px-4">
          <button
            type="button"
            className={cx(button(), 'shrink-0 px-2.5 sm:px-3.5')}
            aria-label={t('call.quitHint')}
            title={t('call.quitHint')}
            onClick={quit}
          >
            <CloseIcon />
            <span className="max-sm:sr-only">{t('call.quit')}</span>
          </button>
          <div className="min-w-0 flex-1 text-center leading-tight">
            <h1 className="truncate font-semibold">{t('call.title', { name: eventTitle(event, i18n) })}</h1>
            <p className="truncate text-sm text-muted">
              {formatDate(event.date, { weekday: 'long', day: 'numeric', month: 'long' })} · {eventTime(event, i18n)}
            </p>
          </div>
          {withQr && (
            <button
              type="button"
              className={cx(button(), 'relative w-10 shrink-0 px-0')}
              aria-label={t('callLink.open')}
              title={t('callLink.open')}
              aria-haspopup="dialog"
              onClick={() => setShowingQr(true)}
            >
              <QrIcon />
              {/* The QR code is open. */}
              {qrLive && <span aria-hidden="true" className="absolute top-1 right-1 size-2 rounded-full bg-success" />}
            </button>
          )}
          <button type="button" className={cx(button('primary'), 'shrink-0')} onClick={() => setFinishing(true)}>
            <span className="lg:hidden">{t('call.finish')}</span>
            <span className="max-lg:hidden">{t('call.finishLong')}</span>
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-3 px-4 py-3 lg:max-w-6xl lg:px-6 lg:py-5">
        {draft.filtered && <InfoNote>{t('call.scopeInfo', { count: total })}</InfoNote>}
        {wide ? (
          <div className="grid grid-cols-[24rem_minmax(0,1fr)] items-start gap-6">
            <div className="space-y-3">
              {progressBar}
              {oneByOne}
            </div>
            <div className="space-y-3">
              {searchBox}
              {typed ? results : list}
            </div>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <div role="group" aria-label={t('call.mode')} className="flex flex-1 overflow-hidden rounded-lg border border-line">
                {modes.map((item, index) => (
                  <button
                    key={item.value}
                    type="button"
                    aria-pressed={mode === item.value}
                    className={cx(
                      'h-10 flex-1 cursor-pointer text-sm font-medium',
                      index > 0 && 'border-l border-line',
                      mode === item.value ? 'bg-accent-soft text-accent' : 'bg-surface text-muted hover:bg-surface-muted',
                    )}
                    onClick={() => setMode(item.value)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className={cx(button(searching ? 'active' : 'default'), 'w-10 shrink-0 px-0')}
                aria-label={t('call.searchOpen')}
                title={t('call.searchOpen')}
                aria-expanded={searching}
                onClick={() => (searching ? closeSearch() : openSearch())}
              >
                <SearchIcon />
              </button>
            </div>
            {searching && searchBox}
            {progressBar}
            {typed ? results : mode === 'one' ? oneByOne : list}
          </>
        )}
      </main>

      <FinishDialog open={finishing} state={state} draft={draft} onClose={() => setFinishing(false)} onConfirm={finish} />
      {withQr && <CallLinkSheet open={showingQr} onClose={() => setShowingQr(false)} state={state} event={{ ...event, id: eventId }} mutate={mutate} />}
    </div>
  )
}
