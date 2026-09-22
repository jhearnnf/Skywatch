// Integration check against a production build. Uses fresh anonymous contexts;
// all writes/analytics are intercepted by routePublicRequests.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { launchBrowser, serveBuild, publicSettings, routePublicRequests, PUBLIC_ROUTES } from './prerender-public-pages.mjs'
import { PUBLIC_PAGE_SEO } from '../src/utils/publicPageSeo.js'

const dist = join(process.cwd(), 'dist')
const artifacts = join(process.cwd(), 'public-page-checks.local')
mkdirSync(artifacts, { recursive: true })
const raw = await serveBuild(dist, { snapshots: false })
const rendered = await serveBuild(dist)
const settings = await publicSettings()
const browser = await launchBrowser()
const results = []
const comparisonCss = '[data-testid="guest-unlock-prompt"]{transform:none!important}.guest-theme-hint{visibility:hidden!important}*,*::before,*::after{animation:none!important;caret-color:transparent!important}'

async function settle(page) {
  // Exclude the deliberately moving signup prompt from pixel comparisons, and
  // transient first-visit theme hints. All actual layout/content stays intact.
  await page.addStyleTag({ content: comparisonCss })
  await page.waitForFunction(() => [...document.querySelectorAll('[data-cbat-card]')].every(node => Number(getComputedStyle(node).opacity) > .99), null, { timeout: 10000 })
  await page.evaluate(() => document.fonts.ready.then(() => true))
}

async function difference(a, b) {
  const first = await sharp(a).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const second = await sharp(b).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  assert.equal(first.data.length, second.data.length)
  let changed = 0
  for (let i = 0; i < first.data.length; i += 3) {
    if (Math.max(...[0, 1, 2].map(channel => Math.abs(first.data[i + channel] - second.data[i + channel]))) > 30) changed++
  }
  return changed / (first.data.length / 3)
}

try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    for (const path of PUBLIC_ROUTES) {
      console.log(`Checking ${path} at ${viewport.width}px`)
      const options = { viewport, serviceWorkers: 'block', reducedMotion: 'reduce', isMobile: viewport.width < 500, hasTouch: viewport.width < 500 }
      const baselineContext = await browser.newContext(options)
      const liveContext = await browser.newContext(options)
      const staticContext = await browser.newContext({ ...options, javaScriptEnabled: false })
      try {
        await routePublicRequests(baselineContext, raw.origin, settings)
        await routePublicRequests(liveContext, rendered.origin, settings)
        await liveContext.addInitScript(() => {
          window.__publicPreviewFrames = []
          const start = performance.now()
          function frame() {
            const root = document.getElementById('root')
            const preview = document.getElementById('public-page-preview')
            let node = root?.querySelector('[data-cbat-card], [data-demo-start]')
            if (!preview && node) {
              let opacity = 1
              while (node && node !== document.body) {
                opacity *= Number(getComputedStyle(node).opacity)
                node = node.parentElement
              }
              window.__publicPreviewFrames.push(opacity)
            }
            if (performance.now() - start < 10000) requestAnimationFrame(frame)
          }
          requestAnimationFrame(frame)
        })
        await routePublicRequests(staticContext, rendered.origin, settings)
        await staticContext.route(`${rendered.origin}/cbat**`, async route => {
          const response = await route.fetch()
          await route.fulfill({ response, body: (await response.text()).replace('</head>', `<style>${comparisonCss}</style></head>`) })
        })
        const baseline = await baselineContext.newPage()
        const live = await liveContext.newPage()
        const staticPage = await staticContext.newPage()
        baseline.setDefaultTimeout(15000)
        live.setDefaultTimeout(15000)
        staticPage.setDefaultTimeout(15000)
        const errors = []
        live.on('pageerror', error => errors.push(error.message))
        await baseline.goto(raw.origin + path, { waitUntil: 'networkidle' })
        await baseline.locator(PUBLIC_PAGE_SEO[path].selector).waitFor({ state: 'visible' })
        await settle(baseline)
        const baselineImage = await baseline.screenshot()
        await staticPage.goto(rendered.origin + path, { waitUntil: 'networkidle' })
        assert.ok((await staticPage.locator('#public-page-preview').innerText()).trim().length > 100)
        assert.equal(await staticPage.locator('link[rel="canonical"]').count(), 1)
        assert.equal(await staticPage.locator('link[rel="canonical"]').getAttribute('href'), 'https://skywatch.academy' + path)
        if (path === '/cbat') {
          for (const route of PUBLIC_ROUTES.slice(1)) assert.ok(await staticPage.locator(`a[href="${route}"]`).count())
        }
        const staticImage = await staticPage.screenshot()
        await live.goto(rendered.origin + path, { waitUntil: 'networkidle' })
        await live.locator('#public-page-preview').waitFor({ state: 'detached' })
        await live.locator(PUBLIC_PAGE_SEO[path].selector).waitFor({ state: 'visible' })
        await settle(live)
        const frames = await live.evaluate(() => window.__publicPreviewFrames)
        assert.ok(frames.length > 0, `No startup frames observed: ${path}`)
        assert.ok(Math.min(...frames) > .99, `Intro faded during handover: ${path} (${Math.min(...frames)})`)
        assert.equal(await live.locator('head title').count(), 1)
        assert.equal(await live.locator('link[rel="canonical"]').count(), 1)
        assert.equal(await live.locator('meta[name="description"]').count(), 1)
        const liveImage = await live.screenshot()
        const staticDifference = await difference(baselineImage, staticImage)
        const liveDifference = await difference(baselineImage, liveImage)
        const stem = `${path.replaceAll('/', '_')}-${viewport.width}`
        writeFileSync(join(artifacts, `${stem}-baseline.png`), baselineImage)
        writeFileSync(join(artifacts, `${stem}-static.png`), staticImage)
        writeFileSync(join(artifacts, `${stem}-live.png`), liveImage)
        results.push({ path, width: viewport.width, staticDifference, liveDifference })
        console.log(JSON.stringify(results.at(-1)))
        assert.ok(staticDifference < .015, `Static appearance changed: ${stem}`)
        assert.ok(liveDifference < .015, `Live appearance changed: ${stem}`)
        if (path !== '/cbat') {
          const start = live.locator('[data-demo-start]')
          await start.click()
          await live.waitForFunction(() => {
            const button = document.querySelector('[data-demo-start]')
            return !button || button.disabled || getComputedStyle(button).visibility === 'hidden'
          })
        }
        assert.deepEqual(errors, [], `Browser errors: ${path}`)
      } finally {
        await baselineContext.close(); await liveContext.close(); await staticContext.close()
      }
    }
  }
  // Saved theme/query users must bypass the default snapshot; metadata still
  // belongs to the clean game URL after boot and after in-app navigation.
  const context = await browser.newContext({ serviceWorkers: 'block' })
  await routePublicRequests(context, rendered.origin, settings)
  await context.addInitScript(() => localStorage.setItem('skywatch.guestUiTheme', 'cbat'))
  const page = await context.newPage()
  await page.goto(`${rendered.origin}/cbat/ant?difficulty=hard`, { waitUntil: 'networkidle' })
  await page.locator('#public-page-preview').waitFor({ state: 'detached' })
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'cbat')
  assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), 'https://skywatch.academy/cbat/ant')
  await context.close()
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify(results, null, 2))
  console.log('Public page appearance, no-JS content, metadata and guest game starts passed.')
} finally {
  await browser.close()
  await raw.close(); await rendered.close()
}
