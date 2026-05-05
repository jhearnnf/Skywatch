import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import * as THREE from 'three'
import { useAuth } from '../context/AuthContext'
import { recordCbatStart } from '../utils/cbat/recordStart'
import { useGameChrome } from '../context/GameChromeContext'
import SEO from '../components/SEO'
import { getModelUrl, has3DModel } from '../data/aircraftModels'

// Aircraft control model: full local-frame flight controls.
//   - Pitch (climb/dive): rotation around the aircraft's local right axis (model -Z).
//   - Yaw (left/right):   rotation around the aircraft's local up axis (model +Y).
//   - Both are LOCAL — at vertical pitch states, yawing rotates around the aircraft's
//     own up axis (which is no longer world +Y), so the motion direction changes
//     correctly from the pilot's POV (e.g. yaw-right while climbing → aircraft turns
//     toward its right wing).
//   - Each input is a single 90° rotation around one local axis. Quaternion is
//     normalised after each multiplication to prevent floating-point drift.
const DIR_VECS_WORLD = [
  new THREE.Vector3(0, 0, -1),  // DIR 0 → world -Z
  new THREE.Vector3(1, 0, 0),   // DIR 1 → world +X
  new THREE.Vector3(0, 0, 1),   // DIR 2 → world +Z
  new THREE.Vector3(-1, 0, 0),  // DIR 3 → world -X
]

const MODEL_UP    = new THREE.Vector3(0, 1, 0)   // aircraft local up axis (model frame)
const MODEL_RIGHT = new THREE.Vector3(0, 0, -1)  // aircraft local right axis (model frame)
const MODEL_NOSE  = new THREE.Vector3(-1, 0, 0)  // aircraft local nose direction

function applyLocalRot(prevArr, axis, angle) {
  const q = new THREE.Quaternion(prevArr[0], prevArr[1], prevArr[2], prevArr[3])
  const local = new THREE.Quaternion().setFromAxisAngle(axis, angle)
  q.multiply(local)
  q.normalize()
  return [q.x, q.y, q.z, q.w]
}

function getForward(quatArr) {
  const q = new THREE.Quaternion(quatArr[0], quatArr[1], quatArr[2], quatArr[3])
  return MODEL_NOSE.clone().applyQuaternion(q)
}

function forwardToMoveState(forwardVec, prevDir) {
  const x = Math.round(forwardVec.x), y = Math.round(forwardVec.y), z = Math.round(forwardVec.z)
  if (y === 1)  return { moveMode: 1, dir: prevDir }
  if (y === -1) return { moveMode: 3, dir: prevDir }
  if (z === -1) return { moveMode: 0, dir: 0 }
  if (x === 1)  return { moveMode: 0, dir: 1 }
  if (z === 1)  return { moveMode: 0, dir: 2 }
  if (x === -1) return { moveMode: 0, dir: 3 }
  return { moveMode: 0, dir: prevDir }
}

function initialPlaneQuat(dir) {
  // Level forward in `dir` with body upright (up = world +Y).
  const forward = DIR_VECS_WORLD[dir].clone()
  const up = new THREE.Vector3(0, 1, 0)
  const right = new THREE.Vector3().crossVectors(forward, up).normalize()
  const m = new THREE.Matrix4().makeBasis(
    forward.clone().negate(),
    up,
    right.clone().negate(),
  )
  const q = new THREE.Quaternion().setFromRotationMatrix(m)
  return [q.x, q.y, q.z, q.w]
}

const PlaneModel3D    = lazy(() => import('../components/PlaneModel3D'))
const PlaneTurn3DScene = lazy(() => import('../components/PlaneTurn3DScene'))

// ── Constants ────────────────────────────────────────────────────────────────
const GRID           = 10
const LAYERS         = 10  // vertical layers in 3D mode (0 = floor, 9 = ceiling)
const TOTAL_PACKAGES = 5
const MAX_LEVEL      = 5
const BASE_INTERVAL  = 500 // ms per move at level 1
const SPEED_STEP     = 40  // ms faster each level

// Direction vectors: index matches rotation (0=up,1=right,2=down,3=left)
const DIR = [
  { dr: -1, dc: 0 },
  { dr: 0,  dc: 1 },
  { dr: 1,  dc: 0 },
  { dr: 0,  dc: -1 },
]
const DIR_DEG = [0, 90, 180, 270]

function randomSafePos() {
  return {
    r: 2 + Math.floor(Math.random() * (GRID - 4)),
    c: 2 + Math.floor(Math.random() * (GRID - 4)),
  }
}
function randomDir() { return Math.floor(Math.random() * 4) }

function randomPackagePos(planeR, planeC) {
  let pos
  do {
    pos = { r: Math.floor(Math.random() * GRID), c: Math.floor(Math.random() * GRID) }
  } while (pos.r === planeR && pos.c === planeC)
  return pos
}

// ── Aircraft Selection Screen ────────────────────────────────────────────────
function AircraftSelect({ aircraft, onSelect, loading, personalBest, gameMode3D, onToggle3D }) {
  return (
    <div>
      <h2 className="text-lg font-bold text-slate-800 text-center mb-1">Choose Your Aircraft</h2>
      <p className="text-xs text-slate-400 text-center mb-3">Select an aircraft, then navigate through 5 levels.</p>

      {/* 3D Mode toggle */}
      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 max-w-md mx-auto mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-[#ddeaf8]">3D Mode</p>
          <p className="text-xs text-slate-400">Only shows aircraft with 3D models</p>
        </div>
        <button
          onClick={() => onToggle3D(!gameMode3D)}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
            gameMode3D ? 'bg-brand-600' : 'bg-[#1a3a5c]'
          }`}
          aria-label="Toggle 3D mode"
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
              gameMode3D ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Instructions */}
      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-4 max-w-md mx-auto mb-4 text-sm text-[#ddeaf8] space-y-1.5">
        <div className="flex items-start gap-2">
          <span className="text-brand-300 shrink-0">📦</span>
          <span>Collect all care packages on each level to advance</span>
        </div>
        <div className="flex items-start gap-2">
          <span className="text-brand-300 shrink-0">🎮</span>
          {gameMode3D
            ? <span><span className="font-mono text-slate-300">←→</span> to turn &middot; <span className="font-mono text-slate-300">↓</span> climb &middot; <span className="font-mono text-slate-300">↑</span> dive (stick convention). Stay within the arena!</span>
            : <span>Arrow keys (desktop) or tap buttons (mobile) to rotate</span>
          }
        </div>
        <div className="flex items-start gap-2">
          <span className="text-brand-300 shrink-0">🏆</span>
          <span>Fewer rotations = better score. Time is also tracked.</span>
        </div>
        <div className="flex items-start gap-2">
          <span className="text-brand-300 shrink-0">⚡</span>
          <span>Speed increases each level — 5 levels total</span>
        </div>
      </div>

      {personalBest && (
        <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 max-w-md mx-auto mb-2 text-center">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Personal Best</p>
          <p className="text-lg font-mono font-bold text-brand-300">
            {personalBest.bestScore} rotations <span className="text-slate-500 mx-1">·</span> {personalBest.bestTime.toFixed(1)}s
          </p>
          <p className="text-[10px] text-slate-500 mt-0.5">{personalBest.attempts} attempt{personalBest.attempts !== 1 ? 's' : ''}</p>
        </div>
      )}

      <div className="text-center mb-4">
        <Link to="/cbat/plane-turn/leaderboard" className="text-xs text-brand-300 hover:text-brand-200 transition-colors">
          View Leaderboard →
        </Link>
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center py-10">
          <div className="w-8 h-8 border-2 border-brand-400 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-sm text-slate-400">Loading aircraft...</p>
        </div>
      )}

      {!loading && !aircraft.length && (
        <div className="text-center py-10">
          <p className="text-4xl mb-3">✈️</p>
          <p className="font-bold text-slate-700 mb-1">
            {gameMode3D ? 'No 3D aircraft available' : 'No aircraft available'}
          </p>
          <p className="text-sm text-slate-400">
            {gameMode3D
              ? 'Switch 3D mode off or add .glb files to public/models/.'
              : 'Aircraft cutout images need to be generated first.'
            }
          </p>
        </div>
      )}

      {!loading && aircraft.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 max-w-md mx-auto">
          {aircraft.map((a, i) => (
            <motion.button
              key={a.briefId}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.04 }}
              onClick={() => onSelect(a)}
              className="relative flex flex-col items-center gap-1.5 p-3 rounded-xl border border-[#1a3a5c] bg-[#0a1628] hover:border-[#5baaff] hover:bg-[#0f2240] transition-all group cursor-pointer"
            >
              {has3DModel(a.briefId, a.title) && (
                <span className="absolute top-1 right-1 text-[8px] font-bold px-1.5 py-0.5 rounded bg-brand-600/80 text-white leading-none">
                  3D
                </span>
              )}
              <img
                src={a.cutoutUrl}
                alt={a.title}
                className="w-14 h-14 object-contain group-hover:scale-110 transition-transform drop-shadow-[0_0_6px_rgba(91,170,255,0.4)]"
              />
              <span className="text-[10px] text-slate-400 group-hover:text-brand-300 text-center leading-tight truncate w-full">
                {a.title}
              </span>
            </motion.button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Game Over Overlay ────────────────────────────────────────────────────────
function GameOverOverlay({ won, score, level, maxLevel, onRestart, onMenu }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 rounded-xl"
    >
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.15 }}
        className="text-center p-6"
      >
        <p className="text-4xl mb-2">{won ? '🎖️' : '💥'}</p>
        <p className="text-xl font-extrabold text-white mb-1">
          {won ? 'Mission Complete' : 'Crashed'}
        </p>
        {won ? (
          <div className="text-sm text-[#ddeaf8] mb-4">
            <p>Level {level} cleared</p>
            <p className="font-mono text-brand-300 text-lg mt-1">
              {score.rotations} rotations &middot; {score.time}s
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-400 mb-4">Your aircraft hit the boundary.</p>
        )}
        <div className="flex gap-3 justify-center">
          <button
            onClick={onRestart}
            className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-lg transition-colors"
          >
            {won ? (level >= maxLevel ? 'View Score' : 'Next Level') : 'Retry'}
          </button>
          <button
            onClick={onMenu}
            className="px-4 py-2 bg-[#1a3a5c] hover:bg-[#254a6e] text-white text-sm font-bold rounded-lg transition-colors"
          >
            Change Aircraft
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── HUD ──────────────────────────────────────────────────────────────────────
function HUD({ collected, rotations, elapsed, level }) {
  return (
    <div className="flex items-center justify-between text-xs font-mono mb-2 px-1">
      <span className="text-slate-400">LVL <span className="text-brand-300">{level}</span>/{MAX_LEVEL}</span>
      <span className="text-slate-400">
        📦 <span className="text-brand-300">{collected}</span>/{TOTAL_PACKAGES}
      </span>
      <span className="text-slate-400">
        ↻ <span className="text-brand-300">{rotations}</span>
      </span>
      <span className="text-slate-400">
        ⏱ <span className="text-brand-300">{elapsed.toFixed(1)}s</span>
      </span>
    </div>
  )
}

// ── D-pad button ─────────────────────────────────────────────────────────────
function DpadBtn({ label, onPress, ariaLabel }) {
  return (
    <button
      onPointerDown={onPress}
      className="rounded-xl bg-[#0a1628] border-2 border-[#1a3a5c] active:border-brand-400 active:bg-[#0f2240] transition-colors flex items-center justify-center text-3xl text-slate-400 active:text-brand-300 select-none"
      style={{ width: 'calc(min(100vw - 2rem, 28rem) * 0.22)', height: 'calc(min(100vw - 2rem, 28rem) * 0.22)' }}
      aria-label={ariaLabel}
    >
      {label}
    </button>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function CbatPlaneTurn() {
  const { user, apiFetch, API } = useAuth()

  // Aircraft selection
  const [aircraft, setAircraft]         = useState([])
  const [loadingAircraft, setLoadingAircraft] = useState(true)
  const [selected, setSelected]         = useState(null)

  // Mode toggle
  const [gameMode3D, setGameMode3D]     = useState(false)
  const gameMode3DRef                   = useRef(false)
  useEffect(() => { gameMode3DRef.current = gameMode3D }, [gameMode3D])

  // Aircraft filtered for the select screen
  const displayAircraft = gameMode3D
    ? aircraft.filter(a => has3DModel(a.briefId, a.title))
    : aircraft

  // Game state
  const [phase, setPhase]               = useState('select')
  const { enterImmersive, exitImmersive } = useGameChrome()
  useEffect(() => {
    if (phase === 'playing' || phase === 'over') enterImmersive()
    else exitImmersive()
    return exitImmersive
  }, [phase, enterImmersive, exitImmersive])

  const [plane, setPlane]               = useState({ r: 5, c: 5, dir: 0, angle: 0 })
  const [pkg, setPkg]                   = useState({ r: 0, c: 0 })
  const [collected, setCollected]       = useState(0)
  const [rotations, setRotations]       = useState(0)
  const [level, setLevel]               = useState(1)
  const [won, setWon]                   = useState(false)
  const [elapsed, setElapsed]           = useState(0)
  const [use3D, setUse3D]               = useState(true)
  const [model3DReady, setModel3DReady] = useState(false)

  // 3D-only state
  const [layer, setLayer]               = useState(2)   // vertical position (0–LAYERS-1)
  // Aircraft visual orientation as a quaternion [x, y, z, w]. Updated by local-frame
  // rotations on each arrow press so every input is exactly one 90° rotation around
  // one world axis (whichever the aircraft's local up/right currently points along).
  const [planeQuat, setPlaneQuat]       = useState(() => initialPlaneQuat(0))
  // Visual pitch (kept for legacy interface; visual now uses planeQuat).
  const [pitch, setPitch]               = useState(0)
  // Movement direction (0 = forward, 1 = up, 2 = backward, 3 = down). Decoupled from visual:
  // climb/dive sync moveMode to pitch%4, but yaw in a vertical state preserves visual pitch
  // and just snaps moveMode to 0 — so the aircraft stays "side-on" climbing/diving while it
  // changes horizontal direction.
  const [moveMode, setMoveMode]         = useState(0)
  const [pkgLayer, setPkgLayer]         = useState(2)

  // Totals across all levels
  const [totalRotations, setTotalRotations] = useState(0)
  const [totalTime, setTotalTime]           = useState(0)

  const [personalBest, setPersonalBest] = useState(null)
  const [scoreSaved, setScoreSaved]     = useState(false)

  const gameRef  = useRef({})
  const timerRef = useRef(null)
  const moveRef  = useRef(null)

  // Fetch aircraft on mount
  useEffect(() => {
    if (!user) return
    apiFetch(`${API}/api/games/cbat/aircraft-cutouts`)
      .then(res => res.json())
      .then(d => setAircraft(d.data || []))
      .catch(() => {})
      .finally(() => setLoadingAircraft(false))
  }, [user])

  // Fetch personal best
  useEffect(() => {
    if (!user) return
    apiFetch(`${API}/api/games/cbat/plane-turn/personal-best`)
      .then(r => r.json())
      .then(d => { if (d.data) setPersonalBest(d.data) })
      .catch(() => {})
  }, [user])

  // Submit score
  const submitScore = useCallback((finalRotations, finalTime, aircraftTitle) => {
    setScoreSaved(false)
    apiFetch(`${API}/api/games/cbat/plane-turn/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        totalRotations: finalRotations,
        totalTime: finalTime,
        levelsCompleted: MAX_LEVEL,
        aircraftUsed: aircraftTitle,
      }),
    })
      .then(r => r.json())
      .then(() => {
        setScoreSaved(true)
        apiFetch(`${API}/api/games/cbat/plane-turn/personal-best`)
          .then(r => r.json())
          .then(d => { if (d.data) setPersonalBest(d.data) })
          .catch(() => {})
      })
      .catch(() => {})
  }, [apiFetch, API])

  // Keep gameRef in sync (includes 3D state)
  useEffect(() => {
    gameRef.current = { plane, pkg, collected, rotations, level, won, phase, layer, pitch, moveMode, pkgLayer, planeQuat }
  })

  // Reset 3D-ready flag when aircraft changes
  useEffect(() => {
    setModel3DReady(false)
  }, [selected?.briefId])

  const handle3DReady = useCallback(() => setModel3DReady(true), [])

  const startGame = useCallback((lvl = 1) => {
    const start = randomSafePos()
    const dir   = randomDir()
    const p     = randomPackagePos(start.r, start.c)
    setLayer(gameMode3DRef.current ? Math.floor(LAYERS / 2) : 0)
    setPkgLayer(gameMode3DRef.current ? Math.floor(Math.random() * LAYERS) : 0)
    setPitch(0)
    setMoveMode(0)
    setPlaneQuat(initialPlaneQuat(dir))
    setPlane({ r: start.r, c: start.c, dir, angle: DIR_DEG[dir] })
    setPkg(p)
    setCollected(0)
    setRotations(0)
    setLevel(lvl)
    setWon(false)
    setElapsed(0)
    setPhase('playing')
  }, [])

  // Timer
  useEffect(() => {
    if (phase !== 'playing') { clearInterval(timerRef.current); return }
    const t0 = Date.now() - elapsed * 1000
    timerRef.current = setInterval(() => {
      setElapsed((Date.now() - t0) / 1000)
    }, 100)
    return () => clearInterval(timerRef.current)
  }, [phase])

  // Movement loop
  useEffect(() => {
    if (phase !== 'playing') { clearInterval(moveRef.current); return }

    const interval = Math.max(150, BASE_INTERVAL - (level - 1) * SPEED_STEP)

    moveRef.current = setInterval(() => {
      setPlane(prev => {
        const g    = gameRef.current
        const is3D = gameMode3DRef.current

        // Movement direction (0 = forward | 1 = up | 2 = backward | 3 = down)
        const pm = is3D ? (g.moveMode ?? 0) : 0
        let nr, nc, nl
        if (pm === 1) {
          nr = prev.r; nc = prev.c; nl = g.layer + 1
        } else if (pm === 3) {
          nr = prev.r; nc = prev.c; nl = g.layer - 1
        } else {
          const sign = pm === 2 ? -1 : 1
          const { dr, dc } = DIR[prev.dir]
          nr = prev.r + dr * sign
          nc = prev.c + dc * sign
          nl = g.layer
        }

        const hitWall     = nr < 0 || nr >= GRID || nc < 0 || nc >= GRID
        const hitVertWall = is3D && (nl < 0 || nl >= LAYERS)

        if (hitWall || hitVertWall) {
          clearInterval(moveRef.current)
          clearInterval(timerRef.current)
          setPhase('over')
          setWon(false)
          return prev
        }

        if (is3D) setLayer(nl)

        const pkgMatch = is3D
          ? (nr === g.pkg.r && nc === g.pkg.c && nl === g.pkgLayer)
          : (nr === g.pkg.r && nc === g.pkg.c)

        if (pkgMatch) {
          const next = g.collected + 1
          setCollected(next)
          if (next >= TOTAL_PACKAGES) {
            clearInterval(moveRef.current)
            clearInterval(timerRef.current)
            setPhase('over')
            setWon(true)
          } else {
            setPkg(randomPackagePos(nr, nc))
            if (is3D) setPkgLayer(Math.floor(Math.random() * LAYERS))
          }
        }

        return { ...prev, r: nr, c: nc }
      })
    }, interval)

    return () => clearInterval(moveRef.current)
  }, [phase, level])

  // Keyboard controls
  useEffect(() => {
    if (phase !== 'playing') return

    function handleKey(e) {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        if (gameMode3DRef.current) {
          // Yaw left around LOCAL up axis (top of cockpit).
          const newQuat = applyLocalRot(gameRef.current.planeQuat, MODEL_UP, Math.PI / 2)
          setPlaneQuat(newQuat)
          const fwd = getForward(newQuat)
          const { moveMode: newMm, dir: newDir } = forwardToMoveState(fwd, gameRef.current.plane.dir)
          setMoveMode(newMm)
          setPlane(prev => ({ ...prev, dir: newDir, angle: prev.angle - 90 }))
        } else {
          setPlane(prev => ({ ...prev, dir: (prev.dir + 3) % 4, angle: prev.angle - 90 }))
        }
        setRotations(r => r + 1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        if (gameMode3DRef.current) {
          // Yaw right around LOCAL up axis.
          const newQuat = applyLocalRot(gameRef.current.planeQuat, MODEL_UP, -Math.PI / 2)
          setPlaneQuat(newQuat)
          const fwd = getForward(newQuat)
          const { moveMode: newMm, dir: newDir } = forwardToMoveState(fwd, gameRef.current.plane.dir)
          setMoveMode(newMm)
          setPlane(prev => ({ ...prev, dir: newDir, angle: prev.angle + 90 }))
        } else {
          setPlane(prev => ({ ...prev, dir: (prev.dir + 1) % 4, angle: prev.angle + 90 }))
        }
        setRotations(r => r + 1)
      } else if (gameMode3DRef.current && e.key === 'ArrowUp') {
        // Stick: push forward = dive. Pitch around local right axis by -π/2.
        e.preventDefault()
        const newQuat = applyLocalRot(gameRef.current.planeQuat, MODEL_RIGHT, -Math.PI / 2)
        setPlaneQuat(newQuat)
        const newPitch = (gameRef.current.pitch ?? 0) - 1
        setPitch(newPitch)
        const fwd = getForward(newQuat)
        const { moveMode: newMm, dir: newDir } = forwardToMoveState(fwd, gameRef.current.plane.dir)
        setMoveMode(newMm)
        if (newDir !== gameRef.current.plane.dir) setPlane(prev => ({ ...prev, dir: newDir }))
        setRotations(r => r + 1)
      } else if (gameMode3DRef.current && e.key === 'ArrowDown') {
        // Stick: pull back = climb. Pitch around local right axis by +π/2.
        e.preventDefault()
        const newQuat = applyLocalRot(gameRef.current.planeQuat, MODEL_RIGHT, Math.PI / 2)
        setPlaneQuat(newQuat)
        const newPitch = (gameRef.current.pitch ?? 0) + 1
        setPitch(newPitch)
        const fwd = getForward(newQuat)
        const { moveMode: newMm, dir: newDir } = forwardToMoveState(fwd, gameRef.current.plane.dir)
        setMoveMode(newMm)
        if (newDir !== gameRef.current.plane.dir) setPlane(prev => ({ ...prev, dir: newDir }))
        setRotations(r => r + 1)
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [phase])

  // Handlers
  const handleSelect = (a) => {
    recordCbatStart('plane-turn', apiFetch, API)
    const modelUrl = getModelUrl(a.briefId, a.title)
    setSelected({ ...a, modelUrl })
    setUse3D(true)
    setTotalRotations(0)
    setTotalTime(0)
    startGame(1)
  }

  const handleRestart = () => {
    if (won) {
      const newTotalRot  = totalRotations + rotations
      const newTotalTime = totalTime + elapsed
      setTotalRotations(newTotalRot)
      setTotalTime(newTotalTime)

      if (level >= MAX_LEVEL) {
        setPhase('finished')
        submitScore(newTotalRot, newTotalTime, selected?.title)
        return
      }
      startGame(level + 1)
    } else {
      startGame(level)
    }
  }

  const handleMenu = () => {
    setSelected(null)
    setPhase('select')
  }

  const cycleAircraft = (dir) => {
    if (!aircraft.length || !selected) return
    const list = gameMode3D
      ? aircraft.filter(a => has3DModel(a.briefId, a.title))
      : aircraft
    if (!list.length) return
    const idx  = list.findIndex(a => a.briefId === selected.briefId)
    const next = list[(idx + dir + list.length) % list.length]
    const modelUrl = getModelUrl(next.briefId, next.title)
    setSelected({ ...next, modelUrl })
    setUse3D(true)
  }

  const handlePlayAgain = () => {
    recordCbatStart('plane-turn', apiFetch, API)
    setTotalRotations(0)
    setTotalTime(0)
    setScoreSaved(false)
    startGame(1)
  }

  const handleRotate = (direction) => {
    if (phase !== 'playing') return
    if (direction === 'up' || direction === 'down') {
      // Stick: ↑ = dive (pitch-1), ↓ = climb (pitch+1). Local rotation around right.
      if (gameMode3DRef.current) {
        const angle = direction === 'up' ? -Math.PI / 2 : Math.PI / 2
        const newQuat = applyLocalRot(gameRef.current.planeQuat, MODEL_RIGHT, angle)
        setPlaneQuat(newQuat)
        const newPitch = (gameRef.current.pitch ?? 0) + (direction === 'up' ? -1 : 1)
        setPitch(newPitch)
        const fwd = getForward(newQuat)
        const { moveMode: newMm, dir: newDir } = forwardToMoveState(fwd, gameRef.current.plane.dir)
        setMoveMode(newMm)
        if (newDir !== gameRef.current.plane.dir) setPlane(prev => ({ ...prev, dir: newDir }))
      } else {
        const cp = gameRef.current.pitch ?? 0
        const np = direction === 'up' ? cp - 1 : cp + 1
        setPitch(np)
        setMoveMode(((np % 4) + 4) % 4)
      }
      setRotations(r => r + 1)
      return
    }
    if (gameMode3DRef.current) {
      // Yaw around LOCAL up axis (top of cockpit).
      const angle = direction === 'left' ? Math.PI / 2 : -Math.PI / 2
      const newQuat = applyLocalRot(gameRef.current.planeQuat, MODEL_UP, angle)
      setPlaneQuat(newQuat)
      const fwd = getForward(newQuat)
      const { moveMode: newMm, dir: newDir } = forwardToMoveState(fwd, gameRef.current.plane.dir)
      setMoveMode(newMm)
      const angleStep = direction === 'left' ? -90 : 90
      setPlane(prev => ({ ...prev, dir: newDir, angle: prev.angle + angleStep }))
    } else {
      const isLeft = direction === 'left'
      setPlane(prev => ({
        ...prev,
        dir:   isLeft ? (prev.dir + 3) % 4 : (prev.dir + 1) % 4,
        angle: prev.angle + (isLeft ? -90 : 90),
      }))
    }
    setRotations(r => r + 1)
  }

  // Auto-advance to finished screen when final level is won
  useEffect(() => {
    if (phase === 'over' && won && level >= MAX_LEVEL) {
      handleRestart()
    }
  }, [phase, won, level])

  const cellPx = 'calc((min(100vw - 2rem, 28rem)) / 10)'

  return (
    <div className="cbat-plane-turn-page">
      <SEO title="Plane Turn — CBAT" description="Navigate your aircraft to collect care packages." />

      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        {phase === 'select'
          ? <Link to="/cbat" className="text-slate-500 hover:text-brand-400 transition-colors text-sm">&larr; CBAT</Link>
          : <button onClick={handleMenu} className="text-slate-500 hover:text-brand-400 transition-colors text-sm bg-transparent border-0 p-0 cursor-pointer">&larr; Instructions</button>
        }
        <h1 className="text-sm font-extrabold text-slate-900">Plane Turn</h1>
      </div>

      {/* Not logged in */}
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

      {/* Logged in — game area */}
      {user && (
        <div className="flex flex-col items-center">

          {/* Aircraft selection */}
          {phase === 'select' && (
            <div className="w-full max-w-md bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-5">
              <AircraftSelect
                aircraft={displayAircraft}
                onSelect={handleSelect}
                loading={loadingAircraft}
                personalBest={personalBest}
                gameMode3D={gameMode3D}
                onToggle3D={setGameMode3D}
              />
            </div>
          )}

          {/* Final score screen */}
          {phase === 'finished' && selected && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="w-full max-w-md bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-8 text-center"
            >
              <p className="text-5xl mb-3">🎖️</p>
              <p className="text-2xl font-extrabold text-white mb-1">All Levels Complete</p>
              <p className="text-sm text-slate-400 mb-6">You cleared all {MAX_LEVEL} levels.</p>

              <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-5 mb-6">
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">Final Score</p>
                <div className="flex justify-center gap-8">
                  <div>
                    <p className="text-3xl font-mono font-bold text-brand-300">{totalRotations}</p>
                    <p className="text-xs text-slate-500 mt-1">rotations</p>
                  </div>
                  <div className="w-px bg-[#1a3a5c]" />
                  <div>
                    <p className="text-3xl font-mono font-bold text-brand-300">{totalTime.toFixed(1)}s</p>
                    <p className="text-xs text-slate-500 mt-1">total time</p>
                  </div>
                </div>
              </div>

              {scoreSaved && (
                <p className="text-xs text-green-400 mb-4">✓ Score saved</p>
              )}

              <div className="flex flex-wrap gap-3 justify-center">
                <button
                  onClick={handlePlayAgain}
                  className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-lg transition-colors"
                >
                  Play Again
                </button>
                <Link
                  to="/cbat/plane-turn/leaderboard"
                  className="px-5 py-2.5 bg-[#1a3a5c] hover:bg-[#254a6e] text-[#ddeaf8] text-sm font-bold rounded-lg transition-colors no-underline"
                >
                  🏆 Leaderboard
                </Link>
                <button
                  onClick={handleMenu}
                  className="px-5 py-2.5 bg-[#1a3a5c] hover:bg-[#254a6e] text-[#ddeaf8] text-sm font-bold rounded-lg transition-colors"
                >
                  Change Aircraft
                </button>
              </div>
            </motion.div>
          )}

          {/* Game board */}
          {(phase === 'playing' || phase === 'over') && selected && (
            <div className="w-full max-w-md">
              <HUD collected={collected} rotations={rotations} elapsed={elapsed} level={level} />

              {/* ── 3D Game ── */}
              {gameMode3D ? (
                <div
                  className="relative bg-[#060e1a] border-2 border-[#1a3a5c] rounded-xl overflow-hidden shadow-[0_0_30px_rgba(91,170,255,0.08)]"
                  style={{ width: '100%', aspectRatio: '1' }}
                >
                  {/* Aircraft name */}
                  <div className="absolute top-1 left-1 z-30 flex items-center gap-1">
                    <button onClick={() => cycleAircraft(-1)} className="text-[10px] text-slate-500 hover:text-brand-300 transition-colors px-0.5 cursor-pointer">&larr;</button>
                    <span className="text-[10px] text-slate-500 font-mono">{selected.title}</span>
                    <button onClick={() => cycleAircraft(1)} className="text-[10px] text-slate-500 hover:text-brand-300 transition-colors px-0.5 cursor-pointer">&rarr;</button>
                  </div>

                  <Suspense fallback={null}>
                    <PlaneTurn3DScene
                      plane={{ ...plane, layer, pitch, moveMode, quat: planeQuat }}
                      pkg={{ ...pkg, layer: pkgLayer }}
                      modelUrl={selected.modelUrl}
                      onError={() => {}}
                      onReady={handle3DReady}
                    />
                  </Suspense>

                  <AnimatePresence>
                    {phase === 'over' && (
                      <GameOverOverlay
                        won={won}
                        score={{ rotations, time: elapsed.toFixed(1) }}
                        level={level}
                        maxLevel={MAX_LEVEL}
                        onRestart={handleRestart}
                        onMenu={handleMenu}
                      />
                    )}
                  </AnimatePresence>
                </div>
              ) : (
                /* ── 2D Game ── */
                <div className="relative bg-[#060e1a] border-2 border-[#1a3a5c] rounded-xl overflow-visible shadow-[0_0_30px_rgba(91,170,255,0.08)]">
                  {/* Aircraft name with cycle arrows */}
                  <div className="absolute top-1 left-1 z-30 flex items-center gap-1">
                    <button onClick={() => cycleAircraft(-1)} className="text-[10px] text-slate-500 hover:text-brand-300 transition-colors px-0.5 cursor-pointer">&larr;</button>
                    <span className="text-[10px] text-slate-500 font-mono">{selected.title}</span>
                    <button onClick={() => cycleAircraft(1)} className="text-[10px] text-slate-500 hover:text-brand-300 transition-colors px-0.5 cursor-pointer">&rarr;</button>
                  </div>

                  {/* Radar sweep */}
                  <div className="absolute inset-0 pointer-events-none z-10 opacity-[0.03]"
                    style={{
                      background: 'conic-gradient(from 0deg, transparent 0deg, rgba(91,170,255,0.5) 30deg, transparent 60deg)',
                      animation: 'radar-sweep 4s linear infinite',
                    }}
                  />

                  {/* Grid */}
                  <div
                    className="grid relative z-20"
                    style={{ gridTemplateColumns: `repeat(${GRID}, 1fr)`, aspectRatio: '1' }}
                  >
                    {Array.from({ length: GRID * GRID }, (_, i) => {
                      const r = Math.floor(i / GRID)
                      const c = i % GRID
                      const isPlane = r === plane.r && c === plane.c
                      const isPkg   = r === pkg.r   && c === pkg.c

                      return (
                        <div
                          key={i}
                          className="relative border border-[#0f2440]/60 overflow-visible"
                          style={{ aspectRatio: '1' }}
                        >
                          {isPkg && (
                            <motion.div
                              key={`pkg-${pkg.r}-${pkg.c}`}
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              className="absolute inset-0 flex items-center justify-center z-20"
                            >
                              <span className="text-base drop-shadow-[0_0_8px_rgba(255,200,50,0.6)]">📦</span>
                            </motion.div>
                          )}

                          {isPlane && (
                            <div
                              className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none"
                              style={{
                                opacity: use3D && selected.modelUrl && model3DReady ? 0 : 1,
                                transition: 'opacity 0.4s ease-out',
                              }}
                            >
                              <img
                                src={selected.cutoutUrl}
                                alt={selected.title}
                                className="w-full h-full object-contain drop-shadow-[0_0_6px_rgba(91,170,255,0.6)]"
                                style={{
                                  transform: `scale(1.5) rotate(${plane.angle}deg)`,
                                  transition: 'transform 0.15s ease-out',
                                }}
                              />
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {/* 3D plane overlay */}
                  {use3D && selected.modelUrl && (
                    <div
                      className="absolute z-30 pointer-events-none"
                      style={{
                        width: `${100 / GRID * 3}%`,
                        height: `${100 / GRID * 3}%`,
                        left: `${(plane.c / GRID) * 100 - (100 / GRID)}%`,
                        top:  `${(plane.r / GRID) * 100 - (100 / GRID)}%`,
                        opacity: model3DReady ? 1 : 0,
                        transition: 'left 0.15s ease-out, top 0.15s ease-out, opacity 0.45s ease-out',
                      }}
                    >
                      <Suspense fallback={null}>
                        <PlaneModel3D
                          modelUrl={selected.modelUrl}
                          angle={plane.angle}
                          onError={() => setUse3D(false)}
                          onReady={handle3DReady}
                        />
                      </Suspense>
                    </div>
                  )}

                  {/* Targeting-lock ring burst */}
                  {use3D && selected.modelUrl && model3DReady && (
                    <div
                      className="absolute z-40 pointer-events-none"
                      style={{
                        width: `${100 / GRID * 3}%`,
                        height: `${100 / GRID * 3}%`,
                        left: `${(plane.c / GRID) * 100 - (100 / GRID)}%`,
                        top:  `${(plane.r / GRID) * 100 - (100 / GRID)}%`,
                        transition: 'left 0.15s ease-out, top 0.15s ease-out',
                      }}
                    >
                      <motion.div
                        initial={{ scale: 0.25, opacity: 0.9 }}
                        animate={{ scale: 1.8, opacity: 0 }}
                        transition={{ duration: 0.7, ease: 'easeOut' }}
                        className="absolute inset-0 flex items-center justify-center"
                      >
                        <div
                          className="rounded-full border-2 border-brand-400"
                          style={{
                            width: '55%', height: '55%',
                            boxShadow: '0 0 24px rgba(91,170,255,0.8), inset 0 0 12px rgba(91,170,255,0.4)',
                          }}
                        />
                      </motion.div>
                      <motion.div
                        initial={{ scale: 0.35, opacity: 0.6 }}
                        animate={{ scale: 2.2, opacity: 0 }}
                        transition={{ duration: 0.9, ease: 'easeOut', delay: 0.12 }}
                        className="absolute inset-0 flex items-center justify-center"
                      >
                        <div className="rounded-full border border-brand-300" style={{ width: '55%', height: '55%' }} />
                      </motion.div>
                    </div>
                  )}

                  {/* Direction chevrons */}
                  {(() => {
                    const { dr, dc } = DIR[plane.dir]
                    const nextR = plane.r + dr
                    const nextC = plane.c + dc
                    if (nextR < 0 || nextR >= GRID || nextC < 0 || nextC >= GRID) return null
                    const rotation = DIR_DEG[plane.dir]
                    return (
                      <div
                        className="absolute z-25 pointer-events-none"
                        style={{
                          width: `${100 / GRID}%`,
                          height: `${100 / GRID}%`,
                          left: `${(nextC / GRID) * 100}%`,
                          top:  `${(nextR / GRID) * 100}%`,
                          transition: 'left 0.15s ease-out, top 0.15s ease-out',
                        }}
                      >
                        <div className="w-full h-full flex items-center justify-center"
                          style={{ transform: `rotate(${rotation}deg)` }}
                        >
                          <div className="flex flex-col items-center gap-[1px]">
                            {[0.2, 0.3, 0.45].map((opacity, i) => (
                              <div key={i} style={{
                                width: 0, height: 0,
                                borderLeft: '5px solid transparent',
                                borderRight: '5px solid transparent',
                                borderBottom: `6px solid rgba(74,222,128,${opacity})`,
                              }} />
                            ))}
                          </div>
                        </div>
                      </div>
                    )
                  })()}

                  {/* Grid crosshair lines */}
                  <div className="absolute inset-0 pointer-events-none z-10">
                    <div className="absolute top-1/2 left-0 right-0 h-px bg-[#1a3a5c]/40" />
                    <div className="absolute left-1/2 top-0 bottom-0 w-px bg-[#1a3a5c]/40" />
                  </div>

                  {/* Game over overlay */}
                  <AnimatePresence>
                    {phase === 'over' && (
                      <GameOverOverlay
                        won={won}
                        score={{ rotations, time: elapsed.toFixed(1) }}
                        level={level}
                        maxLevel={MAX_LEVEL}
                        onRestart={handleRestart}
                        onMenu={handleMenu}
                      />
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* ── Mobile controls ── */}
              {gameMode3D ? (
                <div className="flex flex-col items-center gap-2 mt-4">
                  <DpadBtn label="↑" onPress={() => handleRotate('up')}   ariaLabel="Climb" />
                  <div className="flex gap-4">
                    <DpadBtn label="←" onPress={() => handleRotate('left')}  ariaLabel="Rotate left" />
                    <DpadBtn label="→" onPress={() => handleRotate('right')} ariaLabel="Rotate right" />
                  </div>
                  <DpadBtn label="↓" onPress={() => handleRotate('down')} ariaLabel="Descend" />
                </div>
              ) : (
                <div className="flex gap-4 justify-center mt-4">
                  <button
                    onPointerDown={() => handleRotate('left')}
                    className="rounded-xl bg-[#0a1628] border-2 border-[#1a3a5c] active:border-brand-400 active:bg-[#0f2240] transition-colors flex items-center justify-center text-5xl text-slate-400 active:text-brand-300 select-none"
                    style={{ width: 'calc(min(100vw - 2rem, 28rem) * 0.45)', height: 'calc(min(100vw - 2rem, 28rem) * 0.35)' }}
                    aria-label="Rotate left"
                  >
                    &#8592;
                  </button>
                  <button
                    onPointerDown={() => handleRotate('right')}
                    className="rounded-xl bg-[#0a1628] border-2 border-[#1a3a5c] active:border-brand-400 active:bg-[#0f2240] transition-colors flex items-center justify-center text-5xl text-slate-400 active:text-brand-300 select-none"
                    style={{ width: 'calc(min(100vw - 2rem, 28rem) * 0.45)', height: 'calc(min(100vw - 2rem, 28rem) * 0.35)' }}
                    aria-label="Rotate right"
                  >
                    &#8594;
                  </button>
                </div>
              )}

              {/* Instructions hint */}
              <p className="text-center text-[10px] text-slate-500 mt-3">
                {gameMode3D
                  ? <>Use <span className="font-mono text-slate-400">←→</span> to turn &middot; <span className="font-mono text-slate-400">↓</span> climb &middot; <span className="font-mono text-slate-400">↑</span> dive (stick)</>
                  : <>Use <span className="font-mono text-slate-400">&larr;</span> <span className="font-mono text-slate-400">&rarr;</span> arrow keys or tap the buttons to rotate</>
                }
              </p>
            </div>
          )}
        </div>
      )}

      {/* Radar sweep keyframe */}
      <style>{`
        @keyframes radar-sweep {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
