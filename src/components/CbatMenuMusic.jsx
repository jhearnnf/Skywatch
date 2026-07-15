import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useGameChrome } from '../context/GameChromeContext'
import { updateCbatMusic } from '../utils/cbat/menuMusic'

// Drives the CBAT menu soundtrack from a single place. Maps the current route
// (+ immersive state, which every CBAT game toggles when actively playing) to a
// music zone:
//
//   /cbat                       → 'menu'          (100% volume)
//   /cbat/<game> (instructions) → 'instructions'  ( 25% volume)
//   /cbat/<game> (in game)      →  null           (faded out, in-game sounds only)
//   /cbat/<x>/leaderboard       → 'menu'          (a browsing screen, not a game)
//   anything else               →  null           (stopped)
//
// The controller keeps a single audio sequence alive across CBAT navigation and
// only cross-fades the volume, so moving menu → instructions doesn't restart the
// track. Entering a game (or leaving CBAT) stops it; returning restarts the
// start+repeat sequence.
export default function CbatMenuMusic() {
  const { pathname } = useLocation()
  const { immersive } = useGameChrome()

  useEffect(() => {
    let zone = null
    if (pathname === '/cbat') {
      zone = 'menu'
    } else if (pathname.startsWith('/cbat/')) {
      if (pathname.endsWith('/leaderboard')) zone = 'menu'
      else zone = immersive ? null : 'instructions'
    }
    updateCbatMusic(zone)
  }, [pathname, immersive])

  // Belt-and-braces: stop the soundtrack if this ever unmounts.
  useEffect(() => () => updateCbatMusic(null), [])

  return null
}
