// Runs after `vite build`: writes the indexable home pages (/en/, /fr/), the
// 404 page, the sitemap and robots.txt into dist/, from the built index.html.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, loadEnv } from 'vite'

const OG_LOCALES = { en: 'en_US', fr: 'fr_FR' }

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const { LANGS, renderHome, homeMeta, renderNotFound } = await server.ssrLoadModule('/src/prerender.tsx')
const { siteOrigin } = await server.ssrLoadModule('/src/buildEnv.ts')
await server.close()

// The build has already checked that VITE_SITE_URL is set.
const SITE = siteOrigin(loadEnv('production', process.cwd(), '').VITE_SITE_URL)

const template = readFileSync('dist/index.html', 'utf8')
const attr = (value) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function withHead(html, { lang, title, description }, extra) {
  return html
    .replace('<html lang="en">', `<html lang="${lang}">`)
    .replace(/<title>.*?<\/title>/, `<title>${attr(title)}</title>`)
    .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${attr(description)}" />`)
    .replace(/\n\s*<\/head>/, `\n${extra.map((line) => `    ${line}\n`).join('')}  </head>`)
}

function socialTags(lang, { title, description, imageAlt }, url) {
  const alternates = LANGS.filter((other) => other !== lang)
  return [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Organiz" />`,
    `<meta property="og:title" content="${attr(title)}" />`,
    `<meta property="og:description" content="${attr(description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:locale" content="${OG_LOCALES[lang]}" />`,
    ...alternates.map((other) => `<meta property="og:locale:alternate" content="${OG_LOCALES[other]}" />`),
    `<meta property="og:image" content="${SITE}/og-${lang}.png" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${attr(imageAlt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
  ]
}

function hreflangLinks() {
  return [
    ...LANGS.map((lang) => `<link rel="alternate" hreflang="${lang}" href="${SITE}/${lang}/" />`),
    `<link rel="alternate" hreflang="x-default" href="${SITE}/" />`,
  ]
}

function structuredData(lang, { description }, url) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'Organiz',
    url,
    description,
    inLanguage: lang,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
  }
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`
}

for (const lang of LANGS) {
  const meta = homeMeta(lang)
  const url = SITE + meta.path
  const page = withHead(template, { lang, ...meta }, [
    `<link rel="canonical" href="${url}" />`,
    ...hreflangLinks(),
    ...socialTags(lang, meta, url),
    structuredData(lang, meta, url),
  ])
    .replace('<div id="root"></div>', `<div id="root">${renderHome(lang)}</div>`)
    .replace(/\s*<noscript>[\s\S]*?<\/noscript>/, '')
  mkdirSync(`dist/${lang}`, { recursive: true })
  writeFileSync(`dist/${lang}/index.html`, page)
}

// "/" stays the app shell (dashboard links point there); previews of it use the English card.
const english = homeMeta('en')
writeFileSync('dist/index.html', withHead(template, { lang: 'en', ...english }, [...hreflangLinks(), ...socialTags('en', english, `${SITE}/`)]))

writeFileSync(
  'dist/404.html',
  withHead(template, { lang: 'en', title: 'Page not found · Organiz', description: english.description }, [
    `<meta name="robots" content="noindex" />`,
  ])
    .replace(/\s*<script type="module"[^>]*><\/script>/g, '')
    .replace(/\s*<link rel="modulepreload"[^>]*>/g, '')
    .replace('<div id="root"></div>', `<div id="root">${renderNotFound()}</div>`)
    .replace(/\s*<noscript>[\s\S]*?<\/noscript>/, ''),
)

const today = new Date().toISOString().slice(0, 10)
const links = LANGS.map((lang) => `    <xhtml:link rel="alternate" hreflang="${lang}" href="${SITE}/${lang}/" />`)
  .concat(`    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/" />`)
  .join('\n')
writeFileSync(
  'dist/sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${LANGS.map((lang) => `  <url>\n    <loc>${SITE}/${lang}/</loc>\n    <lastmod>${today}</lastmod>\n${links}\n  </url>`).join('\n')}
</urlset>
`,
)

writeFileSync('dist/robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`)

console.log(`Prerendered ${LANGS.map((lang) => `/${lang}/`).join(', ')}, 404.html, sitemap.xml and robots.txt`)
