// Entry used at build time only (scripts/prerender.mjs): renders the static
// pages so search engines and link previews see real content without JavaScript.
// It is never hot-reloaded, so exporting plain functions is fine here.
/* oxlint-disable react/only-export-components */
import { renderToString } from 'react-dom/server'
import App from './App'
import { homePath, LANGS, translate, type Lang } from './i18n/translate'

export { LANGS }

export const renderHome = (lang: Lang): string => renderToString(<App initialLang={lang} />)

export function homeMeta(lang: Lang) {
  return {
    path: homePath(lang),
    title: translate(lang, 'seo.title'),
    description: translate(lang, 'seo.description'),
    imageAlt: translate(lang, 'home.screenshotAlt'),
  }
}

/** Static 404 page in both languages; it loads no script. */
export function renderNotFound(): string {
  return renderToString(
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-4 text-center">
      {LANGS.map((lang) => (
        <div key={lang} lang={lang}>
          <h1 className="mb-2 text-xl font-bold">{translate(lang, 'notFound.title')}</h1>
          <a className="text-accent underline" href={homePath(lang)}>
            {translate(lang, 'notFound.home')}
          </a>
        </div>
      ))}
    </main>,
  )
}
