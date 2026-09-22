import { currentUiTheme } from '../lib/uiTheme'

// What the reporter's device looks like, attached to a problem report.
//
// A report that reads "the needles are off the screen" is not actionable on its
// own: whether it reproduces depends on the OS, the browser, the screen size and
// the GPU, and none of those are in the description because the person filing
// it has no reason to know they matter. This gathers everything the browser
// will tell us and sends it with the report so the admin card can answer those
// questions before anyone has to ask.
//
// Every field is best effort. A missing one is left out rather than guessed,
// nothing here throws, and the whole thing is capped by a timeout so a slow
// bridge can never hold up the submit — a report with no environment is worth
// far more than one that never arrives.
//
// The OS version and device model are the two that need care. Chromium froze
// the User-Agent string years ago: Windows 11 reports itself as "Windows NT
// 10.0", macOS as 10.15.7 forever, and Android as "Android 10; K" with no model.
// The real values only come from the User-Agent Client Hints API
// (navigator.userAgentData.getHighEntropyValues), which is why that call is
// made even though only Chromium browsers — including the Android WebView the
// app runs in — answer it. Safari and Firefox fall back to the UA string, which
// the server also keeps from the request header.

const HIGH_ENTROPY_HINTS = ['platform', 'platformVersion', 'model', 'architecture', 'bitness', 'fullVersionList']

const DEFAULT_TIMEOUT_MS = 1500

function str(v, max = 200) {
  if (v === undefined || v === null) return undefined
  const s = String(v).trim()
  return s ? s.slice(0, max) : undefined
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

// Strips undefined values so the payload only carries what was actually read.
function compact(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined))
}

async function readUaData(nav) {
  const uad = nav?.userAgentData
  if (!uad) return {}
  const out = {
    uaMobile: typeof uad.mobile === 'boolean' ? uad.mobile : undefined,
    uaPlatform: str(uad.platform),
  }
  try {
    const hi = await uad.getHighEntropyValues(HIGH_ENTROPY_HINTS)
    out.uaPlatform        = str(hi.platform) ?? out.uaPlatform
    out.uaPlatformVersion = str(hi.platformVersion, 40)
    out.uaModel           = str(hi.model, 80)
    out.uaArchitecture    = str(hi.architecture, 20)
    out.uaBitness         = str(hi.bitness, 8)
    const list = Array.isArray(hi.fullVersionList) && hi.fullVersionList.length ? hi.fullVersionList : uad.brands
    if (Array.isArray(list)) {
      out.uaBrands = list
        .map(b => compact({ brand: str(b?.brand, 60), version: str(b?.version, 40) }))
        .filter(b => b.brand)
        .slice(0, 8)
    }
  } catch {
    // Low-entropy brands are still worth having when the high-entropy call is
    // refused (permissions policy, older Chromium).
    if (Array.isArray(uad.brands)) {
      out.uaBrands = uad.brands
        .map(b => compact({ brand: str(b?.brand, 60), version: str(b?.version, 40) }))
        .filter(b => b.brand)
        .slice(0, 8)
    }
  }
  return compact(out)
}

// The GPU, via the debug renderer extension. Instruments, Visualisation and
// the tracking tests are all WebGL, so "which GPU" is the first question on a
// rendering report. The context is released straight after: a page can only
// hold so many, and the games need theirs.
function readWebgl(doc) {
  if (!doc?.createElement) return {}
  try {
    const canvas = doc.createElement('canvas')
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
    if (!gl) return { webglRenderer: 'unavailable' }
    const out = {}
    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    if (dbg) {
      out.webglVendor   = str(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL), 120)
      out.webglRenderer = str(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL), 300)
    }
    out.webglRenderer ??= str(gl.getParameter(gl.RENDERER), 300)
    out.webglVendor   ??= str(gl.getParameter(gl.VENDOR), 120)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return compact(out)
  } catch {
    return {}
  }
}

function readGamepads(nav) {
  try {
    const pads = nav?.getGamepads?.()
    if (!pads) return undefined
    const ids = Array.from(pads).filter(Boolean).map(p => str(p.id, 120)).filter(Boolean)
    return ids.length ? ids.slice(0, 4) : undefined
  } catch {
    return undefined
  }
}

function readDisplayMode(win) {
  try {
    if (win?.navigator?.standalone === true) return 'standalone'
    for (const mode of ['standalone', 'fullscreen', 'minimal-ui']) {
      if (win?.matchMedia?.(`(display-mode: ${mode})`)?.matches) return mode
    }
    return 'browser'
  } catch {
    return undefined
  }
}

function readSync(win) {
  const nav    = win?.navigator
  const screen = win?.screen
  let timezone
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone } catch { /* not every runtime has it */ }

  return compact({
    userAgent:      str(nav?.userAgent, 400),
    screenWidth:    num(screen?.width),
    screenHeight:   num(screen?.height),
    viewportWidth:  num(win?.innerWidth),
    viewportHeight: num(win?.innerHeight),
    dpr:            num(win?.devicePixelRatio),
    orientation:    str(screen?.orientation?.type, 40),
    touchPoints:    num(nav?.maxTouchPoints),
    language:       str(nav?.language, 20),
    timezone:       str(timezone, 60),
    online:         typeof nav?.onLine === 'boolean' ? nav.onLine : undefined,
    connection:     str(nav?.connection?.effectiveType, 20),
    cores:          num(nav?.hardwareConcurrency),
    memory:         num(nav?.deviceMemory),
    displayMode:    readDisplayMode(win),
    fullscreen:     win?.document ? Boolean(win.document.fullscreenElement) : undefined,
    theme:          currentUiTheme(win?.document?.documentElement ?? null),
    gamepads:       readGamepads(nav),
    ...readWebgl(win?.document),
  })
}

// Resolves to a plain object of everything readable, or null outside a browser.
// The async part (Client Hints) races the timeout; whatever it has not answered
// by then is simply absent.
export async function collectReportEnvironment({ win = typeof window !== 'undefined' ? window : null, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!win) return null
  let base
  try { base = readSync(win) } catch { base = {} }

  let uaData
  try {
    uaData = await Promise.race([
      readUaData(win.navigator),
      new Promise(resolve => setTimeout(() => resolve({}), timeoutMs)),
    ])
  } catch {
    uaData = {}
  }

  const env = { ...base, ...uaData }
  return Object.keys(env).length ? env : null
}
