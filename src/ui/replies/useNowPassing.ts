import { useEffect, useState } from 'react'

/** Longest delay setTimeout accepts. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1

/** The current time, refreshed when one of `moments` (ms) passes and when the page comes back into view. */
export function useNowPassing(moments: (number | null)[]): number {
  const [now, setNow] = useState(() => Date.now())
  const next = Math.min(...moments.filter((moment): moment is number => moment !== null && moment > now))
  useEffect(() => {
    const refresh = () => setNow(Date.now())
    document.addEventListener('visibilitychange', refresh)
    const timer = Number.isFinite(next) ? window.setTimeout(refresh, Math.min(Math.max(0, next - Date.now()), MAX_TIMEOUT_MS)) : undefined
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      window.clearTimeout(timer)
    }
  }, [next])
  return now
}
