// Firestore's cache has no time-to-live: it evicts by size only, and can only be
// wiped as a whole, before Firestore starts. So this device keeps when each
// dashboard was last opened, and the whole cache is wiped at startup once any of
// them is older than CACHE_DAYS. The others reload from the network next time.
// Every storage access can throw (private mode, blocked site data).

/** docId → when the dashboard was last opened on this device, in ms. */
export type CacheLog = Record<string, number>

export const CACHE_LOG_KEY = 'organiz.cache'
export const CACHE_DAYS = 30

const DAY_MS = 86_400_000

/** The page's localStorage, or undefined where it is missing or blocked (reading the property can throw). */
export function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

export function readCacheLog(storage: Storage | undefined): CacheLog {
  try {
    const log: unknown = JSON.parse(storage?.getItem(CACHE_LOG_KEY) ?? '{}')
    if (typeof log !== 'object' || log === null || Array.isArray(log)) return {}
    return Object.fromEntries(Object.entries(log).filter(([, openedAt]) => Number.isFinite(openedAt)))
  } catch {
    return {}
  }
}

export function writeCacheLog(storage: Storage | undefined, log: CacheLog): void {
  try {
    storage?.setItem(CACHE_LOG_KEY, JSON.stringify(log))
  } catch {
    // Not recorded: the cache then simply never expires on this device.
  }
}

export const hasExpired = (log: CacheLog, now: number): boolean =>
  Object.values(log).some((openedAt) => now - openedAt > CACHE_DAYS * DAY_MS)

export function markOpened(docId: string): void {
  const storage = browserStorage()
  writeCacheLog(storage, { ...readCacheLog(storage), [docId]: Date.now() })
}

/** The part of the Web Locks API (`navigator.locks`) used to tell whether another tab has the cache open. */
export interface TabLocks {
  request(
    name: string,
    options: { mode: 'exclusive' | 'shared'; ifAvailable?: boolean },
    callback: (lock: object | null) => Promise<unknown>,
  ): Promise<unknown>
}

/** Held in shared mode by every tab with Firestore, for its lifetime. */
const CACHE_LOCK = 'organiz.firestore-cache'

export interface FirestoreStartup<Db> {
  /** Creates the Firestore instance, without starting it. */
  init(): Db
  /** Wipes the persistent cache of a Firestore instance not yet started. */
  clear(db: Db): Promise<void>
  storage?: Storage
  now: number
  /** Without Web Locks (old browsers, insecure contexts), the cache is never wiped. */
  locks?: TabLocks
}

/**
 * Creates Firestore, first wiping its cache if it has expired, and resolves once
 * this tab holds the shared cache lock. Generic over the instance so this file
 * stays free of Firebase.
 */
export async function startFirestore<Db>({ init, clear, storage, now, locks }: FirestoreStartup<Db>): Promise<Db> {
  const db = init()
  if (hasExpired(readCacheLog(storage), now)) await wipe(() => clear(db), storage, locks)
  await holdSharedLock(locks)
  return db
}

/**
 * Wipes the cache only when no other tab has it open. Firestore does not refuse
 * the wipe then: deleting the database makes every other tab terminate its
 * Firestore, losing its listener and its pending writes. So the wipe takes the
 * exclusive lock if no tab holds the shared one. The cost: while another tab
 * stays open, the cache is kept, and the wipe is tried again at each startup.
 */
async function wipe(clear: () => Promise<void>, storage: Storage | undefined, locks: TabLocks | undefined): Promise<void> {
  if (!locks) return
  try {
    await locks.request(CACHE_LOCK, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
      if (!lock) {
        console.warn('Firestore cache kept: another tab has it open')
        return
      }
      await clear()
      // Inside the lock, so a tab starting right after reads the new log.
      writeCacheLog(storage, {})
    })
  } catch (error) {
    // The log is kept: the wipe is tried again at the next startup.
    console.warn('Firestore cache not wiped', error)
  }
}

/**
 * Takes this tab's shared lock, held until the tab closes. While a wipe holds
 * the exclusive lock, this waits for it, so Firestore never starts during one.
 */
function holdSharedLock(locks: TabLocks | undefined): Promise<void> {
  return new Promise((held) => {
    if (!locks) return held()
    locks
      .request(CACHE_LOCK, { mode: 'shared' }, () => {
        held()
        return new Promise(() => {})
      })
      // Locks refused (e.g. a sandboxed page): Firestore still starts.
      .catch(() => held())
  })
}
