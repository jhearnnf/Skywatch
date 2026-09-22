// Capture the real signed-out React screens at build time. Only generated HTML
// goes into dist; Chromium/Playwright never enter the client bundle.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname, extname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import { JSDOM } from 'jsdom'
import { PUBLIC_PAGE_SEO } from '../src/utils/publicPageSeo.js'

export const PUBLIC_ROUTES = Object.entries(PUBLIC_PAGE_SEO)
  .filter(([, value]) => value.selector).map(([path]) => path)

export async function launchBrowser() {
  const { chromium } = await import('playwright')
  if (process.platform === 'linux') {
    const { default: bundled } = await import('@sparticuz/chromium')
    return chromium.launch({ args: bundled.args, executablePath: await bundled.executablePath() })
  }
  // Local Windows/macOS setup: npx playwright install chromium
  return chromium.launch({ headless: true })
}

// Also used by the browser verification script; mimics the exact Vercel routes.
export async function serveBuild(dist, { snapshots = true } = {}) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' }
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    const pageFile = snapshots && PUBLIC_ROUTES.includes(pathname)
      ? `public-pages${pathname}.html` : pathname === '/' ? 'index.html' : pathname.slice(1)
    let file = resolve(dist, pageFile)
    if (!file.startsWith(resolve(dist) + '/') && !file.startsWith(resolve(dist) + '\\')) {
      res.writeHead(403).end(); return
    }
    if (!existsSync(file)) {
      if (extname(pathname)) { res.writeHead(404).end(); return }
      file = join(dist, 'index.html')
    }
    res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream')
    res.end(readFileSync(file))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) }
}

export async function publicSettings() {
  const { loadEnv } = await import('vite')
  const env = loadEnv('production', process.cwd(), 'VITE_')
  const api = process.env.VITE_API_URL || env.VITE_API_URL
  if (!api) throw new Error('VITE_API_URL is required to capture the current public game settings.')
  const response = await fetch(`${api.replace(/\/$/, '')}/api/settings`, { signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new Error(`Public settings returned HTTP ${response.status}`)
  const settings = await response.json()
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Invalid public settings')
  return settings
}

// Fresh anonymous browser, no accounts or writes, no analytics or third-party
// scripts. Actual public settings keep navigation and game availability true.
export async function routePublicRequests(context, origin, settings) {
  await context.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    const headers = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' }
    const json = data => route.fulfill({ json: data, headers })
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: {
      ...headers, 'access-control-allow-headers': request.headers()['access-control-request-headers'] || '*', 'access-control-allow-methods': 'GET, POST, OPTIONS',
    } })
    if (request.method() !== 'GET') return json({ success: true, data: {} })
    if (url.pathname === '/api/settings') return json(settings)
    if (url.pathname === '/api/users/levels') return json({ data: { levels: [] } })
    if (url.pathname === '/api/auth/me') return json({ data: { user: null } })
    if (url.pathname === '/api/games/cbat/aircraft-cutouts') {
      // Fetch anonymously from Node: forwarding localhost's Origin to the
      // production API would correctly fail its browser CORS allowlist.
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) })
      if (!response.ok) return route.fulfill({ status: response.status, headers })
      return json(await response.json())
    }
    if (url.pathname.startsWith('/api/')) return json({ data: [] })
    if (url.origin === origin) return route.continue()
    if (url.origin === 'https://www.gstatic.com' && url.pathname.startsWith('/draco/versioned/decoders/')) {
      const name = url.pathname.split('/').at(-1)
      if (['draco_wasm_wrapper.js', 'draco_decoder.wasm', 'draco_decoder.js'].includes(name)) {
        return route.fulfill({ body: readFileSync(join(process.cwd(), 'node_modules/three/examples/jsm/libs/draco/gltf', name)), contentType: name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript', headers })
      }
    }
    return route.abort()
  })
}

export function buildPublicHtml(template, snapshot, pathname) {
  const dom = new JSDOM(template)
  const { document } = dom.window
  document.body.className = snapshot.bodyClass || ''
  // Replace fallback SEO elements rather than duplicating the homepage tags.
  document.head.querySelectorAll('title, meta[name="description"], meta[name="robots"], link[rel="canonical"], meta[property^="og:"], meta[name^="twitter:"]').forEach(node => node.remove())
  document.head.insertAdjacentHTML('beforeend', snapshot.head)
  document.head.querySelectorAll('title, meta[name="description"], meta[name="robots"], link[rel="canonical"], meta[property^="og:"], meta[name^="twitter:"], [data-page-schema]').forEach(node => node.setAttribute('data-static-seo', ''))
  const canonical = document.querySelector('link[rel="canonical"]')
  if (canonical?.href !== `https://skywatch.academy${pathname}`) throw new Error(`Wrong canonical for ${pathname}`)
  const preview = document.createElement('div')
  preview.id = 'public-page-preview'
  preview.innerHTML = snapshot.body
  // No snapshot scripts, personal state, or embedded game surfaces. The guest
  // theme hint is a transient popup; left in, it is the first text a crawler
  // reads on every page (twice: mobile and desktop copies).
  preview.querySelectorAll('script, iframe, canvas, .guest-theme-hint').forEach(node => node.remove())
  document.getElementById('root').before(preview)
  const style = document.createElement('style')
  style.id = 'public-page-preview-style'
  style.textContent = '#public-page-preview{position:relative;z-index:1}#public-page-preview~#root{display:none}html[data-skip-public-preview] #public-page-preview{display:none}html[data-skip-public-preview] #root{display:block}'
  document.head.append(style)
  const startup = document.createElement('script')
  // Returning players need their live state, not a signed-out default snapshot.
  // This executes in the head before paint. Failed storage access is harmless.
  startup.textContent = `try{if(localStorage.getItem('sw_user_cache')||localStorage.getItem('sw_app_settings_cache')||localStorage.getItem('skywatch.guestUiTheme')||location.search||location.hash)document.documentElement.setAttribute('data-skip-public-preview','')}catch{}`
  document.head.append(startup)
  const result = dom.serialize()
  dom.window.close()
  return result
}

async function capturePage(browser, origin, settings, pathname) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', reducedMotion: 'reduce' })
  try {
    await routePublicRequests(context, origin, settings)
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.stack || error.message))
    await page.goto(`${origin}${pathname}`, { waitUntil: 'networkidle' })
    await page.locator(PUBLIC_PAGE_SEO[pathname].selector).waitFor({ state: 'visible' })
    await page.waitForFunction(path => document.querySelector('link[rel="canonical"]')?.href === `https://skywatch.academy${path}`, pathname)
    // Finish entrance animations before capturing visible styles.
    await page.waitForFunction(() => document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).every(animation => animation.playState === 'finished'))
    if (errors.length) throw new Error(`${pathname}: ${errors.join('; ')}`)
    return await page.evaluate(() => ({
      head: [...document.querySelectorAll('head title, head meta[name="description"], head meta[name="robots"], head link[rel="canonical"], head meta[property^="og:"], head meta[name^="twitter:"], [data-page-schema]')].map(node => node.outerHTML).join('\n'),
      body: document.getElementById('root').innerHTML,
      bodyClass: document.body.className,
    }))
  } finally { await context.close().catch(() => {}) }
}

export async function prerenderPublicPages() {
  const dist = join(process.cwd(), 'dist')
  const template = readFileSync(join(dist, 'index.html'), 'utf8')
  const settings = await publicSettings()
  const server = await serveBuild(dist, { snapshots: false })
  try {
    for (const pathname of PUBLIC_ROUTES) {
      // A fresh browser per route: on Vercel @sparticuz/chromium runs
      // --single-process, so tearing down one WebGL page's context can take
      // the whole browser with it and fail every route after it.
      let snapshot
      for (let attempt = 1; !snapshot; attempt++) {
        const browser = await launchBrowser()
        try {
          snapshot = await capturePage(browser, server.origin, settings, pathname)
        } catch (error) {
          if (attempt >= 2) throw error
          console.warn(`Public HTML: retrying ${pathname} after ${error.message.split('\n')[0]}`)
        } finally { await browser.close().catch(() => {}) }
      }
      const html = buildPublicHtml(template, snapshot, pathname)
      const file = join(dist, 'public-pages', `${pathname.slice(1)}.html`)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, html)
      console.log(`Public HTML: ${pathname} (${Math.round(Buffer.byteLength(html) / 1024)} KB)`)
    }
  } finally {
    await server.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await prerenderPublicPages()
}
