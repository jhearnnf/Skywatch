// Writes the public CBAT test pages into dist/ after the Vite build:
//   dist/cbat-tests.html            -> served at /cbat-tests
//   dist/cbat-tests/<slug>.html     -> served at /cbat-tests/<slug>
// vercel.json rewrites the clean URLs to these files; vite.config.js renders the
// same pages on request in dev. See scripts/cbatTestPages/render.mjs for what
// the pages are and why they are static documents.
//
// Player stats are optional. They come from the live API, and a deploy must
// never fail because the backend was mid-restart, so on any error the pages are
// written without them and a warning is logged. Thin or mis-canonicalised
// pages, on the other hand, fail the build: those would ship broken SEO.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { renderAll, mainWordCount, INDEX_PATH } from './cbatTestPages/render.mjs'

const ROOT = process.cwd()
const DIST = join(ROOT, 'dist')
const MIN_WORDS = 350

export function loadRegistry() {
  return JSON.parse(readFileSync(join(ROOT, 'backend', 'constants', 'cbatTestPages.json'), 'utf8'))
}

async function fetchStats() {
  const { loadEnv } = await import('vite')
  const api = process.env.VITE_API_URL || loadEnv('production', ROOT, 'VITE_').VITE_API_URL
  if (!api) throw new Error('VITE_API_URL is not set')
  const res = await fetch(`${api.replace(/\/$/, '')}/api/games/cbat/public-stats`, { signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = await res.json()
  if (!body?.data?.tests || typeof body.data.tests !== 'object') throw new Error('unexpected payload')
  return body.data.tests
}

export async function buildCbatTestPages({ stats } = {}) {
  const registry = loadRegistry()
  const guideHtml = readFileSync(join(ROOT, 'public', 'cbat-guide.html'), 'utf8')
  const pages = renderAll({ guideHtml, registry, stats })
  for (const [path, html] of pages) {
    const words = mainWordCount(html)
    if (words < MIN_WORDS) throw new Error(`${path} has only ${words} words (floor ${MIN_WORDS}).`)
    if (!html.includes(`<link rel="canonical" href="https://skywatch.academy${path}">`)) {
      throw new Error(`${path} has the wrong canonical.`)
    }
    const file = path === INDEX_PATH ? join(DIST, 'cbat-tests.html') : join(DIST, `${path.slice(1)}.html`)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, html, 'utf8')
  }
  return pages
}

if (process.argv[1]?.endsWith('build-cbat-test-pages.mjs')) {
  if (!existsSync(DIST)) {
    console.log('· No dist/ — skipping CBAT test pages')
    process.exit(0)
  }
  let stats = null
  try {
    stats = await fetchStats()
  } catch (err) {
    console.warn(`! CBAT test pages: no player stats (${err.message}); writing the pages without them`)
  }
  try {
    const pages = await buildCbatTestPages({ stats })
    console.log(`✓ CBAT test pages: ${pages.size} written${stats ? ' with player stats' : ''}`)
  } catch (err) {
    console.error(`\n✖ CBAT test pages: ${err.message}\n`)
    process.exit(1)
  }
}
