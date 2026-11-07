// Build-time environment rules. Pure, so vite.config.ts and the prerender script can share them.
type Env = Record<string, string | undefined>

export const REQUIRED_BUILD_ENV: readonly string[] = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_PROJECT_ID', 'VITE_SITE_URL']

/** Required variables that are unset or blank. Emulator builds need none. */
export function missingBuildEnv(env: Env): string[] {
  if (env.VITE_USE_EMULATOR === 'true') return []
  return REQUIRED_BUILD_ENV.filter((name) => !env[name]?.trim())
}

/** The site origin without a trailing slash. Throws if the URL is not a bare http(s) origin. */
export function siteOrigin(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`VITE_SITE_URL must be a full URL such as https://example.com, got "${url}"`)
  }
  if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error(`VITE_SITE_URL must be an origin without a path, got "${url}"`)
  }
  return parsed.origin
}
