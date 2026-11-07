import type { Sealed } from './envelope'

export interface StoredHub {
  rev: number
  sealed: Sealed
}

/** Every storage access of the hub document of personal links; the UI and the domain only see this. */
export interface HubBackend {
  /** Revision 1 with a proof of work. `next` commits to the proof of revision 2. Rejects with HubExistsError if taken. */
  createHub(hubId: string, sealed: Sealed, auth: { nonce: string; next: string }): Promise<void>
  /** Compare-and-swap on `rev`: 'conflict' when another write took that revision first. */
  updateHub(hubId: string, sealed: Sealed, auth: { rev: number; proof: string; next: string }): Promise<'ok' | 'conflict'>
  readHub(hubId: string): Promise<StoredHub | null>
  watchHub(hubId: string, onHub: (hub: StoredHub | null) => void, onError: (error: unknown) => void): () => void
}

export class HubExistsError extends Error {}
