// Fails a production build whose baked-in API URL is obviously wrong.
//
// VITE_API_URL is inlined at build time, so an installed Android app calls
// whatever address was set when the APK was built — forever, until you ship a
// new version. There is no runtime override and no error message: a build made
// with the dev value simply produces an app that can't reach anything, and you
// find out from users.
//
// That already happened once in a quieter form: the shipped Android build was
// pointing at the raw Railway URL rather than api.skywatch.academy, because
// .env.production (gitignored, so invisible in review) still held the old value.
//
// This check only rejects values that cannot possibly be right in production.
// Anything else passes, so it won't fail a Vercel build or a preview deploy.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ASSET_DIR = join(process.cwd(), 'dist', 'assets')

// Substrings that are always wrong in a production bundle.
const FORBIDDEN = [
  { needle: 'localhost:5000', why: 'the local dev API — this build cannot reach anything' },
  { needle: 'up.railway.app', why: 'the raw Railway URL — use https://api.skywatch.academy' },
]

let files
try {
  files = readdirSync(ASSET_DIR).filter((f) => f.endsWith('.js'))
} catch {
  // No dist/assets — nothing was built (or the layout changed). Not this
  // script's job to fail the build over that.
  process.exit(0)
}

const problems = []
for (const file of files) {
  const contents = readFileSync(join(ASSET_DIR, file), 'utf8')
  for (const { needle, why } of FORBIDDEN) {
    if (contents.includes(needle)) problems.push({ file, needle, why })
  }
}

if (problems.length) {
  console.error('\n✖ Production build has a bad API URL baked in:\n')
  for (const { file, needle, why } of problems) {
    console.error(`  ${needle}  (in assets/${file})`)
    console.error(`    → ${why}\n`)
  }
  console.error('Fix VITE_API_URL in .env.production, then rebuild.')
  console.error('Shipping this to Android would produce an app that silently fails.\n')
  process.exit(1)
}

console.log('✓ API URL check passed')
