import { useRef, useState } from 'react'
import { openShareOf, sharesOf } from '../../domain/shares'
import type { DashboardState, EventId, Mutation, PersonId, ShareEntry, ShareId, ShareKind } from '../../domain/types'
import { generateKeyString } from '../../storage/crypto'
import { newDocId } from '../../storage/dashboardStore'
import { buildReplyLink } from '../../storage/link'
import { downloadFile } from '../download'
import { copyPending } from '../useCopyLink'
import { createPersonalLinkMutation, personalLinkOf } from './personalActions'
import { qrPng } from './qr'
import { useNowPassing } from './useNowPassing'

/** The downloaded PNG is large enough to print. */
const PNG_SIZE = 1024

interface LinkCreation {
  state: DashboardState
  eventId: EventId
  kind: ShareKind
  mutate: (mutation: Mutation) => void
  /** The new link made it to the clipboard. */
  onCopied: (shareId: ShareId) => void
  /** Copies the new link; false in the demo, whose links work in its tab only. Default true. */
  copy?: boolean
}

/**
 * A link created by a click: `create` draws its ids, saves the mutation `open`
 * builds from them, and copies the link. `failed` once the link could not be
 * created, the state having refused it (at the link limit) or a step having failed.
 */
export function useLinkCreation(
  { state, eventId, kind, mutate, onCopied, copy = true }: LinkCreation,
  open: (ids: { shareId: ShareId; key: string }) => Promise<Mutation>,
): { busy: boolean; failed: boolean; create: () => Promise<void> } {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  /** Saves the link and returns it; fails rather than hand out a link the state refused. */
  const createLink = async (ids: { shareId: ShareId; key: string }): Promise<string> => {
    const mutation = await open(ids)
    if (openShareOf(mutation(state), eventId, kind, Date.now())?.[0] !== ids.shareId) throw new Error('The link was not created')
    mutate(mutation)
    return buildReplyLink(ids.shareId, ids.key, window.location.origin)
  }

  const create = async () => {
    if (busy) return
    setBusy(true)
    setFailed(false)
    const ids = { shareId: newDocId(), key: generateKeyString() }
    const link = createLink(ids)
    // Started before any await, while the click still allows copying; a refusal only means the person copies it by hand.
    const copied = copy ? copyPending(link) : Promise.resolve(false)
    try {
      await link
      if (await copied) onCopied(ids.shareId)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return { busy, failed, create }
}

/** Downloads the link's QR code as a PNG named `fileName`; the flag tells it failed. */
export function useQrDownload(link: string, fileName: string): [() => Promise<void>, boolean] {
  const [failed, setFailed] = useState(false)
  const download = async () => {
    setFailed(false)
    try {
      downloadFile(fileName, [await qrPng(link, PNG_SIZE)], 'image/png')
    } catch {
      setFailed(true)
    }
  }
  return [download, failed]
}

/** The event's open roll-call link, followed as its closing time passes. */
export function useOpenCallLink(state: DashboardState, eventId: EventId): [ShareId, ShareEntry] | undefined {
  const calls = sharesOf(state, eventId).filter(([, share]) => share.kind === 'call')
  const now = useNowPassing(calls.map(([, share]) => share.closesAt))
  return openShareOf(state, eventId, 'call', now)
}

/**
 * Creates a person's link with a click and copies it. The ids are drawn and the
 * mutation applied to `state` first: the link is saved and copied only when the
 * result holds the secret just drawn. Resolves to that link and whether the
 * clipboard took it, or to null when nothing was created (the person already had
 * a link, or a click was already at work). Once saved, a newer state may still give the person
 * another organizer's link, created at the same time: the caller shows the link
 * the state has, never the one returned here.
 */
export function usePersonalLinkCreation(state: DashboardState, personId: PersonId, mutate: (mutation: Mutation) => void): () => Promise<{ link: string; copied: boolean } | null> {
  // A second click before the state shows the new link would draw a second one.
  const working = useRef(false)
  return async () => {
    if (working.current) return null
    const ids = { hubId: newDocId(), hubKey: generateKeyString(), secret: generateKeyString() }
    const mutation = createPersonalLinkMutation(state, personId, ids)
    const next = mutation(state)
    const link = personalLinkOf(next, personId, window.location.origin)
    if (!link || next.personalLinks?.[personId]?.secret !== ids.secret) return null
    working.current = true
    mutate(mutation)
    try {
      // Started before any await, while the click still allows copying.
      return { link, copied: await copyPending(Promise.resolve(link)) }
    } finally {
      working.current = false
    }
  }
}
