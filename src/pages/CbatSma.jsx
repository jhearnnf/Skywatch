// CBAT "Sensory Motor Apparatus Test" (SMA) — the red dot and the crosshair.
//
// A circular display with a crosshair fixed at its centre and a red dot that
// drifts continuously across it. The job is to keep the two aligned. The
// simulation, the control law and the reasoning behind the scoring live in
// utils/cbat/smaSim.js; the four ways to fly it live in utils/cbat/smaInput.js.
//
// The real test splits the axes across a joystick (vertical) and foot pedals
// (lateral). Ours puts both on one control, and the instructions card says so in
// as many words. Reproducing the hand-and-foot split would need pedals nobody
// has, and a version that quietly implied it had would be making the one claim
// about this test that is not worth making.
//
// Nothing re-renders during a run. The dot moves at 60 Hz, and a React render
// per frame would cost more than the whole simulation does — so the frame loop
// writes transforms and text straight into the nodes collected on hudRef, the
// same pattern RTT uses.

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { submitCbatResult } from '../lib/cbatOutbox'
import { useCbatTracking } from '../utils/cbat/useCbatTracking'
import { useGameChrome } from '../context/GameChromeContext'
import SEO from '../components/SEO'
import CbatQuitButton from '../components/CbatQuitButton'
import CbatGameOver from '../components/CbatGameOver'
import StickSetup from '../components/cbat/StickSetup'
import { DifficultyButton, DifficultyMarker } from '../components/CbatDifficultySelect'
import { useCbatDemo } from '../utils/cbat/demoMode'
import { useMockStick } from '../utils/cbat/useMockStick'
import { createSmaInput, SMA_SOURCE_LABEL } from '../utils/cbat/smaInput'
import { createSmaSim, smaStats, maxSmaScore, CONTROL_RATE, LEAD_IN_MS } from '../utils/cbat/smaSim'
import {
  SMA_DIFFICULTIES, SMA_LAUNCH_MS, smaTuning, computeGrade, scorePercent,
  readStoredSmaDifficulty, storeSmaDifficulty,
  readStoredSmaSensitivity, storeSmaSensitivity,
  MIN_SMA_SENSITIVITY, MAX_SMA_SENSITIVITY,
} from '../utils/cbat/smaDifficulty'

// ── Display ──────────────────────────────────────────────────────────────────

// The instrument face. A circle, because smaSim clamps the dot radially and
// measures error as a radial distance — a square face would show the player a
// corner the simulation does not believe exists.
//
// The dot is moved by translating the LAYER it sits centred in, in percent.
// A percentage translate resolves against the layer's own box, which is the
// face, so x = 1 lands exactly on the bezel at any size and nothing has to be
// measured or watched for resize.
function Face({ ringPercent, dotLayerRef, ringRef, faceRef }) {
  return (
    <div
      ref={faceRef}
      data-testid="sma-face"
      className="relative w-full aspect-square rounded-full border border-[#1a3a5c] bg-[#060e1a] overflow-hidden select-none touch-none cursor-crosshair"
    >
      {/* Graticule. Faint, and behind everything — it exists so the eye has a
          frame of reference for how far off the dot is, not to be read. */}
      <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full" aria-hidden="true">
        <circle cx="50" cy="50" r="49.5" fill="none" stroke="#12253c" strokeWidth="0.6" />
        <circle cx="50" cy="50" r="33"   fill="none" stroke="#0f1f34" strokeWidth="0.5" />
        <circle cx="50" cy="50" r="16.5" fill="none" stroke="#0f1f34" strokeWidth="0.5" />
        <line x1="50" y1="0" x2="50" y2="100" stroke="#0f1f34" strokeWidth="0.5" />
        <line x1="0" y1="50" x2="100" y2="50" stroke="#0f1f34" strokeWidth="0.5" />
      </svg>

      {/* Tolerance ring — the boundary inside which a run scores at all. Sized
          from the tuning, so the Easier ring is visibly the wider one. Its
          colour is the lock indicator, written by the frame loop. */}
      <div
        ref={ringRef}
        data-state="off"
        data-testid="sma-ring"
        className="sma-ring"
        style={{ width: `${ringPercent}%`, height: `${ringPercent}%` }}
      />

      {/* Crosshair, fixed dead centre. This is the thing that does not move. */}
      <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full text-brand-600" aria-hidden="true">
        <line x1="42" y1="50" x2="48" y2="50" stroke="currentColor" strokeWidth="0.9" />
        <line x1="52" y1="50" x2="58" y2="50" stroke="currentColor" strokeWidth="0.9" />
        <line x1="50" y1="42" x2="50" y2="48" stroke="currentColor" strokeWidth="0.9" />
        <line x1="50" y1="52" x2="50" y2="58" stroke="currentColor" strokeWidth="0.9" />
        <circle cx="50" cy="50" r="0.9" fill="currentColor" />
      </svg>

      {/* The dot. Centred in a full-face layer that the frame loop translates. */}
      <div ref={dotLayerRef} className="absolute inset-0 flex items-center justify-center pointer-events-none will-change-transform">
        <div data-testid="sma-dot" className="sma-dot" />
      </div>
    </div>
  )
}

// ── Touch pad ────────────────────────────────────────────────────────────────

// A virtual stick on its own surface below the display, for the same reason
// ACT's steer pad sits below its tunnel: a finger on the face would cover the
// dot it is chasing. CSS-hidden on fine-pointer devices — with a mouse the pad
// is a trap, because the pointer's offset from the middle of the face IS the
// control, so reaching down for the pad would peg the dot on the way there.
// Same call, and the same reasoning, as RTT's on-screen shutter.
//
// Sticky origin: the gesture is centred wherever the finger lands, so the first
// correction never has to start by finding a centre by feel. The ring and knob
// below are drawn at that origin by the frame loop.
function TouchPad({ padRef, ringRef, knobRef, onPointerDown, onPointerMove, onPointerUp, idleRef }) {
  return (
    <div
      ref={padRef}
      data-testid="sma-pad"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className="sma-pad relative w-full h-40 mt-3 rounded-xl border border-[#1a3a5c] bg-[#0a1628] overflow-hidden"
      style={{ touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' }}
      role="application"
      aria-label="Touch control pad — hold and move to steer the dot"
    >
      <div ref={idleRef} className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <p className="text-[11px] uppercase tracking-widest text-slate-500">Hold and move to steer</p>
      </div>
      <div ref={ringRef} className="sma-pad-ring" style={{ opacity: 0 }} />
      <div ref={knobRef} className="sma-pad-knob" style={{ opacity: 0 }} />
    </div>
  )
}

// ── HUD pieces ───────────────────────────────────────────────────────────────

function Readout({ label, children, align = 'left' }) {
  return (
    <div className={align === 'right' ? 'text-right' : ''}>
      <p className="text-[9px] uppercase tracking-[0.18em] text-slate-500 leading-none mb-0.5">{label}</p>
      <p className="font-mono text-sm font-bold text-[#ddeaf8] leading-none tabular-nums">{children}</p>
    </div>
  )
}

function ResultsScreen({ stats, tuning }) {
  const grade = computeGrade(stats.totalScore, tuning)
  const pct = scorePercent(stats.totalScore, tuning)
  const gradeColor = grade === 'Outstanding' ? 'text-green-400'
    : grade === 'Good' ? 'text-brand-300'
      : grade === 'Needs Work' ? 'text-amber-400' : 'text-red-400'

  return (
    <div className="w-full max-w-md mx-auto">
      <p className={`text-center text-lg font-extrabold ${gradeColor} mb-1`}>{grade}</p>
      <p className="text-center text-[11px] text-slate-500 mb-4">
        {stats.totalScore} of a possible {maxSmaScore(tuning)} ({pct}%) · {tuning.label}
      </p>
      <div className="grid grid-cols-2 gap-2 text-left">
        {[
          ['Inside the ring', `${stats.onTargetPct}%`],
          ['Average error', `${stats.rmsErrorPct}%`],
          ['Worst error', `${stats.worstErrorPct}%`],
          ['Time tracked', `${Math.round(tuning.durationMs / 1000)}s`],
        ].map(([label, value]) => (
          <div key={label} className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">{label}</p>
            <p className="font-mono font-bold text-brand-300">{value}</p>
          </div>
        ))}
      </div>
      {/* Average error is the figure a real tracking apparatus is scored on, and
          it is the one worth explaining: it is measured from the crosshair to
          the dot as a share of the display radius, so 0% is perfect and 100% is
          the bezel. */}
      <p className="text-[11px] text-slate-500 mt-3 text-center">
        Average error is how far the dot sat from the crosshair, measured as a share of the way out to
        the edge of the display. Lower is better.
      </p>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function CbatSma() {
  const { user, apiFetch, API } = useAuth()
  const { start: startTracking, markCompleted: markGameCompleted } = useCbatTracking()
  const { enterImmersive, exitImmersive } = useGameChrome()
  const isDemo = !!useCbatDemo()

  const [phase, setPhase] = useState('intro')   // intro | launching | playing | results
  const [difficulty, setDifficulty] = useState(readStoredSmaDifficulty)
  const tuning = smaTuning(difficulty)
  // The difficulty the run on screen is being played at. Pinned at launch so a
  // mid-results switch can't relabel or misfile a finished run. Held twice on
  // purpose: the ref is what the frame loop reads, the state is what the render
  // tree reads (reading a ref during render trips react-hooks/refs).
  const runTuningRef = useRef(tuning)
  const [runDifficulty, setRunDifficulty] = useState(difficulty)
  const runTuning = smaTuning(runDifficulty)

  const [sensitivity, setSensitivity] = useState(readStoredSmaSensitivity)
  const sensitivityRef = useRef(sensitivity)
  useEffect(() => { sensitivityRef.current = sensitivity }, [sensitivity])

  // Admin ?stick=mock — a synthetic joystick, so the stick path can be flown
  // without one. See mockGamepad.js.
  const mockStick = useMockStick()

  const simRef = useRef(null)
  const inputRef = useRef(null)
  const faceRef = useRef(null)
  const padRef = useRef(null)
  const padRectRef = useRef(null)
  const hudRef = useRef({})

  const [personalBest, setPersonalBest] = useState(null)
  const [scoreSaved, setScoreSaved] = useState(false)
  const [queued, setQueued] = useState(false)
  const [finalStats, setFinalStats] = useState(null)

  // The tolerance ring is a diameter, the tuning is a radius, and both are
  // fractions of the face's radius — hence the doubling.
  const ringPercent = useMemo(() => runTuning.ringRadius * 200, [runTuning])

  useEffect(() => {
    if (phase === 'playing') enterImmersive()
    else exitImmersive()
    return exitImmersive
  }, [phase, enterImmersive, exitImmersive])

  // Personal best is per-difficulty (separate collections), so this refetches on
  // every switch.
  const fetchPB = useCallback((gameKey) => {
    if (!user) return
    apiFetch(`${API}/api/games/cbat/${gameKey}/personal-best`)
      .then(r => r.json())
      .then(d => { if (d.data) setPersonalBest(d.data) })
      .catch(() => {})
  }, [user, apiFetch, API])
  useEffect(() => { fetchPB(tuning.gameKey) }, [fetchPB, tuning.gameKey])

  const doFinish = useCallback(() => {
    const sim = simRef.current
    if (!sim) return
    const playedTuning = runTuningRef.current
    const stats = smaStats(sim)
    setFinalStats(stats)
    setScoreSaved(false)
    setQueued(false)
    markGameCompleted({ score: stats.totalScore })
    submitCbatResult(playedTuning.gameKey, {
      totalScore: stats.totalScore,
      onTargetPct: stats.onTargetPct,
      rmsErrorPct: stats.rmsErrorPct,
      worstErrorPct: stats.worstErrorPct,
      totalTime: stats.totalTime,
    }, { apiFetch, API })
      .then((r) => {
        setScoreSaved(!!r?.synced)
        setQueued(!!r?.queued)
        fetchPB(playedTuning.gameKey)
      })
      .catch(() => {})
    setPhase('results')
  }, [apiFetch, API, markGameCompleted, fetchPB])

  // The input layer lives for exactly as long as the face it is measured
  // against — the pointer path reads deflection from that element's rect.
  useEffect(() => {
    if (phase !== 'playing') return undefined
    const input = createSmaInput({ el: faceRef.current })
    inputRef.current = input
    return () => {
      input.dispose()
      inputRef.current = null
    }
  }, [phase])

  // The frame loop. Scoped to the effect rather than to a self-rescheduling
  // callback, so a run that ends cannot submit through a stale closure — the
  // same trap Vigilance's loop documents.
  useEffect(() => {
    if (phase !== 'playing') return undefined
    let raf
    let last = null

    const write = (hud) => {
      const el = hudRef.current
      if (el.dotLayer) el.dotLayer.style.transform = `translate(${(hud.x * 50).toFixed(2)}%, ${(hud.y * 50).toFixed(2)}%)`
      if (el.ring && el.ring.dataset.state !== hud.ringState) el.ring.dataset.state = hud.ringState
      if (el.errBar) el.errBar.style.width = `${Math.round(hud.error * 100)}%`
      for (const key of ['clock', 'score', 'onTarget', 'err', 'source']) {
        const node = el[key]
        if (node && node.textContent !== hud[key]) node.textContent = hud[key]
      }
      // Pad chrome. Drawn from the live gesture rather than from React state so
      // the knob keeps up with the finger.
      const gesture = hud.gesture
      const rect = padRectRef.current
      if (el.padRing && el.padKnob) {
        if (gesture && rect) {
          const ox = gesture.origin.x - rect.left
          const oy = gesture.origin.y - rect.top
          el.padRing.style.opacity = '1'
          el.padRing.style.transform = `translate(${ox.toFixed(1)}px, ${oy.toFixed(1)}px)`
          el.padKnob.style.opacity = '1'
          el.padKnob.style.transform =
            `translate(${(ox + gesture.axes.x * gesture.radius).toFixed(1)}px, ${(oy + gesture.axes.y * gesture.radius).toFixed(1)}px)`
          if (el.padIdle) el.padIdle.style.opacity = '0'
        } else {
          el.padRing.style.opacity = '0'
          el.padKnob.style.opacity = '0'
          if (el.padIdle) el.padIdle.style.opacity = '1'
        }
      }
    }

    const frame = (ts) => {
      const sim = simRef.current
      const input = inputRef.current
      if (!sim || !input) return
      if (last == null) last = ts
      // Clamped so a backgrounded tab does not return and advance the run by one
      // enormous step, which on an integrating simulation would fling the dot
      // into the bezel and score the whole gap as a miss.
      const dt = Math.min(100, ts - last)
      last = ts

      input.poll(dt, ts)
      const raw = input.axes()
      const k = sensitivityRef.current
      // Sensitivity scales the control and nothing else, so the drift a player
      // is fighting is identical whatever they set it to.
      sim.step(dt, { x: raw.x * k, y: raw.y * k })

      const snap = sim.snapshot()
      const leading = snap.leadInRemainingMs > 0
      write({
        x: snap.x,
        y: snap.y,
        error: snap.error,
        ringState: leading ? 'lead' : snap.onTarget ? 'on' : 'off',
        clock: leading
          ? `READY ${Math.ceil(snap.leadInRemainingMs / 1000)}`
          : `${Math.floor(snap.remainingMs / 1000)}s`,
        score: `${snap.score}`,
        onTarget: snap.onTarget ? 'ON' : 'OFF',
        err: `${Math.round(snap.error * 100)}%`,
        source: SMA_SOURCE_LABEL[input.source()] || '—',
        gesture: input.padGesture(),
      })

      if (snap.finished) { doFinish(); return }
      raf = requestAnimationFrame(frame)
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [phase, doFinish])

  // ── Pad handlers ───────────────────────────────────────────────────────────
  // The rect is re-read on every touch-down rather than cached for the run: the
  // pad moves when the address bar collapses on a phone, and a stale rect would
  // put the gesture's origin somewhere the finger is not.
  const onPadDown = useCallback((e) => {
    const el = padRef.current
    if (!el || !inputRef.current) return
    const rect = el.getBoundingClientRect()
    padRectRef.current = rect
    el.setPointerCapture?.(e.pointerId)
    inputRef.current.padDown(e.clientX, e.clientY, rect, e.pointerId)
  }, [])
  const onPadMove = useCallback((e) => {
    inputRef.current?.padMove(e.clientX, e.clientY, e.pointerId)
  }, [])
  const onPadUp = useCallback((e) => {
    try { padRef.current?.releasePointerCapture?.(e.pointerId) } catch { /* already released */ }
    inputRef.current?.padUp(e.pointerId)
  }, [])

  const startGame = useCallback(() => {
    const played = runTuningRef.current
    simRef.current = createSmaSim({ tuning: played })
    setFinalStats(null)
    setScoreSaved(false)
    startTracking(played.gameKey)
    setPhase('playing')
  }, [startTracking])

  // Pressing Start doesn't drop straight into the game: the chosen difficulty
  // button flashes on a greyed-out card first. A demo tile skips it.
  const beginLaunch = useCallback(() => {
    runTuningRef.current = tuning
    setRunDifficulty(tuning.key)
    if (isDemo) startGame()
    else setPhase('launching')
  }, [tuning, isDemo, startGame])

  useEffect(() => {
    if (phase !== 'launching') return undefined
    const t = setTimeout(() => startGame(), SMA_LAUNCH_MS)
    return () => clearTimeout(t)
  }, [phase, startGame])

  const chooseDifficulty = useCallback((key) => {
    setDifficulty(key)
    storeSmaDifficulty(key)
    // The old board's best belongs to the difficulty being left.
    setPersonalBest(null)
  }, [])

  const changeSensitivity = useCallback((value) => {
    setSensitivity(value)
    storeSmaSensitivity(value)
  }, [])

  const goToIntro = useCallback(() => {
    simRef.current = null
    setPhase('intro')
  }, [])

  const launching = phase === 'launching'
  const dim = launching ? ' cbat-launch-dim' : ''

  return (
    <div>
      <SEO
        title="Sensory Motor Apparatus Test — CBAT"
        description="Keep a continuously drifting red dot aligned with a fixed crosshair. Playable on a joystick, a mouse or a touch pad."
      />

      {!user && (
        <div className="bg-surface rounded-2xl border border-slate-200 p-6 text-center card-shadow">
          <div className="text-4xl mb-3">🔒</div>
          <p className="font-bold text-slate-800 mb-1">Sign in to play</p>
          <p className="text-sm text-slate-500 mb-4">Create a free account to access CBAT games.</p>
          <Link to="/login" className="inline-flex px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors">
            Sign In
          </Link>
        </div>
      )}

      {user && (
        <>
          <div className={`flex items-center gap-2 mb-2${dim}`}>
            {phase === 'intro' || launching
              ? <Link to="/cbat" className="text-slate-500 hover:text-brand-400 transition-colors text-sm">&larr; CBAT</Link>
              : <CbatQuitButton onConfirm={goToIntro} confirmNeeded={phase === 'playing'} />
            }
            <h1 className="text-sm font-extrabold text-slate-900">Sensory Motor Apparatus Test</h1>
            {phase === 'playing' && <DifficultyMarker tuning={runTuning} />}
          </div>

          {/* Intro */}
          {(phase === 'intro' || launching) && (
            <div className="flex flex-col items-center">
              <motion.div
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-md bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-6 text-center"
              >
                <p className={`text-4xl mb-3${dim}`}>🕹️</p>
                <p className={`text-xl font-extrabold text-white mb-2${dim}`}>Sensory Motor Apparatus Test</p>
                <div className="flex items-center justify-center gap-3 mb-1">
                  {SMA_DIFFICULTIES.map(t => (
                    <DifficultyButton
                      key={t.key}
                      tuning={t}
                      selected={difficulty === t.key}
                      onSelect={chooseDifficulty}
                      flashing={launching && difficulty === t.key}
                      dimmed={launching && difficulty !== t.key}
                    />
                  ))}
                </div>
                <p className={`text-[11px] text-brand-300 mb-3${dim}`}>{tuning.blurb}</p>

                <p className={`text-sm text-slate-400 mb-5${dim}`}>
                  A red dot drifts across the display and a crosshair sits fixed at the centre. Keep the
                  two aligned. The dot never holds still between corrections, so it is already moving
                  again while you deal with the last drift.
                </p>

                <div className={`bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-4 mb-5 text-left space-y-2 text-sm text-[#ddeaf8]${dim}`}>
                  <div className="flex items-start gap-2"><span className="text-brand-300 font-bold shrink-0">Control</span><span>your input sets how fast the dot moves, not where it goes. Centre the control and the dot keeps drifting, so you are always holding something.</span></div>
                  <div className="flex items-start gap-2"><span className="text-brand-300 font-bold shrink-0">Mouse</span><span>the further the pointer sits from the middle of the display, the harder the dot is pushed that way</span></div>
                  <div className="flex items-start gap-2"><span className="text-brand-300 font-bold shrink-0">Touch</span><span>hold anywhere on the pad below and move from there. Where you first touch becomes the centre.</span></div>
                  <div className="flex items-start gap-2"><span className="text-brand-300 font-bold shrink-0">Joystick</span><span>push away to send the dot down, pull back to bring it up, exactly as the real test does</span></div>
                  <div className="flex items-start gap-2"><span className="text-brand-300 font-bold shrink-0">Keys</span><span>arrow keys or WASD, if you have neither a mouse nor a touchscreen</span></div>
                  <div className="flex items-start gap-2"><span className="text-brand-300 font-bold shrink-0">Scoring</span><span>you earn points for every second the dot is inside the ring, and the most for holding it dead centre</span></div>
                  <div className="flex items-start gap-2 text-xs text-[#8a9bb5] pt-1"><span className="shrink-0">⏱</span><span>{Math.round(tuning.durationMs / 1000)} seconds, after {LEAD_IN_MS / 1000} seconds to get hold of it. A perfect run is {maxSmaScore(tuning)}.</span></div>
                  {/* Never imply we have reproduced the apparatus. The real test
                      is flown on a stick and a set of foot pedals; this is one
                      control doing both jobs, and a player comparing notes with
                      someone who has sat it should know that going in. */}
                  <div className="flex items-start gap-2 text-xs text-[#8a9bb5]"><span className="shrink-0">ℹ️</span><span>On the real test the up and down axis is on the joystick and the left and right axis is on a pair of foot pedals. Here both axes are on one control, because nobody has the pedals at home.</span></div>
                </div>

                {/* Sensitivity. The corpus's whole message about this test is
                    that the apparatus varies station to station and that the
                    right response to one that feels wrong is to get it changed
                    rather than fight it — so the equivalent belongs on the card,
                    not buried in a settings menu. */}
                <div className={`bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 mb-4 text-left${dim}`}>
                  <label htmlFor="sma-sensitivity" className="flex items-center justify-between text-[10px] text-slate-500 uppercase tracking-wide mb-2">
                    <span>Control sensitivity</span>
                    <span className="font-mono text-brand-300">{sensitivity.toFixed(2)}×</span>
                  </label>
                  <input
                    id="sma-sensitivity"
                    type="range"
                    min={MIN_SMA_SENSITIVITY}
                    max={MAX_SMA_SENSITIVITY}
                    step="0.05"
                    value={sensitivity}
                    onChange={(e) => changeSensitivity(Number(e.target.value))}
                    className="w-full accent-brand-600 cursor-pointer"
                  />
                  <p className="text-[10px] text-slate-600 mt-1">
                    Full deflection moves the dot {(CONTROL_RATE * sensitivity).toFixed(2)} of the way to the edge each second.
                  </p>
                </div>

                <div className={dim.trim()}>
                  <StickSetup title="Joystick" mockActive={mockStick} />
                </div>

                {personalBest && (
                  <div className={`bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 mb-4${dim}`}>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Personal Best · {tuning.label}</p>
                    <p className="text-lg font-mono font-bold text-brand-300">{personalBest.bestScore}</p>
                    <p className="text-[10px] text-slate-500">{personalBest.attempts} attempt{personalBest.attempts !== 1 ? 's' : ''}</p>
                  </div>
                )}

                <div className={`text-center mb-4${dim}`}>
                  <Link to={`/cbat/${tuning.gameKey}/leaderboard`} className="text-xs text-brand-300 hover:text-brand-200 transition-colors">View Leaderboard →</Link>
                </div>

                <button
                  onClick={beginLaunch}
                  disabled={launching}
                  data-demo-start
                  className={`px-8 py-3 bg-brand-600 hover:bg-brand-700 disabled:bg-[#1a3a5c] disabled:text-slate-500 text-white font-bold rounded-lg transition-colors text-sm cursor-pointer disabled:cursor-not-allowed${dim}`}
                >
                  Start
                </button>
              </motion.div>
            </div>
          )}

          {/* Playing */}
          {phase === 'playing' && (
            <div className="w-full max-w-md mx-auto flex flex-col items-center">
              <div className="w-full flex items-end justify-between gap-3 mb-2">
                <Readout label="Score"><span ref={el => (hudRef.current.score = el)}>0</span></Readout>
                <Readout label="Tracking" align="right"><span ref={el => (hudRef.current.onTarget = el)}>OFF</span></Readout>
                <Readout label="Error" align="right"><span ref={el => (hudRef.current.err = el)}>0%</span></Readout>
                <Readout label="Time" align="right"><span ref={el => (hudRef.current.clock = el)}>—</span></Readout>
              </div>

              {/* Error bar. The number above it is exact; this is the one you can
                  read out of the corner of your eye while watching the dot. */}
              <div className="w-full h-1 rounded-full bg-[#12253c] overflow-hidden mb-3">
                <div ref={el => (hudRef.current.errBar = el)} className="h-full bg-brand-600 rounded-full" style={{ width: '0%' }} />
              </div>

              <Face
                faceRef={faceRef}
                ringPercent={ringPercent}
                ringRef={el => (hudRef.current.ring = el)}
                dotLayerRef={el => (hudRef.current.dotLayer = el)}
              />

              <TouchPad
                padRef={padRef}
                ringRef={el => (hudRef.current.padRing = el)}
                knobRef={el => (hudRef.current.padKnob = el)}
                idleRef={el => (hudRef.current.padIdle = el)}
                onPointerDown={onPadDown}
                onPointerMove={onPadMove}
                onPointerUp={onPadUp}
              />

              {/* Which of the four is actually flying. Without it, "my joystick
                  isn't doing anything" is impossible to diagnose from here. */}
              <p className="mt-2 text-[10px] uppercase tracking-widest text-slate-600">
                Flying on <span ref={el => (hudRef.current.source = el)} className="text-brand-300">Mouse</span>
              </p>
            </div>
          )}

          {/* Results */}
          {phase === 'results' && finalStats && (
            <div className="flex flex-col items-center">
              <CbatGameOver
                gameKey={runTuning.gameKey}
                score={finalStats.totalScore}
                scoreSaved={scoreSaved}
                queued={queued}
                personalBest={personalBest}
                onPlayAgain={() => { setScoreSaved(false); startGame() }}
              >
                <ResultsScreen stats={finalStats} tuning={runTuning} />
              </CbatGameOver>
            </div>
          )}
        </>
      )}
    </div>
  )
}
