import { useI18n } from '../i18n/context'
import { button } from './components/styles'
import { useCopyLink } from './useCopyLink'

interface Props {
  /** The link of a dashboard just created: the edit link, which nothing can recover. */
  editLink: string
  onDismiss: () => void
}

export function SaveLinkBanner({ editLink, onDismiss }: Props) {
  const { t } = useI18n()
  const copy = useCopyLink()
  return (
    <div className="mb-4 rounded-xl border border-warning/40 bg-warning/10 p-4" role="alert">
      <p className="mb-1 font-semibold">{t('banner.saveLink.title')}</p>
      <p className="mb-3 text-sm">{t('banner.saveLink.body')}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button('primary')} onClick={() => copy(editLink, 'edit')}>
          {t('share.copy')}
        </button>
        <button type="button" className={button()} onClick={onDismiss}>
          {t('banner.dismiss')}
        </button>
      </div>
    </div>
  )
}
