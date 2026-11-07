import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import './styles.css'
import App from './App.tsx'
import { langFromPath } from './i18n/translate'
import { parseRoute } from './router'

const container = document.getElementById('root')!
// The /en/ and /fr/ home pages set their own language.
const pathLang = langFromPath(window.location.pathname)
const app = (
  <StrictMode>
    <App initialLang={pathLang} />
  </StrictMode>
)

// Those pages are prerendered at build time: hydrate them when they show the
// home page, otherwise (a dashboard opened from them, or dev) render from scratch.
if (pathLang && container.firstElementChild && parseRoute(window.location.hash).name === 'home') {
  hydrateRoot(container, app)
} else {
  container.replaceChildren()
  createRoot(container).render(app)
}
