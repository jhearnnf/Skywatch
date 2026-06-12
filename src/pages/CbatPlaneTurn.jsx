import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import * as THREE from 'three'
import { useAuth } from '../context/AuthContext'
import { submitCbatResult } from '../lib/cbatOutbox'
import { getAircraftRoster } from '../lib/offlineRoster'
import { useAppSettings } from '../context/AppSettingsContext'
import { useCbatTracking } from '../utils/cbat/useCbatTracking'
import { useGameChrome } from '../context/GameChromeContext'
import SEO from '../components/SEO'
import SkywatchLogoIntro from '../components/SkywatchLogoIntro'
import { getModelUrl, has3DModel } from '../data/aircraftModels'
import { useTraceMode } from '../hooks/useTraceMode'
import TraceModeSelector from '../components/TraceModeSelector'

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

// ── Trace 1 constants ────────────────────────────────────────────────────────
// Recall test: autopilot performs one of four turns; player presses the matching
// arrow within the gap before the next turn. Speed ramps linearly across rounds;
// round 5 lands at the old level-3 pace (930ms) — challenging but readable.
const TRACE1_ROUNDS          = 5
const TRACE1_TURNS_PER_ROUND = 8
const TRACE1_SPEED_TABLE     = [1870, 1635, 1400, 1165, 930] // ms between turns
const TRACE1_TOTAL_TURNS     = TRACE1_ROUNDS * TRACE1_TURNS_PER_ROUND
const TRACE1_AIRCRAFT_SLUG   = 'hawk t2'
// Keep the plane at least two cells away from each wall at every projected
// turn moment. With slerp lag the plane can drift up to ~0.4 cells past the
// projection in the old direction, so margin=2 leaves a full cell of buffer
// between the worst-case excursion and the scene's soft-clamp at world ±3.5.
// The schedule + clamp together guarantee the visible aircraft never freezes
// against the wireframe wall.
const TRACE1_WALL_MARGIN     = 2

// Each turn is a local-frame quaternion rotation.
const TRACE1_TURN_DEFS = {
  yawL:   { axis: MODEL_UP,    angle:  Math.PI / 2, key: 'ArrowLeft',  label: '←' },
  yawR:   { axis: MODEL_UP,    angle: -Math.PI / 2, key: 'ArrowRight', label: '→' },
  pitchD: { axis: MODEL_RIGHT, angle: -Math.PI / 2, key: 'ArrowUp',    label: '↑' }, // stick: forward = dive
  pitchU: { axis: MODEL_RIGHT, angle:  Math.PI / 2, key: 'ArrowDown',  label: '↓' }, // stick: back = climb
}
const TRACE1_TURN_KEYS = ['yawL', 'yawR', 'pitchD', 'pitchU']

function trace1KeyToTurn(key) {
  switch (key) {
    case 'ArrowLeft':  return 'yawL'
    case 'ArrowRight': return 'yawR'
    case 'ArrowUp':    return 'pitchD'
    case 'ArrowDown':  return 'pitchU'
    default: return null
  }
}

// Simulate `steps` forward cells along `quat`'s heading. Returns the final
// grid position, or null if any step would cross the margin-tightened bound.
function simulateForwardSteps(quat, startPos, steps, margin = TRACE1_WALL_MARGIN) {
  const fwd = getForward(quat)
  const x = Math.round(fwd.x), y = Math.round(fwd.y), z = Math.round(fwd.z)
  const out = { r: startPos.r, c: startPos.c, layer: startPos.layer }
  const min = margin
  const maxR = GRID  - 1 - margin
  const maxC = GRID  - 1 - margin
  const maxL = LAYERS - 1 - margin
  for (let i = 0; i < steps; i++) {
    out.layer += y
    out.c     += x
    out.r     += z
    if (out.r < min || out.r > maxR || out.c < min || out.c > maxC || out.layer < min || out.layer > maxL) return null
  }
  return out
}

// Build an 8-turn schedule that keeps the plane inside [margin, GRID-1-margin]
// on every axis. With a 10-cell arena and the plane starting at centre, at
// least one of the 4 candidate turns always keeps the path in bounds (the
// candidates are 4 of the 6 cardinal axes); we score each by how much margin
// it leaves and pick a random one from the safest pool. `prevTail` is the
// last 1–2 turn keys from the previous round so we can forbid a 3rd identical
// turn in a row across the round boundary.
function buildTrace1Round(initialQuat, initialPos, prevTail = []) {
  const schedule = []
  let quat = [...initialQuat]
  let pos  = { ...initialPos }
  const tail = prevTail.slice(-2)
  for (let i = 0; i < TRACE1_TURNS_PER_ROUND; i++) {
    // Evaluate all 4 candidate turns.
    const evaluated = TRACE1_TURN_KEYS.map(cand => {
      const def     = TRACE1_TURN_DEFS[cand]
      const newQuat = applyLocalRot(quat, def.axis, def.angle)
      const stepped = simulateForwardSteps(newQuat, pos, 2)
      return { cand, newQuat, stepped }
    })

    // If the last two turns were the same, that direction is now forbidden —
    // taking it would make 3 in a row.
    const forbidden = (tail.length >= 2 && tail[tail.length - 1] === tail[tail.length - 2])
      ? tail[tail.length - 1]
      : null
    const dropForbidden = (list) => forbidden ? list.filter(e => e.cand !== forbidden) : list

    // Prefer candidates that land at least 1 extra cell from any wall.
    const valid    = dropForbidden(evaluated.filter(e => e.stepped))
    const looseSet = valid.length ? valid : dropForbidden(evaluated.map(e => ({
      ...e,
      // Force-walked fallback: re-simulate without margin, clamp inside.
      stepped: simulateForwardSteps(e.newQuat, pos, 2, 0) || pos,
    })))
    // Safety net: if the forbidden filter wipes the set (shouldn't happen
    // with 4 turn options) fall back to the unfiltered list.
    const finalSet = looseSet.length ? looseSet : evaluated

    const chosen = finalSet[Math.floor(Math.random() * finalSet.length)]
    schedule.push(chosen.cand)
    tail.push(chosen.cand)
    if (tail.length > 2) tail.shift()
    quat = chosen.newQuat
    pos  = chosen.stepped || pos
  }
  return { schedule, endQuat: quat, endPos: pos, tail }
}

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
function AircraftSelect({ aircraft, onSelect, loading, personalBest, mode, traceModeSelector }) {
  const gameMode3D     = mode === '3d'
  const gameModeTrace1 = mode === 'trace1'
  const gameModeTrace2 = mode === 'trace2'

  const heading = gameModeTrace1
    ? 'Trace 1'
    : gameModeTrace2
      ? 'Trace 2'
      : `${gameMode3D ? '3D' : '2D'} Practise`
  const subheading = gameModeTrace1
    ? 'Watch the Hawk T2 fly — recall each turn it makes.'
    : gameModeTrace2
      ? 'Coming Soon.'
      : 'Practise for TRACE 1 + 2 CBAT tests.'

  // Personal-best label varies per mode (different scoring shape).
  const pbLine = gameModeTrace1
    ? (personalBest && <>Best: <span className="text-brand-300">{personalBest.bestScore}/40</span></>)
    : (personalBest && <>{personalBest.bestScore} rotations <span className="text-slate-500 mx-1">·</span> {personalBest.bestTime.toFixed(1)}s</>)

  // Leaderboard target depends on mode. Plane Turn 2D and 3D are separate
  // backend games with their own leaderboards.
  const leaderboardPath = gameModeTrace1
    ? '/cbat/trace-1/leaderboard'
    : `/cbat/plane-turn-${gameMode3D ? '3d' : '2d'}/leaderboard`

  return (
    <div>
      {traceModeSelector && (
        <div className="mb-4 flex justify-center">{traceModeSelector}</div>
      )}

      <h2 className="text-lg font-bold text-slate-800 text-center mb-1">{heading}</h2>
      <p className="text-xs text-slate-400 text-center mb-3">{subheading}</p>

      {/* Mode banner */}
      {!gameModeTrace2 && (
        <div
          className={`max-w-md mx-auto mb-3 rounded-lg border-2 p-3 text-sm ${
            gameModeTrace1
              ? 'border-emerald-700 bg-emerald-100 text-emerald-800'
              : gameMode3D
                ? 'border-amber-700 bg-amber-100 text-amber-800'
                : 'border-brand-600 bg-brand-100 text-brand-800'
          }`}
        >
          {gameModeTrace1 ? (
            <>
              <span className="font-extrabold uppercase tracking-wide">Trace 1 — Recall.</span>{' '}
              <span className="text-slate-800">Hawk T2 auto-flies the arena. Press the arrow matching each turn it just made. 5 rounds × 8 turns. +1 correct / −1 wrong.</span>
            </>
          ) : gameMode3D ? (
            <>
              <span className="font-extrabold uppercase tracking-wide">3D — Hard.</span>{' '}
              <span className="text-slate-800">Full pitch &amp; yaw with 10 vertical layers. Switch modes above.</span>
            </>
          ) : (
            <>
              <span className="font-extrabold uppercase tracking-wide">2D — Practice.</span>{' '}
              <span className="text-slate-800">Flat grid to learn the controls. Switch modes above when you're ready.</span>
            </>
          )}
        </div>
      )}

      {/* Instructions */}
      {!gameModeTrace2 && (
        <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-4 max-w-md mx-auto mb-4 text-sm text-[#ddeaf8] space-y-1.5">
          {gameModeTrace1 ? (
            <>
              <div className="flex items-start gap-2">
                <span className="text-brand-300 shrink-0">👀</span>
                <span>Watch the Hawk T2 fly itself through the 3D arena.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-brand-300 shrink-0">🎮</span>
                <span>After each turn, press the matching arrow: <span className="font-mono text-slate-300">←</span> yaw left · <span className="font-mono text-slate-300">→</span> yaw right · <span className="font-mono text-slate-300">↑</span> dive · <span className="font-mono text-slate-300">↓</span> climb.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-brand-300 shrink-0">🏆</span>
                <span>+1 per correct, −1 per wrong or missed. Aim for +40.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-brand-300 shrink-0">⚡</span>
                <span>5 rounds × 8 turns. Each round flies faster than the last.</span>
              </div>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      )}

      {gameModeTrace2 && (
        <div className="max-w-md mx-auto mb-6 bg-[#060e1a] border border-[#1a3a5c] rounded-lg p-6 text-center">
          <p className="text-3xl mb-2">🛠️</p>
          <p className="text-base font-bold text-slate-700 mb-1">Trace 2 — Coming Soon</p>
          <p className="text-xs text-slate-500">Pick Trace 1 or a Practise mode above.</p>
        </div>
      )}

      {personalBest && !gameModeTrace2 && (
        <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 max-w-md mx-auto mb-2 text-center">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Personal Best</p>
          <p className="text-lg font-mono font-bold text-brand-300">{pbLine}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">{personalBest.attempts} attempt{personalBest.attempts !== 1 ? 's' : ''}</p>
        </div>
      )}

      {!gameModeTrace2 && (
        <div className="text-center mb-4">
          <Link to={leaderboardPath} className="text-xs text-brand-300 hover:text-brand-200 transition-colors">
            View Leaderboard →
          </Link>
        </div>
      )}

      {gameModeTrace2 ? null : (
        <>
          <h2 className="text-lg font-bold text-slate-800 text-center mb-1">
            {gameModeTrace1 ? 'Aircraft' : 'Choose Your Aircraft'}
          </h2>
          <p className="text-xs text-slate-400 text-center mb-3">
            {gameModeTrace1
              ? 'Trace 1 uses the Hawk T2 — tap to start.'
              : 'Select an aircraft, then navigate through 5 levels.'}
          </p>
        </>
      )}

      {!gameModeTrace2 && loading && (
        <div className="flex flex-col items-center justify-center py-10">
          <div className="w-8 h-8 border-2 border-brand-400 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-sm text-slate-400">Loading aircraft...</p>
        </div>
      )}

      {!gameModeTrace2 && !loading && !aircraft.length && (
        <div className="text-center py-10">
          <p className="text-4xl mb-3">✈️</p>
          <p className="font-bold text-slate-700 mb-1">
            {gameModeTrace1 ? 'Hawk T2 model not loaded' : (gameMode3D ? 'No 3D aircraft available' : 'No aircraft available')}
          </p>
          <p className="text-sm text-slate-400">
            {gameModeTrace1
              ? 'Add hawk t2.glb to public/models/ to enable Trace 1.'
              : (gameMode3D
                  ? 'Switch 3D mode off or add .glb files to public/models/.'
                  : 'Aircraft cutout images need to be generated first.')}
          </p>
        </div>
      )}

      {!gameModeTrace2 && !loading && aircraft.length > 0 && (
        <div className={`grid gap-3 max-w-md mx-auto ${gameModeTrace1 ? 'grid-cols-1 max-w-[180px]' : 'grid-cols-3 sm:grid-cols-4'}`}>
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
                className={`object-contain group-hover:scale-110 transition-transform drop-shadow-[0_0_6px_rgba(91,170,255,0.4)] ${gameModeTrace1 ? 'w-20 h-20' : 'w-14 h-14'}`}
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

// ── Trace 1 HUD ──────────────────────────────────────────────────────────────
function Trace1HUD({ round, turn }) {
  return (
    <div className="flex items-center justify-between text-xs font-mono mb-2 px-1">
      <span className="text-slate-400">ROUND <span className="text-brand-300">{Math.min(round + 1, TRACE1_ROUNDS)}</span>/{TRACE1_ROUNDS}</span>
      <span className="text-slate-400">TURN <span className="text-brand-300">{Math.min(turn, TRACE1_TURNS_PER_ROUND)}</span>/{TRACE1_TURNS_PER_ROUND}</span>
    </div>
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
  const { settings } = useAppSettings()
  const { start: startTracking, markCompleted: markGameCompleted } = useCbatTracking()

  // Aircraft selection
  const [aircraft, setAircraft]         = useState([])
  const [loadingAircraft, setLoadingAircraft] = useState(true)
  const [selected, setSelected]         = useState(null)

  // Mode (4 values: '2d' | '3d' | 'trace1' | 'trace2'). Single selector;
  // Practise modes drive the legacy plane-turn loop, Trace 1 drives the new
  // autopilot loop. Trace 2 is selector-stub only.
  const [mode, setMode]                 = useTraceMode()
  const gameMode3D                      = mode === '3d'
  const gameModeTrace1                  = mode === 'trace1'
  const gameModeTrace2                  = mode === 'trace2'
  const gameModePractise                = mode === '2d' || mode === '3d'
  const gameMode3DRef                   = useRef(false)
  const gameModeTrace1Ref               = useRef(false)
  useEffect(() => { gameMode3DRef.current = gameMode3D }, [gameMode3D])
  useEffect(() => { gameModeTrace1Ref.current = gameModeTrace1 }, [gameModeTrace1])

  // Per-mode admin gating. Admins always see every mode; everyone else only
  // sees a mode whose cbatGameEnabled flag isn't explicitly false. Trace 2 is a
  // coming-soon stub and is never auto-selected. If the persisted mode has been
  // disabled, fall back to the first one still on (Trace 1 is the headline).
  const isAdmin = !!user?.isAdmin
  const cbatGameEnabled = settings?.cbatGameEnabled ?? {}
  const MODE_KEY = { '2d': 'plane-turn-2d', '3d': 'plane-turn-3d', trace1: 'trace-1' }
  const isModeEnabled = (m) => isAdmin || m === 'trace2' || cbatGameEnabled[MODE_KEY[m]] !== false
  useEffect(() => {
    if (isAdmin || !settings || mode === 'trace2') return
    if (cbatGameEnabled[MODE_KEY[mode]] === false) {
      const fallback = ['trace1', '2d', '3d'].find(m => cbatGameEnabled[MODE_KEY[m]] !== false)
      if (fallback) setMode(fallback)
    }
  }, [mode, settings, isAdmin]) // eslint-disable-line react-hooks/exhaustive-deps

  // Aircraft filtered for the select screen.
  //   Practise 3D → only aircraft with 3D models
  //   Trace 1    → only the Hawk T2 (single card)
  //   Practise 2D → everything
  const displayAircraft = gameModeTrace1
    ? aircraft.filter(a => /hawk\s*t2/i.test(a.title || ''))
    : gameMode3D
      ? aircraft.filter(a => has3DModel(a.briefId, a.title))
      : aircraft

  // Game state
  const [phase, setPhase]               = useState('select')
  const { enterImmersive, exitImmersive } = useGameChrome()
  useEffect(() => {
    if (phase === 'playing' || phase === 'over' || phase === 'intro') enterImmersive()
    else exitImmersive()
    return exitImmersive
  }, [phase, enterImmersive, exitImmersive])

  // Skip the logo-boot intro on Play Again within the same aircraft
  // selection. Reset by handleMenu (back to aircraft select).
  const introPlayedRef = useRef(false)

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
  // Default to the arena's centre layer so the first 3D-scene frame already
  // matches the boot effect's setLayer(5). Before this fix the scene rendered
  // briefly at layer=2 (lower than centre) and then snapped up once the boot
  // effect's state batch applied — visible as a small upward jump.
  const [layer, setLayer]               = useState(5)   // vertical position (0–LAYERS-1)
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

  // ── Trace 1 state ──────────────────────────────────────────────────────────
  const [trace1Round, setTrace1Round]         = useState(0)        // 0-indexed
  const [trace1Turn, setTrace1Turn]           = useState(0)        // 0-indexed within round
  const [trace1Schedule, setTrace1Schedule]   = useState([])       // current round's turns
  const [trace1Correct, setTrace1Correct]     = useState(0)
  const [trace1Total, setTrace1Total]         = useState(0)
  const [trace1Popup, setTrace1Popup]         = useState(null)     // { value: '✓'|'✗', key }
  const [trace1Banner, setTrace1Banner]       = useState(null)     // round-end banner text
  const [trace1Generation, setTrace1Generation] = useState(0)      // bump to re-init the loop
  const trace1AwaitingRef = useRef(false)
  const trace1LastTurnRef = useRef(null)
  const trace1ScheduleRef = useRef([])
  const trace1RoundRef    = useRef(0)
  const trace1TurnRef     = useRef(0)
  const trace1StartedAtRef = useRef(0)
  const trace1ScoreRef    = useRef(0)
  const trace1CorrectRef  = useRef(0)
  const trace1TotalRef    = useRef(0)
  const trace1TickRef     = useRef(null)
  const trace1PopupSeqRef = useRef(0)
  const trace1PosRef      = useRef({ r: 5, c: 5, layer: 5 })
  const trace1QuatRef     = useRef(initialPlaneQuat(0))
  // Last 1–2 turn keys, carried across round boundaries to forbid 3 in a row.
  const trace1TailRef     = useRef([])

  const gameRef  = useRef({})
  const timerRef = useRef(null)
  const moveRef  = useRef(null)

  // Fetch aircraft on mount
  useEffect(() => {
    if (!user) return
    getAircraftRoster('aircraft-cutouts', { apiFetch, API })
      .then(d => setAircraft(d.data || []))
      .catch(() => {})
      .finally(() => setLoadingAircraft(false))
  }, [user])

  // Fetch personal best (re-runs when mode changes). Trace 1 has its own endpoint;
  // Trace 2 has no PB (selector stub only).
  useEffect(() => {
    if (!user) return
    setPersonalBest(null)
    if (mode === 'trace2') return
    const url = mode === 'trace1'
      ? `${API}/api/games/cbat/trace-1/personal-best`
      : `${API}/api/games/cbat/plane-turn-${mode}/personal-best`
    apiFetch(url)
      .then(r => r.json())
      .then(d => { if (d.data) setPersonalBest(d.data) })
      .catch(() => {})
  }, [user, mode])

  // Submit score — mode determines the backend gameKey, which fixes the mode
  // on the saved doc server-side (body no longer needs to send it).
  const submitScore = useCallback((finalRotations, finalTime, aircraftTitle) => {
    setScoreSaved(false)
    markGameCompleted({ score: finalRotations })
    submitCbatResult(`plane-turn-${mode}`, {
        totalRotations: finalRotations,
        totalTime: finalTime,
        levelsCompleted: MAX_LEVEL,
        aircraftUsed: aircraftTitle,
      }, { apiFetch, API })
      .then(() => {
        setScoreSaved(true)
        apiFetch(`${API}/api/games/cbat/plane-turn-${mode}/personal-best`)
          .then(r => r.json())
          .then(d => { if (d.data) setPersonalBest(d.data) })
          .catch(() => {})
      })
      .catch(() => {})
  }, [apiFetch, API, mode])

  // Submit Trace 1 score
  const submitTrace1Score = useCallback((score, correctTurns, totalTurns, elapsedMs) => {
    setScoreSaved(false)
    const accuracy = totalTurns > 0 ? Math.round((correctTurns / totalTurns) * 100) : 0
    markGameCompleted({ score: correctTurns })
    submitCbatResult(`trace-1`, {
        score,
        correctTurns,
        totalTurns,
        roundsCompleted: TRACE1_ROUNDS,
        accuracy,
        aircraftUsed: 'Hawk T2',
        totalTime: elapsedMs,
      }, { apiFetch, API })
      .then(() => {
        setScoreSaved(true)
        apiFetch(`${API}/api/games/cbat/trace-1/personal-best`)
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

  // Timer — Practise modes only (Trace 1 has its own paced loop)
  useEffect(() => {
    if (phase !== 'playing' || gameModeTrace1Ref.current) { clearInterval(timerRef.current); return }
    const t0 = Date.now() - elapsed * 1000
    timerRef.current = setInterval(() => {
      setElapsed((Date.now() - t0) / 1000)
    }, 100)
    return () => clearInterval(timerRef.current)
  }, [phase, gameModeTrace1])

  // Movement loop — Practise modes only
  useEffect(() => {
    if (phase !== 'playing' || gameModeTrace1Ref.current) { clearInterval(moveRef.current); return }

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

  // Keyboard controls (Practise modes only; Trace 1 has its own handler below)
  useEffect(() => {
    if (phase !== 'playing' || gameModeTrace1Ref.current) return

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
  }, [phase, gameModeTrace1])

  // ── Trace 1 game loop ──────────────────────────────────────────────────────
  const trace1Finalize = useCallback(() => {
    if (trace1TickRef.current) { clearTimeout(trace1TickRef.current); trace1TickRef.current = null }
    const elapsedMs = performance.now() - trace1StartedAtRef.current
    setPhase('finished')
    submitTrace1Score(
      trace1ScoreRef.current,
      trace1CorrectRef.current,
      trace1TotalRef.current,
      Math.round(elapsedMs),
    )
  }, [submitTrace1Score])

  // Apply a turn (rotate the plane) and arm the input window. In smooth-flight
  // mode the scene integrates position continuously; we still track a grid-based
  // position internally so the schedule generator can bound future turns to the
  // arena, but we do NOT push position changes to the visible plane state.
  const trace1ExecuteTurn = useCallback((turnKey) => {
    const def = TRACE1_TURN_DEFS[turnKey]
    const prevQuat = trace1QuatRef.current
    const newQuat  = applyLocalRot(prevQuat, def.axis, def.angle)
    trace1QuatRef.current = newQuat

    // Advance the internal simulated position (used only by buildTrace1Round
    // for next-round bounds checking). The visible plane is driven by the
    // smooth-flight component, not by these grid coords.
    const stepped = simulateForwardSteps(newQuat, trace1PosRef.current, 2) || trace1PosRef.current
    trace1PosRef.current = stepped

    setPlaneQuat(newQuat)

    trace1LastTurnRef.current = turnKey
    trace1AwaitingRef.current = true
  }, [])

  const trace1ShowPopup = useCallback((delta) => {
    trace1PopupSeqRef.current += 1
    setTrace1Popup({ value: delta > 0 ? '✓' : '✗', key: trace1PopupSeqRef.current })
  }, [])

  const trace1ApplyScore = useCallback((delta) => {
    trace1ScoreRef.current += delta
    trace1TotalRef.current += 1
    setTrace1Total(trace1TotalRef.current)
    if (delta > 0) {
      trace1CorrectRef.current += 1
      setTrace1Correct(trace1CorrectRef.current)
    }
    trace1ShowPopup(delta)
  }, [trace1ShowPopup])

  const trace1ScheduleTick = useCallback((roundIdx, turnIdx) => {
    const speed = TRACE1_SPEED_TABLE[roundIdx] ?? TRACE1_SPEED_TABLE[TRACE1_SPEED_TABLE.length - 1]
    trace1TickRef.current = setTimeout(() => {
      // Settle the previous turn: if user didn't respond, count as miss.
      if (trace1AwaitingRef.current) {
        trace1AwaitingRef.current = false
        trace1ApplyScore(-1)
      }

      if (turnIdx >= TRACE1_TURNS_PER_ROUND) {
        // Round complete. Banner, then next round or finish.
        const completedRound = roundIdx + 1
        const isLast = completedRound >= TRACE1_ROUNDS
        setTrace1Banner(isLast
          ? { variant: 'final',    title: 'MISSION COMPLETE' }
          : { variant: 'roundEnd', title: `ROUND ${completedRound} CLEAR`, nextRound: completedRound + 1 })
        trace1TickRef.current = setTimeout(() => {
          setTrace1Banner(null)
          if (isLast) { trace1Finalize(); return }
          const nextRoundIdx = roundIdx + 1
          const built = buildTrace1Round(trace1QuatRef.current, trace1PosRef.current, trace1TailRef.current)
          trace1TailRef.current = built.tail
          trace1ScheduleRef.current = built.schedule
          setTrace1Schedule(built.schedule)
          trace1RoundRef.current = nextRoundIdx
          setTrace1Round(nextRoundIdx)
          trace1TurnRef.current = 0
          setTrace1Turn(0)
          trace1ScheduleTick(nextRoundIdx, 0)
        }, 2200)
        return
      }

      // Execute the scheduled turn.
      const turnKey = trace1ScheduleRef.current[turnIdx]
      trace1ExecuteTurn(turnKey)
      trace1TurnRef.current = turnIdx + 1
      setTrace1Turn(turnIdx + 1)
      trace1ScheduleTick(roundIdx, turnIdx + 1)
    }, speed)
  }, [trace1ApplyScore, trace1ExecuteTurn, trace1Finalize])

  // Boot the Trace 1 loop whenever we enter the playing phase in trace1 mode.
  // `trace1Generation` is a manual bump so handlePlayAgain can restart the loop
  // without round-tripping through 'select'.
  useEffect(() => {
    if (phase !== 'playing' || !gameModeTrace1) return
    // Initial state — smooth-flight component owns the visible position, but
    // we still init plane state so existing render paths have valid values.
    trace1QuatRef.current = initialPlaneQuat(0)
    trace1PosRef.current  = { r: 5, c: 5, layer: 5 }
    setPlane({ r: 5, c: 5, dir: 0, angle: 0 })
    setLayer(5)
    setPlaneQuat(trace1QuatRef.current)
    setMoveMode(0)

    trace1TailRef.current = []
    const built = buildTrace1Round(trace1QuatRef.current, trace1PosRef.current)
    trace1TailRef.current = built.tail
    trace1ScheduleRef.current = built.schedule
    setTrace1Schedule(built.schedule)
    trace1RoundRef.current = 0; setTrace1Round(0)
    trace1TurnRef.current  = 0; setTrace1Turn(0)
    trace1ScoreRef.current = 0
    trace1CorrectRef.current = 0; setTrace1Correct(0)
    trace1TotalRef.current = 0; setTrace1Total(0)
    trace1AwaitingRef.current = false
    trace1LastTurnRef.current = null
    trace1StartedAtRef.current = performance.now()

    // Brief settle delay so the user sees the Hawk T2 in the sky before the
    // autopilot's first turn fires — no overlay, no transition.
    const startTimeout = setTimeout(() => trace1ScheduleTick(0, 0), 800)

    return () => {
      clearTimeout(startTimeout)
      if (trace1TickRef.current) { clearTimeout(trace1TickRef.current); trace1TickRef.current = null }
    }
  }, [phase, gameModeTrace1, trace1Generation, trace1ScheduleTick])

  // Trace 1 input — keyboard + D-pad share this handler.
  const trace1HandleInput = useCallback((turnKey) => {
    if (!gameModeTrace1Ref.current) return
    if (phase !== 'playing') return
    if (!trace1AwaitingRef.current) return
    const expected = trace1LastTurnRef.current
    trace1AwaitingRef.current = false
    trace1ApplyScore(turnKey === expected ? 1 : -1)
  }, [phase, trace1ApplyScore])

  // Trace 1 keyboard listener
  useEffect(() => {
    if (phase !== 'playing' || !gameModeTrace1) return
    function handleKey(e) {
      const turn = trace1KeyToTurn(e.key)
      if (!turn) return
      e.preventDefault()
      trace1HandleInput(turn)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [phase, gameModeTrace1, trace1HandleInput])

  // Auto-dismiss the +1/−1 popup after a short fade
  useEffect(() => {
    if (!trace1Popup) return
    const id = setTimeout(() => setTrace1Popup(null), 600)
    return () => clearTimeout(id)
  }, [trace1Popup])

  // Synchronously wipe every Trace 1 display + ref value. Used by handleSelect
  // / handlePlayAgain so the first paint of phase='playing' is already at
  // zero — without this the prior run's HUD flashes for one frame because
  // the boot useEffect's resets don't commit until after first render.
  const resetTrace1State = useCallback(() => {
    trace1ScoreRef.current   = 0
    trace1CorrectRef.current = 0; setTrace1Correct(0)
    trace1TotalRef.current   = 0; setTrace1Total(0)
    trace1RoundRef.current   = 0; setTrace1Round(0)
    trace1TurnRef.current    = 0; setTrace1Turn(0)
    trace1AwaitingRef.current = false
    trace1LastTurnRef.current = null
    setTrace1Banner(null)
    setTrace1Popup(null)
  }, [])

  // Handlers
  const handleSelect = (a) => {
    startTracking(gameModeTrace1 ? 'trace-1' : `plane-turn-${mode}`, { mode })
    const modelUrl = getModelUrl(a.briefId, a.title)
    setSelected({ ...a, modelUrl })
    setUse3D(true)
    setTotalRotations(0)
    setTotalTime(0)
    if (gameModeTrace1) {
      // Wipe any leftover Trace 1 state from a previous run before the new
      // phase commits so the HUD never paints a stale score for a frame.
      resetTrace1State()
      setPhase(introPlayedRef.current ? 'playing' : 'intro')
      return
    }
    startGame(1)
    // Logo-boot intro covers the arena while it boots. Skip on replay
    // within the same aircraft pick.
    // startGame() above set phase='playing'; under React's batching the
    // override below wins, so phase ends as 'intro' and the timer/movement/
    // keyboard effects (gated on === 'playing') stay paused until the
    // curtain lifts. handleIntroComplete flips phase back to 'playing'.
    if (!introPlayedRef.current) setPhase('intro')
  }

  const handleIntroComplete = useCallback(() => {
    introPlayedRef.current = true
    setPhase('playing')
  }, [])

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
    // Back to aircraft select → next pick should replay the intro.
    introPlayedRef.current = false
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
    startTracking(gameModeTrace1 ? 'trace-1' : `plane-turn-${mode}`, { mode })
    setTotalRotations(0)
    setTotalTime(0)
    setScoreSaved(false)
    if (gameModeTrace1) {
      // Wipe Trace 1 state before the next paint, then bump generation so the
      // boot effect re-runs the schedule build + first-turn timer.
      resetTrace1State()
      setTrace1Generation(g => g + 1)
      setPhase('playing')
      return
    }
    startGame(1)
  }

  const handleRotate = (direction) => {
    if (phase !== 'playing') return
    if (gameModeTrace1Ref.current) {
      // Trace 1 reuses the D-pad for input. Map button → turn key.
      const turn = direction === 'left'  ? 'yawL'
                 : direction === 'right' ? 'yawR'
                 : direction === 'up'    ? 'pitchD'
                 :                         'pitchU'
      trace1HandleInput(turn)
      return
    }
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
      <SEO title="Trace — CBAT" description="Practise your turn and heading, or take the Trace recall test." />

      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {phase === 'select'
            ? <Link to="/cbat" className="text-slate-500 hover:text-brand-400 transition-colors text-sm">&larr; CBAT</Link>
            : <button onClick={handleMenu} className="text-slate-500 hover:text-brand-400 transition-colors text-sm bg-transparent border-0 p-0 cursor-pointer">&larr; Instructions</button>
          }
          <h1 className="text-sm font-extrabold text-slate-900">TRACE 1/2</h1>
        </div>
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
                mode={mode}
                traceModeSelector={<TraceModeSelector value={mode} onChange={setMode} isModeEnabled={isModeEnabled} />}
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
              {gameModeTrace1 ? (
                <>
                  <p className="text-5xl mb-3">🛩️</p>
                  <p className="text-2xl font-extrabold text-white mb-1">Trace 1 Complete</p>
                  <p className="text-sm text-slate-400 mb-6">All 5 rounds finished.</p>

                  <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-4 sm:p-5 mb-6">
                    <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">Final Score</p>
                    <div className="flex justify-center items-center gap-4 sm:gap-8">
                      <div className="min-w-0">
                        <p className="text-3xl sm:text-4xl font-mono font-bold text-brand-300">
                          {trace1Correct}<span className="text-slate-400">/40</span>
                        </p>
                        <p className="text-xs text-slate-500 mt-1">correct</p>
                      </div>
                      <div className="w-px self-stretch bg-[#1a3a5c]" />
                      <div className="min-w-0">
                        <p className="text-2xl sm:text-3xl font-mono font-bold text-brand-300">{trace1Total > 0 ? Math.round((trace1Correct / trace1Total) * 100) : 0}%</p>
                        <p className="text-xs text-slate-500 mt-1">accuracy</p>
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
                      to="/cbat/trace-1/leaderboard"
                      className="px-5 py-2.5 bg-[#1a3a5c] hover:bg-[#254a6e] text-[#ddeaf8] text-sm font-bold rounded-lg transition-colors no-underline"
                    >
                      🏆 Leaderboard
                    </Link>
                    <button
                      onClick={handleMenu}
                      className="px-5 py-2.5 bg-[#1a3a5c] hover:bg-[#254a6e] text-[#ddeaf8] text-sm font-bold rounded-lg transition-colors"
                    >
                      Back to Modes
                    </button>
                  </div>
                </>
              ) : (
                <>
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
                      to={leaderboardPath}
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
                </>
              )}
            </motion.div>
          )}

          {/* Game board — mounted during 'intro' too so it sits ready behind
              the curtain. Timer/movement/keyboard effects stay gated on
              `phase === 'playing'`, so the simulation only starts once the
              intro completes and flips us back to 'playing'. */}
          {(phase === 'playing' || phase === 'over' || phase === 'intro') && selected && (
            <div className="w-full max-w-md">
              {gameModeTrace1
                ? <Trace1HUD round={trace1Round} turn={trace1Turn} />
                : <HUD collected={collected} rotations={rotations} elapsed={elapsed} level={level} />}

              {/* ── 3D Game (Practise 3D + Trace 1 share the 3D arena) ── */}
              {(gameMode3D || gameModeTrace1) ? (
                <div
                  className={`relative border-2 rounded-xl overflow-hidden shadow-[0_0_30px_rgba(91,170,255,0.08)] ${
                    gameModeTrace1 ? 'border-[#3a7bbf]' : 'bg-[#060e1a] border-[#1a3a5c]'
                  }`}
                  style={{
                    width: '100%',
                    aspectRatio: '1',
                    // Sky gradient for Trace modes, dark surface for Practise.
                    background: gameModeTrace1
                      ? 'linear-gradient(180deg, #cfe8ff 0%, #8fc4ee 45%, #5398d3 80%, #3a7bbf 100%)'
                      : undefined,
                  }}
                >
                  {/* Aircraft name */}
                  <div className="absolute top-1 left-1 z-30 flex items-center gap-1">
                    {!gameModeTrace1 && (
                      <button onClick={() => cycleAircraft(-1)} className="text-[10px] text-slate-500 hover:text-brand-300 transition-colors px-0.5 cursor-pointer">&larr;</button>
                    )}
                    <span className="text-[10px] text-slate-500 font-mono">{selected.title}</span>
                    {!gameModeTrace1 && (
                      <button onClick={() => cycleAircraft(1)} className="text-[10px] text-slate-500 hover:text-brand-300 transition-colors px-0.5 cursor-pointer">&rarr;</button>
                    )}
                  </div>

                  <Suspense fallback={null}>
                    <PlaneTurn3DScene
                      plane={{ ...plane, layer, pitch, moveMode, quat: planeQuat }}
                      pkg={gameModeTrace1 ? { r: -100, c: -100, layer: -100 } : { ...pkg, layer: pkgLayer }}
                      modelUrl={selected.modelUrl}
                      onError={() => {}}
                      onReady={handle3DReady}
                      traceFlight={gameModeTrace1}
                      // 2 cells of forward distance per scheduled turn → speed
                      // (cells/sec) = 2000 / tickMs. Scales naturally per round.
                      traceFlightSpeed={gameModeTrace1
                        ? (2000 / (TRACE1_SPEED_TABLE[trace1Round] ?? TRACE1_SPEED_TABLE[TRACE1_SPEED_TABLE.length - 1]))
                        : 0}
                      traceFlightActive={gameModeTrace1 && phase === 'playing'}
                      traceFlightResetKey={trace1Generation}
                    />
                  </Suspense>

                  {/* Trace 1 tick / cross popup */}
                  <AnimatePresence>
                    {gameModeTrace1 && trace1Popup && (
                      <motion.div
                        key={trace1Popup.key}
                        initial={{ opacity: 0, y: 20, scale: 0.6 }}
                        animate={{ opacity: 1, y: -10, scale: 1 }}
                        exit={{ opacity: 0, y: -40, scale: 0.9 }}
                        transition={{ duration: 0.45 }}
                        className={`absolute inset-0 z-30 flex items-center justify-center text-7xl font-extrabold pointer-events-none ${trace1Popup.value === '✓' ? 'text-emerald-300' : 'text-red-400'}`}
                        style={{ textShadow: '0 0 18px rgba(0,0,0,0.55)' }}
                      >
                        {trace1Popup.value}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Trace 1 round banner — big, gamified overlay between rounds */}
                  <AnimatePresence>
                    {gameModeTrace1 && trace1Banner && (
                      <motion.div
                        key={trace1Banner.title}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.25 }}
                        className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none"
                      >
                        {/* Dim backdrop */}
                        <div className="absolute inset-0 bg-black/55" />

                        <motion.div
                          initial={{ scale: 0.6, opacity: 0, y: 24 }}
                          animate={{ scale: 1, opacity: 1, y: 0 }}
                          exit={{ scale: 1.05, opacity: 0, y: -10 }}
                          transition={{ type: 'spring', stiffness: 240, damping: 18 }}
                          className="relative text-center px-6 py-5 rounded-2xl border-2 bg-[#0a1628]/95 backdrop-blur"
                          style={{
                            borderColor: trace1Banner.variant === 'final' ? '#fbbf24' : '#5baaff',
                            boxShadow: trace1Banner.variant === 'final'
                              ? '0 0 40px rgba(251,191,36,0.45), inset 0 0 28px rgba(251,191,36,0.18)'
                              : '0 0 40px rgba(91,170,255,0.45), inset 0 0 28px rgba(91,170,255,0.18)',
                          }}
                        >
                          {/* Heading: ROUND N CLEAR / MISSION COMPLETE */}
                          <motion.p
                            initial={{ letterSpacing: '0.6em', opacity: 0 }}
                            animate={{ letterSpacing: '0.25em', opacity: 1 }}
                            transition={{ duration: 0.4, delay: 0.05 }}
                            className={`text-3xl sm:text-4xl font-extrabold uppercase ${
                              trace1Banner.variant === 'final' ? 'text-amber-200' : 'text-white'
                            }`}
                            style={{
                              textShadow: trace1Banner.variant === 'final'
                                ? '0 0 18px rgba(251,191,36,0.85)'
                                : '0 0 16px rgba(91,170,255,0.85)',
                            }}
                          >
                            {trace1Banner.title}
                          </motion.p>

                          {/* Next round tagline */}
                          {trace1Banner.variant === 'roundEnd' && (
                            <motion.p
                              initial={{ opacity: 0, y: 4 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: 0.55, duration: 0.3 }}
                              className="mt-3 text-sm sm:text-base font-extrabold uppercase tracking-[0.25em] text-brand-300"
                            >
                              Round {trace1Banner.nextRound} <span className="text-amber-300">·</span> Faster
                            </motion.p>
                          )}
                          {trace1Banner.variant === 'final' && (
                            <motion.p
                              initial={{ opacity: 0, y: 4 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: 0.55, duration: 0.3 }}
                              className="mt-3 text-sm sm:text-base font-extrabold uppercase tracking-[0.25em] text-amber-300"
                            >
                              All 5 Rounds Logged
                            </motion.p>
                          )}
                        </motion.div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <AnimatePresence>
                    {!gameModeTrace1 && phase === 'over' && (
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
              {(gameMode3D || gameModeTrace1) ? (
                <div className="flex flex-col items-center gap-2 mt-4">
                  <DpadBtn label="↑" onPress={() => handleRotate('up')} ariaLabel={gameModeTrace1 ? 'Recall: dive' : 'Dive'} />
                  <div className="flex gap-2">
                    <DpadBtn label="←" onPress={() => handleRotate('left')}  ariaLabel={gameModeTrace1 ? 'Recall: yaw left' : 'Rotate left'} />
                    <DpadBtn label="↓" onPress={() => handleRotate('down')}  ariaLabel={gameModeTrace1 ? 'Recall: climb' : 'Climb'} />
                    <DpadBtn label="→" onPress={() => handleRotate('right')} ariaLabel={gameModeTrace1 ? 'Recall: yaw right' : 'Rotate right'} />
                  </div>
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
                {gameModeTrace1
                  ? <>After each turn, press the arrow the plane just took</>
                  : gameMode3D
                    ? <>Use <span className="font-mono text-slate-400">←→</span> to turn &middot; <span className="font-mono text-slate-400">↓</span> climb &middot; <span className="font-mono text-slate-400">↑</span> dive (stick)</>
                    : <>Use <span className="font-mono text-slate-400">&larr;</span> <span className="font-mono text-slate-400">&rarr;</span> arrow keys or tap the buttons to rotate</>
                }
              </p>
            </div>
          )}

          {/* Logo-boot intro — covers the viewport while the game board boots
              behind it. Choreography + sound + completion timer all live in
              <SkywatchLogoIntro>; we just gate it on phase. Shared with DPT
              and applies to both 2D and 3D modes here. */}
          {phase === 'intro' && <SkywatchLogoIntro onComplete={handleIntroComplete} />}
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
