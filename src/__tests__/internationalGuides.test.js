import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

// The Canadian and Australian guides are static documents outside the build,
// exactly like the UK one, so nothing in the app imports them and nothing else
// would notice if they broke.
//
// The thing most likely to go wrong is not the HTML. It is that a page ships
// while one of the four things that keep a draft private is missing, or that a
// guide goes live with only some of them removed. Each guide has to agree with
// itself across four files: the noindex tag, robots.txt, the sitemap, and the
// serving rules. These tests hold that agreement together in both directions.

const GUIDES = [
  { slug: 'cbat-guide-canada',    file: 'public/cbat-guide-canada.html' },
  { slug: 'cbat-guide-australia', file: 'public/cbat-guide-australia.html' },
]

const read    = (p) => readFileSync(p, 'utf8')
const robots  = read('public/robots.txt')
const sitemap = read('public/sitemap.xml')
const vercel  = JSON.parse(read('vercel.json'))
const vite    = read('vite.config.js')

describe.each(GUIDES)('$slug', ({ slug, file }) => {
  const html = read(file)

  it('is served at a clean URL in production and in dev', () => {
    const rewrite = vercel.rewrites.find(r => r.source === `/${slug}`)
    expect(rewrite?.destination).toBe(`/${slug}.html`)
    // staticDocRoutes() is what makes the clean URL work under `npm run dev`.
    // Without it the SPA answers and the guide 404s locally only.
    expect(vite).toContain(`'/${slug}':`)
  })

  it('opts out of the service worker navigation fallback', () => {
    // The precached index.html answers every navigation unless the path is
    // denied, which breaks the guide in production only. Dev has no service
    // worker, so this cannot be caught by hand.
    const denylist = vite.match(/navigateFallbackDenylist:\s*\[(.+?)\]/s)?.[1] ?? ''
    const pattern  = denylist.match(/\/\^\\\/cbat-guide[^,\]]*/)?.[0] ?? ''
    expect(new RegExp(pattern.slice(1, -1)).test(`/${slug}`)).toBe(true)
  })

  it('loads the shared stylesheet rather than carrying its own copy', () => {
    expect(html).toContain('href="/guide-assets/guide.css"')
    expect(html).not.toContain('<style>')
  })

  it('renders its body without JavaScript', () => {
    // The UK guide builds itself in the browser and needed a build-time
    // pre-render before Google would index it. These are authored as static
    // HTML precisely so that never becomes a problem again.
    const body = html.slice(html.indexOf('<main'), html.indexOf('</main>'))
    expect(body.length).toBeGreaterThan(8000)
    expect(body).toContain('<section id=')
  })

  it('has a contents entry for every section, and no orphans', () => {
    const sections = [...html.matchAll(/<section id="([^"]+)"/g)].map(m => m[1])
    const contents = [...html.matchAll(/data-t="([^"]+)"/g)].map(m => m[1])
    expect(sections.length).toBeGreaterThan(4)
    expect(contents).toEqual(sections)
  })

  it('carries the independence disclaimer and does not claim to have the real tests', () => {
    expect(html).toMatch(/not affiliated with, endorsed by or connected to/)
    expect(html).toMatch(/simulations built from/)
    expect(html).toContain('They are not the real tests')
  })

  it('uses no em dashes in on-screen copy', () => {
    // House style, and they read as machine-written. Comments are stripped
    // first so the note to future maintainers is not what fails the test.
    const visible = html.replace(/<!--[\s\S]*?-->/g, '')
    expect(visible).not.toContain('—')
  })

  it('spells SkyWatch with a capital W', () => {
    expect(html).not.toMatch(/Skywatch/)
  })

  describe('staging', () => {
    // All four of these move together. Half a release is worse than none: a
    // noindex tag removed while robots.txt still blocks the page means Google
    // cannot fetch the page to see that it may now index it.
    const noindexed  = /<meta name="robots" content="noindex/.test(html)
    const disallowed = robots.includes(`Disallow: /${slug}`)
    const inSitemap  = sitemap.includes(`/${slug}<`)

    it('keeps its noindex tag, robots rule and sitemap entry consistent', () => {
      expect(disallowed).toBe(noindexed)
      expect(inSitemap).toBe(!noindexed)
    })

    it('says in the page which state it is in', () => {
      // So an admin opening the draft knows it is a draft without checking
      // four config files to find out.
      if (noindexed) expect(html).toContain('admin preview')
      else expect(html).not.toContain('admin preview')
    })
  })
})

describe('the shared guide stylesheet', () => {
  it('still defines the classes the guides are written against', () => {
    const css = read('public/guide-assets/guide.css')
    for (const cls of ['.masthead', '.shell', '.item', '.chip', '.tiles', '.tblwrap', 'ol.key']) {
      expect(css).toContain(cls)
    }
  })

  it('is not loaded by the UK guide, which keeps its own inline copy', () => {
    // Deliberate: that page is pre-rendered and read whole by other tests.
    // If this ever changes, those tests need looking at first.
    expect(read('public/cbat-guide.html')).not.toContain('guide-assets/guide.css')
  })
})
