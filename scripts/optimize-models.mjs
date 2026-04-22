// Reads uncompressed GLB source models from models-src/ and writes compressed
// versions to public/models/. Idempotent — skips any source whose output exists
// and is newer than the source. Re-run safely.
//
// Also exposes optimizeGlbFile(srcPath) for the Vite plugin to call on file drop.

import { readdirSync, statSync, existsSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, basename } from 'node:path'
import { pathToFileURL } from 'node:url'

export const SRC_DIR = 'models-src'
export const OUT_DIR = 'public/models'

const OPTIMIZE_ARGS = [
  '--compress', 'draco',
  '--texture-compress', 'webp',
  '--texture-size', '256',
  '--simplify-ratio', '0.1',
  '--simplify-error', '0.01',
].join(' ')

function needsOptimize(srcPath, outPath) {
  if (!existsSync(outPath)) return true
  return statSync(srcPath).mtimeMs > statSync(outPath).mtimeMs
}

export function optimizeGlbFile(srcPath) {
  const outPath = join(OUT_DIR, basename(srcPath))
  if (!needsOptimize(srcPath, outPath)) return false
  mkdirSync(OUT_DIR, { recursive: true })
  console.log(`[models] optimizing ${basename(srcPath)}`)
  const before = statSync(srcPath).size
  execSync(
    `npx -y @gltf-transform/cli optimize "${srcPath}" "${outPath}" ${OPTIMIZE_ARGS}`,
    { stdio: 'inherit' }
  )
  const after = statSync(outPath).size
  console.log(`[models] ${basename(srcPath)}: ${fmt(before)} → ${fmt(after)} (${Math.round((1 - after / before) * 100)}% smaller)`)
  return true
}

function fmt(bytes) {
  if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB'
  if (bytes > 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return bytes + ' B'
}

function runAll() {
  let files
  try {
    files = readdirSync(SRC_DIR).filter(f => f.toLowerCase().endsWith('.glb'))
  } catch {
    console.log(`[models] ${SRC_DIR}/ not found — nothing to optimize`)
    return
  }
  if (!files.length) {
    console.log(`[models] ${SRC_DIR}/ is empty — nothing to optimize`)
    return
  }
  let processed = 0
  for (const file of files) {
    const srcPath = join(SRC_DIR, file)
    try {
      if (optimizeGlbFile(srcPath)) processed++
    } catch (e) {
      console.error(`[models] failed to optimize ${file}:`, e.message)
    }
  }
  console.log(`[models] ${processed} file(s) optimized, ${files.length - processed} up to date`)
}

// Run the batch pass when invoked directly (npm run optimize-models / predev / prebuild)
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAll()
}
