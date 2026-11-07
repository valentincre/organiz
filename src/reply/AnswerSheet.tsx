import type { Answer, Reply } from '../domain/types'
import { useI18n } from '../i18n/context'
import { ChoicePill } from '../ui/components/ChoicePill'
import { Dialog } from '../ui/components/Dialog'
import { CheckIcon, SpinnerIcon } from '../ui/components/icons'
import { button, cx } from '../ui/components/styles'
import { AnswerTag } from './NameList'

interface Props {
  name: string
  /** The answer the pill shows: the person's current one on a public link, this phone's last one on a private link. */
  value: Reply | null
  sending: boolean
  /** Private links: the reply was sent, and the sheet says so instead of showing the pill. */
  confirmed: boolean
  onChoose: (answer: Answer) => void
  /** "Change my reply": back to the pill. */
  onChange: () => void
  /** "Answer for someone else as well": closes the sheet and goes to the names. */
  onAnother: () => void
  onClose: () => void
}

/** Coming / No for one name: a sheet from the bottom on phones, a dialog on larger screens. */
export function AnswerSheet({ name, value, sending, confirmed, onChoose, onChange, onAnother, onClose }: Props) {
  const { t } = useI18n()

  return (
    <Dialog open onClose={onClose} title={name} closeLabel={t('reply.close')} sheet>
      {confirmed ? (
        <div className="space-y-4">
          <p className="flex items-center gap-2 font-semibold text-success">
            <CheckIcon />
            {t('reply.page.sent')}
            <AnswerTag answer={value ?? 'none'} />
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" className={cx(button(), 'sm:flex-1')} onClick={onChange}>
              {t('reply.page.changeMine')}
            </button>
            <button type="button" className={cx(button('primary'), 'sm:flex-1')} onClick={onAnother}>
              {t('reply.page.another')}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <ChoicePill
            value={value}
            options={[
              { value: 'yes', label: t('reply.yes') },
              { value: 'no', label: t('reply.no') },
            ]}
            clearable
            large
            disabled={sending}
            label={t('reply.title', { name })}
            onChange={(reply) => onChoose(reply ?? 'none')}
          />
          {sending ? (
            <p className="flex items-center gap-2 text-sm text-muted" role="status">
              <SpinnerIcon small />
              {t('reply.page.sending')}
            </p>
          ) : (
            <p className="text-sm text-muted">{t('reply.page.remember', { name })}</p>
          )}
        </div>
      )}
    </Dialog>
  )
}
