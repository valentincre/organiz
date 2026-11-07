// Version and source code link shown in the home page footer.
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION
export const SOURCE_URL: string = import.meta.env.VITE_SOURCE_URL || 'https://github.com/valentincre/organiz'

// Only a strict X.Y.Z version has a release page; dev builds have none.
export function releaseUrl(version: string, source: string): string | undefined {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return undefined
  return `${source.replace(/\/+$/, '')}/releases/tag/v${version}`
}
