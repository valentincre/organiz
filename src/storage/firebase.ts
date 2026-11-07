import { initializeApp } from 'firebase/app'
import {
  clearIndexedDbPersistence,
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore'
import { browserStorage, startFirestore } from './cacheExpiry'
import { firebaseOptions } from './firebaseConfig'

const CACHE_SIZE_BYTES = 10 * 1024 * 1024

// The Firebase web config is public by design: it comes from the environment, and access
// is controlled by firestore.rules and the client-side encryption.
export const app = initializeApp(firebaseOptions(import.meta.env))

function init(): Firestore {
  if (import.meta.env.VITE_USE_EMULATOR === 'true') {
    const db = initializeFirestore(app, { localCache: memoryLocalCache() })
    // VITE_EMULATOR_PORT lets checks run on a private emulator beside the usual one.
    connectFirestoreEmulator(db, '127.0.0.1', Number(import.meta.env.VITE_EMULATOR_PORT ?? 8180))
    return db
  }
  // The cache holds the encrypted documents only. All tabs share it.
  return initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager(), cacheSizeBytes: CACHE_SIZE_BYTES }),
  })
}

/** Firestore, once its cache has been wiped if it expired (see cacheExpiry). */
export const dbReady: Promise<Firestore> = startFirestore({
  init,
  clear: clearIndexedDbPersistence,
  storage: browserStorage(),
  now: Date.now(),
  locks: globalThis.navigator?.locks,
})
