import { useI18n } from '../../i18n/context'
import { button, cx } from '../components/styles'

/** Above an event's counters, for editors: how many replies came in since they last looked, and "Seen". */
export function NewRepliesBanner({ count, onSeen }: { count: number; onSeen: () => void }) {
  const { t } = useI18n()
  return (
    <div className="flex items-center gap-3 rounded-lg border border-accent/30 bg-accent-soft py-1.5 pr-1.5 pl-3 text-sm" role="status">
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-accent" />
      <span className="min-w-0 flex-1 font-medium">{t('replies.newSince', { count })}</span>
      <button type="button" className={cx(button(), 'min-h-9')} onClick={onSeen}>
        {t('replies.seen')}
      </button>
    </div>
  )
}
