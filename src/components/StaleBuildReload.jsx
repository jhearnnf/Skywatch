import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { CBAT_LEADERBOARD_CONFIG } from '../data/cbatGames'
import { getActiveMock } from '../lib/cbatMockSession'
import { isUpdateReady, reloadTargetFor } from '../utils/staleBuild'

// Every CBAT game's own page. A new build waiting to load never reloads into one of these.
const GAME_PATHS = new Set(
  Object.values(CBAT_LEADERBOARD_CONFIG).map(c => c.backPath).filter(p => p && p !== '/cbat'),
)

// Loads a new build that is waiting (utils/staleBuild.js) the moment the player moves to a page
// where a reload costs nothing. Renders nothing.
export default function StaleBuildReload() {
  const location = useLocation()
  const first = useRef(true)

  useEffect(() => {
    // The page the tab opened on is already the newest build it could get.
    if (first.current) { first.current = false; return }
    if (!isUpdateReady()) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    const target = reloadTargetFor({
      pathname: location.pathname,
      search: location.search,
      hash: location.hash,
      state: location.state,
      mockActive: !!getActiveMock(),
      gamePaths: GAME_PATHS,
    })
    // A full load, not a router push: the point is to fetch the new build. replace() keeps the
    // entry the router just pushed from appearing twice in history.
    if (target) window.location.replace(target)
  }, [location.key]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}
