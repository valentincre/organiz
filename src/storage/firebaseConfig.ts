import type { FirebaseOptions } from 'firebase/app'

/**
 * Firebase options from the environment. Firestore only needs the API key and the project id.
 * The emulator uses a fixed demo project, so it needs no real config.
 */
export function firebaseOptions(env: Record<string, string | undefined>): FirebaseOptions {
  if (env.VITE_USE_EMULATOR === 'true') return { projectId: 'demo-organiz', apiKey: 'demo' }
  const { VITE_FIREBASE_API_KEY: apiKey, VITE_FIREBASE_PROJECT_ID: projectId } = env
  if (!apiKey || !projectId) {
    throw new Error('Missing VITE_FIREBASE_API_KEY or VITE_FIREBASE_PROJECT_ID: copy .env.example to .env.local')
  }
  return { apiKey, projectId }
}
