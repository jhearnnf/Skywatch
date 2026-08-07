import { useEffect, useRef } from 'react'
import { useAuth } from '../../context/AuthContext'
import { parseRoundParam } from './adminRoundParam'

// Jump a CBAT game to the round named by ?round=N. See adminRoundParam.js for
// why this exists rather than more typed cheat codes.
//
//   useAdminRoundParam({
//     totalRounds: TOTAL_ROUNDS,
//     ready: phase === 'playing',
//     onJump: (round) => { setDebugUsed(true); startRound(round) },
//   })
//
// `ready` is the game's own answer to "is it safe to move the round cursor
// now" — usually the playing phase, because jumping while an intro animation
// owns the screen lands in a state the game will overwrite a moment later.
//
// `onJump` must flag the run as debug as well as move the cursor. That is left
// to the caller rather than done here: each game already has its own flag with
// its own name and its own effect on submission, and a hook that tried to
// impose one would be guessing.
//
// Applies once per mount. Quitting to the menu and starting again therefore
// plays from round 1 — deliberate, because the alternative is a game that
// silently refuses to start at the beginning until you notice the URL. Capture
// recipes navigate fresh each time, so they always get the jump.
//
// The URL is read from `window.location` inside the effect rather than through
// useLocation/useSearchParams, for two reasons. It is read exactly once and
// needs no reactivity, so a router subscription would buy nothing; and every
// CBAT page test stubs react-router-dom with a hand-written object, so a new
// router hook in a shared game hook would break three dozen unrelated suites
// that have no opinion about rounds. Reading in the effect also keeps render
// pure, which the React Compiler lint enforces.
export function useAdminRoundParam({ totalRounds, ready, onJump }) {
  const { user } = useAuth()
  const isAdmin = !!user?.isAdmin

  // Held in a ref so a caller passing an inline arrow — which every caller
  // does — cannot retrigger the jump on every render.
  const onJumpRef = useRef(onJump)
  useEffect(() => { onJumpRef.current = onJump })

  const appliedRef = useRef(false)

  useEffect(() => {
    if (!ready || !isAdmin || appliedRef.current) return

    const search = typeof window === 'undefined' ? '' : window.location.search
    const round = parseRoundParam(search, totalRounds)
    if (round === null) return

    appliedRef.current = true
    onJumpRef.current?.(round)
  }, [ready, isAdmin, totalRounds])
}
