/**
 * The CBAT guide's build-time pre-render.
 *
 * public/cbat-guide.html is a shell: ~190 words of masthead over an empty
 * <main id="main">, with the other ~17,000 words held in a script and injected
 * on load. Search Console reported the page as "URL is not on Google", never
 * having crawled it, and a document that reads as a 190-word stub on first
 * fetch is not one anything hurries to index.
 *
 * scripts/prerender-cbat-guide.mjs runs that script in jsdom after the build so
 * dist/ ships the whole document. This exercises the bake against the real
 * source, because the way it breaks is silent: someone adds a browser API the
 * bake cannot provide, the script throws before it fills <main>, and the only
 * symptom is the guide quietly falling out of Google weeks later.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { prerenderGuide } from '../../scripts/prerender-cbat-guide.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const source = readFileSync(join(ROOT, 'public', 'cbat-guide.html'), 'utf8')

describe('CBAT guide pre-render', () => {
  const { html, words } = prerenderGuide(source)

  it('bakes the full document into static HTML', () => {
    // The source shell is under 300 words. Anything near that means the
    // generator did not run.
    expect(words).toBeGreaterThan(10_000)
    expect(html.length).toBeGreaterThan(source.length * 1.5)
  })

  it('fills the three containers the page builds at runtime', () => {
    // <main>, the contents rail and the footer are each set by innerHTML. A
    // crawler that gets any of them empty gets a page with no body, no
    // navigation, or no provenance note.
    expect(html).toMatch(/id="main"[^>]*>\s*<section/)
    expect(html).toMatch(/id="tocbody"[^>]*><h4>Contents<\/h4><a href="#/)
    expect(html).toMatch(/id="foot"[^>]*><strong/)
  })

  it('keeps every section the contents rail points at', () => {
    const targets = [...html.matchAll(/<a href="#([^"]+)" class="[^"]*" data-t=/g)].map(m => m[1])
    expect(targets.length).toBeGreaterThan(10)
    for (const id of targets) {
      expect(html, `contents links #${id}, which is not in the document`).toContain(`id="${id}"`)
    }
  })

  it('leaves the head metadata untouched', () => {
    // Serialising through jsdom must not disturb what the crawler reads first.
    expect(html).toContain('<link rel="canonical" href="https://skywatch.academy/cbat-guide">')
    expect(html).toMatch(/<meta name="robots" content="index, follow/)
    expect(html).toContain('<title>')
  })

  it('keeps the page script, so the document still works unchanged', () => {
    // The bake is additive: the browser re-runs the same generator and rebuilds
    // the identical DOM. Stripping the script would take the contents toggle,
    // the scrollspy and the lazy-loaded simulation frames with it.
    expect(html).toContain('main.innerHTML = out.join')
    expect(html).toContain('IntersectionObserver')
  })

  it('is idempotent, so a re-run cannot compound', () => {
    const again = prerenderGuide(html)
    expect(again.words).toBe(words)
  })
})
