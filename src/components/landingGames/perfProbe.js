// Measurement helpers for the live game wall's perf sweep (see LiveGameGridPerf).
//
// Deliberately dependency-free and side-effect-free so the numbers can be
// trusted: the probe must not itself be a source of jank. Everything here is a
// plain function over data the browser already has.

// Rolling frame-time sampler. Feed it rAF timestamps; it keeps the deltas for
// one stage of the sweep and reports the shape of the distribution — the
// median says how it normally feels, the 95th says how bad the hitches are.
export function createFpsSampler() {
  let last = null
  let deltas = []
  return {
    frame(ts) {
      if (last != null) deltas.push(ts - last)
      last = ts
    },
    reset() { last = null; deltas = [] },
    get samples() { return deltas.length },
    stats() {
      if (deltas.length === 0) return null
      const sorted = [...deltas].sort((a, b) => a - b)
      const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
      const median = at(0.5)
      return {
        frames: sorted.length,
        fps: median > 0 ? 1000 / median : 0,
        medianMs: median,
        p95Ms: at(0.95),
        worstMs: sorted[sorted.length - 1],
        // A frame is "dropped" if it took longer than two 60Hz frames.
        droppedPct: (sorted.filter((d) => d > 33.4).length / sorted.length) * 100,
      }
    },
  }
}

/**
 * What every WebGL canvas on the page is actually rendering, versus what it
 * shows. `canvas.width/height` is the drawing buffer — the pixels the GPU
 * fills — while the bounding rect is the size it occupies on screen after the
 * demo card's scale transform. The ratio between them is wasted work.
 */
export function scanCanvases(root = document) {
  const out = []
  for (const el of root.querySelectorAll('canvas')) {
    const rect = el.getBoundingClientRect()
    const bufferPx = el.width * el.height
    const screenPx = Math.max(1, Math.round(rect.width) * Math.round(rect.height))
    out.push({
      buffer: { w: el.width, h: el.height },
      screen: { w: Math.round(rect.width), h: Math.round(rect.height) },
      bufferPx,
      screenPx,
      // >1 means the canvas renders more pixels than the page displays.
      overdraw: bufferPx / screenPx,
    })
  }
  return out
}

export function summariseCanvases(list) {
  const bufferPx = list.reduce((s, c) => s + c.bufferPx, 0)
  const screenPx = list.reduce((s, c) => s + c.screenPx, 0)
  return {
    contexts: list.length,
    bufferMPx: bufferPx / 1e6,
    screenMPx: screenPx / 1e6,
    overdraw: screenPx > 0 ? bufferPx / screenPx : 0,
  }
}

// Long tasks are the ones the user feels: anything blocking the main thread for
// 50ms+. Returns a no-op collector where the API is unavailable (Safari).
export function observeLongTasks() {
  let count = 0
  let totalMs = 0
  let observer = null
  if (typeof PerformanceObserver !== 'undefined') {
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) { count += 1; totalMs += entry.duration }
      })
      observer.observe({ entryTypes: ['longtask'] })
    } catch { observer = null }
  }
  return {
    supported: !!observer,
    reset() { count = 0; totalMs = 0 },
    read() { return { count, totalMs } },
    stop() { observer?.disconnect() },
  }
}

// One row per stage, formatted for pasting back into a chat.
export function formatReport(rows, env = {}) {
  const head = [
    `device pixel ratio ${env.dpr ?? '?'}`,
    `viewport ${env.vw ?? '?'}x${env.vh ?? '?'}`,
    env.longTasksSupported ? 'longtask: yes' : 'longtask: unsupported',
  ].join(' · ')
  const cols = ['live', 'fps', 'p95ms', 'worst', 'drop%', 'ctx', 'bufMPx', 'scrMPx', 'over', 'LT/s']
  const lines = rows.map((r) => [
    String(r.live).padStart(4),
    r.fps.toFixed(0).padStart(3),
    r.p95Ms.toFixed(1).padStart(5),
    r.worstMs.toFixed(0).padStart(5),
    r.droppedPct.toFixed(0).padStart(5),
    String(r.contexts).padStart(3),
    r.bufferMPx.toFixed(1).padStart(6),
    r.screenMPx.toFixed(2).padStart(6),
    r.overdraw.toFixed(1).padStart(4),
    r.longTasksPerS.toFixed(1).padStart(4),
  ].join(' '))
  return [head, cols.map((c, i) => c.padStart([4, 3, 5, 5, 5, 3, 6, 6, 4, 4][i])).join(' '), ...lines].join('\n')
}
