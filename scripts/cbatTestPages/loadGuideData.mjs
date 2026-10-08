// Reads the CBAT guide's own data out of public/cbat-guide.html.
//
// The guide keeps every test as a `const TESTS = [...]` array in an inline
// <script>, followed by helpers and a `const SIMS = {...}` map, and only starts
// touching the DOM at `const main = document.getElementById('main')`. Everything
// above that line is plain data and pure string helpers, so it can run in a bare
// vm context with no DOM at all.
//
// The test pages read the guide rather than keeping a copy so a fact corrected
// in the guide is corrected on its page too. If the guide is ever restructured
// so these markers move, this throws and the build stops, rather than quietly
// publishing 23 empty pages.
import vm from 'node:vm'

const START = 'const TESTS = ['
const END = "const main = document.getElementById('main');"

export function loadGuideData(html) {
  const start = html.indexOf(START)
  const end = html.indexOf(END, start)
  if (start < 0 || end < 0) {
    throw new Error('cbat-guide.html no longer has the TESTS … main markers the test pages read from.')
  }
  // The data and the renderer sit in two adjacent <script> blocks; join them.
  const body = html.slice(start, end).replace(/<\/script>\s*<script>/g, '\n')
  // The guide's own markup helpers come back too, so a fact renders on a test
  // page exactly as it does in the guide.
  const code = `${body}\n;({ TESTS, SIMS, CONF, esc, chip, factsHTML, simHTML })`
  // `location` is read by the guide's link helper (pageHref); a bare path keeps
  // it on the clean, crawler-facing form.
  const data = vm.runInNewContext(code, { location: { pathname: '/' } }, { timeout: 2000 })
  if (!Array.isArray(data.TESTS) || !data.TESTS.length) throw new Error('cbat-guide.html TESTS is empty.')
  return data
}

// The guide's PostHog loader (the deferred array.js tag and its init script),
// so the test pages are measured the same way the guide is. See the comment
// above that block in the guide for why it is a <script src> and not a snippet.
export function loadGuideAnalytics(html) {
  const start = html.indexOf('<script src="https://eu-assets.i.posthog.com/')
  const initEnd = start < 0 ? -1 : html.indexOf('</script>', html.indexOf('<script>', start))
  if (start < 0 || initEnd < 0) throw new Error('cbat-guide.html no longer has its PostHog block.')
  return html.slice(start, initEnd + '</script>'.length)
}

// The guide's <style> block, so the test pages read as the same document family.
export function loadGuideStyle(html) {
  const m = html.match(/<style>([\s\S]*?)<\/style>/)
  if (!m) throw new Error('cbat-guide.html has no <style> block.')
  return m[1]
}
