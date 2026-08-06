import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { submitCbatResult } from '../lib/cbatOutbox'
import { useCbatTracking } from '../utils/cbat/useCbatTracking'
import { useGameChrome } from '../context/GameChromeContext'
import { useGameBodyClass } from '../hooks/useGameBodyClass'
import SEO from '../components/SEO'
import CbatQuitButton from '../components/CbatQuitButton'
import CbatGameOver from '../components/CbatGameOver'
import RttScene from '../components/RttScene'
import { DifficultyButton, DifficultyMarker } from '../components/CbatDifficultySelect'
import { playRttShutter } from '../utils/sound'
import { useCbatDemo } from '../utils/cbat/demoMode'
import { createRttInput } from '../utils/cbat/rttInput'
import {
  RTT_DIFFICULTIES, RTT_LAUNCH_MS, rttTuning,
  readStoredRttDifficulty, storeRttDifficulty, computeGrade,
  readStoredSensitivity, storeSensitivity, MIN_SENSITIVITY, MAX_SENSITIVITY,
} from '../utils/cbat/rttDifficulty'
import {
  makeRttSim, rttStats, maxRttScore, captureRadius,
  CAMERA_FOV_DEG, RTT_FRAMES_PER_TARGET, SHUTTER_COOLDOWN_MS, RTT_KINDS,
  START_ELEV_DEG,
} from '../utils/cbat/rttSim'

const DEG = Math.PI / 180

// How tall the reticle box is as a percentage of the arena height.
//
// The capture cone is an angle and the camera's vertical field of view is an
// angle, so their tangent ratio is the fraction of the frame the cone covers —
// which means the reticle can be sized in percent and never needs measuring or
// a resize listener. The SVG inside draws its circle at half the box width, so
// the box is twice the cone.
// The camera's state at the start of a run. Pitched down rather than level:
// every ground target sits below the horizon, so starting level meant the first
// thing every run asked for was "look down".
function freshCamera() {
  return { az: 0, elev: START_ELEV_DEG * DEG, deflection: 0, stickX: 0, stickY: 0 }
}

function reticleBoxPercent(tuning) {
  const cone = Math.tan(captureRadius(tuning))
  const halfFov = Math.tan((CAMERA_FOV_DEG / 2) * DEG)
  return 2 * 100 * (cone / halfFov)
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

function Reticle({ boxPercent, innerRef }) {
  return (
    <div ref={innerRef} data-state="idle" data-testid="rtt-reticle" className="rtt-reticle" style={{ height: `${boxPercent}%` }}>
      <svg viewBox="0 0 100 100" className="w-full h-full" aria-hidden="true">
        <circle cx="50" cy="50" r="25" fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.95" />
        {/* Corner ticks reaching out past the cone, so the reticle is findable
            against a busy picture without hiding the target inside it. */}
        {[[50, 10, 50, 21], [50, 79, 50, 90], [10, 50, 21, 50], [79, 50, 90, 50]].map(([x1, y1, x2, y2], i) => (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth="1.4" opacity="0.9" />
        ))}
        <circle cx="50" cy="50" r="1.4" fill="currentColor" />
      </svg>
    </div>
  )
}

// Which way to slew to find the target: an arrow riding a circle around the
// reticle, rotated to point at it. The arm rotates; nothing inside it carries
// text, so nothing ends up upside down. How far away the target is goes in the
// readout block instead.
function TargetCue({ innerRef, armRef }) {
  return (
    <div ref={innerRef} data-state="live" className="rtt-cue" aria-hidden="true">
      <div ref={armRef} className="rtt-cue-arm">
        {/* A long, notched arrowhead rather than a plain triangle. The first
            attempt was very nearly equilateral, which reads as a blob — at a
            glance you could not tell which way it pointed, which is the one
            thing it exists to say. */}
        <svg viewBox="0 0 16 10" className="rtt-cue-arrow">
          <path d="M0 0 L16 5 L0 10 L5 5 Z" fill="currentColor" />
        </svg>
      </div>
    </div>
  )
}

// The stick's current deflection, drawn as a dot in a ring. On a mouse this is
// the only feedback that the pointer's distance from centre is what matters —
// without it players read the game as "aim with the mouse" and fight it.
function StickIndicator({ innerRef }) {
  return (
    <div className="relative w-11 h-11 rounded-full border border-[#1a3a5c] bg-[#060e1a]/70" aria-hidden="true">
      <div className="absolute left-1/2 top-1/2 w-[3px] h-[3px] -ml-[1.5px] -mt-[1.5px] rounded-full bg-slate-600" />
      <div
        ref={innerRef}
        className="absolute left-1/2 top-1/2 w-2 h-2 -ml-1 -mt-1 rounded-full bg-brand-600 shadow-[0_0_8px_rgba(91,170,255,0.6)]"
      />
    </div>
  )
}

function ResultsScreen({ stats, tuning }) {
  const pct = Math.round((stats.totalScore / maxRttScore(tuning)) * 100)
  const grade = computeGrade(stats.totalScore, tuning)
  const gradeColor = grade === 'Outstanding' ? 'text-green-400'
    : grade === 'Good' ? 'text-brand-300'
      : grade === 'Needs Work' ? 'text-amber-400' : 'text-red-400'
  const accuracy = stats.framesTaken
    ? Math.round((stats.framesOnTarget / stats.framesTaken) * 100)
    : 0

  return (
    <div className="w-full max-w-md mx-auto">
      <p className={`text-center text-lg font-extrabold ${gradeColor} mb-1`}>{grade}</p>
      <p className="text-center text-[11px] text-slate-500 mb-4">
        {stats.totalScore} of a possible {maxRttScore(tuning)} ({pct}%) · {tuning.label}
      </p>
      <div className="grid grid-cols-2 gap-2 text-left">
        {[
          ['Targets completed', `${stats.targetsCompleted} / ${stats.totalTargets}`],
          ['Frames on target', `${stats.framesOnTarget} / ${stats.totalTargets * RTT_FRAMES_PER_TARGET}`],
          ['Shutter accuracy', `${accuracy}%`],
          ['Average centring', `${stats.avgCentringErrorDeg}°`],
        ].map(([label, value]) => (
          <div key={label} className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">{label}</p>
            <p className="font-mono font-bold text-brand-300">{value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function CbatRtt() {
  const { user, apiFetch, API } = useAuth()
  const { start: startTracking, markCompleted: markGameCompleted } = useCbatTracking()
  const { enterImmersive, exitImmersive } = useGameChrome()
  const isDemo = !!useCbatDemo()

  const [phase, setPhase] = useState('intro') // intro | launching | playing | results
  const [difficulty, setDifficulty] = useState(readStoredRttDifficulty)
  const tuning = rttTuning(difficulty)
  // The difficulty the run on screen is being played at. Pinned at launch so a
  // mid-results switch can't relabel or misfile a finished run. Held twice on
  // purpose: the ref is what the frame loop reads, the state is what the render
  // tree reads (reading a ref during render trips react-hooks/refs).
  const runTuningRef = useRef(tuning)
  const [runDifficulty, setRunDifficulty] = useState(difficulty)
  const runTuning = rttTuning(runDifficulty)

  const [sensitivity, setSensitivity] = useState(readStoredSensitivity)
  const sensitivityRef = useRef(sensitivity)
  useEffect(() => { sensitivityRef.current = sensitivity }, [sensitivity])

  const [sim, setSim] = useState(null)
  const simRef = useRef(null)
  const inputRef = useRef(null)
  const runningRef = useRef(false)
  // Starts pitched down, where the ground targets actually are — see
  // START_ELEV_DEG.
  const camRef = useRef(freshCamera())
  const arenaRef = useRef(null)
  const hudRef = useRef({})

  const [events, setEvents] = useState([])
  const [flash, setFlash] = useState(null)

  const [personalBest, setPersonalBest] = useState(null)
  const [scoreSaved, setScoreSaved] = useState(false)
  const [queued, setQueued] = useState(false)
  const [finalStats, setFinalStats] = useState(null)

  const boxPercent = useMemo(() => reticleBoxPercent(runTuning), [runTuning])

  useEffect(() => {
    if (phase === 'playing') enterImmersive()
    else exitImmersive()
    return exitImmersive
  }, [phase, enterImmersive, exitImmersive])

  useGameBodyClass('cbat-rtt-wide', phase === 'playing')

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

  // The stick lives for exactly as long as the arena it is measured against.
  useEffect(() => {
    if (phase !== 'playing') return
    const input = createRttInput({ el: arenaRef.current })
    inputRef.current = input
    runningRef.current = true
    return () => {
      runningRef.current = false
      input.dispose()
      inputRef.current = null
    }
  }, [phase])

  // The event ticker is polled rather than pushed: it has to show targets LOST
  // as well as frames taken, and a lost target isn't an action the player took,
  // so there is nothing to hang a callback on. 4 Hz is plenty for reading.
  useEffect(() => {
    if (phase !== 'playing') return
    const id = setInterval(() => {
      const s = simRef.current
      if (s) setEvents(s.events.slice(0, 3))
    }, 250)
    return () => clearInterval(id)
  }, [phase])

  const doFinish = useCallback(() => {
    runningRef.current = false
    const s = simRef.current
    if (!s) return
    const playedTuning = runTuningRef.current
    const stats = rttStats(s)
    setFinalStats(stats)
    setScoreSaved(false)
    setQueued(false)
    markGameCompleted({ score: stats.totalScore })
    submitCbatResult(playedTuning.gameKey, {
      totalScore: stats.totalScore,
      totalTime: s.durationMs / 1000,
      framesTaken: stats.framesTaken,
      framesOnTarget: stats.framesOnTarget,
      targetsCompleted: stats.targetsCompleted,
      avgCentringErrorDeg: stats.avgCentringErrorDeg,
    }, { apiFetch, API })
      .then((r) => {
        setScoreSaved(!!r?.synced)
        setQueued(!!r?.queued)
        fetchPB(playedTuning.gameKey)
      })
      .catch(() => {})
    setPhase('results')
  }, [apiFetch, API, markGameCompleted, fetchPB])

  // Called once per animation frame by the scene with the run's live numbers.
  // Written straight into the DOM rather than through state: at 60 Hz a
  // re-render per frame would cost more than the game does, and the reticle's
  // lock colour has to be exactly as current as the camera it describes.
  const writeHud = useCallback((hud) => {
    const el = hudRef.current
    if (!el.reticle) return
    if (el.reticle.dataset.state !== hud.reticle) el.reticle.dataset.state = hud.reticle
    if (el.stick) el.stick.style.transform = `translate(${(hud.stickX * 18).toFixed(1)}px, ${(hud.stickY * 18).toFixed(1)}px)`
    if (el.window && el.window.style.width !== hud.window) el.window.style.width = hud.window
    if (el.cue) {
      const shown = hud.cueOn ? '1' : '0'
      if (el.cue.style.opacity !== shown) el.cue.style.opacity = shown
      const state = hud.cueNext ? 'next' : 'live'
      if (el.cue.dataset.state !== state) el.cue.dataset.state = state
      if (el.cueArm) el.cueArm.style.transform = `rotate(${hud.cueAngle})`
    }
    if (el.cueDeg) {
      const text = hud.cueOn ? hud.cueDeg : '—'
      if (el.cueDeg.textContent !== text) el.cueDeg.textContent = text
    }
    for (const key of ['clock', 'score', 'az', 'elev', 'frames', 'label', 'count']) {
      const node = el[key]
      if (node && node.textContent !== hud[key]) node.textContent = hud[key]
    }
  }, [])

  const onShot = useCallback((result) => {
    playRttShutter(result.kind === 'hit' ? 'hit' : 'miss')
    setFlash({ id: `${Date.now()}-${Math.random()}`, kind: result.kind })
  }, [])

  const startGame = useCallback(() => {
    const next = makeRttSim(runTuningRef.current)
    simRef.current = next
    setSim(next)
    camRef.current = freshCamera()
    setEvents([])
    setFlash(null)
    setFinalStats(null)
    setScoreSaved(false)
    startTracking(runTuningRef.current.gameKey)
    setPhase('playing')
  }, [startTracking])

  // Pressing Start doesn't drop straight into the game: the chosen difficulty
  // button flashes on a greyed-out card for RTT_LAUNCH_MS first. A demo tile
  // skips it — the landing wall drives the Start button and shouldn't sit on a
  // dimmed card for a second of its short loop.
  const beginLaunch = useCallback(() => {
    runTuningRef.current = tuning
    setRunDifficulty(tuning.key)
    if (isDemo) startGame()
    else setPhase('launching')
  }, [tuning, isDemo, startGame])

  useEffect(() => {
    if (phase !== 'launching') return
    const t = setTimeout(() => startGame(), RTT_LAUNCH_MS)
    return () => clearTimeout(t)
  }, [phase, startGame])

  const chooseDifficulty = useCallback((key) => {
    setDifficulty(key)
    storeRttDifficulty(key)
    // The old board's best belongs to the difficulty being left.
    setPersonalBest(null)
  }, [])

  const changeSensitivity = useCallback((value) => {
    setSensitivity(value)
    storeSensitivity(value)
  }, [])

  const goToIntro = useCallback(() => {
    runningRef.current = false
    setPhase('intro')
  }, [])

  const launching = phase === 'launching'
  const dim = launching ? ' cbat-launch-dim' : ''

  return (
    <div className="cbat-rtt-page">
      <SEO title="Rapid Tracking Test — CBAT" description="Slew a sensor camera onto moving targets and capture three centred frames of each before the pass ends." />

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
          {/* Header */}
          <div className={`flex items-center gap-2 mb-2${launching ? ' cbat-launch-dim' : ''}`}>
            {phase === 'intro' || launching
              ? <Link to="/cbat" className="text-slate-500 hover:text-brand-400 transition-colors text-sm">&larr; CBAT</Link>
              : <CbatQuitButton onConfirm={goToIntro} confirmNeeded={phase === 'playing'} />
            }
            <h1 className="text-sm font-extrabold text-slate-900">Rapid Tracking Test</h1>
            {phase === 'playing' && <DifficultyMarker tuning={runTuning} />}
          </div>

          {/* Intro */}
          {(phase === 'intro' || launching) && (
            <div className="flex flex-col items-center">
              <motion.div
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-md bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-6 text-center"
              >
                <p className={`text-4xl mb-3${dim}`}>📷</p>
                <p className={`text-xl font-extrabold text-white mb-2${dim}`}>Rapid Tracking Test</p>
                <div className="flex items-center justify-center gap-3 mb-1">
                  {RTT_DIFFICULTIES.map(t => (
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
                  You are looking through a sensor camera slung under an aircraft. Slew it onto each target and
                  capture <span className="text-[#ddeaf8]">three frames</span> with the target in the centre of
                  the reticle before the pass ends.
                </p>

                <div className={`bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-4 mb-5 text-left space-y-2 text-sm text-[#ddeaf8]${dim}`}>
                  <div className="flex items-start gap-2"><span className="text-brand-300 font-bold shrink-0">Slew</span><span>the further the pointer sits from the middle of the picture, the faster the camera turns — bring it back to the middle to stop</span></div>
                  <div className="flex items-start gap-2"><span className="text-brand-300 font-bold shrink-0">Shoot</span><span>click, or press Space, with the target inside the reticle — dead centre is worth double</span></div>
                  <div className="flex items-start gap-2"><span className="text-brand-300 font-bold shrink-0">Targets</span><span>{tuning.targets} passes: {tuning.kinds.map(k => RTT_KINDS[k].label.toLowerCase()).join(', ')}</span></div>
                  <div className="flex items-start gap-2"><span className="text-brand-300 font-bold shrink-0">Cover</span><span>targets pass behind cloud and terrain — predict where they come out and pick the track back up</span></div>
                  <div className="flex items-start gap-2"><span className="text-brand-300 font-bold shrink-0">Drift</span><span>the aircraft never sits still — the picture wanders on its own and you have to keep trimming it back</span></div>
                  <div className="flex items-start gap-2"><span className="text-brand-300 font-bold shrink-0">Cue</span><span>an arrow points the way to the target — amber while it points at the next one, so use the gaps to get ahead of it</span></div>
                  <div className="flex items-start gap-2 text-xs text-[#8a9bb5] pt-1"><span className="shrink-0">⏱</span><span>the shutter needs {(SHUTTER_COOLDOWN_MS / 1000).toFixed(2)}s between frames, so spraying costs you the pass</span></div>
                </div>

                {/* Sensitivity. The real test's own advice is that adapting to
                    the sensitivity of the stick in front of you matters more
                    than any amount of gaming, so it belongs on the card rather
                    than buried in settings. */}
                <div className={`bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 mb-4 text-left${dim}`}>
                  <label htmlFor="rtt-sensitivity" className="flex items-center justify-between text-[10px] text-slate-500 uppercase tracking-wide mb-2">
                    <span>Slew sensitivity</span>
                    <span className="font-mono text-brand-300">{sensitivity.toFixed(2)}×</span>
                  </label>
                  <input
                    id="rtt-sensitivity"
                    type="range"
                    min={MIN_SENSITIVITY}
                    max={MAX_SENSITIVITY}
                    step="0.05"
                    value={sensitivity}
                    onChange={(e) => changeSensitivity(Number(e.target.value))}
                    className="w-full accent-brand-600 cursor-pointer"
                  />
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
          {phase === 'playing' && sim && (
            <div className="flex flex-col items-center gap-2">
              <div
                ref={arenaRef}
                data-testid="rtt-arena"
                className="relative w-full rounded-xl overflow-hidden border border-[#1a3a5c] bg-[#060e1a] select-none touch-none cursor-crosshair"
                style={{ height: 'min(72vh, 620px)' }}
              >
                <RttScene
                  sim={sim}
                  simRef={simRef}
                  inputRef={inputRef}
                  sensitivityRef={sensitivityRef}
                  runningRef={runningRef}
                  camRef={camRef}
                  onHud={writeHud}
                  onShot={onShot}
                  onEnd={doFinish}
                />

                {/* HUD. Every value below is written by RttScene's frame loop
                    straight into these nodes — see the refs collected on
                    hudRef. Nothing here re-renders during a run. */}
                <div className="absolute inset-0 pointer-events-none">
                  <Reticle boxPercent={boxPercent} innerRef={el => (hudRef.current.reticle = el)} />
                  <TargetCue
                    innerRef={el => (hudRef.current.cue = el)}
                    armRef={el => (hudRef.current.cueArm = el)}
                  />

                  <div className="absolute top-0 left-0 right-0 flex items-start justify-between gap-3 p-3">
                    <div>
                      <p className="text-[9px] uppercase tracking-[0.18em] text-slate-500 leading-none mb-0.5">Sensor</p>
                      <p ref={el => (hudRef.current.label = el)} className="font-mono text-sm font-extrabold text-brand-300 leading-none">STAND BY</p>
                      <p ref={el => (hudRef.current.count = el)} className="font-mono text-[10px] text-slate-500 leading-none mt-1">– of {sim.run.targets.length}</p>
                      {/* How much of the current pass is left. Without it, a
                          target running out of time is something that happens
                          to you rather than something you watched coming. */}
                      <div className="mt-1.5 w-24 h-1 rounded-full bg-[#12253c] overflow-hidden">
                        <div
                          ref={el => (hudRef.current.window = el)}
                          className="h-full bg-brand-600 rounded-full"
                          style={{ width: '0%' }}
                        />
                      </div>
                    </div>
                    <div className="flex items-start gap-4">
                      <Readout label="Frames" align="right"><span ref={el => (hudRef.current.frames = el)}>–/{RTT_FRAMES_PER_TARGET}</span></Readout>
                      <Readout label="Score" align="right"><span ref={el => (hudRef.current.score = el)}>0</span></Readout>
                      <Readout label="Time" align="right"><span ref={el => (hudRef.current.clock = el)}>0:00</span></Readout>
                    </div>
                  </div>

                  <div className="absolute bottom-0 left-0 right-0 flex items-end justify-between gap-3 p-3">
                    <div>
                      <ul className="mb-2 space-y-0.5">
                        {events.map(e => (
                          <li key={e.id} className={`text-[10px] font-mono leading-tight ${e.delta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {e.delta >= 0 ? '+' : ''}{e.delta} · {e.text}
                          </li>
                        ))}
                      </ul>
                      <div className="flex items-end gap-4">
                        <Readout label="Bearing"><span ref={el => (hudRef.current.az = el)}>000</span>°</Readout>
                        <Readout label="Elev"><span ref={el => (hudRef.current.elev = el)}>+00</span>°</Readout>
                        <Readout label="To target"><span ref={el => (hudRef.current.cueDeg = el)}>—</span></Readout>
                      </div>
                    </div>
                    <StickIndicator innerRef={el => (hudRef.current.stick = el)} />
                  </div>

                  {flash && (
                    <div
                      key={flash.id}
                      className={`absolute inset-0 rtt-shutter-flash ${flash.kind === 'hit' ? 'bg-white' : 'bg-red-500'}`}
                    />
                  )}
                </div>
              </div>

              {/* Touch-only shutter — see .rtt-shutter in main.css for why it is
                  hidden on pointer devices. */}
              <button
                type="button"
                onPointerDown={(e) => { e.preventDefault(); inputRef.current?.fireTrigger() }}
                className="rtt-shutter items-center justify-center w-full max-w-xs py-4 rounded-xl bg-brand-600 text-white font-extrabold uppercase tracking-wider text-sm cursor-pointer select-none touch-none"
              >
                Capture Frame
              </button>
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
