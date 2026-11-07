// Regenerates the home page screenshots (public/screens/) and the link
// preview images (public/og-*.png) from the demo. Needs a running app:
//   npm run dev   then   node scripts/marketing-images.mjs [http://localhost:5173]
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:5173'
const copy = {
  en: { title: 'Free online attendance tracker', subtitle: 'Take attendance, follow it by calendar or by person, share one link.' },
  fr: { title: 'Feuille de présence gratuite en ligne', subtitle: 'Fais l’appel, suis les présences par calendrier ou par personne, partage un lien.' },
}

const browser = await chromium.launch({ channel: 'chrome' })
mkdirSync('public/screens', { recursive: true })

for (const [lang, text] of Object.entries(copy)) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 750 }, deviceScaleFactor: 1, colorScheme: 'light' })
  await context.addInitScript((lang) => localStorage.setItem('organiz.lang', lang), lang)
  const page = await context.newPage()
  await page.goto(`${base}/${lang}/#/demo`)
  await page.getByRole('note').waitFor()
  // The demo banner explains the demo; the screenshot shows the app itself.
  await page.getByRole('note').evaluate((banner) => banner.remove())
  const png = await page.screenshot({ type: 'png' })

  // Chrome screenshots are PNG or JPEG only; the page's canvas encodes WebP.
  const webp = await page.evaluate(async (data) => {
    const image = new Image()
    image.src = `data:image/png;base64,${data}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    canvas.getContext('2d').drawImage(image, 0, 0)
    return canvas.toDataURL('image/webp', 0.82).split(',')[1]
  }, png.toString('base64'))
  writeFileSync(`public/screens/${lang}-calendar.webp`, Buffer.from(webp, 'base64'))

  // Link preview: title on the left, the screenshot cropped on the right.
  await page.setViewportSize({ width: 1200, height: 630 })
  await page.setContent(`<!doctype html><html><body style="margin:0;width:1200px;height:630px;overflow:hidden;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#3b5bdb;color:#fff;display:flex">
    <div style="width:470px;padding:64px 40px 64px 64px;display:flex;flex-direction:column;justify-content:center;gap:24px">
      <div style="font-size:30px;font-weight:700;opacity:.9">Organiz</div>
      <div style="font-size:52px;font-weight:800;line-height:1.08">${text.title}</div>
      <div style="font-size:26px;line-height:1.35;opacity:.9">${text.subtitle}</div>
    </div>
    <div style="flex:1;padding:56px 0 0;overflow:hidden">
      <img src="data:image/png;base64,${png.toString('base64')}" style="width:1000px;border-radius:16px 0 0 0;box-shadow:0 20px 50px rgba(0,0,0,.35)">
    </div></body></html>`)
  writeFileSync(`public/og-${lang}.png`, await page.screenshot({ type: 'png' }))
  await context.close()
}

await browser.close()
console.log('Wrote public/screens/*-calendar.webp and public/og-*.png')
