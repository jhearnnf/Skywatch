import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useGameChrome } from '../context/GameChromeContext'
import { useSlimMode } from '../hooks/useSlimMode'
import { updateCbatMusic } from '../utils/cbat/menuMusic'

// Drives the CBAT menu soundtrack from a single place. Maps the current route
// (+ immersive state, which every CBAT game toggles when actively playing) to a
// music zone:
//
//   /cbat                       → 'menu'          (100% volume)
//   /cbat/<game> (instructions) → 'instructions'  ( 25% volume)
//   /cbat/<game> (in game)      →  null           (faded out, in-game sounds only)
//   /cbat/<game> (game over)    → 'menu'          (results screen — a browse/celebrate screen)
//   /cbat/<x>/leaderboard       → 'menu'          (a browsing screen, not a game)
//   /profile[/...]              → 'menu'          (stats/leaderboard browsing)
//   / (slim landing only)       → 'menu'          (CBAT-only mode home page)
//   anything else               →  null           (stopped)
//
// The controller keeps a single audio sequence alive across CBAT navigation and
// only cross-fades the volume, so moving menu → instructions doesn't restart the
// track. Entering a game (or leaving CBAT) stops it; returning restarts the
// start+repeat sequence.
export default function CbatMenuMusic() {
  const { pathname } = useLocation()
  const { immersive, gameOver } = useGameChrome()
  const slim = useSlimMode()

  useEffect(() => {
    let zone = null
    if (pathname === '/cbat') {
      zone = 'menu'
    } else if (pathname.startsWith('/cbat/')) {
      if (pathname.endsWith('/leaderboard')) zone = 'menu'
      else if (immersive) zone = null
      // The game-over "Your Score" screen is a browse/celebrate screen, so it
      // gets full menu volume — not the quiet pre-play "instructions" level.
      else zone = gameOver ? 'menu' : 'instructions'
    } else if (pathname === '/profile' || pathname.startsWith('/profile/')) {
      // Profile (stats + leaderboard) is a browsing screen off the CBAT menu —
      // keep the soundtrack running so the trip there doesn't cut the music.
      zone = 'menu'
    } else if (slim && pathname === '/') {
      // Slim (CBAT-only) landing doubles as the home page — play the soundtrack.
      zone = 'menu'
    }
    updateCbatMusic(zone)
  }, [pathname, immersive, gameOver, slim])

  // Belt-and-braces: stop the soundtrack if this ever unmounts.
  useEffect(() => () => updateCbatMusic(null), [])

  return null
}
