import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Android targetSdk 36 forces edge-to-edge, and index.html sets viewport-fit=cover,
// so the WebView draws underneath the 3-button nav bar / gesture pill. Nothing
// reserves that strip except env(safe-area-inset-bottom).
//
// Immersive mode (every CBAT game while playing) translates the BottomNav off
// screen and drops its 5rem reservation with it. If the immersive rule zeroes
// padding-bottom outright, bottom-anchored game controls render *under* the
// system nav bar: visually clipped and untappable. jsdom applies no stylesheet,
// so these assert on the source the same way capacitorConfig.test.js does.
const css = readFileSync(join(process.cwd(), 'src', 'main.css'), 'utf8')
const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8')

describe('bottom safe-area — Android system nav bar clearance', () => {
  it('opts the viewport into the display cutout so the insets are non-zero', () => {
    // Without viewport-fit=cover every env(safe-area-inset-*) resolves to 0px.
    expect(html).toMatch(/<meta[^>]+name="viewport"[^>]+viewport-fit=cover/)
  })

  it('reserves the inset on the immersive main region', () => {
    const rule = css.match(/\.chrome-immersive\s+\.app-shell-main\s*\{([^}]*)\}/)
    expect(rule).not.toBeNull()
    expect(rule[1]).toContain('env(safe-area-inset-bottom)')
  })

  it('keeps the inset in the non-immersive BottomNav reservation', () => {
    const rule = css.match(/\.app-shell-main\s*\{([^}]*)\}/)
    expect(rule).not.toBeNull()
    expect(rule[1]).toContain('env(safe-area-inset-bottom)')
  })
})
