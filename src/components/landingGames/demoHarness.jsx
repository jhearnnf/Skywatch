import { useMemo } from 'react'
import { AuthContext } from '../../context/AuthContext'
import { GameChromeProvider } from '../../context/GameChromeContext'
import { CbatDemoContext, DEMO_CANVAS_DPR } from '../../utils/cbat/demoMode'
import { createDemoApiFetch, DEMO_USER } from './demoStubs'

// Provider stack wrapped around every game mounted by the landing page's live
// game wall. Its job is containment: a showcase run must look exactly like the
// real game while touching nothing outside its own card.
//
// Three rails, in order of importance:
//
//  1. A stub AuthContext (see demoStubs.js) whose apiFetch never reaches the
//     network and always resolves successfully — so a demo score can neither be
//     submitted nor queued into the offline outbox.
//  2. A nested GameChromeProvider. Games call enterImmersive() when play
//     begins; nesting gives the demo its own isolated copy of that state, so a
//     card can't hide the site nav or duck the menu music.
//  3. CbatDemoContext, which marks the subtree as a demo. Read by
//     useCbatTracking (drops the analytics events a showcase run would fire on
//     every landing page view), by CbatQuitButton (skips its window.history
//     back-guard, which nine cycling cards would otherwise fight over), and by
//     Overlay (portals modals into the card's stage rather than document.body,
//     so nothing a demo opens can cover the landing page).
//
// AppSettings is deliberately NOT stubbed — a demo should respect the same
// admin gating as the real game.
export default function DemoHarness({ children, portalTarget = null }) {
  // `dpr` is read by every game canvas (useCbatDemoDpr) so a showcase tile
  // never renders at full retina resolution.
  const demo = useMemo(() => ({ portalTarget, dpr: DEMO_CANVAS_DPR }), [portalTarget])

  const auth = useMemo(() => ({
    user: DEMO_USER,
    setUser: () => {},
    logout: () => {},
    loading: false,
    apiFetch: createDemoApiFetch(),
    API: '',
  }), [])

  return (
    <CbatDemoContext.Provider value={demo}>
      <AuthContext.Provider value={auth}>
        <GameChromeProvider>
          {children}
        </GameChromeProvider>
      </AuthContext.Provider>
    </CbatDemoContext.Provider>
  )
}
