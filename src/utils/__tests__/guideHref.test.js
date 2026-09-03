import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isCbatGuideUrl } from '../guideHref'

// The whole point of the module is that it answers differently inside the store
// binary, so each case re-imports it with Capacitor mocked to that platform.
async function hrefFor(native) {
  vi.resetModules()
  vi.doMock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => native },
  }))
  return (await import('../guideHref')).CBAT_GUIDE_HREF
}

describe('CBAT_GUIDE_HREF', () => {
  beforeEach(() => { vi.resetModules(); vi.doUnmock('@capacitor/core') })

  it('uses the canonical clean URL on the web', async () => {
    // This is the URL in sitemap.xml, the guide's own <link rel="canonical">,
    // and the one Google has crawled. It must not pick up a .html suffix.
    expect(await hrefFor(false)).toBe('/cbat-guide')
  })

  it('asks for the real filename in the native app', async () => {
    // Capacitor serves the bundle off https://localhost with no rewrite rules,
    // so the extensionless path falls through to index.html and the SPA — which
    // has no route for it — instead of opening the document.
    expect(await hrefFor(true)).toBe('/cbat-guide.html')
  })
})

describe('prepareGuideChrome', () => {
  beforeEach(() => { vi.resetModules(); vi.doUnmock('@capacitor/core') })

  async function callWith(native) {
    vi.resetModules()
    const setStyle = vi.fn().mockResolvedValue(undefined)
    vi.doMock('@capacitor/core', () => ({
      Capacitor: { isNativePlatform: () => native },
    }))
    vi.doMock('@capacitor/status-bar', () => ({
      StatusBar: { setStyle }, Style: { Light: 'LIGHT', Dark: 'DARK' },
    }))
    const { prepareGuideChrome } = await import('../guideHref')
    await prepareGuideChrome()
    return setStyle
  }

  it('switches the status bar to dark text for the cream document', async () => {
    // Style.Light means "dark text for a light background". Without it the
    // clock and signal icons stay white and vanish into the guide's paper.
    const setStyle = await callWith(true)
    expect(setStyle).toHaveBeenCalledWith({ style: 'LIGHT' })
  })

  it('does nothing on the web, where there is no status bar to own', async () => {
    const setStyle = await callWith(false)
    expect(setStyle).not.toHaveBeenCalled()
  })
})

describe('isCbatGuideUrl', () => {
  it('matches both spellings of the guide and nothing else', () => {
    // The chat rail lists guides from the database, so this decides which of
    // them get the status-bar handover. Only our own cream document does.
    expect(isCbatGuideUrl('/cbat-guide')).toBe(true)
    expect(isCbatGuideUrl('/cbat-guide.html')).toBe(true)
    for (const url of ['/cbat', '/rankings', 'https://cbatguide.com/', '/cbat-guide.pdf', '', undefined]) {
      expect(isCbatGuideUrl(url)).toBe(false)
    }
  })
})
