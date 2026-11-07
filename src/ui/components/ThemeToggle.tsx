import { useI18n } from '../../i18n/context'
import { useTheme } from '../theme'
import { MoonIcon, SunIcon } from './icons'

export function ThemeToggle() {
  const { t } = useI18n()
  const [theme, setTheme] = useTheme()
  const next = theme === 'dark' ? 'light' : 'dark'
  const label = t(next === 'light' ? 'theme.toLight' : 'theme.toDark')

  return (
    <button
      type="button"
      className="inline-flex size-10 cursor-pointer items-center justify-center rounded-md border border-line bg-surface text-muted hover:text-text"
      aria-label={label}
      title={label}
      onClick={() => setTheme(next)}
    >
      {/* The sun switches to the light theme, the moon to the dark one. */}
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  )
}
