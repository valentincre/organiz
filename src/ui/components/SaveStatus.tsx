import { useEffect, useState } from 'react'
import { useI18n } from '../../i18n/context'
import type { SaveError } from '../../storage/dashboardStore'
import { CloudOffIcon, SpinnerIcon } from './icons'
import { useToast } from './toast'

/** Saves usually finish within this delay; showing the spinner earlier would flicker on every tick. */
const SPINNER_DELAY_MS = 1000

interface Props {
  /** A write is running; edits waiting for the save delay do not count. */
  writing: boolean
  saveError: SaveError | null
  onRetry: () => void
}

const failedButton =
  'inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-md px-2 text-sm font-medium text-danger hover:bg-danger-soft'

/**
 * Shows nothing while everything is saved, a spinner for slow saves, and a retry button on
 * failure. A dashboard too large to save cannot be retried: its button explains what to do.
 */
export function SaveStatus({ writing, saveError, onRetry }: Props) {
  const { t } = useI18n()
  const toast = useToast()
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    if (!writing) return
    const timer = window.setTimeout(() => setSlow(true), SPINNER_DELAY_MS)
    return () => {
      window.clearTimeout(timer)
      setSlow(false)
    }
  }, [writing])

  if (saveError === 'too-large') {
    return (
      <button type="button" className={failedButton} title={t('save.tooLargeHint')} onClick={() => toast(t('save.tooLargeHint'))}>
        <CloudOffIcon />
        {t('save.tooLarge')}
      </button>
    )
  }

  if (saveError) {
    return (
      <button
        type="button"
        className={failedButton}
        title={t('save.failed')}
        onClick={onRetry}
      >
        <CloudOffIcon />
        <span className="sr-only">{t('save.failed')}.</span>
        {t('save.retry')}
      </button>
    )
  }

  return (
    <span role="status" className="inline-flex text-muted" title={slow ? t('save.saving') : undefined}>
      {slow && (
        <>
          <SpinnerIcon />
          <span className="sr-only">{t('save.saving')}</span>
        </>
      )}
    </span>
  )
}
