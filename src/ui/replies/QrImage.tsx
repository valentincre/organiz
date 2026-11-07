import { useEffect, useState } from 'react'
import { useI18n } from '../../i18n/context'
import { SpinnerIcon } from '../components/icons'
import { cx } from '../components/styles'
import { qrSvg } from './qr'

interface Props {
  link: string
  /** What the image is, for screen readers; the reply link's QR code by default. */
  alt?: string
  className?: string
}

/** The QR code of a link, on a white ground whatever the theme: scanners expect dark modules on a light one. */
export function QrImage({ link, alt, className }: Props) {
  const { t } = useI18n()
  // Kept with the link it was drawn for, so a stale code or failure is never shown.
  const [drawn, setDrawn] = useState<{ link: string; src: string | null } | null>(null)

  useEffect(() => {
    let live = true
    qrSvg(link).then(
      (svg) => live && setDrawn({ link, src: `data:image/svg+xml,${encodeURIComponent(svg)}` }),
      () => live && setDrawn({ link, src: null }),
    )
    return () => {
      live = false
    }
  }, [link])

  const current = drawn?.link === link ? drawn : null

  return (
    <div className={cx('flex aspect-square max-w-full items-center justify-center overflow-hidden rounded-lg bg-white', className)}>
      {current?.src ? (
        <img src={current.src} alt={alt ?? t('replies.qrAlt')} className="size-full" />
      ) : current ? (
        <p className="px-4 text-sm text-danger">{t('replies.qrFailed')}</p>
      ) : (
        <SpinnerIcon className="text-black/50" />
      )}
    </div>
  )
}
