import { useCallback, useEffect, useMemo, useState } from 'react'
import type { IncomingReply } from '../domain/replies'
import { snapshotAnswers, snapshotPresent, type ShareSnapshot } from '../domain/shareSnapshot'
import type { PersonId, Reply } from '../domain/types'
import { dbReady } from '../storage/firebase'
import { FirestoreShareBackend } from '../storage/firestoreShares'
import { ShareClosedError, type ShareBackend, type StoredReply } from '../storage/shareBackend'
import { importShareKey, openReply, openSnapshot, sealReply } from '../storage/shareCrypto'
import { answeredFor, deviceId, rememberAnswer } from './replyMemory'

export type ShareView =
  | { status: 'loading' | 'missing' | 'bad-link' }
  | {
      status: 'ready'
      snapshot: ShareSnapshot
      open: boolean
      /** Public links: every current answer. Private links: empty. */
      answers: Record<PersonId, Reply>
      /** Public call links: the people present, check-ins included. Empty otherwise. */
      present: Set<PersonId>
      /** Sends a reply or check-in from this phone and remembers it (see replyMemory); 'closed' when the link refused it. */
      send(personId: PersonId, answer: IncomingReply['answer']): Promise<'sent' | 'closed'>
    }

/** How long a link whose share document does not exist yet shows "loading" before saying so. */
const MISSING_DELAY_MS = 4_000
/** setTimeout's longest delay (about 24.8 days); later closing times are checked again then. */
const MAX_TIMER_MS = 2 ** 31 - 1

const NO_REPLIES: IncomingReply[] = []

let defaultBackend: ShareBackend | null = null
const firestoreBackend = (): ShareBackend => (defaultBackend ??= new FirestoreShareBackend(dbReady))

/** What the share document says, once decrypted. */
interface Loaded {
  snapshot: ShareSnapshot
  closed: boolean
  closesAt: number | null
}

type Phase = { status: 'loading' | 'missing' | 'bad-link' } | ({ status: 'ready' } & Loaded)

/**
 * A reply link as its page sees it. The share document is watched, so a new
 * snapshot or the link closing arrive live; a document that does not exist yet
 * keeps being waited for, since the organizer's app may not have written it. A
 * public link also watches the replies newer than its snapshot; a private one
 * watches none, its replies being readable by the organizers only. A call link
 * stops watching them once this device checked someone in (the page then shows
 * this device's own check-ins).
 */
export function useShare(shareId: string, key: string, backend: ShareBackend = firestoreBackend()): ShareView {
  const [phase, setPhase] = useState<Phase>({ status: 'loading' })
  const [shareKey, setShareKey] = useState<CryptoKey | null>(null)
  // The decrypted replies newer than the snapshot time `since`.
  const [replies, setReplies] = useState<{ since: number; list: IncomingReply[] } | null>(null)
  // A reply refused because the link closed, possibly before this page saw the share change.
  const [refused, setRefused] = useState(false)
  // The closing time this page has seen pass.
  const [passed, setPassed] = useState<number | null>(null)
  // This device checked someone in on a call link (now or earlier): the replies are no longer watched.
  const [checkedIn, setCheckedIn] = useState(() => answeredFor(shareId).some((entry) => entry.answer === 'here'))

  // The share document.
  useEffect(() => {
    let stopped = false
    let unsubscribe = () => {}
    let missingTimer: ReturnType<typeof setTimeout> | undefined
    let ready = false
    // Snapshots decrypt asynchronously: only the latest document is applied.
    let latest = 0
    importShareKey(key).then(
      (cryptoKey) => {
        if (stopped) return
        setShareKey(cryptoKey)
        unsubscribe = backend.watchShare(
          shareId,
          (share) => {
            const seq = ++latest
            if (share === null) {
              if (ready) {
                // Share documents are never deleted, so this should not happen: the page keeps showing it, closed.
                setPhase((current) => (current.status === 'ready' ? { ...current, closed: true } : current))
              } else {
                missingTimer ??= setTimeout(() => !stopped && !ready && setPhase({ status: 'missing' }), MISSING_DELAY_MS)
              }
              return
            }
            openSnapshot(cryptoKey, shareId, share.sealed).then(
              (snapshot) => {
                if (stopped || seq !== latest) return
                ready = true
                clearTimeout(missingTimer)
                if (share.closesAt !== null && Date.now() >= share.closesAt) setPassed(share.closesAt)
                setPhase({ status: 'ready', snapshot, closed: share.closed, closesAt: share.closesAt })
              },
              () => {
                if (stopped || seq !== latest) return
                // Not readable with this key: the link is wrong or incomplete.
                if (!ready) setPhase({ status: 'bad-link' })
              },
            )
          },
          (error) => {
            console.error('Reply link listener failed', error)
            if (!stopped && !ready) setPhase({ status: 'missing' })
          },
        )
      },
      () => !stopped && setPhase({ status: 'bad-link' }),
    )
    return () => {
      stopped = true
      clearTimeout(missingTimer)
      unsubscribe()
    }
  }, [backend, shareId, key])

  const snapshot = phase.status === 'ready' ? phase.snapshot : null
  const since = snapshot?.visibility === 'public' && !(snapshot.kind === 'call' && checkedIn) ? snapshot.at : null

  // Public links: the replies newer than the snapshot. Decrypted once each, by id.
  useEffect(() => {
    if (since === null || !shareKey) return
    let stopped = false
    let latest = 0
    const opened = new Map<string, IncomingReply | null>()
    const decrypt = async (stored: StoredReply): Promise<IncomingReply | null> => {
      if (!opened.has(stored.id)) {
        try {
          const payload = await openReply({ shareKey }, shareId, stored.sealed)
          opened.set(stored.id, { id: stored.id, shareId, createdAt: stored.createdAt, ...payload })
        } catch {
          // Not a reply to this public link (or a private one sent before a switch): ignored.
          opened.set(stored.id, null)
        }
      }
      return opened.get(stored.id) ?? null
    }
    const stop = backend.watchReplies(
      shareId,
      since,
      // Pages from the cache are fine to show: a later page replaces them.
      (page) => {
        const seq = ++latest
        void Promise.all(page.map(decrypt)).then((list) => {
          if (!stopped && seq === latest) setReplies({ since, list: list.filter((reply): reply is IncomingReply => reply !== null) })
        })
      },
      (error) => console.error('Reply listener failed', error),
    )
    return () => {
      stopped = true
      stop()
    }
  }, [backend, shareId, shareKey, since])

  // The closing time: checked again when it comes (the snapshot callback handles one already past).
  const closesAt = phase.status === 'ready' ? phase.closesAt : null
  useEffect(() => {
    if (closesAt === null) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = () => {
      clearTimeout(timer)
      const left = closesAt - Date.now()
      if (left <= 0) setPassed(closesAt)
      else timer = setTimeout(check, Math.min(left, MAX_TIMER_MS))
    }
    timer = setTimeout(check, Math.min(Math.max(0, closesAt - Date.now()), MAX_TIMER_MS))
    // Timers stop while a phone sleeps: check again when the page shows.
    document.addEventListener('visibilitychange', check)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', check)
    }
  }, [closesAt])

  // Replies already seen stay shown after the watching stops.
  const newer = replies !== null && replies.since === snapshot?.at ? replies.list : NO_REPLIES
  const answers = useMemo(() => (snapshot?.visibility === 'public' ? snapshotAnswers(snapshot, newer) : {}), [snapshot, newer])
  const present = useMemo(() => (snapshot?.visibility === 'public' && snapshot.kind === 'call' ? snapshotPresent(snapshot, newer) : new Set<PersonId>()), [snapshot, newer])

  const send = useCallback(
    async (personId: PersonId, answer: IncomingReply['answer']): Promise<'sent' | 'closed'> => {
      if (!snapshot || !shareKey) throw new Error('The link is not loaded')
      const payload = { personId, answer, device: deviceId(), via: 'shared' as const }
      const to = snapshot.visibility === 'public' ? { shareKey } : { publicKey: snapshot.publicKey! }
      try {
        await backend.addReply(shareId, await sealReply(to, shareId, payload))
        rememberAnswer(shareId, personId, answer, Date.now())
        if (answer === 'here' && snapshot.kind === 'call') setCheckedIn(true)
        return 'sent'
      } catch (error) {
        if (!(error instanceof ShareClosedError)) throw error
        setRefused(true)
        return 'closed'
      }
    },
    [backend, shareId, shareKey, snapshot],
  )

  if (phase.status !== 'ready') return { status: phase.status }
  const expired = phase.closesAt !== null && passed === phase.closesAt
  return { status: 'ready', snapshot: phase.snapshot, open: !phase.closed && !refused && !expired, answers, present, send }
}
