import { describe, expect, it } from 'vitest'
import { firebaseOptions } from './firebaseConfig'

describe('firebaseOptions', () => {
  it('uses the demo project in emulator mode', () => {
    expect(firebaseOptions({ VITE_USE_EMULATOR: 'true' })).toEqual({ projectId: 'demo-organiz', apiKey: 'demo' })
  })

  it('reads the instance config', () => {
    expect(firebaseOptions({ VITE_FIREBASE_API_KEY: 'k', VITE_FIREBASE_PROJECT_ID: 'p' })).toEqual({
      apiKey: 'k',
      projectId: 'p',
    })
  })

  it('refuses a missing config', () => {
    expect(() => firebaseOptions({})).toThrow(/VITE_FIREBASE_API_KEY.*VITE_FIREBASE_PROJECT_ID.*\.env\.example/s)
  })
})
