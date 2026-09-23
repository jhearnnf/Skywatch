import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Altimeter, AttitudeIndicator, Airspeed, VSI, HeadingDG, TurnCoordinator } from './InstrumentPanel'
import {
  createDrill, stepDrill, telemetry, drillSummary, challengePoints, turnNeedleFor, pitchFromAxes,
  DRILL_SECONDS, DIAL_LABEL, DIAL_HOW, RING_POINTS, BULLSEYE_POINTS, HOLD_MS, MAX_POINTS, MIN_POINTS,
} from '../../utils/cbat/instrumentsDrill'
import { createSmaInput } from '../../utils/cbat/smaInput'
import { createThrottleReader } from '../../utils/cbat/throttle'
import { useCbatTheme } from '../../hooks/useCbatTheme'
import { useAuth } from '../../context/AuthContext'
import { submitCbatResult } from '../../lib/cbatOutbox'
import { useCbatTracking } from '../../utils/cbat/useCbatTracking'
import CbatGameOver from '../CbatGameOver'
import TouchSteerPad from './TouchSteerPad'
import { useIsTouch } from '../../hooks/useIsTouch'

// The Instruments practice drill. A minute of free flight with the six dials
// live beside the view; every few seconds one dial lights up with a magenta
// target and the rest grey out, and the player flies until the needle sits on
// it. The drill itself (flight model, course, challenges, scoring) is the
// pure module in utils/cbat/instrumentsDrill.js; this is the screen round it.
//
// Opened from the Practise pill in the Instruments mode row, and built the way
// AntPractise is: the intro card explains it, Start flies straight in, and the
// run posts to its own board (`instruments-practise`) and finishes on the
// shared CbatGameOver screen.

const InstrumentsDrillScene = lazy(() => import('./InstrumentsDrillScene'))

const GAME_KEY = 'instruments-practise'
const SNAP_EVERY_S = 1 / 30   // how often the dials and HUD re-render
const TOAST_MS = 1100

const THROTTLE_UP_KEYS = new Set(['KeyR', 'Equal', 'NumpadAdd', 'PageUp'])
const THROTTLE_DOWN_KEYS = new Set(['KeyF', 'Minus', 'NumpadSubtract', 'PageDown'])

// `gesture` is the surface a drag started on: { rect, on: 'view' | 'pad' }.
function snapshot(d, input, gesture) {
  const c = d.challenge
  const pad = input?.padGesture?.()
  return {
    tele: telemetry(d.flight),
    throttle: d.flight.throttle,
    phase: d.phase,
    score: d.score,
    elapsed: d.elapsed,
    streak: d.streak,
    challenge: c ? {
      kind: c.kind, target: c.target, matched: c.matched, startedAt: c.startedAt, points: c.points, heldMs: c.heldMs,
    } : null,
    pad: pad && gesture ? {
      on: gesture.on,
      x: pad.origin.x - gesture.rect.left,
      y: pad.origin.y - gesture.rect.top,
      r: pad.radius,
      ax: pad.axes.x,
      ay: pad.axes.y,
    } : null,
  }
}

// ── Dials ────────────────────────────────────────────────────────────────────
const DrillDials = memo(function DrillDials({ snap }) {
  const { tele, challenge: c, phase } = snap
  const tone = (kind) => {
    if (!c) return undefined
    if (c.kind !== kind) return 'dim'
    return c.matched || phase === 'solved' ? 'match' : 'target'
  }
  const target = kind => (c && c.kind === kind ? c.target : null)
  const turnTarget = target('turn')
  return (
    <div className="grid grid-cols-3 gap-2 lg:gap-3 [&_svg]:max-w-none lg:[&_p]:text-[11px]" data-testid="drill-dials">
      <Altimeter durationMs={0} altitude={tele.altitude} tone={tone('altitude')} target={target('altitude')} />
      <AttitudeIndicator durationMs={0} pitchDeg={tele.pitchDeg} bankDeg={tele.bankDeg} tone={tone('attitude')} target={target('attitude')} />
      <Airspeed durationMs={0} knots={tele.airspeed} tone={tone('airspeed')} target={target('airspeed')} />
      <VSI durationMs={0} fpm={tele.vsFpm} tone={tone('vs')} target={target('vs')} />
      <HeadingDG durationMs={0} headingDeg={tele.headingDeg} tone={tone('heading')} target={target('heading')} />
      <TurnCoordinator durationMs={0} needleDeg={tele.turnNeedle} tone={tone('turn')}
        target={turnTarget == null ? null : turnNeedleFor(turnTarget)} />
    </div>
  )
})

// ── Drag knob + throttle ─────────────────────────────────────────────────────
// Where a drag landed and where the finger or mouse is now, drawn on the
// surface the drag started on (the view with a mouse, the pad on touch).
function DragKnob({ pad }) {
  return (
    <div className="absolute pointer-events-none" style={{ left: pad.x - pad.r, top: pad.y - pad.r, width: pad.r * 2, height: pad.r * 2 }}>
      <div className="absolute inset-0 rounded-full border border-white/25" />
      <div
        className="absolute w-6 h-6 -ml-3 -mt-3 rounded-full bg-white/60"
        style={{ left: `${50 + pad.ax * 50}%`, top: `${50 + pad.ay * 50}%` }}
      />
    </div>
  )
}

// The throttle bar and +/- buttons. On the view's corner with a mouse; beside
// the flight pad on touch, so a thumb never has to reach onto the view.
function ThrottleControls({ throttle, buttonProps, tall = false }) {
  const btn = `${tall ? 'w-12 h-[3.75rem]' : 'w-9 h-9'} rounded-lg bg-black/55 border border-white/25 text-white font-bold text-lg leading-none select-none`
  return (
    <div className="flex items-end gap-1.5">
      <div className={`w-2 ${tall ? 'h-32' : 'h-[4.75rem]'} rounded-full bg-black/50 border border-white/20 overflow-hidden flex flex-col-reverse`} aria-hidden="true">
        <div className="bg-brand-600" style={{ height: `${Math.round(throttle * 100)}%` }} />
      </div>
      <div className="flex flex-col gap-1">
        <button type="button" aria-label="More throttle" {...buttonProps(1)} className={btn} style={{ touchAction: 'none' }}>+</button>
        <button type="button" aria-label="Less throttle" {...buttonProps(-1)} className={btn} style={{ touchAction: 'none' }}>-</button>
      </div>
    </div>
  )
}

// ── SkyWatch flight overlay ─────────────────────────────────────────────────
// The gamified HUD over the view, SkyWatch theme only: glass score and a ring
// timer, a streak chip, and a challenge card whose bar drains as the points on
// offer fall and whose ring fills while the match is held.
const TIMER_R = 17
const TIMER_C = 2 * Math.PI * TIMER_R

function SkyHud({ snap, timeLeft, livePoints }) {
  const c = snap.challenge
  const solved = snap.phase === 'solved'
  const low = timeLeft < 10
  const hold = c && c.matched && !solved ? Math.min(1, c.heldMs / HOLD_MS) : 0
  const bar = livePoints == null ? 0 : (livePoints - MIN_POINTS) / (MAX_POINTS - MIN_POINTS)
  return (
    <div className="absolute inset-0 pointer-events-none" data-testid="sky-hud">
      <div className="drill-vignette absolute inset-0" />

      {/* Score + streak */}
      <div className="absolute top-2 left-2 flex flex-col items-start gap-1.5">
        <div className="drill-glass rounded-lg px-3 py-1.5">
          <p className="text-[9px] font-extrabold uppercase tracking-[0.2em] text-brand-600/80">Score</p>
          <p key={snap.score} className="drill-pop font-mono text-2xl lg:text-3xl font-extrabold leading-none text-white">{snap.score}</p>
        </div>
        {snap.streak >= 2 && (
          <p key={snap.streak} className="drill-pop drill-glass rounded-full px-2.5 py-0.5 font-mono text-[11px] font-extrabold uppercase tracking-wider text-amber-700">
            {'\u{1F525}'} x{snap.streak} streak
          </p>
        )}
      </div>

      {/* Ring timer */}
      <div className={`absolute top-2 right-2 drill-glass rounded-full p-1 ${low ? 'drill-low-time' : ''}`}>
        <svg viewBox="0 0 40 40" className="w-12 h-12 lg:w-14 lg:h-14 -rotate-90" aria-hidden="true">
          <circle cx="20" cy="20" r={TIMER_R} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3" />
          <circle cx="20" cy="20" r={TIMER_R} fill="none" stroke={low ? '#f87171' : '#5baaff'} strokeWidth="3" strokeLinecap="round"
            strokeDasharray={TIMER_C} strokeDashoffset={TIMER_C * (1 - timeLeft / DRILL_SECONDS)} />
        </svg>
        <span className={`absolute inset-0 flex items-center justify-center font-mono text-sm lg:text-base font-extrabold ${low ? 'text-red-400' : 'text-white'}`}>
          {Math.ceil(timeLeft)}
        </span>
      </div>

      {/* What to do right now */}
      <div className="absolute top-2 inset-x-20 lg:inset-x-24 flex justify-center text-center">
        {c ? (
          <div className={`drill-glass rounded-xl px-3 py-2 w-full max-w-sm border ${solved ? 'border-green-500/70' : 'border-amber-700/70'}`}>
            <div className="flex items-center justify-center gap-2">
              {/* Hold ring: fills while the reading sits on the target. */}
              {!solved && (
                <svg viewBox="0 0 20 20" className="w-5 h-5 -rotate-90 shrink-0" aria-hidden="true">
                  <circle cx="10" cy="10" r="8" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2.5" />
                  <circle cx="10" cy="10" r="8" fill="none" stroke="#4ade80" strokeWidth="2.5"
                    strokeDasharray={2 * Math.PI * 8} strokeDashoffset={2 * Math.PI * 8 * (1 - hold)} />
                </svg>
              )}
              <p className={`text-[11px] lg:text-sm font-extrabold uppercase tracking-wider ${solved ? 'text-green-400' : 'text-amber-700'}`}>
                {solved ? `${DIAL_LABEL[c.kind]} locked! +${c.points}` : c.matched ? 'On target, hold it...' : `Match the ${DIAL_LABEL[c.kind]} dial`}
              </p>
            </div>
            {!solved && (
              <>
                <p className="text-[10px] lg:text-xs text-slate-300 mt-1">{DIAL_HOW[c.kind]}</p>
                {/* Points on offer, draining from 10 to 5. */}
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-amber-700 to-green-400" style={{ width: `${Math.max(0.04, bar) * 100}%` }} />
                  </div>
                  <span className="font-mono text-[11px] font-extrabold text-white">+{livePoints}</span>
                </div>
              </>
            )}
          </div>
        ) : (
          <p className="drill-glass rounded-full px-3 py-1 text-[10px] lg:text-xs text-slate-200">
            Fly through the gates. The centre is a bullseye: +{BULLSEYE_POINTS}
          </p>
        )}
      </div>
    </div>
  )
}

// ── Results breakdown (inside CbatGameOver) ────────────────────────────────
function Stat({ label, value }) {
  return (
    <div className="bg-game-arena rounded-lg border border-game-line p-3 text-center">
      <p className="text-xl lg:text-2xl font-mono font-bold text-game-text">{value}</p>
      <p className="text-[11px] text-slate-500">{label}</p>
    </div>
  )
}

function DrillBreakdown({ summary }) {
  return (
    <div className="w-full grid grid-cols-3 gap-2" data-testid="drill-results">
      <Stat label="dials matched" value={`${summary.solved}/${summary.attempted}`} />
      <Stat label="average match" value={summary.avgSeconds == null ? '-' : `${summary.avgSeconds.toFixed(1)}s`} />
      <Stat label="gates" value={summary.ringsHit} />
      <Stat label="bullseyes" value={summary.bullseyes} />
      <Stat label="best streak" value={summary.bestStreak} />
      <Stat label="score" value={summary.score} />
    </div>
  )
}

// ── Run ──────────────────────────────────────────────────────────────────────
// `onStageChange('flying' | 'done')` lets the page drop the wide stage and
// the immersive chrome for the results screen, as every other game does.
export default function InstrumentsDrill({ onExit, craftUrl, onStageChange }) {
  const cbat = useCbatTheme()
  const { user, apiFetch, API } = useAuth()
  const { start: startTracking, markCompleted: markGameCompleted } = useCbatTracking()
  // The first run starts the moment this mounts; Play Again starts the next.
  const [firstDrill] = useState(() => createDrill({ seed: Date.now() }))
  const [stage, setStage] = useState('flying') // flying | done
  const stageRef = useRef('flying')
  const drillRef = useRef(firstDrill)
  const inputRef = useRef(null)
  const throttleRef = useRef(null)
  const sceneRef = useRef(null)
  const padElRef = useRef(null)
  // The surface the current drag started on, for drawing its knob.
  const gestureRef = useRef(null)
  // Touch screens fly from a pad under the dials, never from the view, where
  // a thumb would cover the aircraft. The pad glows with a prompt until the
  // first touch on it.
  const isTouch = useIsTouch()
  const [padUsed, setPadUsed] = useState(false)
  const sinceSnapRef = useRef(0)
  const throttleKeysRef = useRef({ up: false, down: false })
  const throttleBtnRef = useRef(0)
  const toastTimers = useRef([])
  const [snap, setSnap] = useState(() => snapshot(firstDrill, null, null))
  const [toasts, setToasts] = useState([])
  const [result, setResult] = useState(null)
  const [personalBest, setPersonalBest] = useState(null)
  const [scoreSaved, setScoreSaved] = useState(false)
  const [queued, setQueued] = useState(false)

  useEffect(() => { startTracking(GAME_KEY) }, [startTracking])

  // Personal best: the board this drill ranks on, not either Instruments one.
  const fetchBest = useCallback(() => {
    if (!user) return
    apiFetch(`${API}/api/games/cbat/${GAME_KEY}/personal-best`)
      .then(r => r.json())
      .then(d => { if (d.data) setPersonalBest(d.data) })
      .catch(() => {})
  }, [user, apiFetch, API])
  useEffect(() => { fetchBest() }, [fetchBest])

  const setStageBoth = useCallback((s) => { stageRef.current = s; setStage(s); onStageChange?.(s) }, [onStageChange])

  const toast = useCallback((text, tone) => {
    const id = Math.random()
    setToasts(list => [...list, { id, text, tone }])
    toastTimers.current.push(setTimeout(() => setToasts(list => list.filter(t => t.id !== id)), TOAST_MS))
  }, [])
  useEffect(() => () => toastTimers.current.forEach(clearTimeout), [])

  const finish = useCallback(() => {
    const summary = drillSummary(drillRef.current)
    setResult({ summary })
    setStageBoth('done')
    setScoreSaved(false)
    setQueued(false)
    markGameCompleted({ score: summary.score })
    submitCbatResult(GAME_KEY, {
      totalScore: summary.score,
      dialsMatched: summary.solved,
      dialsSet: summary.attempted,
      ringsHit: summary.ringsHit,
      avgMatchTime: summary.avgSeconds,
      totalTime: DRILL_SECONDS,
    }, { apiFetch, API })
      .then((r) => {
        setScoreSaved(!!r?.synced)
        setQueued(!!r?.queued)
        fetchBest()
      })
      .catch(() => {})
  }, [setStageBoth, markGameCompleted, apiFetch, API, fetchBest])

  const start = useCallback(() => {
    drillRef.current = createDrill({ seed: Date.now() })
    sinceSnapRef.current = 0
    setPadUsed(false)   // every run opens with the pad prompt again
    setResult(null)
    setToasts([])
    setSnap(snapshot(drillRef.current, null, null))
    setStageBoth('flying')
    startTracking(GAME_KEY)
  }, [setStageBoth, startTracking])

  // Input lives only while flying. `el: null` switches off SMA's
  // mouse-offset steering: here the mouse drags, like a finger, so it can
  // also reach the throttle buttons without flying the aircraft into the sea.
  useEffect(() => {
    if (stage !== 'flying') return
    const input = createSmaInput({ el: null })
    inputRef.current = input
    // A joystick's throttle lever or bound buttons (ThrottleSetup.jsx). Fresh
    // per run, so the lever has to be moved again before it takes over.
    throttleRef.current = createThrottleReader()
    const keys = throttleKeysRef.current
    const onKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (THROTTLE_UP_KEYS.has(e.code)) { keys.up = true; e.preventDefault() }
      if (THROTTLE_DOWN_KEYS.has(e.code)) { keys.down = true; e.preventDefault() }
    }
    const onKeyUp = (e) => {
      if (THROTTLE_UP_KEYS.has(e.code)) keys.up = false
      if (THROTTLE_DOWN_KEYS.has(e.code)) keys.down = false
    }
    const onBlur = () => { keys.up = false; keys.down = false }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      input.dispose()
      inputRef.current = null
      throttleRef.current = null
      onBlur()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [stage])

  // One step of the drill per rendered frame, driven from the scene's loop.
  const onFrame = useCallback((dt) => {
    const d = drillRef.current
    if (!d || stageRef.current !== 'flying') return null
    const input = inputRef.current
    input?.poll(dt * 1000)
    const axes = input ? input.axes() : { x: 0, y: 0 }
    const keys = throttleKeysRef.current
    // Throttle, in order: a set-up lever once it has been moved (it SETS the
    // throttle); otherwise R/F, the on-screen buttons and any bound stick
    // buttons, all nudging it up or down together.
    const stickThrottle = throttleRef.current
    stickThrottle?.poll()
    const throttleLevel = stickThrottle?.level() ?? undefined
    const nudge = (keys.up || throttleBtnRef.current > 0 ? 1 : 0) - (keys.down || throttleBtnRef.current < 0 ? 1 : 0)
      + (stickThrottle?.direction() ?? 0)
    const throttle = Math.max(-1, Math.min(1, nudge))
    const pitch = pitchFromAxes(input?.source(), axes.y)
    const events = stepDrill(d, { roll: axes.x, pitch, throttle, throttleLevel }, dt)

    for (const e of events) {
      if (e.type === 'ring' && e.result === 'hit') toast(`+${RING_POINTS}`, 'ring')
      else if (e.type === 'ring' && e.result === 'bullseye') toast(`Bullseye +${BULLSEYE_POINTS}`, 'bullseye')
      else if (e.type === 'solved') toast(`+${e.points}`, 'solved')
      else if (e.type === 'timeout') toast('Out of time, next one', 'miss')
    }
    if (events.some(e => e.type === 'end')) { finish(); return events }

    sinceSnapRef.current += dt
    if (sinceSnapRef.current >= SNAP_EVERY_S || events.length) {
      sinceSnapRef.current = 0
      setSnap(snapshot(d, input, gestureRef.current))
    }
    // Handed back to the scene, whose gate bursts react to them.
    return events
  }, [finish, toast])

  // ── Pointer steering ───────────────────────────────────────────────────────
  // A drag works as a virtual stick from wherever it lands. With a mouse the
  // view takes it; on touch only the pad below the dials does.
  const startDrag = (el, on) => (e) => {
    if (!el || !inputRef.current) return
    const rect = el.getBoundingClientRect()
    gestureRef.current = { rect, on }
    try { el.setPointerCapture(e.pointerId) } catch { /* not supported */ }
    inputRef.current.padDown(e.clientX, e.clientY, rect, e.pointerId)
  }
  const onViewPointerDown = (e) => startDrag(sceneRef.current, 'view')(e)
  const onPadPointerDown = (e) => {
    setPadUsed(true)
    startDrag(padElRef.current, 'pad')(e)
  }
  const onPointerMove = (e) => inputRef.current?.padMove(e.clientX, e.clientY, e.pointerId)
  const onPointerUp = (e) => inputRef.current?.padUp(e.pointerId)

  const throttleButton = (dir) => ({
    onPointerDown: (e) => { e.stopPropagation(); throttleBtnRef.current = dir },
    onPointerUp: () => { throttleBtnRef.current = 0 },
    onPointerLeave: () => { throttleBtnRef.current = 0 },
    onPointerCancel: () => { throttleBtnRef.current = 0 },
  })

  // The canvas never re-renders with the HUD: same element, React skips it.
  const scene = useMemo(() => (
    <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center text-xs text-slate-500">Loading aircraft...</div>}>
      <InstrumentsDrillScene drillRef={drillRef} onFrame={onFrame} realCbat={cbat} craftUrl={craftUrl} />
    </Suspense>
  ), [onFrame, cbat, craftUrl])

  if (stage === 'done' && result) {
    // Centred like every other game's results: CbatGameOver is a max-w-md
    // column that relies on its parent to centre it.
    return (
      <div className="w-full flex flex-col items-center">
      <CbatGameOver
        gameKey={GAME_KEY}
        score={result.summary.score}
        scoreSaved={scoreSaved}
        queued={queued}
        personalBest={personalBest}
        onPlayAgain={start}
        extraActions={[{ label: 'Back to Instruments', onClick: onExit }]}
      >
        <DrillBreakdown summary={result.summary} />
      </CbatGameOver>
      </div>
    )
  }
  if (!snap) return null

  const c = snap.challenge
  const timeLeft = Math.max(0, DRILL_SECONDS - snap.elapsed)
  const livePoints = c && snap.phase === 'challenge' ? challengePoints(snap.elapsed - c.startedAt) : null

  return (
    <div className="w-full" data-testid="instruments-drill">
      {/* HUD row: Real CBAT only. SkyWatch carries it on the view (SkyHud). */}
      {cbat && <>
      <div className="flex items-center justify-between text-xs lg:text-sm font-mono mb-2 px-1">
        <span className="text-slate-400">Score <span className="text-brand-600 font-bold">{snap.score}</span></span>
        <span className="text-slate-500 uppercase tracking-wide font-sans text-[10px] lg:text-xs">Practise</span>
        <span className="text-slate-400">
          {'⏱'} <span className={timeLeft < 10 ? 'text-red-400' : 'text-brand-600'}>{timeLeft.toFixed(1)}s</span>
        </span>
      </div>
      <div className="w-full h-1 bg-game-line rounded-full mb-3 overflow-hidden">
        <div className={`h-full rounded-full ${timeLeft < 10 ? 'bg-red-500' : 'bg-brand-600'}`} style={{ width: `${(timeLeft / DRILL_SECONDS) * 100}%` }} />
      </div>
      </>}

      <div className="lg:flex lg:gap-4 lg:items-center">
        {/* View */}
        <div
          ref={sceneRef}
          className={`relative w-full lg:w-1/2 ${isTouch ? 'h-[30dvh]' : 'h-[36dvh]'} min-h-[200px] lg:h-[min(calc(100dvh-14rem),44rem)] rounded-xl overflow-hidden border border-game-line bg-game-arena select-none`}
          style={{ touchAction: 'none' }}
          onPointerDown={isTouch ? undefined : onViewPointerDown}
          onPointerMove={isTouch ? undefined : onPointerMove}
          onPointerUp={isTouch ? undefined : onPointerUp}
          onPointerCancel={isTouch ? undefined : onPointerUp}
          data-testid="drill-view"
        >
          {scene}

          {!cbat && <SkyHud snap={snap} timeLeft={timeLeft} livePoints={livePoints} />}
          {/* A green edge flash when a dial locks, SkyWatch only. */}
          {!cbat && snap.phase === 'solved' && <div key={c?.startedAt} className="drill-flash absolute inset-0 pointer-events-none" />}

          {/* What to do right now (Real CBAT) */}
          {cbat && <div className="absolute top-2 inset-x-2 flex flex-col items-center pointer-events-none text-center">
            {c ? (
              <div className={`rounded-lg px-3 py-1.5 bg-black/55 border ${snap.phase === 'solved' ? 'border-green-500' : 'border-amber-700'}`}>
                <p className={`text-xs lg:text-sm font-bold ${snap.phase === 'solved' ? 'text-green-400' : 'text-amber-700'}`}>
                  {snap.phase === 'solved' ? `${DIAL_LABEL[c.kind]} matched! +${c.points}` : `Match the ${DIAL_LABEL[c.kind]} dial`}
                </p>
                {snap.phase === 'challenge' && (
                  <p className="text-[10px] lg:text-xs text-slate-300 mt-0.5">{DIAL_HOW[c.kind]}</p>
                )}
                {livePoints != null && (
                  <p className="text-[10px] lg:text-xs font-mono text-slate-400 mt-0.5">Worth +{livePoints}</p>
                )}
              </div>
            ) : (
              <p className="rounded-lg px-3 py-1 bg-black/40 text-[10px] lg:text-xs text-slate-300">Fly through the rings. Watch the dials move.</p>
            )}
          </div>}

          {/* Points */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            {toasts.map(t => (
              <span key={t.id} className={`drill-toast absolute font-mono font-extrabold uppercase ${
                t.tone === 'solved' ? 'text-4xl text-green-400'
                  : t.tone === 'bullseye' ? 'text-2xl text-amber-800 drill-toast-glow'
                  : t.tone === 'miss' ? 'text-sm text-red-400'
                  : 'text-xl text-sky-800'
              }`}>{t.text}</span>
            ))}
          </div>

          {snap.pad?.on === 'view' && <DragKnob pad={snap.pad} />}

          {/* Throttle on the view's corner with a mouse; beside the pad on touch. */}
          {!isTouch && (
            <div className="absolute right-2 bottom-2">
              <ThrottleControls throttle={snap.throttle} buttonProps={throttleButton} />
            </div>
          )}
        </div>

        {/* Dials */}
        <div className="w-full lg:w-1/2 mt-3 lg:mt-0">
          <DrillDials snap={snap} />
        </div>
      </div>

      {/* Touch: the flight pad under the dials, throttle beside it. */}
      {isTouch && (
        <div className="mt-3 flex items-stretch gap-2">
          <TouchSteerPad
            padRef={padElRef}
            onPointerDown={onPadPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            isDragging={snap.pad?.on === 'pad'}
            label="Drag here to fly"
            ariaLabel="Flight pad: drag to bank and pitch"
            cue="both"
            className={`h-32 flex-1 ${padUsed ? '' : 'drill-pad-prompt'}`}
            data-testid="drill-pad"
          >
            {snap.pad?.on === 'pad' && <DragKnob pad={snap.pad} />}
            {!padUsed && (
              <p className="absolute top-2 inset-x-2 text-center text-[11px] font-extrabold text-brand-600 pointer-events-none" data-testid="drill-pad-prompt">
                Use this pad to fly the aircraft
              </p>
            )}
          </TouchSteerPad>
          <ThrottleControls throttle={snap.throttle} buttonProps={throttleButton} tall />
        </div>
      )}

      <p className="text-[10px] lg:text-xs text-slate-500 text-center mt-2">
        {isTouch
          ? 'Drag the pad to bank and pitch (up pushes the nose down, like a real stick). Hold + and - for throttle.'
          : 'Arrow keys or WASD to bank and pitch (up pushes the nose down, like a real stick), R and F for throttle. Or drag on the view.'}
      </p>
    </div>
  )
}
