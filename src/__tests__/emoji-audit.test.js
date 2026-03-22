/**
 * Emoji audit — flags Unicode 13.0+ emoji in source files.
 *
 * Unicode 13.0 emojis (released March 2020) are not available on:
 *   - Windows 10 versions prior to 2004 (May 2020 Update)
 *   - macOS prior to 11 Big Sur
 *   - Older Android/iOS devices
 *
 * This test fails if any risky emoji is found, so CI catches regressions.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, extname } from 'path'

// ── Unicode 13.0+ emoji code points that are risky on older desktops ──────
// These were NOT in Segoe UI Emoji before Windows 10 2004.
// Add to this list if new risky emojis are introduced.
const RISKY_EMOJIS = [
  // Unicode 13.0 (March 2020)
  '🪖', // U+1FA96  military helmet
  '🪙', // U+1FA99  coin
  '🪗', // U+1FA97  accordion
  '🪘', // U+1FA98  long drum
  '🧋', // U+1F9CB  bubble tea
  '🥲', // U+1F972  smiling face with tear
  '🤌', // U+1F90C  pinched fingers
  '🫀', // U+1FAC0  anatomical heart
  '🫁', // U+1FAC1  lungs
  '🥸', // U+1F978  disguised face
  // Unicode 14.0 (September 2021)
  '🫶', // U+1FAF6  heart hands
  '🫠', // U+1FAE0  melting face
  '🫡', // U+1FAE1  saluting face
  '🫢', // U+1FAE2  face with open eyes and hand over mouth
  '🫣', // U+1FAE3  face with peeking eye
  '🫤', // U+1FAE4  face with diagonal mouth
  '🫥', // U+1FAE5  dotted line face
  '🫦', // U+1FAF6  biting lip
  // Unicode 15.0 (September 2022)
  '🩷', // U+1FA77  pink heart
  '🩸', // already Unicode 12 — safe
  '🫨', // U+1FAE8  shaking face
]

// ── Source file scanner ───────────────────────────────────────────────────

const SRC_ROOT = join(process.cwd(), 'src')
const EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.css'])

function collectFiles(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__') continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      collectFiles(full, files)
    } else if (EXTENSIONS.has(extname(entry))) {
      files.push(full)
    }
  }
  return files
}

// ── Test ──────────────────────────────────────────────────────────────────

describe('Emoji audit — cross-platform compatibility', () => {
  it('no Unicode 13.0+ emojis are present in source files', () => {
    const files   = collectFiles(SRC_ROOT)
    const matches = []

    for (const file of files) {
      const content = readFileSync(file, 'utf8')
      for (const emoji of RISKY_EMOJIS) {
        if (content.includes(emoji)) {
          matches.push({ file: file.replace(process.cwd(), ''), emoji })
        }
      }
    }

    if (matches.length > 0) {
      const report = matches.map(m => `  ${m.emoji}  in  ${m.file}`).join('\n')
      throw new Error(
        `Found ${matches.length} Unicode 13.0+ emoji(s) that may not render on older desktop OS:\n${report}\n\n` +
        `Replace with a Unicode ≤12.0 equivalent or verify cross-platform support.`
      )
    }

    expect(matches).toHaveLength(0)
  })
})
