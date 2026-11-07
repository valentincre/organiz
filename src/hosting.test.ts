import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface HeaderRule {
  source?: string
  regex?: string
  headers: { key: string; value: string }[]
}

const root = new URL('../', import.meta.url)
const html = readFileSync(new URL('index.html', root), 'utf8')
const config = JSON.parse(readFileSync(new URL('firebase.json', root), 'utf8'))
const rules: HeaderRule[] = config.hosting.headers

const header = (key: string) => rules.flatMap((rule) => rule.headers).find((h) => h.key === key)?.value ?? ''

describe('hosting headers', () => {
  it('allow every inline script of index.html by hash in the CSP', () => {
    const scriptSrc = header('Content-Security-Policy')
      .split(';')
      .find((directive) => directive.trim().startsWith('script-src'))
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1])
    expect(inline.length).toBeGreaterThan(0)
    for (const script of inline) {
      const hash = createHash('sha256').update(script).digest('base64')
      expect(scriptSrc).toContain(`'sha256-${hash}'`)
    }
  })

  it('never cache pages, only hashed assets', () => {
    const noCache = new RegExp(rules.find((rule) => rule.regex)!.regex!)
    for (const path of ['/', '/index.html', '/fr/', '/en']) expect(noCache.test(path)).toBe(true)
    for (const path of ['/assets/index-abc.js', '/favicon.svg']) expect(noCache.test(path)).toBe(false)
  })
})
