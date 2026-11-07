import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { hasKey } from '../domain/limits'
import type { ShareSnapshot } from '../domain/shareSnapshot'
import type { Answer, PersonId, Reply, ShareId } from '../domain/types'
import { dbReady } from '../storage/firebase'
import { FirestoreHubBackend } from '../storage/firestoreHubs'
import { FirestoreShareBackend } from '../storage/firestoreShares'
import type { HubBackend } from '../storage/hubBackend'
import { ShareClosedError, type ShareBackend } from '../storage/shareBackend'
import { importShareKey } from '../storage/shareCrypto'
import { loadPersonalShare, openPersonalHub, personalAnswer, sendPersonalReply, type OpenedPerson, type PersonalShare } from './personal'
import { answeredFor, deviceId, rememberAnswer, type Answered } from './replyMemory'

export interface PersonalEventView {
  shareId: ShareId
  snapshot: ShareSnapshot
  open: boolean
  /** This device's last answer when newer than the hub's, else the hub's. */
  answer: Reply | null
  /** Sends the person's reply and remembers it on this device; 'closed' when the link refused it. */
  send(answer: Answer): Promise<'sent' | 'closed'>
}

export type PersonalView =
  | { status: 'loading' | 'missing' | 'bad-link' | 'revoked' }
  | {
      status: 'ready'
      name: string
      /** Open events, soonest first. */
      events: PersonalEventView[]
    }

export interface PersonalBackends {
  hub: HubBackend
  share: ShareBackend
}

/** How long a link whose hub document does not exist yet shows "loading" before saying so (as `useShare`). */
const MISSING_DELAY_MS = 4_000

let defaultBackends: PersonalBackends | null = null
const firestoreBackends = (): PersonalBackends =>
  (defaultBackends ??= { hub: new FirestoreHubBackend(dbReady), share: new FirestoreShareBackend(dbReady) })

type Phase = { status: 'loading' | 'missing' | 'bad-link' } | OpenedPerson

/**
 * A personal link as its page sees it. The hub is watched: the person's name and replies, the
 * revocation of the link and the list of open events arrive live. A hub that does not exist yet
 * keeps being waited for, since the organizer's app may not have written it. Each listed event
 * is read once per page load (spec §6.6), so its names and their answers are those of the load;
 * events closed or past their closing time then are left out.
 *
 * `backends` must keep the same identity across renders.
 */
export function usePersonal(
  hubId: string,
  hubKey: string,
  personId: PersonId,
  secret: string,
  backends: PersonalBackends = firestoreBackends(),
): PersonalView {
  const { hub: hubBackend, share: shareBackend } = backends
  const [phase, setPhase] = useState<Phase>({ status: 'loading' })
  // The listed events read so far (null: left out); null until the first list is read.
  const [loaded, setLoaded] = useState<Record<ShareId, PersonalShare | null> | null>(null)
  // The one read of each event, for the life of the page.
  const reads = useRef(new Map<ShareId, Promise<PersonalShare | null>>())
  // Links that refused a reply: closed, possibly before the hub said so.
  const [refused, setRefused] = useState<ReadonlySet<ShareId>>(() => new Set())
  // Answers sent from this page, newer than what the hub or this device's memory said at load.
  const [sent, setSent] = useState<Record<ShareId, Answered>>({})

  // The hub document.
  useEffect(() => {
    let stopped = false
    let unsubscribe = () => {}
    let missingTimer: ReturnType<typeof setTimeout> | undefined
    let ready = false
    // The hub opens asynchronously: only the latest document is applied.
    let latest = 0
    importShareKey(hubKey).then(
      (cryptoKey) => {
        if (stopped) return
        unsubscribe = hubBackend.watchHub(
          hubId,
          (hub) => {
            const seq = ++latest
            if (hub === null) {
              // Hubs are never deleted: once shown, the page keeps its last state.
              if (!ready) missingTimer ??= setTimeout(() => !stopped && !ready && setPhase({ status: 'missing' }), MISSING_DELAY_MS)
              return
            }
            openPersonalHub(cryptoKey, hubId, personId, secret, hub.sealed).then(
              (opened) => {
                if (stopped || seq !== latest) return
                ready = true
                clearTimeout(missingTimer)
                setPhase(opened)
              },
              () => {
                if (stopped || seq !== latest) return
                // Not readable with this key: the link is wrong or incomplete.
                if (!ready) setPhase({ status: 'bad-link' })
              },
            )
          },
          (error) => {
            console.error('Personal link listener failed', error)
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
  }, [hubBackend, hubId, hubKey, personId, secret])

  // The listed events, each read once; a list that changes reads only the new ones.
  const listed = phase.status === 'ready' ? phase.shares : null
  useEffect(() => {
    if (!listed) return
    let stopped = false
    const requests = listed.map(({ shareId, key }) => {
      let read = reads.current.get(shareId)
      if (!read) {
        read = loadPersonalShare(shareBackend, shareId, key, Date.now()).catch((error: unknown) => {
          console.error('Personal link: an event could not be read', error)
          return null
        })
        reads.current.set(shareId, read)
      }
      return read.then((share) => [shareId, share] as const)
    })
    void Promise.all(requests).then((entries) => {
      if (!stopped) setLoaded((current) => ({ ...current, ...Object.fromEntries(entries) }))
    })
    return () => {
      stopped = true
    }
  }, [listed, shareBackend])

  const send = useCallback(
    async (share: PersonalShare, answer: Answer): Promise<'sent' | 'closed'> => {
      const sentAt = Date.now()
      try {
        await sendPersonalReply(shareBackend, share, personId, secret, answer, deviceId(), sentAt)
      } catch (error) {
        if (!(error instanceof ShareClosedError)) throw error
        setRefused((current) => new Set(current).add(share.shareId))
        return 'closed'
      }
      rememberAnswer(share.shareId, personId, answer, sentAt)
      setSent((current) => ({ ...current, [share.shareId]: { personId, answer, at: sentAt } }))
      return 'sent'
    },
    [shareBackend, personId, secret],
  )

  const events = useMemo((): PersonalEventView[] | null => {
    if (phase.status !== 'ready' || loaded === null) return null
    const { person, shares } = phase
    const list: PersonalEventView[] = []
    // In the hub's order, soonest first. An event added since is shown once read.
    for (const { shareId } of shares) {
      const share = hasKey(loaded, shareId) ? loaded[shareId] : null
      if (!share) continue
      const remembered = hasKey(sent, shareId) ? sent[shareId] : answeredFor(shareId).find((entry) => entry.personId === personId)
      list.push({
        shareId,
        snapshot: share.snapshot,
        open: !refused.has(shareId),
        answer: personalAnswer(hasKey(person.replies, shareId) ? person.replies[shareId] : undefined, remembered),
        send: (answer) => send(share, answer),
      })
    }
    return list
  }, [phase, loaded, sent, refused, personId, send])

  if (phase.status !== 'ready') return { status: phase.status }
  if (events === null) return { status: 'loading' }
  return { status: 'ready', name: phase.person.name, events }
}
