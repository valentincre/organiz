import type { HubContent, HubPerson } from '../domain/hub'
import { hasKey } from '../domain/limits'
import type { ShareSnapshot } from '../domain/shareSnapshot'
import type { Answer, PersonId, Reply, ShareId } from '../domain/types'
import { DecryptError } from '../storage/crypto'
import type { Sealed } from '../storage/envelope'
import { openHub, openHubPerson } from '../storage/hubCrypto'
import { signReply } from '../storage/personalCrypto'
import type { ShareBackend } from '../storage/shareBackend'
import { importShareKey, openSnapshot, sealReply } from '../storage/shareCrypto'
import type { Answered } from './replyMemory'

// The storage steps of a personal page, apart from React so they can be tested on the memory backends.

/** A listed event as the personal page loaded it, once. */
export interface PersonalShare {
  shareId: ShareId
  shareKey: CryptoKey
  snapshot: ShareSnapshot
  closesAt: number | null
}

export type OpenedPerson = { status: 'revoked' } | { status: 'ready'; person: HubPerson; shares: HubContent['shares'] }

/**
 * Opens the hub, then the person's own entry. 'revoked' when the hub has no entry for the person,
 * or one their secret does not open (the link was made again). Rejects with `DecryptError` when
 * the hub key does not open the hub.
 */
export async function openPersonalHub(hubKey: CryptoKey, hubId: string, personId: PersonId, secret: string, sealed: Sealed): Promise<OpenedPerson> {
  const { shares, sealedPeople } = await openHub(hubKey, hubId, sealed)
  if (!hasKey(sealedPeople, personId)) return { status: 'revoked' }
  try {
    return { status: 'ready', person: await openHubPerson(secret, hubId, personId, sealedPeople[personId]), shares }
  } catch (error) {
    if (error instanceof DecryptError) return { status: 'revoked' }
    throw error
  }
}

/**
 * Reads a listed link once and opens it. Null when it no longer exists, is closed, has passed its
 * closing time at `now`, is not a presence link, or its key does not open it. Storage errors reject.
 */
export async function loadPersonalShare(backend: ShareBackend, shareId: ShareId, key: string, now: number): Promise<PersonalShare | null> {
  const stored = await backend.readShare(shareId)
  if (!stored || stored.closed || (stored.closesAt !== null && now >= stored.closesAt)) return null
  try {
    const shareKey = await importShareKey(key)
    const snapshot = await openSnapshot(shareKey, shareId, stored.sealed)
    if (snapshot.kind !== 'presence') return null
    return { shareId, shareKey, snapshot, closesAt: stored.closesAt }
  } catch (error) {
    if (error instanceof DecryptError) return null
    throw error
  }
}

/** This device's last answer when newer than the hub's, else the hub's. */
export function personalAnswer(hub: { answer: Reply; at: number } | undefined, remembered: Answered | undefined): Reply | null {
  const mine = remembered?.answer
  if (remembered && (mine === 'yes' || mine === 'no' || mine === 'none') && (!hub || remembered.at > hub.at)) {
    return mine === 'none' ? null : mine
  }
  return hub?.answer ?? null
}

/**
 * Sends a reply through a personal link: signed with the person's secret, then sealed like any
 * reply, with the share key (public) or to the organizers' public key (private). Rejects with
 * `ShareClosedError` when the link refuses it.
 */
export async function sendPersonalReply(
  backend: ShareBackend,
  share: PersonalShare,
  personId: PersonId,
  secret: string,
  answer: Answer,
  device: string,
  sentAt: number,
): Promise<void> {
  const { shareId, shareKey, snapshot } = share
  const mac = await signReply(secret, { shareId, personId, answer, device, sentAt })
  const to = snapshot.visibility === 'public' ? { shareKey } : { publicKey: snapshot.publicKey! }
  await backend.addReply(shareId, await sealReply(to, shareId, { personId, answer, device, via: 'personal', mac, sentAt }))
}
