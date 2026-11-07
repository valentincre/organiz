import { useEffect, useRef } from 'react'

export interface CallKeys {
  present: () => void
  absent: () => void
  previous: () => void
  search: () => void
  finish: () => void
}

/** Where a keystroke is meant for something else: a field, or an element that Enter or Space already activates. */
const takesTyping = (target: EventTarget | null) => target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]') !== null
const activatesOnEnter = (target: EventTarget | null) => target instanceof Element && target.closest('button, a, summary, [role="radio"]') !== null

/**
 * Keyboard shortcuts of the roll call: P present, A absent, ← previous,
 * / search, Enter finish. Ignored while typing in a field, while a dialog is
 * open, and with a modifier key (browser shortcuts keep working).
 */
export function useCallKeys(keys: CallKeys, enabled: boolean): void {
  const latest = useRef(keys)
  useEffect(() => {
    latest.current = keys
  })

  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return
      if (takesTyping(event.target) || document.querySelector('dialog[open]')) return
      const handlers = latest.current
      const run = (action: () => void) => {
        event.preventDefault()
        action()
      }
      switch (event.key) {
        case 'p':
        case 'P':
          return run(handlers.present)
        case 'a':
        case 'A':
          return run(handlers.absent)
        case 'ArrowLeft':
          return run(handlers.previous)
        case '/':
          return run(handlers.search)
        case 'Enter':
          // On a focused button Enter already clicks it.
          if (!activatesOnEnter(event.target)) run(handlers.finish)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}
