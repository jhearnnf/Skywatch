// The last few pages someone visited, for the problem report form.
//
// Why a module-level ring buffer rather than router state: the trail has to
// survive the navigation *to* /report and still be readable at submit time,
// which is a route change and an unmount after the pages it describes. A ref in
// a component that unmounts on navigation cannot answer that, and carrying it in
// location.state would need every link into /report to remember to pass it —
// there are three today and the next one would silently arrive without it.
//
// Pathnames only, never the search or hash. That is the same rule the heartbeat
// follows (src/hooks/useHeartbeat.js) and for the same reason: a query string
// can carry ids and search terms, and neither is part of "what page were they
// on". The server turns these into labels and stores those, so nothing recorded
// here is kept verbatim — see backend/constants/presenceLocations.js.

// Five is enough to show the shape of what they were doing ("played SMA, went
// back to the hub, opened the form") without turning a bug report into a
// browsing history.
export const TRAIL_LENGTH = 5

let trail = []

// Records a visit. Consecutive duplicates are dropped: a re-render, or a change
// to the query string alone, is not a new page, and letting those in would fill
// the trail with one repeated entry and push out the pages that matter.
export function recordPath(path) {
  if (typeof path !== 'string') return
  const clean = path.split('?')[0].split('#')[0].trim()
  if (!clean.startsWith('/')) return
  if (trail[trail.length - 1] === clean) return
  trail = [...trail, clean].slice(-TRAIL_LENGTH)
}

// Oldest first, most recent last. A copy, so a caller filtering the trail
// cannot alter what the next reader sees.
export function getRouteTrail() {
  return [...trail]
}

// Test seam only.
export function __resetRouteTrail() {
  trail = []
}
