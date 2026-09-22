import { describe, it, expect, vi } from 'vitest'
import { collectReportEnvironment } from '../reportEnvironment'

// A fake window with just enough surface to be read. Everything the collector
// touches is optional in real browsers too (Firefox has no userAgentData,
// Safari no connection, a jsdom canvas no WebGL), so each test starts from the
// bare minimum and adds only what it is about.
function fakeWindow(overrides = {}) {
  const canvas = { getContext: () => null }
  const documentElement = { getAttribute: () => null }
  return {
    innerWidth: 1440,
    innerHeight: 760,
    devicePixelRatio: 1.25,
    screen: { width: 1920, height: 1080, orientation: { type: 'landscape-primary' } },
    navigator: {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0',
      maxTouchPoints: 0,
      language: 'en-GB',
      onLine: true,
      hardwareConcurrency: 8,
      deviceMemory: 8,
    },
    document: { createElement: () => canvas, documentElement, fullscreenElement: null },
    matchMedia: () => ({ matches: false }),
    ...overrides,
  }
}

describe('collectReportEnvironment', () => {
  it('reads the screen, viewport and navigator basics', async () => {
    const env = await collectReportEnvironment({ win: fakeWindow() })
    expect(env).toMatchObject({
      userAgent: expect.stringContaining('Windows NT 10.0'),
      screenWidth: 1920, screenHeight: 1080,
      viewportWidth: 1440, viewportHeight: 760,
      dpr: 1.25,
      orientation: 'landscape-primary',
      touchPoints: 0,
      language: 'en-GB',
      online: true,
      cores: 8,
      memory: 8,
      displayMode: 'browser',
      theme: 'skywatch',
      webglRenderer: 'unavailable',
    })
  })

  // Chromium's frozen UA string cannot tell Windows 10 from 11 or name an
  // Android device; only the high-entropy hints can.
  it('asks Client Hints for the platform version, model and brands', async () => {
    const getHighEntropyValues = vi.fn().mockResolvedValue({
      platform: 'Windows', platformVersion: '15.0.0', model: '', architecture: 'x86', bitness: '64',
      fullVersionList: [
        { brand: 'Not)A;Brand', version: '99.0.0.0' },
        { brand: 'Google Chrome', version: '128.0.6613.84' },
      ],
    })
    const win = fakeWindow()
    win.navigator.userAgentData = { mobile: false, platform: 'Windows', brands: [], getHighEntropyValues }

    const env = await collectReportEnvironment({ win })
    expect(getHighEntropyValues).toHaveBeenCalledWith(expect.arrayContaining(['platformVersion', 'model', 'fullVersionList']))
    expect(env).toMatchObject({
      uaMobile: false, uaPlatform: 'Windows', uaPlatformVersion: '15.0.0', uaArchitecture: 'x86', uaBitness: '64',
      uaBrands: [{ brand: 'Not)A;Brand', version: '99.0.0.0' }, { brand: 'Google Chrome', version: '128.0.6613.84' }],
    })
    expect(env.uaModel).toBeUndefined()
  })

  it('keeps the low-entropy brands when the high-entropy call is refused', async () => {
    const win = fakeWindow()
    win.navigator.userAgentData = {
      mobile: true, platform: 'Android',
      brands: [{ brand: 'Chromium', version: '127' }],
      getHighEntropyValues: () => Promise.reject(new Error('NotAllowedError')),
    }
    const env = await collectReportEnvironment({ win })
    expect(env.uaPlatform).toBe('Android')
    expect(env.uaBrands).toEqual([{ brand: 'Chromium', version: '127' }])
  })

  // The submit must never wait on the bridge.
  it('gives up on Client Hints after the timeout and still returns the rest', async () => {
    const win = fakeWindow()
    win.navigator.userAgentData = { platform: 'Windows', getHighEntropyValues: () => new Promise(() => {}) }
    const env = await collectReportEnvironment({ win, timeoutMs: 10 })
    expect(env.screenWidth).toBe(1920)
    expect(env.uaPlatformVersion).toBeUndefined()
  })

  it('names the GPU through the debug renderer extension and releases the context', async () => {
    const loseContext = vi.fn()
    const gl = {
      RENDERER: 'RENDERER', VENDOR: 'VENDOR',
      getExtension: (name) => name === 'WEBGL_debug_renderer_info'
        ? { UNMASKED_VENDOR_WEBGL: 'uv', UNMASKED_RENDERER_WEBGL: 'ur' }
        : name === 'WEBGL_lose_context' ? { loseContext } : null,
      getParameter: (p) => ({ uv: 'Google Inc. (NVIDIA)', ur: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' })[p],
    }
    const win = fakeWindow({ document: { createElement: () => ({ getContext: () => gl }), documentElement: { getAttribute: () => 'cbat' } } })
    const env = await collectReportEnvironment({ win })
    expect(env.webglVendor).toBe('Google Inc. (NVIDIA)')
    expect(env.webglRenderer).toMatch(/RTX 3060/)
    expect(env.theme).toBe('cbat')
    expect(loseContext).toHaveBeenCalled()
  })

  it('lists connected controllers and the installed display mode', async () => {
    const win = fakeWindow({ matchMedia: (q) => ({ matches: q.includes('standalone') }) })
    win.navigator.getGamepads = () => [null, { id: 'T.16000M (Vendor: 044f Product: b10a)' }]
    const env = await collectReportEnvironment({ win })
    expect(env.gamepads).toEqual(['T.16000M (Vendor: 044f Product: b10a)'])
    expect(env.displayMode).toBe('standalone')
  })

  it('never throws when a browser API misbehaves', async () => {
    const win = fakeWindow()
    Object.defineProperty(win.navigator, 'getGamepads', { get() { throw new Error('SecurityError') } })
    win.document.createElement = () => { throw new Error('no canvas') }
    win.matchMedia = () => { throw new Error('no matchMedia') }
    const env = await collectReportEnvironment({ win })
    expect(env.screenWidth).toBe(1920)
  })

  it('returns null outside a browser', async () => {
    expect(await collectReportEnvironment({ win: null })).toBeNull()
  })
})
