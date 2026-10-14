// Placement rules for the desktop CBAT chat dock (components/cbat/
// CbatLoungeDock.jsx). Kept apart from the component so they can be tested
// without a layout.

// Which kind of CBAT page a path is, for the dock. null = not one it serves.
export function cbatRouteKind(pathname) {
  if (pathname === '/cbat' || pathname === '/cbat/') return 'hub'
  const m = pathname.match(/^\/cbat\/([^/]+)(\/leaderboard)?\/?$/)
  if (!m) return null
  if (m[2]) return 'board'
  // Not games: the report and the mock assessment have layouts of their own.
  if (m[1] === 'report' || m[1] === 'mock') return null
  return 'game'
}

// Where the panel should be. Pure, so the rules are testable without layout.
export function dockMode({ kind, hubSlot, immersive, gameOver, stick, wide, wider }) {
  // While the hub's placeholder exists the panel belongs to it, even once the
  // route has moved on: the hub is still fading out, and the panel leaves with
  // its column rather than ahead of it.
  if (hubSlot) return 'hub'
  // Arriving at the hub, before its column has mounted: hold still.
  if (kind === 'hub') return 'hold'
  const roomy = stick ? wider : wide
  if (kind === 'board' && roomy) return 'full'
  if (kind === 'game' && !immersive && !gameOver && roomy) return 'full'
  return 'hidden'
}
