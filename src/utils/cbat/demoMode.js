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
