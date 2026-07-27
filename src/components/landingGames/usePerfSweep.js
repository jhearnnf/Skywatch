import { useEffect, useRef, useState } from 'react'
import { createFpsSampler, observeLongTasks, scanCanvases, summariseCanvases } from './perfProbe'

// Drives the live game wall's perf sweep: steps the number of live cards down
// through PERF_STAGES, measuring each step once it has settled. Lives apart
// from the HUD component so each file exports one kind of thing.
//
// Temporary — delete alongside LiveGameGridPerf.jsx and perfProbe.js.

const PERF_STAGES = [9, 6, 4, 2, 1, 0]
const STAGE_MS  = 6000
const SETTLE_MS = 1800   // discard the mount storm at the top of each stage

function usePerfSweep(enabled) {
  const [live, setLive] = useState(PERF_STAGES[0])
  const [rows, setRows] = useState([])
  const [done, setDone] = useState(false)
  const stageRef = useRef(0)

  useEffect(() => {
    if (!enabled) return
    const sampler = createFpsSampler()
    const longTasks = observeLongTasks()
    let raf = null
    let settleAt = performance.now() + SETTLE_MS
    let stageEndsAt = performance.now() + STAGE_MS
    let sampling = false

    const tick = (ts) => {
      const now = performance.now()
      if (!sampling && now >= settleAt) {
        sampling = true
        sampler.reset()
        longTasks.reset()
      }
      if (sampling) sampler.frame(ts)

      if (now >= stageEndsAt) {
        const stats = sampler.stats()
        const lt = longTasks.read()
        const canvases = summariseCanvases(scanCanvases())
        if (stats) {
          setRows((prev) => [...prev, {
            live: PERF_STAGES[stageRef.current],
            ...stats,
            ...canvases,
            longTasksPerS: lt.count / ((STAGE_MS - SETTLE_MS) / 1000),
            longTaskMs: lt.totalMs,
          }])
        }
        stageRef.current += 1
        if (stageRef.current >= PERF_STAGES.length) {
          setDone(true)
          longTasks.stop()
          return
        }
        setLive(PERF_STAGES[stageRef.current])
        sampling = false
        settleAt = now + SETTLE_MS
        stageEndsAt = now + STAGE_MS
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { if (raf) cancelAnimationFrame(raf); longTasks.stop() }
  }, [enabled])

  return { live, rows, done, longTasksSupported: typeof PerformanceObserver !== 'undefined' }
}

export { usePerfSweep, PERF_STAGES }
