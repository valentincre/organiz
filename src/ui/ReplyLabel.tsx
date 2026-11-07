import type { Reply } from '../domain/types'
import { useI18n } from '../i18n/context'
import { CheckIcon, CloseIcon } from './components/icons'

/** What someone said before the event: "✓ said yes", "✗ said no" or "no reply". */
export function ReplyLabel({ reply }: { reply: Reply | undefined }) {
  const { t } = useI18n()
  return (
    <>
      {reply === 'yes' && <CheckIcon small />}
      {reply === 'no' && <CloseIcon small />}
      {t(reply === 'yes' ? 'reply.saidYes' : reply === 'no' ? 'reply.saidNo' : 'reply.none')}
    </>
  )
}
