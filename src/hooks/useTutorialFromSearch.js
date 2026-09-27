import { useEffect, useRef } from 'react'

// `?tutorial=1` opens a game's tutorial on arrival.
//
// Built for the Mock Assessment: during a mock the game's own Tutorial button is hidden (the
// test is meant to be sat, not browsed), and the between-tests screen offers "Tutorial first"
// instead, which lands here. When the tutorial finishes the page is back on its instructions card
// with Start, exactly as if the button had been pressed by hand.
//
// Read from window.location rather than useSearchParams, for the same reason as
// utils/cbat/difficultyParam.js: the param only matters on arrival, and every game page can then
// use this without router context (their tests mount them without one).
//
// Applied once per mount, like useModeFromSearch, so leaving the tutorial never reopens it.
export function tutorialRequested(search) {
  try {
    return new URLSearchParams(search ?? window.location.search).get('tutorial') === '1'
  } catch {
    return false
  }
}

export function useTutorialFromSearch(open) {
  const appliedRef = useRef(false)

  useEffect(() => {
    if (appliedRef.current || !open || !tutorialRequested()) return
    appliedRef.current = true
    open()
  }, [open])
}

export default useTutorialFromSearch
