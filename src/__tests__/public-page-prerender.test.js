import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { JSDOM } from 'jsdom'
import { buildPublicHtml, PUBLIC_ROUTES } from '../../scripts/prerender-public-pages.mjs'
import { PUBLIC_CBAT_GAME_KEYS } from '../utils/cbat/publicGames'
import { PUBLIC_PAGE_SEO } from '../utils/publicPageSeo'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const template = readFileSync(join(root, 'index.html'), 'utf8')

describe('public page HTML', () => {
  it('serves the hub and exactly the account-free games before the SPA rewrite', () => {
    expect(PUBLIC_ROUTES).toEqual(['/cbat', ...PUBLIC_CBAT_GAME_KEYS.map(key => `/cbat/${key}`)])
    const config = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'))
    for (const path of PUBLIC_ROUTES) {
      const index = config.rewrites.findIndex(rule => rule.source === path)
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(config.rewrites.findIndex(rule => rule.destination === '/index.html'))
      expect(config.rewrites[index].destination).toBe(`/public-pages${path}.html`)
    }
  })

  it('replaces generic metadata and preserves readable content without executable snapshot code', () => {
    const html = buildPublicHtml(template, {
      head: '<title data-rh="true">ANT — CBAT — SkyWatch</title><link data-rh="true" rel="canonical" href="https://skywatch.academy/cbat/ant"><meta data-rh="true" name="description" content="Free ANT practice. No account required.">',
      body: '<div class="guest-theme-hint">Try the Real CBAT theme</div><h1>Airborne Numerical Test</h1><p>Practise speed, distance and time.</p><a href="/cbat">Back to games</a><script>alert(1)</script>',
    }, '/cbat/ant')
    const dom = new JSDOM(html)
    const doc = dom.window.document
    expect(doc.querySelectorAll('link[rel="canonical"]')).toHaveLength(1)
    expect(doc.querySelectorAll('meta[name="description"]')).toHaveLength(1)
    expect(doc.querySelectorAll('title')).toHaveLength(1)
    expect(doc.querySelector('#public-page-preview h1').textContent).toBe('Airborne Numerical Test')
    expect(doc.querySelector('#public-page-preview a').getAttribute('href')).toBe('/cbat')
    expect(doc.querySelector('#public-page-preview script')).toBeNull()
    expect(doc.querySelector('#public-page-preview .guest-theme-hint')).toBeNull()
    expect(doc.getElementById('root').innerHTML).toBe('')
    expect(doc.querySelector('script[type="module"]').getAttribute('src')).toBe('/src/main.jsx')
    dom.window.close()
  })

  it('fails rather than deploying a page canonicalised to the homepage', () => {
    expect(() => buildPublicHtml(template, { head: '<link rel="canonical" href="https://skywatch.academy/">', body: '' }, '/cbat/ant')).toThrow('Wrong canonical')
  })

  it('keeps account requirements accurate and descriptions concise', () => {
    for (const [path, page] of Object.entries(PUBLIC_PAGE_SEO)) {
      expect(page.description.length).toBeLessThanOrEqual(160)
      expect(page.description).toMatch(/free/i)
      expect(page.description).toMatch(path.startsWith('/cbat/') ? /no account required/i : /free account/i)
    }
  })
})
