import { describe, expect, it } from 'vitest'
import { releaseUrl } from './appInfo'

const SOURCE = 'https://github.com/valentincre/organiz'

describe('releaseUrl', () => {
  it('links a released version to its tag', () => {
    expect(releaseUrl('0.3.1', SOURCE)).toBe(`${SOURCE}/releases/tag/v0.3.1`)
  })

  it('has no link for a dev or empty version', () => {
    expect(releaseUrl('0.0.0-dev', SOURCE)).toBeUndefined()
    expect(releaseUrl('', SOURCE)).toBeUndefined()
  })

  it('ignores a trailing slash on the source URL', () => {
    expect(releaseUrl('0.3.1', 'https://github.com/x/y/')).toBe('https://github.com/x/y/releases/tag/v0.3.1')
  })
})
