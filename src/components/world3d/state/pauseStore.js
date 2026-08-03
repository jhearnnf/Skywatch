// Tiny pub-sub for the hangar pause menu. Mirrors modalStore: the Escape /
// pointer-lock listeners live outside React and the frame loop reads the flag
// every tick, so it can't sit in component state.

let paused = false
const listeners = new Set()

export const pause = {
  get() { return paused },
  set(next) { if (paused !== next) { paused = next; notify() } },
  toggle() { pause.set(!paused) },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
}

function notify() { for (const fn of listeners) fn() }
