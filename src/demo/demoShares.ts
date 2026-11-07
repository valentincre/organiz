import { generateKeyString } from '../storage/crypto'
import { MemoryShareBackend } from '../storage/memoryShares'
import type { ShareSyncOptions } from '../storage/shareSync'

// Kept light: the reply page's chunk imports it for the demo's reply link. ShareSync is only a type here.

/**
 * The demo's reply link: a fixed id, and a key drawn once per page load, like the rest of the
 * demo. A reload builds a new demo, so the link of the previous one stops working.
 */
export const DEMO_SHARE: { id: string; key: string } = { id: 'demoPresenceReplyLink1', key: generateKeyString() }

let backend: MemoryShareBackend | null = null

/** The demo's reply links live in this tab only: the dashboard and the reply page share this backend. */
export const demoShareBackend = (): MemoryShareBackend => (backend ??= new MemoryShareBackend({ now: Date.now }))

let editKey: Promise<CryptoKey> | null = null

/**
 * How the demo's ShareSync writes: the memory backend checks neither proofs nor proof of work,
 * so a random key signs the proofs (the demo has no edit secret to derive one from) and the proof
 * of work is skipped. Changes are written at once: nothing is sent anywhere.
 */
export const demoShareSyncOptions: Pick<ShareSyncOptions, 'delay' | 'solvePow' | 'editKey'> = {
  delay: { idle: 0, max: 0 },
  solvePow: async () => '',
  editKey: () => (editKey ??= crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])),
}
