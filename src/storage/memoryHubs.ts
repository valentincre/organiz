import type { Sealed } from './envelope'
import { HubExistsError, type HubBackend, type StoredHub } from './hubBackend'

/**
 * Hub storage in memory, with the behavior of firestore.rules: compare-and-swap on the revision.
 * Proofs and proof of work are not checked. Watchers are called synchronously after each change,
 * and once when they start.
 */
export class MemoryHubBackend implements HubBackend {
  private readonly hubs = new Map<string, StoredHub>()
  private readonly listeners = new Map<string, Set<() => void>>()

  async createHub(hubId: string, sealed: Sealed, _auth: { nonce: string; next: string }): Promise<void> {
    if (this.hubs.has(hubId)) throw new HubExistsError()
    this.hubs.set(hubId, { rev: 1, sealed })
    this.notify(hubId)
  }

  async updateHub(hubId: string, sealed: Sealed, auth: { rev: number; proof: string; next: string }): Promise<'ok' | 'conflict'> {
    const hub = this.hubs.get(hubId)
    if (!hub) throw new Error('not-found')
    if (auth.rev !== hub.rev + 1) return 'conflict'
    this.hubs.set(hubId, { rev: auth.rev, sealed })
    this.notify(hubId)
    return 'ok'
  }

  async readHub(hubId: string): Promise<StoredHub | null> {
    return this.hubs.get(hubId) ?? null
  }

  watchHub(hubId: string, onHub: (hub: StoredHub | null) => void, _onError?: (error: unknown) => void): () => void {
    let listeners = this.listeners.get(hubId)
    if (!listeners) this.listeners.set(hubId, (listeners = new Set()))
    const callback = () => onHub(this.hubs.get(hubId) ?? null)
    listeners.add(callback)
    callback()
    return () => listeners.delete(callback)
  }

  private notify(hubId: string): void {
    for (const callback of [...(this.listeners.get(hubId) ?? [])]) callback()
  }
}
