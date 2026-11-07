import {
  addDoc,
  Bytes,
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  type DocumentData,
  type Firestore,
  type FirestoreError,
} from 'firebase/firestore'
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

const SHARES = 'shares'
const REPLIES = 'replies'
/** Version of the stored share; mirrored in firestore.rules. */
const SHARE_VERSION = 1

const codeOf = (error: unknown) => (error as FirestoreError | null)?.code
// By code, not `instanceof FirestoreError`: a denied write rejects with a plain FirebaseError.
const isPermissionDenied = (error: unknown) => codeOf(error) === 'permission-denied'

const toTimestamp = (ms: number | null) => (ms === null ? null : Timestamp.fromMillis(ms))

/**
 * An epoch ms value (a `foldedUpTo`, or a reply's `createdAt`) as a Timestamp, without losing its fraction. The rules compare a
 * reply's `createdAt` with `foldedUpTo` at microsecond precision, and `createdAt.toMillis()`
 * is a fractional number of ms: `Timestamp.fromMillis` would floor the nanoseconds and could
 * land just below the newest folded reply, which would then never become deletable. Rounding
 * to the nearest microsecond gives back exactly the `createdAt` the value came from (a double
 * at this magnitude is accurate to about 0.25 microsecond), so replies created at or before
 * it stay deletable and any reply created even 1 microsecond later is not.
 */
const exactTimestamp = (ms: number | null) => {
  if (ms === null) return null
  const micros = Math.round(ms * 1000)
  const seconds = Math.floor(micros / 1_000_000)
  return new Timestamp(seconds, (micros - seconds * 1_000_000) * 1000)
}

const millisOf = (value: Timestamp | null | undefined) => (value ? value.toMillis() : null)

function shareFields(write: ShareWrite, rev: number, proof: string, next: string) {
  return {
    v: SHARE_VERSION,
    iv: write.sealed.iv,
    ct: Bytes.fromUint8Array(write.sealed.ct),
    closesAt: toTimestamp(write.closesAt),
    closed: write.closed,
    foldedUpTo: exactTimestamp(write.foldedUpTo),
    rev,
    next,
    proof,
    updatedAt: serverTimestamp(),
  }
}

function toStoredShare(data: DocumentData): StoredShare {
  return {
    rev: data.rev,
    sealed: { iv: data.iv, ct: (data.ct as Bytes).toUint8Array() as Uint8Array<ArrayBuffer> },
    closesAt: millisOf(data.closesAt),
    closed: data.closed,
    foldedUpTo: millisOf(data.foldedUpTo),
  }
}

/** Reply links stored in Firestore, under the `shares` rules. */
export class FirestoreShareBackend implements ShareBackend {
  private readonly db: Promise<Firestore>

  constructor(db: Promise<Firestore>) {
    this.db = db
  }

  async createShare(shareId: string, write: ShareWrite, auth: { nonce: string; next: string }): Promise<void> {
    const ref = doc(await this.db, SHARES, shareId)
    try {
      // On create, `proof` carries the proof of work.
      await setDoc(ref, shareFields(write, 1, auth.nonce, auth.next))
    } catch (error) {
      if (!isPermissionDenied(error)) throw error
      // Over an existing share the write is an update, which the rules deny.
      if ((await getDocFromServer(ref)).exists()) throw new ShareExistsError()
      throw error
    }
  }

  async updateShare(shareId: string, write: ShareWrite, auth: { rev: number; proof: string; next: string }): Promise<'ok' | 'conflict'> {
    const ref = doc(await this.db, SHARES, shareId)
    try {
      await updateDoc(ref, shareFields(write, auth.rev, auth.proof, auth.next))
      return 'ok'
    } catch (error) {
      if (!isPermissionDenied(error)) throw error
      const snap = await getDocFromServer(ref)
      // The revision was not taken by someone else: the write itself was refused.
      if (!snap.exists() || (snap.data().rev as number) < auth.rev) throw error
      return 'conflict'
    }
  }

  async readShare(shareId: string): Promise<StoredShare | null> {
    const snap = await getDocFromServer(doc(await this.db, SHARES, shareId))
    return snap.exists() ? toStoredShare(snap.data()) : null
  }

  watchShare(shareId: string, onShare: (share: StoredShare | null) => void, onError: (error: unknown) => void): () => void {
    return this.listen(async (db) =>
      onSnapshot(
        doc(db, SHARES, shareId),
        (snap) => onShare(snap.exists() ? toStoredShare(snap.data()) : null),
        onError,
      ),
    onError)
  }

  watchReplies(
    shareId: string,
    since: number,
    onReplies: (replies: StoredReply[], page: ReplyPageInfo) => void,
    onError: (error: unknown) => void,
  ): () => void {
    return this.listen(async (db) =>
      onSnapshot(
        // The rules require a limit of at most 500.
        query(collection(db, SHARES, shareId, REPLIES), where('createdAt', '>=', exactTimestamp(since)), orderBy('createdAt'), limit(REPLY_PAGE)),
        // Metadata changes tell when a cached page, or one with local deletes, is confirmed by the server.
        { includeMetadataChanges: true },
        (snap) => {
          const replies: StoredReply[] = []
          for (const d of snap.docs) {
            // Its server timestamp is not resolved yet: the confirmed version comes next.
            if (d.metadata.hasPendingWrites) continue
            const data = d.data()
            replies.push({
              id: d.id,
              createdAt: (data.createdAt as Timestamp).toMillis(),
              sealed: {
                iv: data.iv,
                ct: (data.ct as Bytes).toUint8Array() as Uint8Array<ArrayBuffer>,
                ...(data.epk === undefined ? {} : { epk: data.epk as string }),
              },
            })
          }
          onReplies(replies, { fromServer: !snap.metadata.fromCache && !snap.metadata.hasPendingWrites })
        },
        onError,
      ),
    onError)
  }

  async addReply(shareId: string, sealed: SealedReply): Promise<void> {
    const db = await this.db
    try {
      await addDoc(collection(db, SHARES, shareId, REPLIES), {
        createdAt: serverTimestamp(),
        iv: sealed.iv,
        ct: Bytes.fromUint8Array(sealed.ct),
        ...(sealed.epk === undefined ? {} : { epk: sealed.epk }),
      })
    } catch (error) {
      if (isPermissionDenied(error)) throw new ShareClosedError()
      throw error
    }
  }

  async deleteReplies(shareId: string, ids: string[]): Promise<void> {
    const db = await this.db
    await Promise.all(
      ids.map(async (id) => {
        try {
          await deleteDoc(doc(db, SHARES, shareId, REPLIES, id))
        } catch (error) {
          // A reply that is already gone is denied like one that is not deletable yet
          // (the rules see no resource): both are ignored.
          if (!isPermissionDenied(error) && codeOf(error) !== 'not-found') throw error
        }
      }),
    )
  }

  /** Subscribes once Firestore is ready; the returned function works at any time, even before that. */
  private listen(subscribe: (db: Firestore) => Promise<() => void>, onError: (error: unknown) => void): () => void {
    let stopped = false
    let unsubscribe: (() => void) | null = null
    this.db.then(subscribe).then(
      (stop) => (stopped ? stop() : (unsubscribe = stop)),
      onError,
    )
    return () => {
      stopped = true
      unsubscribe?.()
    }
  }
}
