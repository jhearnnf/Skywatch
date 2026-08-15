// Bakes the CBAT guide's generated body into static HTML at build time.
//
// public/cbat-guide.html ships ~190 words of real markup — the masthead and the
// intro — over an empty <main id="main">. Everything else, all ~17,000 words of
// it, lives in a `const TESTS = [...]` array inside a <script> and only exists
// once `main.innerHTML = out.join('')` runs in the browser.
//
// Google Search Console reported the page as "URL is not on Google" with no
// crawl history. Googlebot does render JavaScript, but rendering is a deferred
// second pass, and the first thing it sees here is a near-empty document. A
// 17,000-word guide that reads as a 190-word stub is not a page anything wants
// to index, and it is the site's strongest content asset.
//
// So: run the page's own script in jsdom after the build, serialise the result
// and write it back over dist/cbat-guide.html. The crawler now gets the whole
// document in the initial response.
//
// public/ is deliberately left alone. It stays the hand-edited source — small,
// readable, and free of a 400KB generated diff every time a fact changes. Only
// the build output is expanded, which also makes this idempotent: the browser
// re-runs the same script on load and produces exactly the same DOM.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { JSDOM, VirtualConsole } from 'jsdom'

const GUIDE = join(process.cwd(), 'dist', 'cbat-guide.html')

// The generated body is ~17,000 words. Anything remotely near the 190-word
// static shell means the script did not run and the build must not ship.
const MIN_WORDS = 5000

/**
 * Runs the guide's inline scripts and returns the expanded HTML.
 *
 * Exported so the test suite can assert the bake works against the source file
 * without needing a full build — this is the failure mode that would otherwise
 * only surface as a page quietly going back to 190 words on Google.
 */
export function prerenderGuide(html) {
  const errors = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', (e) => errors.push(e))

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true, // gives requestAnimationFrame, used at the end
    virtualConsole,
    beforeParse(window) {
      // The guide's tail wires up a scrollspy and lazy-loads the simulation
      // iframes through IntersectionObserver, and jumps to location.hash with
      // scrollIntoView. jsdom has neither. Both run *after* the content is
      // built, so without stubs the bake would still work — but it would throw
      // on the way out and bury a real error in the noise. Stub them and any
      // error that does surface is worth reading.
      window.IntersectionObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() { return [] }
      }
      window.Element.prototype.scrollIntoView = function scrollIntoView() {}
    },
  })

  const { document } = dom.window
  const main = document.getElementById('main')
  const words = main ? main.textContent.trim().split(/\s+/).filter(Boolean).length : 0

  if (words < MIN_WORDS) {
    dom.window.close()
    const detail = errors.length
      ? `\n\nThe page threw while rendering:\n${errors.map((e) => `  ${e.message || e}`).join('\n')}`
      : '\n\nNo script error was reported, so check that <main id="main"> and the' +
        ' generator script are both still present.'
    throw new Error(
      `CBAT guide pre-render produced only ${words} words (expected at least ${MIN_WORDS}).${detail}`,
    )
  }

  const out = dom.serialize()
  dom.window.close()
  return { html: out, words }
}

// ── CLI ────────────────────────────────────────────────────────────────────
// Skipped when there is no dist/, matching check-build-api-url.mjs: a missing
// build directory is not this script's business to fail over.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('prerender-cbat-guide.mjs')) {
  if (!existsSync(GUIDE)) {
    console.log('· No dist/cbat-guide.html — skipping guide pre-render')
    process.exit(0)
  }

  const source = readFileSync(GUIDE, 'utf8')
  let result
  try {
    result = prerenderGuide(source)
  } catch (err) {
    console.error(`\n✖ ${err.message}\n`)
    console.error('The guide would deploy as a near-empty page and drop out of')
    console.error('Google\'s index. Fix the page script, then rebuild.\n')
    process.exit(1)
  }

  writeFileSync(GUIDE, result.html, 'utf8')

  const kb = (Buffer.byteLength(result.html, 'utf8') / 1024).toFixed(0)
  console.log(`✓ CBAT guide pre-rendered — ${result.words.toLocaleString()} words in the HTML (${kb} KB)`)
}
