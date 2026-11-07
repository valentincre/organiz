import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ToastContext } from './toast'

const DURATION_MS = 4000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const show = useCallback((next: string) => {
    window.clearTimeout(timer.current)
    setMessage(next)
    timer.current = window.setTimeout(() => setMessage(null), DURATION_MS)
  }, [])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex justify-center"
        role="status"
        aria-live="polite"
      >
        {message && (
          <div className="pointer-events-auto max-w-md rounded-xl bg-text px-4 py-3 text-bg shadow-lg">{message}</div>
        )}
      </div>
    </ToastContext.Provider>
  )
}
