// The public CBAT test pages: /cbat-tests and one page per test, generated at
// build time by scripts/build-cbat-test-pages.mjs from the guide's TESTS array.
//
// These exist for search, so the failure modes worth guarding are the quiet
// ones: a guide refactor that empties every page, a slug that drifts between the
// registry and the guide's links, a canonical pointing at the wrong URL, a page
// too thin to rank, or copy that breaks a standing rule (em dashes on screen,
// "Skywatch" casing, naming OASC, claiming the real test).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'
import { loadGuideData } from '../../scripts/cbatTestPages/loadGuideData.mjs'
import { renderAll, mainWordCount, pagePath, INDEX_PATH } from '../../scripts/cbatTestPages/render.mjs'
import { PRACTISE } from '../../scripts/cbatTestPages/copy.js'
import registry from '../../backend/constants/cbatTestPages.json'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8')
const guideHtml = read('public', 'cbat-guide.html')
const SITE_URL = 'https://skywatch.academy'

const STATS = {
  flag: { runs: 2284, improvedPct: 78, cohort: 65 },
  dad: { runs: 150, improvedPct: 90, cohort: 12 },
}
const pages = renderAll({ guideHtml, registry, stats: STATS })
const body = html => html.slice(html.indexOf('<body>')).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ')

describe('guide data', () => {
  const { TESTS } = loadGuideData(guideHtml)

  it('reads every test out of the guide', () => {
    expect(TESTS.length).toBe(23)
    for (const t of TESTS) expect(t.facts.length).toBeGreaterThan(0)
  })

  it('gives every guide test exactly one page, and every page a guide test', () => {
    expect(registry.tests.map(t => t.guideId).sort()).toEqual(TESTS.map(t => t.id).sort())
    expect(new Set(registry.tests.map(t => t.slug)).size).toBe(registry.tests.length)
  })

  it('keeps the guide’s own “Full page” slugs in step with the registry', () => {
    const src = guideHtml.match(/const PAGES = (\{[\s\S]*?\});/)[1]
    const pagesInGuide = vm.runInNewContext(`(${src})`)
    expect(pagesInGuide).toEqual(Object.fromEntries(registry.tests.map(t => [t.guideId, t.slug])))
  })

  it('links every guide test to the same game its page does', () => {
    const src = guideHtml.match(/const PLAY = (\{[\s\S]*?\});/)[1]
    const playInGuide = vm.runInNewContext(`(${src})`)
    expect(playInGuide).toEqual(Object.fromEntries(registry.tests.map(t => [t.guideId, t.playPath])))
  })

  it('has practise copy for every test and a known group for each page', () => {
    const groups = registry.groups.map(g => g.id)
    for (const t of registry.tests) {
      expect(PRACTISE[t.guideId]?.length).toBeGreaterThan(0)
      expect(groups).toContain(t.group)
      expect(t.playPath).toMatch(/^\/cbat\/[a-z0-9-]+$/)
    }
  })
})

describe('rendered pages', () => {
  it('renders the index and one page per test', () => {
    expect(pages.size).toBe(registry.tests.length + 1)
    expect(pages.has(INDEX_PATH)).toBe(true)
  })

  for (const [path, html] of pages) {
    describe(path, () => {
      it('self-canonicalises to its clean URL', () => {
        expect(html).toContain(`<link rel="canonical" href="${SITE_URL}${path}">`)
        expect(html).toContain(`<meta property="og:url" content="${SITE_URL}${path}">`)
      })

      it('is substantial enough to rank', () => {
        expect(mainWordCount(html)).toBeGreaterThanOrEqual(350)
      })

      it('ships structured data that parses, with breadcrumbs', () => {
        const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])
        expect(ld['@graph'].map(n => n['@type'])).toContain('BreadcrumbList')
      })

      it('follows the on-screen copy rules', () => {
        const text = body(html)
        expect(text).not.toMatch(/—/)
        expect(text).not.toMatch(/Skywatch/)
        expect(text).not.toMatch(/\bOASC\b/)
        expect(text).toMatch(/practice version/)
      })
    })
  }

  it('links each test page to its game, its guide section and the index', () => {
    for (const t of registry.tests) {
      const html = pages.get(pagePath(t.slug))
      expect(html).toContain(`class="cta" href="${t.playPath}"`)
      expect(html).toContain(`href="/cbat-guide#test-${t.guideId}"`)
      expect(html).toContain(`href="${INDEX_PATH}"`)
    }
  })

  it('shows stats only above the floors', () => {
    const flag = pages.get(pagePath('flag-figures-logistics-and-groups'))
    expect(flag).toContain('2,200+')
    expect(flag).toContain('78%')
    const dad = pages.get(pagePath('dad-directions-and-distances'))
    expect(dad).not.toContain('class="stats"')
  })

  it('renders without stats when the API was unreachable', () => {
    const bare = renderAll({ guideHtml, registry })
    for (const html of bare.values()) expect(html).not.toContain('class="stats"')
  })

  it('rewrites sibling document links to .html only when opened as a file', () => {
    const html = pages.get(INDEX_PATH)
    expect(html).toMatch(/if \(\/\\\.html\$\/\.test\(location\.pathname\)\)/)
  })
})

describe('routing and discovery', () => {
  const vercel = JSON.parse(read('vercel.json'))
  const fallback = vercel.rewrites.findIndex(r => r.destination === '/index.html')

  it('rewrites the clean URLs to the generated files before the SPA fallback', () => {
    const idx = vercel.rewrites.findIndex(r => r.source === '/cbat-tests')
    const slug = vercel.rewrites.findIndex(r => r.source === '/cbat-tests/:slug')
    expect(vercel.rewrites[idx].destination).toBe('/cbat-tests.html')
    expect(vercel.rewrites[slug].destination).toBe('/cbat-tests/:slug.html')
    expect(idx).toBeLessThan(fallback)
    expect(slug).toBeLessThan(fallback)
  })

  it('lists every page in the sitemap', () => {
    const xml = read('public', 'sitemap.xml')
    for (const path of pages.keys()) expect(xml).toContain(`<loc>${SITE_URL}${path}</loc>`)
  })
})
