import { useEffect, useState } from 'react'
import { useI18n } from '../i18n/context'
import type { Access } from '../storage/link'
import { useToast } from './components/toast'

/** How long a Copy button says "Copied". */
const COPIED_MS = 2000

/**
 * Copies a share link; shows the link to copy by hand when the clipboard is refused.
 * A copy is confirmed by a toast saying what the link grants, or by `onCopied`
 * inside a modal dialog, which hides the rest of the page (`access` then only
 * matters for the toast).
 */
export function useCopyLink(onCopied?: () => void): (link: string, access?: Access) => Promise<void> {
  const { t } = useI18n()
  const toast = useToast()
  return async (link, access = 'edit') => {
    try {
      await navigator.clipboard.writeText(link)
      if (onCopied) onCopied()
      else toast(t(access === 'edit' ? 'share.copied' : 'share.copiedRead'))
    } catch {
      window.prompt(t('share.copyFailed'), link)
    }
  }
}

/**
 * What was just copied, for a Copy button to say "Copied" for a moment (a toast
 * would sit under a modal's backdrop). `mark(what)` sets it; it clears itself.
 */
export function useCopiedMark<T>(): [T | null, (what: T) => void] {
  const [copied, setCopied] = useState<{ what: T } | null>(null)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(null), COPIED_MS)
    return () => window.clearTimeout(timer)
  }, [copied])
  return [copied?.what ?? null, (what) => setCopied({ what })]
}

/**
 * Copies text that is still being worked out, such as a link whose creation
 * awaits something. Safari only lets a click copy until its first await, so the
 * clipboard write starts at once and waits for the text. False when the text
 * fails or the clipboard is refused.
 */
export async function copyPending(text: Promise<string>): Promise<boolean> {
  try {
    if (typeof ClipboardItem === 'function' && typeof navigator.clipboard.write === 'function') {
      const blob = text.then((value) => new Blob([value], { type: 'text/plain' }))
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })])
    } else {
      await navigator.clipboard.writeText(await text)
    }
    return true
  } catch {
    return false
  }
}
