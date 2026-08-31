/**
 * PostHog on the CBAT guide.
 *
 * The guide is a standalone document served out of public/, not a route, so
 * src/main.jsx and initPostHog() never run on it. It went untracked for its
 * whole life while every in-app route was measured — the page taking most of
 * the site's search traffic was the one page invisible in analytics.
 *
 * Two things are asserted here, and they pull against each other:
 *
 *   1. The tracking really fires in a browser. A guard that is too broad turns
 *      the page silently untracked again, which is exactly the failure that
 *      went unnoticed before and produces no error anywhere.
 *   2. It fires *only* in a browser. scripts/prerender-cbat-guide.mjs runs this
 *      page's scripts in jsdom on every build to bake the body into dist/; that
 *      must not boot analytics or leave anything behind in the serialised HTML.
 */

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { JSDOM, VirtualConsole } from 'jsdom'
import { prerenderGuide } from '../../scripts/prerender-cbat-guide.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const source = readFileSync(join(ROOT, 'public', 'cbat-guide.html'), 'utf8')

// The same stubs the pre-render installs: the page's tail wires up a scrollspy
// and lazy-loads the demo iframes, and jsdom has neither API.
function beforeParse(window) {
  window.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return [] }
  }
  window.Element.prototype.scrollIntoView = function scrollIntoView() {}
}

describe('CBAT guide analytics', () => {
  it('loads PostHog from the EU asset host, deferred', () => {
    // Deferred so a content page 17,000 words long is never waiting on the
    // analytics CDN to start rendering.
    expect(source).toMatch(
      /<script src="https:\/\/eu-assets\.i\.posthog\.com\/static\/array\.js" defer><\/script>/,
    )
  })

  it('initialises against the same EU project as the app bundle', async () => {
    const appConfig = readFileSync(join(ROOT, 'src', 'lib', 'posthog.js'), 'utf8')
    const key = source.match(/posthog\.init\('(phc_[A-Za-z0-9]+)'/)?.[1]
    const env = readFileSync(join(ROOT, '.env.example'), 'utf8')

    // Guide events landing in a different project than the app's would split
    // one user's journey across two datasets.
    expect(key).toMatch(/^phc_/)
    expect(source).toContain("api_host: 'https://eu.i.posthog.com'")
    expect(appConfig).toContain("'https://eu.i.posthog.com'")
    // The key is literal here because Vite copies public/ through verbatim and
    // substitutes no env vars in it. Nothing to assert about .env beyond the
    // app still reading its own key from there.
    expect(env).toContain('VITE_POSTHOG_KEY=')
  })

  it('captures the pageview once, not on every hash jump', () => {
    // The section rail replaceState()s the hash on each click. Under the SPA's
    // capture_pageview: 'history_change' that logs a fresh pageview per jump,
    // inflating views and resetting the time-on-page the guide is judged on.
    expect(source).toContain('capture_pageview: true')
    expect(source).not.toContain("capture_pageview: 'history_change'")
  })

  it('captures pageleave, which is what measures reading depth', () => {
    // Time on page and $prev_pageview_max_scroll_percentage both ride on this.
    // Drop it and the two questions the guide exists to answer go unanswerable.
    expect(source).toContain('capture_pageleave: true')
  })

  it('actually initialises on a real https page load', async () => {
    const calls = []
    const dom = new JSDOM(source, {
      url: 'https://skywatch.academy/cbat-guide',
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      virtualConsole: new VirtualConsole(),
      beforeParse(window) {
        beforeParse(window)
        // Stands in for array.js, which jsdom does not fetch.
        window.posthog = { init: (key, config) => calls.push({ key, config }) }
      },
    })

    await vi.waitFor(() => expect(calls).toHaveLength(1), { timeout: 5000 })
    expect(calls[0].key).toMatch(/^phc_/)
    expect(calls[0].config.person_profiles).toBe('always')
    dom.window.close()
  })

  it('stays inert during the build pre-render', () => {
    const calls = []
    const dom = new JSDOM(source, {
      // No url: jsdom parses at about:blank, exactly as the pre-render does.
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      virtualConsole: new VirtualConsole(),
      beforeParse(window) {
        beforeParse(window)
        window.posthog = { init: (key, config) => calls.push({ key, config }) }
      },
    })

    // Even with PostHog present, about:blank must not boot it — otherwise every
    // build counts itself as a reader.
    expect(calls).toHaveLength(0)
    dom.window.close()
  })

  it('ships exactly one loader tag through the pre-render', () => {
    // The reason this uses a plain <script src> rather than PostHog's inline
    // bootstrap snippet: the snippet injects its own loader tag into the DOM,
    // which the pre-render would then serialise into dist/ alongside this one.
    const { html } = prerenderGuide(source)
    const tags = html.match(/eu-assets\.i\.posthog\.com/g) || []
    expect(tags).toHaveLength(1)
  })
})
