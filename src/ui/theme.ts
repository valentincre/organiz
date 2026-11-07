import { useCallback, useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'

// Must match the key read by the inline script in index.html.
const STORAGE_KEY = 'organiz.theme'
const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)')

function readSaved(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

// Saved choice as an external store, so prerendered pages hydrate with "no
// choice" (the server cannot know it) and pick it up right after.
const savedListeners = new Set<() => void>()
const subscribeSaved = (onChange: () => void) => {
  savedListeners.add(onChange)
  return () => savedListeners.delete(onChange)
}

const subscribeSystem = (onChange: () => void) => {
  const query = darkQuery()
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/** Current theme: the saved choice, else the system preference. */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const saved = useSyncExternalStore(subscribeSaved, readSaved, () => null)
  const systemDark = useSyncExternalStore(subscribeSystem, () => darkQuery().matches, () => false)

  const setTheme = useCallback((theme: Theme) => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // Storage may be unavailable (private mode); the choice then lasts for this visit.
    }
    for (const listener of savedListeners) listener()
  }, [])

  return [saved ?? (systemDark ? 'dark' : 'light'), setTheme]
}
