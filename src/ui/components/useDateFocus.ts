import { useCallback, useEffect, useRef } from 'react'
import type { IsoDate } from '../../domain/types'

/**
 * Moves keyboard focus to a day cell (`data-date`) once it is rendered, e.g.
 * after "Today" switched the month and selected the day through the URL.
 */
export function useDateFocus<T extends HTMLElement>(...renderKeys: unknown[]) {
  const container = useRef<T>(null)
  const pending = useRef<IsoDate | null>(null)

  const tryFocus = useCallback(() => {
    if (!pending.current) return
    const cell = container.current?.querySelector<HTMLElement>(`[data-date="${pending.current}"]`)
    if (cell) {
      cell.focus()
      pending.current = null
    }
  }, [])

  // Retry after each render that may have brought the cell in.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(tryFocus, renderKeys)

  const focusDate = useCallback(
    (date: IsoDate) => {
      pending.current = date
      requestAnimationFrame(tryFocus)
    },
    [tryFocus],
  )

  return { container, focusDate }
}
