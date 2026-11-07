import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import type { Firestore } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach } from 'vitest'
import { FirestoreHubBackend } from '../src/storage/firestoreHubs'
import { describeHubBackend } from '../src/storage/hubBackendContract'

// The emulator port is overridable so a private emulator can run beside `npm run emulators`.
const PORT = Number(process.env.FIRESTORE_EMULATOR_PORT ?? 8180)

let env: RulesTestEnvironment

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-organiz',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: PORT },
  })
})
beforeEach(() => env.clearFirestore())
afterAll(() => env.cleanup())

describeHubBackend(
  () => new FirestoreHubBackend(Promise.resolve(env.unauthenticatedContext().firestore() as unknown as Firestore)),
)
