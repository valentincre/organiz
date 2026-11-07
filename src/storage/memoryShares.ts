import {
  REPLY_PAGE,
  ShareClosedError,
  ShareExistsError,
  type ReplyPageInfo,
  type ShareBackend,
  type ShareWrite,
  type StoredReply,
  type StoredShare,
} from './shareBackend'
import type { SealedReply } from './shareCrypto'

interface Entry {
  share: StoredShare
  replies: StoredReply[]
}

/**
 * Share storage in memory, with the behavior of firestore.rules: compare-and-swap on the
 * revision, replies only while the share is open, a closed share never reopens, only folded
 * replies can be deleted. Proofs and proof of work are not checked. Listeners are called
 * synchronously after each change, and once when they start.
 */
export class MemoryShareBackend implements ShareBackend {
  private readonly shares = new Map<string, Entry>()
  private readonly shareListeners = new Map<string, Set<() => void>>()
  private readonly replyListeners = new Map<string, Set<() => void>>()
  private readonly now: () => number
  private nextId = 1

  constructor({ now }: { now: () => number }) {
    this.now = now
  }

  async createShare(shareId: string, write: ShareWrite, _auth: { nonce: string; next: string }): Promise<void> {
    if (this.shares.has(shareId)) throw new ShareExistsError()
    // Like the rules: a share is created open.
    if (write.closed) throw new Error('permission-denied: a share is created open')
    this.shares.set(shareId, { share: { rev: 1, ...write }, replies: [] })
    this.notify(this.shareListeners, shareId)
  }

  async updateShare(shareId: string, write: ShareWrite, auth: { rev: number; proof: string; next: string }): Promise<'ok' | 'conflict'> {
    const entry = this.shares.get(shareId)
    if (!entry) throw new Error('not-found')
    const { share } = entry
    if (auth.rev !== share.rev + 1) return 'conflict'
    const reopens = share.closed && !write.closed
    const movesPassedClose = share.closesAt !== null && this.now() >= share.closesAt && write.closesAt !== share.closesAt
    if (reopens || movesPassedClose) throw new Error('permission-denied')
    entry.share = { rev: auth.rev, ...write }
    this.notify(this.shareListeners, shareId)
    return 'ok'
  }

  async readShare(shareId: string): Promise<StoredShare | null> {
    return this.shares.get(shareId)?.share ?? null
  }

  watchShare(shareId: string, onShare: (share: StoredShare | null) => void, _onError?: (error: unknown) => void): () => void {
    return this.listen(this.shareListeners, shareId, () => onShare(this.shares.get(shareId)?.share ?? null))
  }

  /** Every page is the server's: there is no cache. */
  watchReplies(
    shareId: string,
    since: number,
    onReplies: (replies: StoredReply[], page: ReplyPageInfo) => void,
    _onError?: (error: unknown) => void,
  ): () => void {
    return this.listen(this.replyListeners, shareId, () => {
      const replies = (this.shares.get(shareId)?.replies ?? []).filter((r) => r.createdAt >= since)
      onReplies(replies.slice(0, REPLY_PAGE), { fromServer: true })
    })
  }

  async addReply(shareId: string, sealed: SealedReply): Promise<void> {
    const entry = this.shares.get(shareId)
    const createdAt = this.now()
    if (!entry || entry.share.closed || (entry.share.closesAt !== null && createdAt >= entry.share.closesAt)) {
      throw new ShareClosedError()
    }
    entry.replies.push({ id: `r${this.nextId++}`, createdAt, sealed })
    this.notify(this.replyListeners, shareId)
  }

  async deleteReplies(shareId: string, ids: string[]): Promise<void> {
    const entry = this.shares.get(shareId)
    const { closed, foldedUpTo } = entry?.share ?? {}
    if (!entry || !closed || foldedUpTo == null) return
    const doomed = new Set(ids)
    const before = entry.replies.length
    entry.replies = entry.replies.filter((r) => !(doomed.has(r.id) && r.createdAt <= foldedUpTo))
    if (entry.replies.length !== before) this.notify(this.replyListeners, shareId)
  }

  private listen(registry: Map<string, Set<() => void>>, shareId: string, callback: () => void): () => void {
    let listeners = registry.get(shareId)
    if (!listeners) registry.set(shareId, (listeners = new Set()))
    listeners.add(callback)
    callback()
    return () => listeners.delete(callback)
  }

  private notify(registry: Map<string, Set<() => void>>, shareId: string): void {
    for (const callback of [...(registry.get(shareId) ?? [])]) callback()
  }
}
