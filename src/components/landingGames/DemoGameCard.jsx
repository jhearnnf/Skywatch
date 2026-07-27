import { Component, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import DemoHarness from './demoHarness'
import { runDemoDriver } from './demoDriver'
import { beginDemo } from '../../utils/cbat/demoMode'

// One tile on the landing page's live game wall: a real CBAT game, mounted at a
// fixed "stage" size and scaled down to fit the card.
//
// Why a fixed stage rather than letting the game fill the card: the games lay
// themselves out against the viewport, not their container, so a 260px-wide box
// would render a layout no player ever sees. Rendering at a sane size and
// scaling the whole thing keeps every card looking like the real screen.

const STAGE = { w: 900, h: 600 }

// Anything that throws inside a mounted game is contained here and the card
// falls back to its poster — a landing page must never white-screen because a
// showcase tile misbehaved.
class DemoBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.onError?.() }
  render() { return this.state.failed ? null : this.props.children }
}

export default function DemoGameCard({
  entry,
  Component: Game,
  loggedIn = false,
  active = true,
  cycleMs = 26000,
  startDelayMs = 0,
  stage = STAGE,
}) {
  const { label, poster, path, props: gameProps, answerIntervalMs } = entry

  const cardRef  = useRef(null)
  const stageRef = useRef(null)
  // Also held in state, because the harness needs it as a render-time value:
  // it's where the mounted game portals its overlays.
  const [stageEl, setStageEl] = useState(null)
  const setStage = useCallback((el) => { stageRef.current = el; setStageEl(el) }, [])

  const [runKey, setRunKey] = useState(0)
  const [failed, setFailed] = useState(false)
  const [alive, setAlive]   = useState(false)   // game has actually started
  const [scale, setScale]   = useState(0.3)
  const [delayElapsed, setDelayElapsed] = useState(false)

  // Mount only while the wall is on screen, and on a stagger so nine games
  // don't spin up in the same frame. Scrolling away tears the game back down —
  // a live game off-screen is pure cost.
  const mounted = active && delayElapsed && !failed && !!Game

  useEffect(() => {
    if (!active) return
    const t = setTimeout(() => setDelayElapsed(true), startDelayMs)
    return () => clearTimeout(t)
  }, [active, startDelayMs])

  // Scale the stage to whatever width the card ended up with.
  useLayoutEffect(() => {
    const el = cardRef.current
    if (!el) return
    const measure = () => setScale(el.clientWidth / stage.w)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [stage.w])

  const handleFail = useCallback(() => { setFailed(true); setAlive(false) }, [])

  // One run: flag the demo globally (silences the ACT/SAT audio modules), drive
  // the game, then remount on a fresh key. Cards are deliberately recycled well
  // before any game could finish — a completed run is a score-submission path we
  // simply never want to walk.
  useEffect(() => {
    if (!mounted) return
    const endDemo = beginDemo()

    const cancelDriver = runDemoDriver(stageRef.current, {
      answerIntervalMs,
      onStart: () => setAlive(true),
      onFail:  handleFail,
    })
    const cycle = setTimeout(() => setRunKey((k) => k + 1), cycleMs)

    return () => {
      cancelDriver()
      clearTimeout(cycle)
      endDemo()
    }
  }, [mounted, runKey, cycleMs, answerIntervalMs, handleFail])

  const to = loggedIn ? path : '/login?tab=register'
  // The poster carries the card until the game is genuinely running, and for
  // good if it can't run here.
  const showPoster = !mounted || !alive

  return (
    <div
      ref={cardRef}
      className="group relative block overflow-hidden rounded-xl sm:rounded-2xl"
      style={{
        aspectRatio: `${stage.w} / ${stage.h}`,
        background: '#06101e',
        border: '1px solid rgba(91,170,255,0.22)',
        boxShadow: '0 10px 24px rgba(0,0,0,0.35)',
      }}
    >
      {/* Poster — the first thing painted, and the resting state if the game
          can't run here. */}
      <img
        src={poster}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 w-full h-full object-cover transition-opacity duration-500"
        style={{ opacity: showPoster ? 1 : 0 }}
      />

      {/* The live game. inert + aria-hidden: it is scenery, not a control —
          taps belong to the link overlay below and focus must never land
          inside. Note the link is a *sibling*, never an ancestor: the driver's
          synthetic clicks bubble, and inside an anchor every press the bot made
          would navigate the visitor into that game. */}
      {mounted && (
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ pointerEvents: 'none' }}
        >
          <div
            ref={setStage}
            inert={true}
            aria-hidden="true"
            style={{
              // `position: relative` + the transform make this the containing
              // block for the game's `position: fixed` overlays, so anything
              // portalled in here stays inside the card.
              position: 'relative',
              width: stage.w,
              height: stage.h,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
              overflow: 'hidden',
            }}
          >
            <DemoBoundary key={runKey} onError={handleFail}>
              <DemoHarness portalTarget={stageEl}>
                <Game {...gameProps} />
              </DemoHarness>
            </DemoBoundary>
          </div>
        </div>
      )}

      {/* Scanlines + vignette — the same tactical treatment the preview window
          uses, and they hide a lot of downscaling artefacts. */}
      <span
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 75% 65% at 50% 45%, transparent 45%, rgba(0,0,0,0.6) 100%)',
        }}
      />
      <span
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.14) 2px, rgba(0,0,0,0.14) 3px)',
          mixBlendMode: 'multiply',
        }}
      />

      {/* Tap target — covers the card, above everything else. */}
      <Link
        to={to}
        aria-label={`${label} — CBAT practice game`}
        className="absolute inset-0 z-10"
      />

      {/* Label */}
      <span
        className="absolute bottom-0 inset-x-0 px-2 py-1.5 text-center intel-mono font-extrabold uppercase pointer-events-none z-20"
        style={{
          fontSize: 'clamp(8px, 1.4vw, 11px)',
          letterSpacing: '0.14em',
          color: '#ddeaf8',
          background: 'linear-gradient(to top, rgba(6,16,30,0.92), transparent)',
          textShadow: '0 1px 6px rgba(0,0,0,0.9)',
        }}
      >
        {label}
      </span>

      {/* Hover accent */}
      <span
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none rounded-xl sm:rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity z-20"
        style={{ boxShadow: 'inset 0 0 0 1.5px rgba(91,170,255,0.75)' }}
      />
    </div>
  )
}
