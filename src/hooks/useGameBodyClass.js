import { useEffect } from 'react'
import { useCbatDemo } from '../utils/cbat/demoMode'

// Puts a class on <body> while a game wants it — unless the game is a demo
// mount, in which case it does nothing at all.
//
// Games restyle the page around them: DPT and CUT widen the app shell, SAT
// washes it in beta colours, and Visualisation 2D pins the body against
// scrolling on phones. That is correct for a game that owns the screen and
// wrong for one playing inside a 200px tile on the landing page — a demo card
// doing it locked scrolling for every visitor under 600px wide, because
// `body.cbat-vis2d-locked` sets `overflow: hidden` and `touch-action: pan-x`.
//
// The demo harness contains context (auth, chrome, portals) but nothing can
// contain `document.body`, so the guard has to live at the point of use.
export function useGameBodyClass(className, active = true) {
  const isDemo = !!useCbatDemo()
  useEffect(() => {
    if (!active || isDemo) return
    document.body.classList.add(className)
    return () => document.body.classList.remove(className)
  }, [className, active, isDemo])
}

export default useGameBodyClass
