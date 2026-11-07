import type { RefObject } from 'react'
import type { Reply } from '../domain/types'
import { useI18n } from '../i18n/context'
import { ChoicePill } from './components/ChoicePill'
import { Dialog } from './components/Dialog'
import { InfoNote } from './components/InfoNote'
import { Popover } from './components/Popover'
import { button, cx } from './components/styles'
import { useMediaQuery } from './useMediaQuery'

interface Props {
  /** The button it was opened from: the popover opens under it. */
  anchor: RefObject<HTMLElement | null>
  name: string
  reply: Reply | undefined
  /** Real presence, only to say it is not changed by editing the reply. */
  presence: boolean | undefined
  onChange: (reply: Reply | null) => void
  onClose: () => void
}

/**
 * Fixes what someone said before an event, once the roll call is done: a
 * sheet from the bottom on phones, a popover under the reply from `sm`. The
 * presence recorded by the call never changes here.
 */
export function ReplyPicker({ anchor, name, reply, presence, onChange, onClose }: Props) {
  const { t } = useI18n()
  const phone = useMediaQuery('(width < 40rem)')
  const title = t('reply.title', { name })
  const state = t(presence === undefined ? 'reply.stateNone' : presence ? 'sheet.statePresent' : 'sheet.stateAbsent')

  const content = (
    <div className={cx('space-y-3 text-sm', !phone && 'p-2')}>
      {!phone && <p className="font-semibold">{title}</p>}
      <p className="text-muted">{t('reply.hint')}</p>
      <ChoicePill
        value={reply ?? null}
        options={[
          { value: 'yes', label: t('reply.yes') },
          { value: 'no', label: t('reply.no') },
        ]}
        clearable
        large
        label={title}
        onChange={onChange}
      />
      <InfoNote>{t('reply.info', { state })}</InfoNote>
      {phone && (
        <button type="button" className={cx(button(), 'w-full')} onClick={onClose}>
          {t('reply.close')}
        </button>
      )}
    </div>
  )

  return phone ? (
    <Dialog open onClose={onClose} title={title} closeLabel={t('reply.close')} sheet>
      {content}
    </Dialog>
  ) : (
    <Popover anchor={anchor} onClose={onClose} label={title} align="start" className="w-80">
      {content}
    </Popover>
  )
}
