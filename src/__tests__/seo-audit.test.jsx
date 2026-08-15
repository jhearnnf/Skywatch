/**
 * SEO audit — guards the things Google Search Console actually penalises.
 *
 * These are all cheap, static invariants that were each broken at some point:
 *   · titles that ended up as "Debrief — SkyWatch — SkyWatch"
 *   · descriptions long enough to be truncated mid-word in a result snippet
 *   · a sitemap listing auth-gated URLs, which GSC logs as "Page with redirect"
 *   · a sitemap URL that robots.txt separately forbids crawling
 *
 * None of this needs a browser or a network, so it runs with the unit tests.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, extname, dirname } from 'path'
import { fileURLToPath } from 'url'
import { formatTitle } from '../utils/seoTitle.js'

// Resolved from this file rather than process.cwd() so the test does not depend
// on where vitest was invoked from — and so it needs no Node globals, which the
// browser-targeted eslint config does not provide.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SITE_URL = 'https://skywatch.academy'

// Google truncates a result snippet at roughly this width. Titles get less.
const MAX_DESCRIPTION = 160
const MAX_TITLE = 65

function readText(...parts) {
  return readFileSync(join(ROOT, ...parts), 'utf8')
}

function walkJsx(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkJsx(full, out)
    else if (extname(full) === '.jsx') out.push(full)
  }
  return out
}

const JSX_FILES = walkJsx(join(ROOT, 'src'))

// ── Title formatting ──────────────────────────────────────────────────────
describe('formatTitle', () => {
  it('appends the site name once', () => {
    expect(formatTitle('Case Files')).toBe('Case Files — SkyWatch')
  })

  it('does not double the site name when a caller already included it', () => {
    expect(formatTitle('Debrief — SkyWatch')).toBe('Debrief — SkyWatch')
    expect(formatTitle('Debrief - SkyWatch')).toBe('Debrief — SkyWatch')
  })

  it('leads with the keyword, not the brand, when a page has no title', () => {
    const title = formatTitle(undefined)
    expect(title.startsWith('CBAT')).toBe(true)
    expect(title.endsWith('— SkyWatch')).toBe(true)
    expect(title.length).toBeLessThanOrEqual(MAX_TITLE)
  })
})

// ── <SEO> call sites ──────────────────────────────────────────────────────
describe('<SEO> usage', () => {
  it('never passes a title that already ends in the site name', () => {
    const offenders = []
    for (const file of JSX_FILES) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(/<SEO[^>]*?title=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        const title = m[1] ?? m[2]
        if (/[—–-]\s*SkyWatch\s*$/i.test(title)) {
          offenders.push(`${file.replace(ROOT, '')}: ${title}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps literal descriptions within the snippet limit', () => {
    const tooLong = []
    for (const file of JSX_FILES) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(/<SEO[^>]*?description="([^"]*)"/g)) {
        if (m[1].length > MAX_DESCRIPTION) {
          tooLong.push(`${file.replace(ROOT, '')}: ${m[1].length} chars`)
        }
      }
    }
    expect(tooLong).toEqual([])
  })
})

// ── The rendered head ─────────────────────────────────────────────────────
// Helmet silently drops children it cannot serialise, so the `jsonLd` prop
// working is worth proving rather than assuming.
describe('<SEO> rendered output', () => {
  it('writes the canonical, robots and JSON-LD tags into the head', async () => {
    const { render, waitFor } = await import('@testing-library/react')
    const { HelmetProvider } = await import('react-helmet-async')
    const { MemoryRouter } = await import('react-router-dom')
    const SEO = (await import('../components/SEO.jsx')).default

    render(
      <HelmetProvider>
        <MemoryRouter initialEntries={['/cbat']}>
          <SEO title="CBAT Practice Tests" jsonLd={{ '@type': 'ItemList', name: 'probe' }} />
        </MemoryRouter>
      </HelmetProvider>,
    )

    await waitFor(() => {
      expect(document.title).toBe('CBAT Practice Tests — SkyWatch')
    })
    expect(document.querySelector('link[rel="canonical"]').getAttribute('href'))
      .toBe(`${SITE_URL}/cbat`)
    expect(document.querySelector('meta[name="robots"]').getAttribute('content'))
      .toContain('index, follow')

    const ld = document.querySelector('script[type="application/ld+json"]')
    expect(JSON.parse(ld.textContent).name).toBe('probe')
  })
})

// ── index.html (the no-JS fallback every crawler reads first) ─────────────
describe('index.html', () => {
  const html = readText('index.html')

  it('has a self-referencing canonical', () => {
    expect(html).toContain(`<link rel="canonical" href="${SITE_URL}/" />`)
  })

  it('leads its title with the CBAT keyword and stays within budget', () => {
    const title = html.match(/<title>([^<]*)<\/title>/)[1]
    expect(title.startsWith('CBAT')).toBe(true)
    expect(title.length).toBeLessThanOrEqual(MAX_TITLE)
  })

  it('has a description within the snippet limit', () => {
    const desc = html.match(/<meta name="description" content="([^"]*)"/)[1]
    expect(desc.length).toBeGreaterThan(50)
    expect(desc.length).toBeLessThanOrEqual(MAX_DESCRIPTION)
  })

  it('ships structured data that parses', () => {
    const block = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]
    const parsed = JSON.parse(block)
    expect(parsed['@context']).toBe('https://schema.org')
    const types = parsed['@graph'].map(n => n['@type'])
    expect(types).toContain('WebSite')
    expect(types).toContain('Organization')
  })
})

// ── The CBAT guide — the site's strongest crawlable document ──────────────
describe('cbat-guide.html', () => {
  const html = readText('public', 'cbat-guide.html')

  // The year is what makes a guide look current in a result list, and the one
  // thing that dates it if nobody rolls it forward. It is in the <title>, the
  // social titles, the Article headline and the <h1>; they move together.
  it('dates its title, and keeps it inside the snippet width', () => {
    const title = html.match(/<title>([^<]*)<\/title>/)[1]
    expect(title).toMatch(/\b20\d{2}\b/)
    expect(title.length).toBeLessThanOrEqual(MAX_TITLE)
    for (const prop of ['og:title', 'twitter:title']) {
      const social = html.match(new RegExp(`(?:property|name)="${prop}" content="([^"]*)"`))[1]
      expect(social).toBe(title)
    }
  })

  it('canonicalises to the clean URL, not the .html one', () => {
    const canonical = html.match(/<link rel="canonical" href="([^"]*)"/)[1]
    expect(canonical).toBe(`${SITE_URL}/cbat-guide`)
  })

  it('has a description within the snippet limit', () => {
    const desc = html.match(/<meta name="description" content="([^"]*)"/)[1]
    expect(desc.length).toBeGreaterThan(50)
    expect(desc.length).toBeLessThanOrEqual(MAX_DESCRIPTION)
  })

  it('ships Article structured data that parses', () => {
    const block = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]
    const types = JSON.parse(block)['@graph'].map(n => n['@type'])
    expect(types).toContain('Article')
    expect(types).toContain('BreadcrumbList')
  })
})

// ── Internal links to the guide ───────────────────────────────────────────
//
// Google reported the guide as "URL is not on Google" with no crawl history at
// all: it had never fetched the page. The sitemap listed it, but nothing on the
// public site linked to it, and a sitemap-only URL with zero internal links is
// the lowest crawl priority there is.
//
// So the two indexable pages that can reach it must keep doing so. These assert
// the anchor exists and is a real one — a react-router <Link to="/cbat-guide">
// would navigate inside the SPA, never hit the server rewrite, and render the
// 404 instead of the document.
describe('internal links to the guide', () => {
  for (const page of ['Landing.jsx', 'Cbat.jsx']) {
    const src = readText('src', 'pages', page)

    it(`${page} links the guide at its canonical clean URL`, () => {
      expect(src).toMatch(/href="\/cbat-guide"/)
    })

    it(`${page} links it as a document, not an app route`, () => {
      expect(src).not.toMatch(/to="\/cbat-guide"/)
      expect(src).not.toMatch(/href="\/cbat-guide\.html"/)
    })
  }
})

// ── sitemap.xml ───────────────────────────────────────────────────────────
describe('sitemap.xml', () => {
  const xml = readText('public', 'sitemap.xml')
  const locs = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map(m => m[1])
  const paths = locs.map(l => l.replace(SITE_URL, '') || '/')

  it('lists only absolute production URLs', () => {
    expect(locs.length).toBeGreaterThan(0)
    for (const loc of locs) expect(loc.startsWith(`${SITE_URL}/`)).toBe(true)
  })

  it('has no duplicate entries', () => {
    expect(new Set(locs).size).toBe(locs.length)
  })

  it('gives every entry a lastmod', () => {
    expect([...xml.matchAll(/<lastmod>/g)].length).toBe(locs.length)
  })

  it('points at the guide by its clean URL only', () => {
    expect(paths).toContain('/cbat-guide')
    expect(paths.some(p => p.endsWith('.html'))).toBe(false)
  })

  // Every /cbat/<game> route sits behind RequireAuth and redirects a logged-out
  // crawler to /login. /cbat/report is the one public exception.
  it('omits the auth-gated CBAT game routes', () => {
    const gated = paths.filter(p => /^\/cbat\//.test(p) && p !== '/cbat/report')
    expect(gated).toEqual([])
  })
})

// ── vercel.json: the www -> apex redirect ────────────────────────────────
//
// Vercel serves both www.skywatch.academy and the apex from the same
// deployment, which splits ranking signals across two URLs for every page and
// surfaces in Search Console as duplicates. Everything else already names the
// apex as canonical — the canonical tags, og:url and sitemap.xml — so this rule
// is what makes the server agree with them.
//
// It lives here rather than in the Vercel dashboard because www does not appear
// as its own row under Settings > Domains, and because a routing rule in the
// repo is reviewable and survives a dashboard reshuffle.
//
// Note for anyone tempted to simplify this: do NOT instead delete the www
// domain or its DNS record. www would stop resolving and every existing
// backlink to a www URL would die rather than forwarding its value to the apex.
//
// vercel.json is strict JSON validated against Vercel's schema — it accepts no
// comments and no extra keys, so the explanation has to live out here.
describe('vercel.json www redirect', () => {
  const config = JSON.parse(readText('vercel.json'))
  const wwwRule = config.redirects?.find(r =>
    r.has?.some(h => h.type === 'host' && h.value === 'www.skywatch.academy'))

  it('redirects the www host to the apex', () => {
    expect(wwwRule).toBeDefined()
    expect(wwwRule.destination).toBe(`${SITE_URL}/$1`)
  })

  // 307 is temporary and tells Google to keep indexing www — the exact problem
  // this rule exists to remove. `permanent: true` is what emits a 308.
  it('is permanent, not temporary', () => {
    expect(wwwRule.permanent).toBe(true)
  })

  // The host condition is what prevents an infinite loop: an apex request never
  // matches, so it falls through to the SPA rewrites instead of redirecting.
  it('matches every path but only on the www host', () => {
    expect(wwwRule.source).toBe('/(.*)')
    expect(wwwRule.has).toHaveLength(1)
  })

  it('still rewrites the guide and the SPA fallback', () => {
    const sources = config.rewrites.map(r => r.source)
    expect(sources).toContain('/cbat-guide')
    expect(config.rewrites.some(r => r.destination === '/index.html')).toBe(true)
  })
})

// ── robots.txt ────────────────────────────────────────────────────────────
describe('robots.txt', () => {
  const txt = readText('public', 'robots.txt')
  const directives = txt
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
  const disallows = directives
    .filter(l => /^Disallow:/i.test(l))
    .map(l => l.replace(/^Disallow:\s*/i, ''))

  it('declares the sitemap', () => {
    expect(txt).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`)
  })

  // A bare "/cbat" would match /cbat, /cbat/report and /cbat-guide alike,
  // de-indexing the entire thing the site is meant to rank for.
  it('never blocks the public CBAT pages', () => {
    for (const path of ['/cbat', '/cbat/report', '/cbat-guide', '/']) {
      const blocked = disallows.filter(d => d !== '/' && path.startsWith(d))
      expect(blocked, `${path} blocked by ${blocked}`).toEqual([])
    }
  })

  // Google renders this SPA to index it, so it needs the JS, CSS and media.
  it('leaves render-critical assets crawlable', () => {
    for (const dir of ['/assets/', '/images/', '/models/', '/sounds/']) {
      expect(disallows.some(d => dir.startsWith(d))).toBe(false)
    }
  })

  it('does not disallow anything listed in the sitemap', () => {
    const xml = readText('public', 'sitemap.xml')
    const paths = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)]
      .map(m => m[1].replace(SITE_URL, '') || '/')
    const conflicts = []
    for (const path of paths) {
      for (const d of disallows) {
        if (d !== '/' && path.startsWith(d)) conflicts.push(`${path} vs Disallow: ${d}`)
      }
    }
    expect(conflicts).toEqual([])
  })
})
