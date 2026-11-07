import { describe, expect, it } from 'vitest'
import { REQUIRED_BUILD_ENV, missingBuildEnv, siteOrigin } from './buildEnv'

describe('missingBuildEnv', () => {
  it('requires the Firebase config and the site URL', () => {
    expect(REQUIRED_BUILD_ENV).toEqual(['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_PROJECT_ID', 'VITE_SITE_URL'])
  })

  it('lists missing and blank variables', () => {
    expect(missingBuildEnv({ VITE_FIREBASE_API_KEY: 'k', VITE_FIREBASE_PROJECT_ID: '  ' })).toEqual([
      'VITE_FIREBASE_PROJECT_ID',
      'VITE_SITE_URL',
    ])
  })

  it('needs nothing in emulator mode', () => {
    expect(missingBuildEnv({ VITE_USE_EMULATOR: 'true' })).toEqual([])
  })
})

describe('siteOrigin', () => {
  it('drops a trailing slash', () => {
    expect(siteOrigin('https://organiz.events/')).toBe('https://organiz.events')
  })

  it('keeps a clean origin as is', () => {
    expect(siteOrigin('https://organiz.events')).toBe('https://organiz.events')
  })

  it('refuses a URL without a scheme', () => {
    expect(() => siteOrigin('organiz.events')).toThrow()
  })

  it('refuses a URL with a path', () => {
    expect(() => siteOrigin('https://a.b/path')).toThrow()
  })
})
