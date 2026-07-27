import { createContext, useContext } from 'react'

// Marks a subtree as a *demo* mount of a real CBAT game — the landing page's
// live game wall (src/components/landingGames/) mounts the actual game pages,
// auto-started and driven by scripted clicks, purely as a showcase.
//
// Nothing a demo does may reach the outside world: no scores, no analytics,
// no audio. Most of that is handled by the harness swapping in a stub
// AuthContext (see demoHarness.jsx) — the guards here cover the two paths a
// stubbed apiFetch can't reach:
//
//   1. useCbatTracking fires PostHog events directly (React hook → context).
//   2. actAudio / satSpeech are plain modules with no React context available,
//      so they read the module-level counter below instead.

// Value is `false` outside a demo, or `{ portalTarget }` inside one.
export const CbatDemoContext = createContext(false)

// Truthy when the calling component is inside a demo mount.
export const useCbatDemo = () => useContext(CbatDemoContext)

// Where a demo-mounted game should portal its overlays.
//
// Games render modals and full-screen animations through createPortal to
// document.body. That is right in the real game and catastrophic in a demo
// card: the overlay escapes the scaled stage and paints over the whole landing
// page. Portalling into the card's own stage keeps it where it belongs — and
// still looks correct, because the stage is a transformed ancestor, which makes
// it the containing block for `position: fixed` children.
export function useCbatDemoPortalTarget() {
  const demo = useContext(CbatDemoContext)
  return demo?.portalTarget ?? null
}

// Device pixel ratio for a canvas mounted inside a demo card.
//
// R3F sizes its drawing buffer from the canvas's CSS size times the device
// pixel ratio, which is right for a game filling the screen and wasteful for
// one scaled down into a 320px tile — the wall's canvases were measured
// rendering 3x the pixels they display, and that multiplies by dpr² on a phone
// (a 3x screen renders 9x the pixels for a tile nobody is inspecting closely).
// Capping at 1 costs nothing visible at tile size.
export const DEMO_CANVAS_DPR = 1

// Pass straight to <Canvas dpr={…}>: a number inside a demo, undefined outside,
// which leaves R3F's own default alone for real players.
export function useCbatDemoDpr() {
  const demo = useContext(CbatDemoContext)
  return demo ? (demo.dpr ?? DEMO_CANVAS_DPR) : undefined
}

// Everything a <Canvas> needs to behave inside a demo card, as one spread:
//
//   <Canvas {...useCbatDemoCanvas()} … />
//
// Outside a demo it is empty, so real players get stock R3F.
//
// `resize.offsetSize` is the one that matters. R3F measures the canvas with
// react-use-measure, which reports getBoundingClientRect — and the demo stage
// is CSS-scaled, so the rect comes back at a fraction of the element's real
// layout box. R3F then sized the canvas to that fraction inside a
// full-size container, which drew the game into the top-left corner of the
// tile while DOM overlays (the ACT callsign screen, say) still filled it.
// offsetSize measures offsetWidth/offsetHeight instead, which transforms don't
// touch.
export function useCbatDemoCanvas() {
  const demo = useContext(CbatDemoContext)
  if (!demo) return EMPTY_CANVAS_PROPS
  return demo.canvasProps ?? DEMO_CANVAS_PROPS
}

const EMPTY_CANVAS_PROPS = {}
const DEMO_CANVAS_PROPS = {
  dpr: DEMO_CANVAS_DPR,
  resize: { offsetSize: true },
}

// The stage is scaled (and, when the card zooms in on a game, translated), so
// the two coordinate spaces a game works in stop agreeing: getScreenCTM /
// getBoundingClientRect answer in screen pixels, while an overlay portalled
// into the stage is laid out in the stage's own unscaled pixels. Anything that
// measures one and paints in the other has to go through here or it lands in
// the wrong place at the wrong size.
//
// Returns null outside a demo (and when the element hasn't been laid out yet),
// which callers read as "screen space is the only space".
export function getDemoStageFrame(el) {
  if (!el?.getBoundingClientRect) return null
  const rect = el.getBoundingClientRect()
  const width = el.offsetWidth || 0
  if (!width || !rect.width) return null
  // Local (0,0) sits at the transformed box's top-left corner whatever the
  // translate is, so the rect gives both the origin and the scale.
  return { left: rect.left, top: rect.top, scale: rect.width / width }
}

// ── Module-level flag, for non-React callers ────────────────────────────────
//
// Ref-counted because several demo cards mount and unmount independently. The
// landing page never hosts a real playable game (game routes are behind
// RequireAuth and live elsewhere), so a global "some demo is running" flag can
// never silence audio for a real player.
let demoCount = 0

export function beginDemo() {
  demoCount += 1
  return () => endDemo()
}

export function endDemo() {
  demoCount = Math.max(0, demoCount - 1)
}

export function isDemoActive() {
  return demoCount > 0
}

// Test helper — resets the counter between suites.
export function __resetDemoCount() {
  demoCount = 0
}
