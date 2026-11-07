import type { Sealed } from './envelope'
import type { SealedReply } from './shareCrypto'

export interface StoredShare {
  rev: number
  sealed: Sealed
  /** Epoch ms; replies are refused from then on. */
  closesAt: number | null
  closed: boolean
  /** Replies created at or before this time (epoch ms, may be fractional) are folded and may be deleted. */
  foldedUpTo: number | null
}

export interface ShareWrite {
  sealed: Sealed
  closesAt: number | null
  closed: boolean
  foldedUpTo: number | null
}

/** `createdAt` is the storage's clock, in epoch ms (microsecond precision, so possibly fractional). */
export interface StoredReply {
  id: string
  createdAt: number
  sealed: SealedReply
}

export interface ReplyPageInfo {
  fromServer: boolean
}

/** The most replies a listener delivers; the Firestore rules refuse a larger limit. */
export const REPLY_PAGE = 500

/** Every storage access of reply links; the UI and the domain only see this. */
export interface ShareBackend {
  /** Revision 1. `next` commits to the proof of revision 2. Rejects with ShareExistsError if taken. */
  createShare(shareId: string, write: ShareWrite, auth: { nonce: string; next: string }): Promise<void>
  /** Compare-and-swap on `rev`: 'conflict' when another write took that revision first. */
  updateShare(shareId: string, write: ShareWrite, auth: { rev: number; proof: string; next: string }): Promise<'ok' | 'conflict'>
  readShare(shareId: string): Promise<StoredShare | null>
  watchShare(shareId: string, onShare: (share: StoredShare | null) => void, onError: (error: unknown) => void): () => void
  /**
   * Replies with createdAt >= since, oldest first, at most REPLY_PAGE. A page is `fromServer`
   * when it is the server's current result; otherwise it may come from a local cache or show
   * local changes the server has not confirmed yet.
   */
  watchReplies(
    shareId: string,
    since: number,
    onReplies: (replies: StoredReply[], page: ReplyPageInfo) => void,
    onError: (error: unknown) => void,
  ): () => void
  /** Rejects with ShareClosedError when the rules refuse it. */
  addReply(shareId: string, sealed: SealedReply): Promise<void>
  /** Already deleted, or not deletable yet: ignored. */
  deleteReplies(shareId: string, ids: string[]): Promise<void>
}

export class ShareClosedError extends Error {}
export class ShareExistsError extends Error {}
