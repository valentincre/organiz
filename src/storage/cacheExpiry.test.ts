import { afterEach, describe, expect, it, vi } from 'vitest'
import { CACHE_LOG_KEY, hasExpired, markOpened, readCacheLog, startFirestore, writeCacheLog, type TabLocks } from './cacheExpiry'

const DAY = 86_400_000
const fakeDb = { name: 'db' }

/** The parts of Storage the cache log uses, kept in a map. */
function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  } as Storage
}

/** Storage in private mode or with site data blocked: every access throws. */
function throwingStorage(): Storage {
  const blocked = () => {
    throw new Error('SecurityError')
  }
  return { getItem: blocked, setItem: blocked } as unknown as Storage
}

/**
 * Web Locks as seen by one tab: the exclusive lock is granted unless another tab
 * holds the cache, and the shared one when `grantShared` runs (at once by
 * default). `events` records the requests, and the wipe through `clear`.
 */
function fakeTabs({ otherTabOpen = false, sharedDelayed = false } = {}) {
  const events: string[] = []
  let grantShared = () => {}
  const locks: TabLocks = {
    request: async (_name, { mode, ifAvailable }, callback) => {
      events.push(ifAvailable ? `${mode} if available` : mode)
      if (mode === 'exclusive') return callback(otherTabOpen ? null : {})
      if (sharedDelayed) await new Promise<void>((resolve) => (grantShared = resolve))
      events.push('shared granted')
      return callback({})
    },
  }
  const clear = vi.fn(async () => void events.push('clear'))
  return { locks, clear, events, grantShared: () => grantShared() }
}

const expiredLog = () => memoryStorage({ [CACHE_LOG_KEY]: JSON.stringify({ a: 0 }) })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('cache expiry', () => {
  it('expires when any dashboard is older than 30 days', () => {
    expect(hasExpired({ a: 0, b: 31 * DAY }, 31 * DAY)).toBe(true)
    expect(hasExpired({ a: 2 * DAY }, 31 * DAY)).toBe(false)
    expect(hasExpired({}, 31 * DAY)).toBe(false)
  })

  it('wipes the cache and the log on expiry, then holds the shared lock', async () => {
    const { locks, clear, events } = fakeTabs()
    const storage = expiredLog()
    expect(await startFirestore({ init: () => fakeDb, clear, storage, now: 31 * DAY, locks })).toBe(fakeDb)
    expect(clear).toHaveBeenCalledExactlyOnceWith(fakeDb)
    expect(events).toEqual(['exclusive if available', 'clear', 'shared', 'shared granted'])
    expect(readCacheLog(storage)).toEqual({})
  })

  it('keeps the cache while another tab has it open', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { locks, clear, events } = fakeTabs({ otherTabOpen: true })
    const storage = expiredLog()
    expect(await startFirestore({ init: () => fakeDb, clear, storage, now: 31 * DAY, locks })).toBe(fakeDb)
    expect(clear).not.toHaveBeenCalled()
    expect(events).toEqual(['exclusive if available', 'shared', 'shared granted'])
    expect(readCacheLog(storage)).toEqual({ a: 0 })
  })

  it('keeps the log when the wipe fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { locks } = fakeTabs()
    const storage = expiredLog()
    const clear = async () => {
      throw new Error('IndexedDB error')
    }
    expect(await startFirestore({ init: () => fakeDb, clear, storage, now: 31 * DAY, locks })).toBe(fakeDb)
    expect(readCacheLog(storage)).toEqual({ a: 0 })
  })

  it('keeps the cache while every dashboard is recent, and still holds the shared lock', async () => {
    const { locks, clear, events } = fakeTabs()
    const storage = memoryStorage({ [CACHE_LOG_KEY]: JSON.stringify({ a: 2 * DAY }) })
    await startFirestore({ init: () => fakeDb, clear, storage, now: 31 * DAY, locks })
    expect(clear).not.toHaveBeenCalled()
    expect(events).toEqual(['shared', 'shared granted'])
    expect(readCacheLog(storage)).toEqual({ a: 2 * DAY })
  })

  it('gives Firestore only once the shared lock is held', async () => {
    const { locks, clear, grantShared } = fakeTabs({ sharedDelayed: true })
    let started = false
    const db = startFirestore({ init: () => fakeDb, clear, storage: expiredLog(), now: 31 * DAY, locks }).then((db) => {
      started = true
      return db
    })
    await vi.waitFor(() => expect(clear).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(started).toBe(false)
    grantShared()
    expect(await db).toBe(fakeDb)
  })

  it('never wipes without Web Locks', async () => {
    const clear = vi.fn(async () => {})
    const storage = expiredLog()
    expect(await startFirestore({ init: () => fakeDb, clear, storage, now: 31 * DAY })).toBe(fakeDb)
    expect(clear).not.toHaveBeenCalled()
    expect(readCacheLog(storage)).toEqual({ a: 0 })
  })

  it('survives unavailable storage', async () => {
    const { locks, clear } = fakeTabs()
    expect(readCacheLog(throwingStorage())).toEqual({})
    expect(readCacheLog(undefined)).toEqual({})
    expect(() => writeCacheLog(throwingStorage(), { a: 0 })).not.toThrow()
    expect(await startFirestore({ init: () => fakeDb, clear, storage: throwingStorage(), now: 0, locks })).toBe(fakeDb)
  })

  it('ignores a log that is not one', () => {
    expect(readCacheLog(memoryStorage({ [CACHE_LOG_KEY]: 'not json' }))).toEqual({})
    expect(readCacheLog(memoryStorage({ [CACHE_LOG_KEY]: '[1]' }))).toEqual({})
    expect(readCacheLog(memoryStorage({ [CACHE_LOG_KEY]: JSON.stringify({ a: 'x', b: 5 }) }))).toEqual({ b: 5 })
  })

  it('records when a dashboard is opened', () => {
    const storage = memoryStorage({ [CACHE_LOG_KEY]: JSON.stringify({ a: 0 }) })
    vi.stubGlobal('localStorage', storage)
    vi.useFakeTimers({ now: 3 * DAY })
    markOpened('b')
    markOpened('a')
    expect(readCacheLog(storage)).toEqual({ a: 3 * DAY, b: 3 * DAY })
  })
})
