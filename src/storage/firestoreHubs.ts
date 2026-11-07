import {
  Bytes,
  doc,
  getDocFromServer,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  type DocumentData,
  type Firestore,
  type FirestoreError,
} from 'firebase/firestore'
import type { Sealed } from './envelope'
import { HubExistsError, type HubBackend, type StoredHub } from './hubBackend'

const HUBS = 'hubs'
/** Version of the stored hub; mirrored in firestore.rules. */
const HUB_VERSION = 1

// By code, not `instanceof FirestoreError`: a denied write rejects with a plain FirebaseError.
const isPermissionDenied = (error: unknown) => (error as FirestoreError | null)?.code === 'permission-denied'

function hubFields(sealed: Sealed, rev: number, proof: string, next: string) {
  return {
    v: HUB_VERSION,
    iv: sealed.iv,
    ct: Bytes.fromUint8Array(sealed.ct),
    rev,
    next,
    proof,
    updatedAt: serverTimestamp(),
  }
}

const toStoredHub = (data: DocumentData): StoredHub => ({
  rev: data.rev,
  sealed: { iv: data.iv, ct: (data.ct as Bytes).toUint8Array() as Uint8Array<ArrayBuffer> },
})

/** The hub of personal links stored in Firestore, under the `hubs` rules. */
export class FirestoreHubBackend implements HubBackend {
  private readonly db: Promise<Firestore>

  constructor(db: Promise<Firestore>) {
    this.db = db
  }

  async createHub(hubId: string, sealed: Sealed, auth: { nonce: string; next: string }): Promise<void> {
    const ref = doc(await this.db, HUBS, hubId)
    try {
      // On create, `proof` carries the proof of work.
      await setDoc(ref, hubFields(sealed, 1, auth.nonce, auth.next))
    } catch (error) {
      if (!isPermissionDenied(error)) throw error
      // Over an existing hub the write is an update, which the rules deny.
      if ((await getDocFromServer(ref)).exists()) throw new HubExistsError()
      throw error
    }
  }

  async updateHub(hubId: string, sealed: Sealed, auth: { rev: number; proof: string; next: string }): Promise<'ok' | 'conflict'> {
    const ref = doc(await this.db, HUBS, hubId)
    try {
      await updateDoc(ref, hubFields(sealed, auth.rev, auth.proof, auth.next))
      return 'ok'
    } catch (error) {
      if (!isPermissionDenied(error)) throw error
      const snap = await getDocFromServer(ref)
      // The revision was not taken by someone else: the write itself was refused.
      if (!snap.exists() || (snap.data().rev as number) < auth.rev) throw error
      return 'conflict'
    }
  }

  async readHub(hubId: string): Promise<StoredHub | null> {
    const snap = await getDocFromServer(doc(await this.db, HUBS, hubId))
    return snap.exists() ? toStoredHub(snap.data()) : null
  }

  watchHub(hubId: string, onHub: (hub: StoredHub | null) => void, onError: (error: unknown) => void): () => void {
    let stopped = false
    let unsubscribe: (() => void) | null = null
    // Subscribes once Firestore is ready; the returned function works at any time, even before that.
    this.db
      .then((db) => onSnapshot(doc(db, HUBS, hubId), (snap) => onHub(snap.exists() ? toStoredHub(snap.data()) : null), onError))
      .then((stop) => (stopped ? stop() : (unsubscribe = stop)), onError)
    return () => {
      stopped = true
      unsubscribe?.()
    }
  }
}
