import { todayIso } from '../domain/dates'
import type { Mutation } from '../domain/types'
import type { DashboardSnapshot, DashboardStore } from '../storage/dashboardStore'
import { buildDemoState } from './demoData'

/** In-memory dashboard: edits apply instantly and are never sent anywhere. */
export class DemoSession implements DashboardStore {
  readonly canEdit = true
  /** The demo is never stored, so it has nothing to share. */
  readonly readLink = null
  private snapshot: DashboardSnapshot
  private readonly listeners = new Set<() => void>()

  /** `share`: the demo's reply link (see buildDemoState). */
  constructor(name: string, today = todayIso(), lang: 'en' | 'fr' = 'en', share?: { id: string; key: string }) {
    this.snapshot = { state: buildDemoState(name, today, lang, share), confirmed: true, loadError: null, saving: false, writing: false, saveError: null }
  }

  async start(): Promise<void> {}

  stop(): void {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): DashboardSnapshot => this.snapshot

  /** Edits are never sent anywhere, so the save options mean nothing here. */
  mutate = (mutation: Mutation): void => {
    const state = this.snapshot.state && mutation(this.snapshot.state)
    if (state === this.snapshot.state) return
    this.snapshot = { ...this.snapshot, state }
    for (const listener of this.listeners) listener()
  }

  flushNow = (): void => {}

  retry = (): void => {}
}
