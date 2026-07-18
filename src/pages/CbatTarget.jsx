import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { submitCbatResult } from '../lib/cbatOutbox'
import { getAircraftRoster } from '../lib/offlineRoster'
import { useCbatTracking } from '../utils/cbat/useCbatTracking'
import { useAppSettings } from '../context/AppSettingsContext'
import { useGameChrome } from '../context/GameChromeContext'
import { getModelUrl, has3DModel } from '../data/aircraftModels'
import SEO from '../components/SEO'
import CbatGameOver from '../components/CbatGameOver'

const AircraftTopDown = lazy(() => import('../components/AircraftTopDown'))

// ── Constants ────────────────────────────────────────────────────────────────
const GAME_MS = 120_000
const FIRST_TARGET_MS = 15_000
const NEXT_TARGET_MS = 20_000
const MAX_ACTIVE_TARGETS = 5
const LIGHT_CHANGE_MS = 5_000
const SCAN_PANEL_CHANGE_MS = 10_000
const SCAN_PANEL_MATCH_COOLDOWN_MS = 7_000
const SCAN_TARGET_CHANGE_MS = 45_000
const SCAN_FIRST_APPEAR_MS = 10_000
// When the scan panel rotates, roughly this fraction of the time it'll show
// the current scan target so players can actually rack up ID points.
const SCAN_PANEL_MATCH_CHANCE = 0.35
const SECOND_SYS_TARGET_MS = 60_000
const SYS_SCROLL_MS = 1_000        // ms per row of system-panel scroll
const SYS_GREEN_FADE_MS = 1_500
// Alert circles — red pulsing markers that appear on the scene and stay until
// clicked. First appears 8–15s in; each subsequent one 8–15s after the last.
// Uncleared alerts stack, so several can be on screen at once.
const ALERT_GAP_MIN_MS = 8_000
const ALERT_GAP_MAX_MS = 15_000
// Click bonus decays to zero over this window from spawn, so a fast reaction is
// worth the most.
const ALERT_SCORE_WINDOW_MS = 6_000

const SHAPE_KINDS = ['truck', 'tank', 'building']
const SHAPE_COLOURS = ['hostile', 'friendly', 'neutral']
const COL_HEX = { hostile: '#ef4444', friendly: '#5baaff', neutral: '#facc15' }
const DIRECTIONS = ['N', 'E', 'S', 'W']
const LIGHT_COLOURS = ['red', 'blue', 'green', 'yellow']
const LIGHT_HEX = { red: '#ef4444', blue: '#5baaff', green: '#22c55e', yellow: '#facc15' }

const SCORE = {
  sceneHit: 10, sceneHitBonus: 3, sceneMiss: -5,
  lightMatch: 20, lightBonus: 8, lightMiss: -10,
  scanMatch: 25, scanBonus: 10, scanMiss: -10,
  systemMatch: 15, systemMiss: -5,
  alertHit: 10, alertBonus: 20,
}

// Grade bands (out of roughly -50..+500)
function computeGrade(score) {
  if (score >= 400) return 'Outstanding'
  if (score >= 250) return 'Good'
  if (score >= 100) return 'Needs Work'
  return 'Failed'
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const rand = (n) => Math.floor(Math.random() * n)
const pick = (arr) => arr[rand(arr.length)]
const randRange = (lo, hi) => lo + rand(hi - lo + 1)
const uid = (() => { let i = 0; return () => `id-${++i}` })()

function randomLightPattern() {
  return [pick(LIGHT_COLOURS), pick(LIGHT_COLOURS), pick(LIGHT_COLOURS)]
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'  // skip I/O to reduce ambiguity
function randomCode() {
  let out = ''
  for (let i = 0; i < 4; i++) out += CODE_CHARS[rand(CODE_CHARS.length)]
  return out
}

// Build a scan-panel aircraft entry with a random framing so only a slice of
// the model sits in view. Seed lets React remount the Canvas for fresh framing.
function scanFrame(aircraft) {
  return {
    ...aircraft,
    seed: `${aircraft.briefId}-${Math.random().toString(36).slice(2, 8)}`,
    offsetX: (Math.random() - 0.5) * 4,   // ±2 world units
    offsetZ: (Math.random() - 0.5) * 4,
  }
}

function labelFor(t) {
  const adj = []
  if (t.damaged) adj.push('damaged')
  if (t.highPriority) adj.push('high-priority')
  adj.push(t.color)
  let base = t.kind + 's'
  if (t.direction) base += ` facing ${{ N: 'north', E: 'east', S: 'south', W: 'west' }[t.direction]}`
  return adj.join(' ') + ' ' + base
}

function shapeMatches(shape, target) {
  if (shape.fake || shape.kind === 'unknown') return false
  if (shape.kind !== target.kind) return false
  if (shape.color !== target.color) return false
  if (target.damaged && !shape.damaged) return false
  if (target.highPriority && !shape.highPriority) return false
  if (target.direction && shape.direction !== target.direction) return false
  return true
}

// Plan target labels and pre-generate all scene shapes + their spawn times.
function planGame() {
  // 6 target activations at t=15,35,55,75,95,115s
  const activations = [15, 35, 55, 75, 95, 115]
  const dirIdx = new Set()
  while (dirIdx.size < 2) dirIdx.add(rand(activations.length))

  const targets = activations.map((tsec, i) => ({
    id: uid(),
    activateAt: tsec * 1000,
    kind: pick(SHAPE_KINDS),
    color: pick(SHAPE_COLOURS),
    damaged: Math.random() < 0.4,
    highPriority: Math.random() < 0.4,
    direction: dirIdx.has(i) ? pick(DIRECTIONS) : null,
  }))

  const shapes = []

  // Distribute spawn times roughly evenly across a window with jitter, so
  // appearances feel paced rather than bunched.
  const evenlySpread = (n, startMs, endMs) => {
    const span = Math.max(500, endMs - startMs)
    const step = span / n
    return Array.from({ length: n }, (_, i) =>
      startMs + (i + 0.5) * step + (Math.random() - 0.5) * step * 0.55
    )
  }

  // For each target: pre-place N matching shapes, spread evenly across the
  // window from game start to ~2s before the target activates. Nothing spawns
  // at t=0 — shapes trickle in gradually so the scene fills rather than dumps.
  for (const t of targets) {
    const n = randRange(3, 8)
    const times = evenlySpread(n, 1500, Math.max(3000, t.activateAt - 2000))
    for (let k = 0; k < n; k++) {
      shapes.push({
        id: uid(),
        kind: t.kind,
        color: t.color,
        damaged: t.damaged,
        highPriority: t.highPriority,
        direction: t.direction || (Math.random() < 0.3 ? pick(DIRECTIONS) : null),
        spawnAt: times[k],
        fake: false,
        ...placeRandom(),
      })
    }
  }

  // Diamonds (unknown) — always yellow, all present from game start.
  const diamondCount = randRange(8, 10)
  for (let i = 0; i < diamondCount; i++) {
    shapes.push({
      id: uid(),
      kind: 'unknown',
      color: 'neutral',
      damaged: false,
      highPriority: false,
      direction: null,
      spawnAt: 0,
      fake: false,
      ...placeRandom(),
    })
  }

  // Fake shapes (octagons, lines) — ~half present at start, rest trickle in.
  const fakeCount = randRange(16, 20)
  const fakeImmediateCount = Math.round(fakeCount * 0.5)
  const fakeLaterTimes = evenlySpread(
    Math.max(1, fakeCount - fakeImmediateCount),
    15_000,
    115_000,
  )
  for (let i = 0; i < fakeCount; i++) {
    const roll = Math.random()
    const fakeKind = roll < 0.34 ? 'line' : roll < 0.67 ? 'octagon' : 'pentagon'
    shapes.push({
      id: uid(),
      kind: fakeKind,
      lineHorizontal: fakeKind === 'line' ? Math.random() < 0.5 : undefined,
      color: pick(SHAPE_COLOURS),
      damaged: false,
      highPriority: false,
      direction: null,
      spawnAt: i < fakeImmediateCount ? 0 : fakeLaterTimes[i - fakeImmediateCount],
      fake: true,
      ...placeRandom(),
    })
  }

  // Random noise shapes — a few visible at game start so the scene reads
  // as populated immediately; the rest trickle in across the game.
  const noiseCount = randRange(10, 14)
  const noiseImmediateCount = randRange(3, 4)
  const noiseLaterTimes = evenlySpread(
    Math.max(1, noiseCount - noiseImmediateCount),
    20_000,
    115_000,
  )
  for (let i = 0; i < noiseCount; i++) {
    shapes.push({
      id: uid(),
      kind: pick(SHAPE_KINDS),
      color: pick(SHAPE_COLOURS),
      damaged: Math.random() < 0.3,
      highPriority: Math.random() < 0.3,
      direction: Math.random() < 0.3 ? pick(DIRECTIONS) : null,
      spawnAt: i < noiseImmediateCount ? 0 : noiseLaterTimes[i - noiseImmediateCount],
      fake: false,
      ...placeRandom(),
    })
  }

  return { targets, shapes }
}

// Random position within the 1000×800 virtual canvas, with soft spacing.
// Pad is generous enough that direction arrows and high-priority crosshair
// arms stay inside the scene container across all viewport sizes.
let _placed = []
function placeRandom() {
  const padX = 80
  const padY = 80
  for (let attempt = 0; attempt < 12; attempt++) {
    const x = padX + Math.random() * (1000 - 2 * padX)
    const y = padY + Math.random() * (800 - 2 * padY)
    const ok = _placed.every(p => Math.hypot(p.x - x, p.y - y) > 55)
    if (ok) { _placed.push({ x, y }); return { x, y } }
  }
  const x = padX + Math.random() * (1000 - 2 * padX)
  const y = padY + Math.random() * (800 - 2 * padY)
  _placed.push({ x, y })
  return { x, y }
}
function resetPlacements() { _placed = [] }

// Random position for an alert circle within the virtual canvas. Kept clear of
// the edges so the pulsing ring never clips the scene border. Independent of
// the shape spacing pool — alerts are allowed to overlap shapes.
function randomAlertPos() {
  const padX = 100
  const padY = 100
  return {
    x: padX + Math.random() * (1000 - 2 * padX),
    y: padY + Math.random() * (800 - 2 * padY),
  }
}

// ── Shape rendering — each shape is an absolutely-positioned fixed-size box
// so aspect ratio stays intact regardless of scene container shape.
const SHAPE_BOX = 72      // wrapper box size in px (desktop baseline)
const SHAPE_R_BASE = 18   // baseline half-extent; scaled per kind below

// Mobile shrink factor — smaller physical shapes overlap less on narrow screens.
function useShapeScale(breakpoint = 900) {
  const [scale, setScale] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth <= breakpoint ? 0.6 : 1
  )
  useEffect(() => {
    const update = () => setScale(window.innerWidth <= breakpoint ? 0.6 : 1)
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [breakpoint])
  return scale
}
const KIND_SCALE = {
  truck: 1, tank: 1, building: 1,
  unknown: 0.55,          // diamonds noticeably smaller
  octagon: 2.05,          // octagons bigger
  pentagon: 2.05,         // pentagons sized to match octagons
  line: 1.25,
}
function Shape({ shape, scale = 1 }) {
  const { kind, color, damaged, highPriority, direction, x, y, fake, lineHorizontal } = shape
  const hex = COL_HEX[color]
  const isReal = !fake && kind !== 'unknown'
  const strokeCol = kind === 'unknown' ? COL_HEX.neutral : hex
  const baseR = SHAPE_R_BASE * scale
  const box = SHAPE_BOX * scale
  const R = baseR * (KIND_SCALE[kind] || 1)

  let shapeEl = null
  if (kind === 'truck') {
    shapeEl = <circle cx={0} cy={0} r={R} fill="none" stroke={strokeCol} strokeWidth="2.5" />
  } else if (kind === 'tank') {
    shapeEl = <rect x={-R} y={-R} width={R * 2} height={R * 2} fill="none" stroke={strokeCol} strokeWidth="2.5" />
  } else if (kind === 'building') {
    // Equilateral triangle with base 2R (side length), centroid at origin:
    //   apex at y = -2R/√3, base at y = R/√3.
    const apex = (R * 2) / Math.sqrt(3)
    const base = R / Math.sqrt(3)
    shapeEl = <polygon points={`0,${-apex} ${-R},${base} ${R},${base}`} fill="none" stroke={strokeCol} strokeWidth="2.5" />
  } else if (kind === 'unknown') {
    shapeEl = <rect x={-R} y={-R} width={R * 2} height={R * 2} fill="none" stroke={strokeCol} strokeWidth="2.5" transform="rotate(45)" />
  } else if (kind === 'octagon') {
    const pts = []
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i + Math.PI / 8
      pts.push(`${Math.cos(a) * R},${Math.sin(a) * R}`)
    }
    shapeEl = <polygon points={pts.join(' ')} fill="none" stroke={strokeCol} strokeWidth="2.5" />
  } else if (kind === 'pentagon') {
    // Regular pentagon, apex up, centroid at origin.
    const pts = []
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + i * (2 * Math.PI / 5)
      pts.push(`${Math.cos(a) * R},${Math.sin(a) * R}`)
    }
    shapeEl = <polygon points={pts.join(' ')} fill="none" stroke={strokeCol} strokeWidth="2.5" />
  } else if (kind === 'line') {
    const L = R * 1.1
    shapeEl = lineHorizontal
      ? <line x1={-L} y1={-L} x2={L} y2={L} stroke={strokeCol} strokeWidth="3" />
      : <line x1={-L} y1={L} x2={L} y2={-L} stroke={strokeCol} strokeWidth="3" />
  }

  const crosshairArms = isReal && highPriority ? (
    <g stroke={strokeCol} strokeWidth="2.5" opacity="0.85">
      <line x1={0} y1={-R * 1.9} x2={0} y2={-R * 1.2} />
      <line x1={0} y1={R * 1.2} x2={0} y2={R * 1.9} />
      <line x1={-R * 1.9} y1={0} x2={-R * 1.2} y2={0} />
      <line x1={R * 1.9} y1={0} x2={R * 1.2} y2={0} />
    </g>
  ) : null

  // Diagonal X is inscribed into each shape so its endpoints touch the
  // inside edge of the outline without crossing it. PAD reserves room for the
  // shape's 2.5px stroke half + the X's rounded cap.
  const damagedReach = (() => {
    const PAD = 1.75
    if (kind === 'truck')    return R / Math.sqrt(2) - PAD                       // inscribed in circle
    if (kind === 'tank')     return R - PAD                                      // inscribed in square
    if (kind === 'building') return R * (1 - 1 / Math.sqrt(3)) - PAD             // bound by slant edges of equilateral triangle
    if (kind === 'octagon')  return R * Math.cos(Math.PI / 8) / Math.sqrt(2) - PAD
    return R * 0.55
  })()
  const damagedX = isReal && damaged ? (
    <g stroke={strokeCol} strokeWidth="3" strokeLinecap="round">
      <line x1={-damagedReach} y1={-damagedReach} x2={damagedReach} y2={damagedReach} />
      <line x1={-damagedReach} y1={damagedReach} x2={damagedReach} y2={-damagedReach} />
    </g>
  ) : null

  let arrow = null
  if (isReal && direction) {
    const d = R * 1.55
    const tip = { N: [0, -d - 6], S: [0, d + 6], E: [d + 6, 0], W: [-d - 6, 0] }[direction]
    const base1 = { N: [-5, -d + 2], S: [-5, d - 2], E: [d - 2, -5], W: [-d + 2, -5] }[direction]
    const base2 = { N: [5, -d + 2], S: [5, d - 2], E: [d - 2, 5], W: [-d + 2, 5] }[direction]
    arrow = <polygon points={`${tip[0]},${tip[1]} ${base1[0]},${base1[1]} ${base2[0]},${base2[1]}`} fill={strokeCol} />
  }

  const leftPct = (x / 1000) * 100
  const topPct  = (y / 800) * 100

  return (
    <div
      className="cbat-shape-wrap cursor-pointer"
      style={{
        position: 'absolute',
        left:   `${leftPct}%`,
        top:    `${topPct}%`,
        width:  box,
        height: box,
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',   /* let parent handle hit-testing */
      }}
    >
      <svg
        width={box}
        height={box}
        viewBox={`${-box / 2} ${-box / 2} ${box} ${box}`}
        style={{ display: 'block', overflow: 'visible' }}
      >
        {arrow}
        {shapeEl}
        {crosshairArms}
        {damagedX}
      </svg>
    </div>
  )
}

// ── Alert circle — red pulsing marker layered over the scene ─────────────────
// Positioned with the same percentage scheme as Shape so it tracks its point
// across viewport sizes. It's a real button so it owns its own click and stops
// the event bubbling to the scene's shape hit-test.
function AlertCircle({ alert, scale = 1, onClick }) {
  const leftPct = (alert.x / 1000) * 100
  const topPct  = (alert.y / 800) * 100
  const size = 22 * scale
  return (
    <button
      type="button"
      aria-label="Alert"
      onClick={(e) => { e.stopPropagation(); onClick(alert) }}
      className="cbat-alert-circle"
      style={{ left: `${leftPct}%`, top: `${topPct}%`, width: size, height: size }}
    />
  )
}

// ── Info panel: legend/key ───────────────────────────────────────────────────
function InfoPanel({ highlightUnknown = false } = {}) {
  const Item = ({ icon, label, className = '' }) => (
    <span className={`flex items-center gap-1 whitespace-nowrap ${className}`}>
      {icon}<span>{label}</span>
    </span>
  )
  const outlineSvg = (child) => (
    <svg width="11" height="11" viewBox="-6 -6 12 12" style={{ flexShrink: 0 }}>{child}</svg>
  )
  return (
    <div className="w-full h-full bg-[#0a1628] border border-[#1a3a5c] rounded-lg px-1.5 py-1 text-[10px] text-[#ddeaf8] leading-[1.2]">
      <div className="flex flex-wrap gap-x-2 gap-y-0.5">
        <Item icon={<span className="inline-block w-2.5 h-2.5 rounded-full bg-[#ef4444]" />} label="hostile" />
        <Item icon={<span className="inline-block w-2.5 h-2.5 rounded-full bg-[#5baaff]" />} label="friendly" />
        <Item icon={<span className="inline-block w-2.5 h-2.5 rounded-full bg-[#facc15]" />} label="neutral" />
        <Item icon={outlineSvg(<circle cx="0" cy="0" r="4.5" fill="none" stroke="#94a3b8" strokeWidth="1.3" />)} label="truck" />
        <Item icon={outlineSvg(<rect x="-4.5" y="-4.5" width="9" height="9" fill="none" stroke="#94a3b8" strokeWidth="1.3" />)} label="tank" />
        <Item icon={outlineSvg(<polygon points="0,-5.2 -4.5,2.6 4.5,2.6" fill="none" stroke="#94a3b8" strokeWidth="1.3" />)} label="building" />
        <Item className={highlightUnknown ? 'cbat-triple-pulse' : ''} icon={outlineSvg(<rect x="-3.5" y="-3.5" width="7" height="7" fill="none" stroke="#facc15" strokeWidth="1.3" transform="rotate(45)" />)} label="unknown" />
        <Item icon={<span className="text-red-300 font-bold">✕</span>} label="damaged" />
        <Item icon={outlineSvg(
          <g stroke="#5baaff" strokeWidth="1.5" strokeLinecap="round">
            <line x1="0" y1="-5" x2="0" y2="-2" />
            <line x1="0" y1="2" x2="0" y2="5" />
            <line x1="-5" y1="0" x2="-2" y2="0" />
            <line x1="2" y1="0" x2="5" y2="0" />
          </g>
        )} label="hi-pri" />
      </div>
    </div>
  )
}

// ── Light panel ──────────────────────────────────────────────────────────────
function LightPanel({ pattern, flash, onPress, lockPulse = false }) {
  return (
    <div className={`h-full w-full bg-[#0a1628] border rounded-lg p-2 flex items-center justify-around gap-2 transition-colors ${flash ? 'border-green-400 bg-green-500/15' : 'border-[#1a3a5c]'}`}>
      <div className="flex gap-2">
        {pattern.map((c, i) => (
          <span key={i} className="inline-block rounded-full"
            style={{ width: 18, height: 18, background: LIGHT_HEX[c], boxShadow: `0 0 10px ${LIGHT_HEX[c]}` }} />
        ))}
      </div>
      <button
        onClick={onPress}
        className={`px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-[11px] font-bold rounded transition-colors cursor-pointer ${lockPulse ? 'cbat-btn-flash' : ''}`}
      >
        LOCK
      </button>
    </div>
  )
}

function LightTargetPanel({ pattern }) {
  return (
    <div className="h-full w-full bg-[#0a1628] border border-[#1a3a5c] rounded-lg p-2 flex flex-col items-center justify-center gap-1 max-[900px]:flex-row max-[900px]:gap-2">
      <p className="text-[9px] uppercase tracking-wide text-slate-500 shrink-0">Light Target</p>
      <div className="flex gap-1.5">
        {pattern.map((c, i) => (
          <span key={i} className="inline-block rounded-full border border-[#0c1829]"
            style={{ width: 14, height: 14, background: LIGHT_HEX[c] }} />
        ))}
      </div>
    </div>
  )
}

// ── Scan panels ──────────────────────────────────────────────────────────────
// Standalone radar overlay so the sweep keeps animating even when no aircraft
// is showing in the scan panel (pre-first-spawn and during post-match cooldown).
function ScanRadar() {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', borderRadius: 8, background: '#020a18' }}>
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(circle at center, transparent 40%, rgba(6,16,30,0.55) 100%), ' +
            'repeating-linear-gradient(0deg, rgba(91,170,255,0.08) 0 1px, transparent 1px 6px), ' +
            'repeating-linear-gradient(90deg, rgba(91,170,255,0.08) 0 1px, transparent 1px 6px)',
          pointerEvents: 'none',
        }}
      />
      <div
        aria-hidden
        className="radar-sweep"
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'conic-gradient(from 0deg, rgba(91,170,255,0.35) 0deg, rgba(91,170,255,0) 40deg, rgba(91,170,255,0) 360deg)',
          mixBlendMode: 'screen',
          pointerEvents: 'none',
          animation: 'radar-sweep 2.6s linear infinite',
          borderRadius: '50%',
        }}
      />
    </div>
  )
}

function ScanPanel({ aircraft, onPress, flash, idPulse = false }) {
  return (
    <div className={`h-full w-full bg-[#0a1628] border rounded-lg p-1 flex items-center gap-1 transition-colors ${flash ? 'border-green-400 bg-green-500/15' : 'border-[#1a3a5c]'}`}>
      <div className="flex-1 h-full relative">
        {aircraft ? (
          <Suspense fallback={<div className="w-full h-full bg-[#020a18] rounded" />}>
            <AircraftTopDown
              key={aircraft.seed}
              modelUrl={aircraft.modelUrl}
              partial
              offsetX={aircraft.offsetX}
              offsetZ={aircraft.offsetZ}
            />
          </Suspense>
        ) : (
          <ScanRadar />
        )}
      </div>
      <button
        onClick={onPress}
        className={`px-2 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-[10px] font-bold rounded transition-colors cursor-pointer shrink-0 ${idPulse ? 'cbat-btn-flash' : ''}`}
      >
        ID
      </button>
    </div>
  )
}

function ScanTargetPanel({ aircraft }) {
  return (
    <div className="h-full w-full bg-[#0a1628] border border-[#1a3a5c] rounded-lg p-1 flex flex-col items-center gap-0.5 max-[900px]:flex-row max-[900px]:items-center max-[900px]:gap-1.5">
      <p className="text-[9px] uppercase tracking-wide text-slate-500 shrink-0 max-[900px]:px-1">Scan Target</p>
      <div className="flex-1 w-full relative max-[900px]:h-full">
        {aircraft ? (
          <Suspense fallback={<div className="w-full h-full bg-[#020a18] rounded" />}>
            <AircraftTopDown modelUrl={aircraft.modelUrl} clear />
          </Suspense>
        ) : (
          <div className="w-full h-full bg-[#020a18] rounded flex items-center justify-center text-[9px] text-slate-600">waiting…</div>
        )}
      </div>
    </div>
  )
}

// ── Scene target panel ───────────────────────────────────────────────────────
function SceneTargetPanel({ labels, diamondsActive, highlightUnknown = false }) {
  const all = [
    ...(diamondsActive ? [{ id: '__unknown', text: 'unknown' }] : []),
    ...labels.map(l => ({ id: l.id, text: labelFor(l) })),
  ]
  return (
    <div className="h-full w-full bg-[#0a1628] border border-[#1a3a5c] rounded-lg p-1.5 overflow-hidden">
      <p className="text-[9px] uppercase tracking-wide text-slate-500 mb-1">Scene Targets</p>
      <div className="flex flex-wrap gap-1 overflow-hidden">
        {all.length === 0 && <p className="text-[10px] text-slate-600 italic">none yet…</p>}
        {all.map(l => (
          <span key={l.id} className={`inline-flex items-center gap-1 px-1.5 py-0.5 bg-[#060e1a] border border-[#1a3a5c] rounded text-[10px] text-[#ddeaf8] ${highlightUnknown && l.id === '__unknown' ? 'cbat-triple-pulse' : ''}`}>
            {l.text}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── System panel ─────────────────────────────────────────────────────────────
function SystemPanel({ columns, highlights, onClickCode, flashCode = null }) {
  return (
    <div className="h-full w-full bg-[#0a1628] border border-[#1a3a5c] rounded-lg p-1 overflow-hidden">
      <div className="grid grid-cols-3 gap-1 h-full">
        {columns.map((col, ci) => (
          <div key={ci} className="sys-column relative overflow-hidden h-full bg-[#060e1a] rounded">
            <div
              className="sys-column-inner"
              style={{ animationDuration: `${col.durationMs}ms` }}
            >
              {/* Duplicated codes so the loop wraps seamlessly. */}
              {[...col.codes, ...col.codes].map((code, ri) => {
                const actualRow = ri % col.codes.length
                const isGreen = highlights.has(`${ci}:${actualRow}`)
                const isFlash = flashCode && code === flashCode
                return (
                  <button
                    key={ri}
                    onClick={() => onClickCode(ci, actualRow, code)}
                    className={`sys-row w-full text-center font-mono text-[15px] cursor-pointer transition-colors ${
                      isGreen ? 'bg-green-500/40 text-green-200' : 'text-[#ddeaf8] hover:bg-[#0f2240]'
                    }${isFlash ? ' cbat-row-flash' : ''}`}
                  >
                    {code}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SystemTargetPanel({ targets }) {
  return (
    <div className="h-full w-full bg-[#0a1628] border border-[#1a3a5c] rounded-lg p-1.5 flex flex-col">
      <p className="text-[9px] uppercase tracking-wide text-slate-500 mb-1">System Targets</p>
      <div className="flex flex-wrap gap-1">
        {targets.map(t => (
          <span key={t.id} className="px-2 py-0.5 bg-[#060e1a] border border-[#2e5d94] rounded font-mono text-[13px] font-bold text-white" style={{ textShadow: '0 0 6px rgba(91,170,255,0.75)' }}>
            {t.code}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Compass ──────────────────────────────────────────────────────────────────
function Compass() {
  return (
    <svg
      width="46" height="46" viewBox="0 0 46 46"
      className="absolute top-1.5 left-1.5 pointer-events-none"
      style={{ zIndex: 25, opacity: 0.55 }}
    >
      <circle cx="23" cy="23" r="20" fill="#060e1a" fillOpacity="0.35" stroke="#1a3a5c" strokeWidth="1.3" />
      <polygon points="23,5 20,23 26,23" fill="#ef4444" />
      <polygon points="23,41 20,23 26,23" fill="#5baaff" />
      <text x="23" y="10" textAnchor="middle" fontSize="7" fill="#ddeaf8" fontWeight="bold">N</text>
      <text x="23" y="43" textAnchor="middle" fontSize="7" fill="#ddeaf8" fontWeight="bold">S</text>
      <text x="5"  y="25" textAnchor="middle" fontSize="7" fill="#ddeaf8" fontWeight="bold">W</text>
      <text x="41" y="25" textAnchor="middle" fontSize="7" fill="#ddeaf8" fontWeight="bold">E</text>
    </svg>
  )
}

// ── Results screen ───────────────────────────────────────────────────────────
function ResultsScreen({ stats }) {
  const grade = computeGrade(stats.totalScore)
  const gradeStyle = {
    'Outstanding': { emoji: '\u{1F396}\uFE0F', color: 'text-green-400' },
    'Good':        { emoji: '\u2708\uFE0F',    color: 'text-brand-300' },
    'Needs Work':  { emoji: '\u{1F527}',       color: 'text-amber-400' },
    'Failed':      { emoji: '\u{1F4A5}',       color: 'text-red-400' },
  }[grade]

  const row = (label, val, sub, wide = false) => (
    <div className={`bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 ${wide ? 'col-span-2' : ''}`}>
      <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-xl font-mono font-bold text-brand-300">{val}</p>
      {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  )

  return (
    <div className="w-full bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-6 text-center">
      <p className="text-4xl mb-2">{gradeStyle.emoji}</p>
      <p className={`text-xl font-extrabold mb-1 ${gradeStyle.color}`}>{grade}</p>
      <p className="text-sm text-slate-400 mb-4">Target Complete</p>

      <div className="grid grid-cols-2 gap-2">
        {row('Scene', stats.sceneScore, `${stats.sceneHits} hit / ${stats.sceneMisses} miss`)}
        {row('Light', stats.lightScore, `${stats.lightMatches} match / ${stats.lightMisclicks} miss`)}
        {row('Scan',  stats.scanScore,  `${stats.scanMatches} match / ${stats.scanMisclicks} miss`)}
        {row('System',stats.systemScore,`${stats.systemMatches} match / ${stats.systemMisclicks} miss`)}
        {row('Alerts', stats.alertScore, `${stats.alertHits} cleared`, true)}
      </div>
    </div>
  )
}

// ── Intro ────────────────────────────────────────────────────────────────────
function Intro({ onStart, onTutorial, personalBest, aircraftReady }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-md bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-6 text-center"
    >
      <p className="text-4xl mb-3">🎯</p>
      <p className="text-xl font-extrabold text-white mb-2">Target</p>
      <p className="text-sm text-slate-400 mb-5">
        Multi-task across eight panels for 2 minutes. Hunt shapes, match light patterns,
        identify aircraft on radar, and find strings in the system feed.
      </p>

      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-4 mb-5 text-left space-y-2">
        <div className="flex items-start gap-2 text-sm text-[#ddeaf8]">
          <span className="text-brand-300 font-bold shrink-0">{'⏱'}</span>
          <span>2-minute total time limit</span>
        </div>
        <div className="flex items-start gap-2 text-sm text-[#ddeaf8]">
          <span className="text-brand-300 font-bold shrink-0">Scene</span>
          <span>click shapes matching each target label</span>
        </div>
        <div className="flex items-start gap-2 text-sm text-[#ddeaf8]">
          <span className="text-brand-300 font-bold shrink-0">Light</span>
          <span>press LOCK when your 3-light pattern matches the target</span>
        </div>
        <div className="flex items-start gap-2 text-sm text-[#ddeaf8]">
          <span className="text-brand-300 font-bold shrink-0">Scan</span>
          <span>press ID when your radar aircraft matches the scan target</span>
        </div>
        <div className="flex items-start gap-2 text-sm text-[#ddeaf8]">
          <span className="text-brand-300 font-bold shrink-0">System</span>
          <span>click any scrolling code matching a system target</span>
        </div>
        <div className="flex items-start gap-2 text-sm text-[#ddeaf8]">
          <span className="text-red-400 font-bold shrink-0">Alert</span>
          <span>click the red pulsing circles fast — the sooner, the more points</span>
        </div>
        <div className="flex items-start gap-2 text-xs text-[#8a9bb5]">
          <span className="shrink-0">{'⚠️'}</span>
          <span>Wrong clicks lose points. Score can go negative.</span>
        </div>
      </div>

      {personalBest && (
        <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 mb-4">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Personal Best</p>
          <p className="text-lg font-mono font-bold text-brand-300">{personalBest.bestScore}</p>
          <p className="text-[10px] text-slate-500">{personalBest.attempts} attempt{personalBest.attempts !== 1 ? 's' : ''}</p>
        </div>
      )}

      <div className="text-center mb-4">
        <Link to="/cbat/target/leaderboard" className="text-xs text-brand-300 hover:text-brand-200 transition-colors">
          {'View Leaderboard \u2192'}
        </Link>
      </div>

      <div className="flex flex-wrap gap-3 justify-center">
        <button
          onClick={onTutorial}
          className="px-6 py-3 bg-[#1a3a5c] hover:bg-[#254a6e] text-[#ddeaf8] font-bold rounded-lg transition-colors text-sm cursor-pointer"
        >
          Tutorial
        </button>
        <button
          onClick={onStart}
          disabled={!aircraftReady}
          className="px-8 py-3 bg-brand-600 hover:bg-brand-700 disabled:bg-[#1a3a5c] disabled:text-slate-500 text-white font-bold rounded-lg transition-colors text-sm cursor-pointer disabled:cursor-not-allowed"
        >
          {aircraftReady ? 'Start' : 'Loading aircraft…'}
        </button>
      </div>
    </motion.div>
  )
}

// ── Tutorial / practice mode ─────────────────────────────────────────────────
// Progressive walkthrough: panels unlock one step at a time. Each step lists the
// panels it enables and the panels it pulses to draw the eye. More steps will be
// appended here one at a time.
// `enabled` is cumulative — each section keeps earlier panels unlocked and adds
// its own. Sections advance automatically as the user completes the task.
const TUTORIAL_STEPS = [
  {
    enabled: { info: true, scene: true, sceneTarget: true },
    // Cycle the spotlight through these panels in order, looping. The matching
    // "unknown" value inside the focused panel gets a rapid triple-pulse, and
    // when the scene is focused, arrows point at each unknown target.
    sequence: ['sceneTarget', 'info', 'scene'],
    title: 'Spot the targets',
    body: (
      <>
        When the game begins, read the <b className="text-brand-300">Scene Targets</b> panel,
        then click the matching targets you see in the <b className="text-brand-300">scene</b>.
        The first target is always <b className="text-brand-300">unknown</b> — check the{' '}
        <b className="text-brand-300">key</b> to work out which shape that is (a diamond),
        then click every one you can find. Watch out for the{' '}
        <b className="text-red-400">red pulsing circle</b> too — click it as fast as you can;
        in the real game these keep appearing, and the quicker you clear them the more points
        you score.
      </>
    ),
  },
  {
    enabled: { info: true, scene: true, sceneTarget: true, light: true, lightTarget: true },
    highlight: ['lightTarget', 'light'],
    title: 'Match the lights',
    body: (
      <>
        Now watch the <b className="text-brand-300">Light Target</b> pattern. The moment your{' '}
        <b className="text-brand-300">Light</b> panel shows the same three colours,
        press <b className="text-brand-300">LOCK</b>.
      </>
    ),
  },
  {
    enabled: {
      info: true, scene: true, sceneTarget: true,
      light: true, lightTarget: true, scan: true, scanTarget: true,
    },
    highlight: ['scanTarget', 'scan'],
    title: 'Identify the aircraft',
    body: (
      <>
        The <b className="text-brand-300">Scan Target</b> shows an aircraft to find. Watch the{' '}
        <b className="text-brand-300">Scan</b> radar — when the aircraft on it matches the target,
        press <b className="text-brand-300">ID</b>.
      </>
    ),
  },
  {
    enabled: {
      info: true, scene: true, sceneTarget: true,
      light: true, lightTarget: true, scan: true, scanTarget: true,
      system: true, systemTarget: true,
    },
    highlight: ['systemTarget', 'system'],
    title: 'Catch the code',
    body: (
      <>
        The <b className="text-brand-300">System Target</b> shows a code. Watch the{' '}
        <b className="text-brand-300">System</b> feed — when that code scrolls into view it will
        flash. Click it before it scrolls away.
      </>
    ),
  },
]

const NO_HIGHLIGHTS = new Set()

// Build a small, fixed practice scene for the first step: a handful of unknown
// diamonds (the only valid targets here) mixed with non-target distractors.
function planTutorialScene() {
  resetPlacements()
  const shapes = []
  const diamonds = randRange(5, 6)
  for (let i = 0; i < diamonds; i++) {
    shapes.push({
      id: uid(), kind: 'unknown', color: 'neutral',
      damaged: false, highPriority: false, direction: null,
      spawnAt: 0, fake: false, ...placeRandom(),
    })
  }
  const distractors = randRange(7, 9)
  for (let i = 0; i < distractors; i++) {
    shapes.push({
      id: uid(), kind: pick(SHAPE_KINDS), color: pick(SHAPE_COLOURS),
      damaged: Math.random() < 0.3, highPriority: Math.random() < 0.3,
      direction: Math.random() < 0.3 ? pick(DIRECTIONS) : null,
      spawnAt: 0, fake: false, ...placeRandom(),
    })
  }
  const fakes = randRange(3, 4)
  for (let i = 0; i < fakes; i++) {
    const fakeKind = Math.random() < 0.5 ? 'octagon' : 'pentagon'
    shapes.push({
      id: uid(), kind: fakeKind, color: pick(SHAPE_COLOURS),
      damaged: false, highPriority: false, direction: null,
      spawnAt: 0, fake: true, ...placeRandom(),
    })
  }
  return shapes
}

// Bouncing arrow pointing down at a scene target. Positioned with the same
// percentage scheme as Shape so it tracks the target across viewport sizes.
function TutorialArrow({ x, y }) {
  const leftPct = (x / 1000) * 100
  const topPct  = (y / 800) * 100
  return (
    <div
      className="cbat-tutorial-arrow"
      style={{ left: `${leftPct}%`, top: `${topPct}%` }}
      aria-hidden
    >
      <svg width="24" height="28" viewBox="0 0 24 28" style={{ display: 'block' }}>
        <path
          d="M12 27 L3 15 H9 V2 H15 V15 H21 Z"
          fill="#5baaff"
          stroke="#06101e"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}

function TutorialDisabledPanel({ label }) {
  return (
    <div className="cbat-tutorial-disabled w-full h-full bg-[#0a1628] border border-[#15293f] rounded-lg flex items-center justify-center select-none">
      <span className="text-[10px] uppercase tracking-wide text-slate-600 flex items-center gap-1">
        {'\u{1F512}'} {label}
      </span>
    </div>
  )
}

function TutorialComplete({ onExit }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="w-full max-w-md bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-6 text-center"
    >
      <p className="text-5xl mb-3">✅</p>
      <p className="text-2xl font-extrabold text-white mb-1">Tutorial Complete</p>
      <p className="text-sm text-slate-400 mb-6">Nice work — you've got the basics down.</p>
      <button
        onClick={onExit}
        className="px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg transition-colors text-sm cursor-pointer"
      >
        Back to Briefing
      </button>
    </motion.div>
  )
}

// Per-playthrough id for tutorial usage tracking. Stamped once per tutorial
// mount; the backend dedupes/upserts on it so repeated progress reports for the
// same playthrough never create a second row.
function makeTutorialRunId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch { /* fall through */ }
  return `tut_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function TargetTutorial({ onExit, shapeScale, aircraftList = [], onProgress }) {
  const [stepIdx, setStepIdx] = useState(0)
  const [done, setDone] = useState(false)
  const [runId] = useState(makeTutorialRunId)

  // Report tutorial usage for admin stats (per-step drop-off funnel). Fires on
  // entry (step 0) and on every section change — forward via auto-advance or the
  // coach-card arrows, and backward jumps too (the backend's $max keeps the
  // recorded reach monotonic). Completion is reported separately below.
  useEffect(() => {
    onProgress?.({ clientRunId: runId, furthestStep: stepIdx, totalSteps: TUTORIAL_STEPS.length, completed: false })
  }, [stepIdx, runId, onProgress])
  useEffect(() => {
    if (done) onProgress?.({ clientRunId: runId, furthestStep: TUTORIAL_STEPS.length - 1, totalSteps: TUTORIAL_STEPS.length, completed: true })
  }, [done, runId, onProgress])
  const [shapes] = useState(() => planTutorialScene())
  const [clicked, setClicked] = useState(() => new Set())
  const [missFlash, setMissFlash] = useState(false)
  // Section 1 also teaches the alert mechanic: a single red pulsing circle the
  // user must click before the section will advance. Cleared once, then gone.
  const [tutAlert, setTutAlert] = useState(() => ({ id: uid(), ...randomAlertPos() }))

  // Section 2 (Light) state.
  const [lightPattern, setLightPattern] = useState(() => randomLightPattern())
  const [lightTarget] = useState(() => randomLightPattern())
  const [lightFlash, setLightFlash] = useState(false)

  // Section 3 (Scan) state. The target is the first available aircraft; the
  // scan panel cycles aircraft and periodically shows the target.
  const [scanPanelAc, setScanPanelAc] = useState(null)
  const [scanFlash, setScanFlash] = useState(false)
  const scanTargetAc = aircraftList[0] || null

  // Section 4 (System) state. Target code is injected below the visible fold so
  // it scrolls into view; an IntersectionObserver flashes it once it's visible.
  const systemRef = useRef(null)
  const [sysColumns, setSysColumns] = useState(() => initSysColumns())
  const [sysTarget, setSysTarget] = useState(null)
  const [sysTargetPlaced, setSysTargetPlaced] = useState(false)
  const [sysTargetInView, setSysTargetInView] = useState(false)

  // Coach card height animates as the per-section copy changes, so the panels
  // below slide rather than jump when the text length differs between sections.
  const coachRef = useRef(null)
  const [coachHeight, setCoachHeight] = useState('auto')
  useEffect(() => {
    const el = coachRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setCoachHeight(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const step = TUTORIAL_STEPS[stepIdx]
  const enabled = step?.enabled || {}
  const sequence = step?.sequence || null

  // Once the user starts clicking targets, freeze the guided spotlight cycle and
  // let them finish clicking the remaining unknown targets at their own pace.
  const [engaged, setEngaged] = useState(false)
  // Cycle the spotlight through the step's sequence (looping). Falls back to a
  // static highlight set for steps that don't define a sequence. The index grows
  // unbounded and is wrapped with modulo so it stays valid across step changes.
  const [focusIdx, setFocusIdx] = useState(0)
  useEffect(() => {
    if (engaged || !sequence || sequence.length < 2) return
    const id = setInterval(() => setFocusIdx(i => i + 1), 2600)
    return () => clearInterval(id)
  }, [stepIdx, sequence, engaged])
  const focus = engaged ? null : (sequence ? sequence[focusIdx % sequence.length] : null)

  const isPulsing = (panel) => (!engaged && (sequence ? focus === panel : step?.highlight?.includes(panel)))
  const pulse = (panel) => (isPulsing(panel) ? ' cbat-tutorial-pulse' : '')

  // Which section's task is currently active — gates each panel's button flash
  // and completion so e.g. the Light LOCK stops flashing/advancing once the user
  // has moved on to the Scan section.
  const lightActive  = !!step?.highlight?.includes('light')
  const scanActive   = !!step?.highlight?.includes('scan')
  const systemActive = !!step?.highlight?.includes('system')

  // Section 2: cycle the player's light pattern so a match periodically appears.
  // Mirrors the live game — when the current pattern matches the target, hold it
  // noticeably longer so the player has time to spot it and press LOCK. The
  // effect re-runs whenever the pattern changes, re-scheduling the next change.
  useEffect(() => {
    if (!enabled.light) return
    const matching = lightPattern.every((c, i) => c === lightTarget[i])
    const delay = matching ? 3600 : 1600
    const id = setTimeout(() => {
      setLightPattern(Math.random() < 0.4 ? [...lightTarget] : randomLightPattern())
    }, delay)
    return () => clearTimeout(id)
  }, [enabled.light, lightPattern, lightTarget])

  // Section 3: cycle the scan panel aircraft, holding a match longer (mirrors
  // the light cycle). Re-runs on each panel change to re-schedule.
  useEffect(() => {
    if (!enabled.scan || !scanTargetAc) return
    const matching = scanPanelAc && scanPanelAc.briefId === scanTargetAc.briefId
    const delay = matching ? 3600 : (scanPanelAc ? 1800 : 0)
    const id = setTimeout(() => {
      const pickAc = Math.random() < 0.45 ? scanTargetAc : pick(aircraftList)
      setScanPanelAc(scanFrame(pickAc))
    }, delay)
    return () => clearTimeout(id)
  }, [enabled.scan, scanPanelAc, scanTargetAc, aircraftList])

  // Section 4: once the System panel is shown, measure the visible height and
  // inject the target code just below the fold so it scrolls into view rather
  // than starting on screen. Runs inside rAF so it reads post-layout sizes.
  useEffect(() => {
    if (!enabled.system || sysTargetPlaced) return
    const raf = requestAnimationFrame(() => {
      const colEl = systemRef.current?.querySelector('.sys-column')
      if (!colEl) return
      const visibleRows = Math.max(1, Math.floor(colEl.clientHeight / 32))
      const targetRow = Math.min(sysColumns[0].codes.length - 1, visibleRows + 1)
      const code = randomCode()
      setSysColumns(prev => {
        const next = prev.map(c => ({ ...c, codes: [...c.codes] }))
        next[0].codes[targetRow] = code
        return next
      })
      setSysTarget({ id: uid(), code })
      setSysTargetPlaced(true)
    })
    return () => cancelAnimationFrame(raf)
  }, [enabled.system, sysTargetPlaced, sysColumns])

  // Flash the target row only while it's actually scrolled into the viewport.
  useEffect(() => {
    if (!enabled.system || !sysTarget || typeof IntersectionObserver === 'undefined') return
    const rootEl = systemRef.current
    const nodes = rootEl
      ? Array.from(rootEl.querySelectorAll('.sys-row')).filter(n => n.textContent === sysTarget.code)
      : []
    if (!nodes.length) return
    const io = new IntersectionObserver(
      (entries) => setSysTargetInView(entries.some(e => e.isIntersecting)),
      { root: nodes[0].closest('.sys-column'), threshold: 0.85 },
    )
    nodes.forEach(n => io.observe(n))
    return () => io.disconnect()
  }, [enabled.system, sysTarget])

  const visibleShapes = shapes.filter(s => !clicked.has(s.id))

  // Advance to the next section, or finish the tutorial after the last one.
  const advance = () => {
    if (stepIdx < TUTORIAL_STEPS.length - 1) {
      setEngaged(false)
      setFocusIdx(0)
      setStepIdx(stepIdx + 1)
    } else {
      setDone(true)
    }
  }

  // Manual section navigation via the coach-card arrows. Resets the per-section
  // guidance state so the chosen section plays from its start.
  const goToStep = (idx) => {
    if (idx < 0 || idx > TUTORIAL_STEPS.length - 1) return
    setEngaged(false)
    setFocusIdx(0)
    setStepIdx(idx)
  }

  const onSceneClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const clickX = e.clientX - rect.left
    const clickY = e.clientY - rect.top
    const scaleX = rect.width / 1000
    const scaleY = rect.height / 800
    const hits = visibleShapes.filter(s => {
      const sx = s.x * scaleX
      const sy = s.y * scaleY
      const half = SHAPE_R_BASE * shapeScale * (KIND_SCALE[s.kind] || 1) + 8
      return Math.abs(sx - clickX) <= half && Math.abs(sy - clickY) <= half
    })
    if (hits.length === 0) return
    // Prefer an unknown diamond when several shapes overlap the click.
    hits.sort((a, b) => {
      const p = (b.kind === 'unknown' ? 1 : 0) - (a.kind === 'unknown' ? 1 : 0)
      if (p !== 0) return p
      const da = Math.hypot(a.x * scaleX - clickX, a.y * scaleY - clickY)
      const db = Math.hypot(b.x * scaleX - clickX, b.y * scaleY - clickY)
      return da - db
    })
    const hit = hits[0]
    if (hit.kind === 'unknown') {
      setClicked(prev => new Set(prev).add(hit.id))
      setEngaged(true)
      // Advance only once every unknown AND the alert circle are cleared.
      const remaining = visibleShapes.filter(s => s.kind === 'unknown' && s.id !== hit.id).length
      if (remaining === 0 && !tutAlert) advance()
    } else {
      setMissFlash(true)
      setTimeout(() => setMissFlash(false), 300)
    }
  }

  const onTutAlertClick = () => {
    setTutAlert(null)
    setEngaged(true)
    // If the diamonds are already gone, clearing the alert finishes section 1.
    const remainingUnknown = visibleShapes.filter(s => s.kind === 'unknown').length
    if (remainingUnknown === 0) advance()
  }

  const onLightPress = () => {
    if (lightActive && lightPattern.every((c, i) => c === lightTarget[i])) {
      setLightFlash(true)
      setTimeout(() => setLightFlash(false), 300)
      advance()
    }
  }

  const onScanPress = () => {
    if (scanActive && scanPanelAc && scanTargetAc && scanPanelAc.briefId === scanTargetAc.briefId) {
      setScanFlash(true)
      setTimeout(() => setScanFlash(false), 300)
      advance()
    }
  }

  const onSysCodeClick = (ci, row, code) => {
    if (systemActive && sysTarget && code === sysTarget.code) advance()
  }

  if (done) {
    return (
      <div className="flex flex-col items-center">
        <TutorialComplete onExit={onExit} />
      </div>
    )
  }

  const diamondsActive = visibleShapes.some(s => s.kind === 'unknown')
  const lightsMatch = lightActive && lightPattern.every((c, i) => c === lightTarget[i])
  const scanMatch = scanActive && scanPanelAc && scanTargetAc &&
    scanPanelAc.briefId === scanTargetAc.briefId

  return (
    <div>
      {/* Coach card — height animates as the per-section copy changes so the
          panels below slide smoothly instead of snapping. */}
      <motion.div
        animate={{ height: coachHeight }}
        transition={{ duration: 0.3, ease: 'easeInOut' }}
        style={{ overflow: 'hidden' }}
        className="mb-3"
      >
        <div ref={coachRef} className="w-full bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase tracking-wide text-brand-300 font-bold">Practice Mode</span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => goToStep(stepIdx - 1)}
                disabled={stepIdx === 0}
                aria-label="Previous section"
                className="px-1.5 py-0.5 text-base leading-none text-slate-400 hover:text-brand-300 disabled:opacity-30 disabled:cursor-not-allowed bg-transparent border-0 cursor-pointer"
              >
                {'‹'}
              </button>
              <span className="text-[10px] text-slate-500 tabular-nums">{stepIdx + 1} / {TUTORIAL_STEPS.length}</span>
              <button
                onClick={() => goToStep(stepIdx + 1)}
                disabled={stepIdx === TUTORIAL_STEPS.length - 1}
                aria-label="Next section"
                className="px-1.5 py-0.5 text-base leading-none text-slate-400 hover:text-brand-300 disabled:opacity-30 disabled:cursor-not-allowed bg-transparent border-0 cursor-pointer"
              >
                {'›'}
              </button>
            </div>
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={stepIdx}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
            >
              <h2 className="text-base font-extrabold text-white mb-1">{step.title}</h2>
              <p className="text-sm text-[#ddeaf8] leading-relaxed">{step.body}</p>
            </motion.div>
          </AnimatePresence>
          <div className="flex items-center gap-3 mt-4">
            <button
              onClick={onExit}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors bg-transparent border-0 cursor-pointer"
            >
              Exit practice
            </button>
          </div>
        </div>
      </motion.div>

      {/* Practice arena — same grid as the live game; locked panels greyed out */}
      <div className="cbat-target-arena">
        <div className="cbat-target-grid">
          <div className={`grid-info${pulse('info')}`}>
            {enabled.info ? <InfoPanel highlightUnknown={focus === 'info'} /> : <TutorialDisabledPanel label="Key" />}
          </div>
          <div className={`grid-light${pulse('light')}`}>
            {enabled.light
              ? <LightPanel pattern={lightPattern} flash={lightFlash} onPress={onLightPress} lockPulse={lightsMatch} />
              : <TutorialDisabledPanel label="Light" />}
          </div>
          <div className={`grid-scan${pulse('scan')}`}>
            {enabled.scan
              ? <ScanPanel aircraft={scanPanelAc} onPress={onScanPress} flash={scanFlash} idPulse={scanMatch} />
              : <TutorialDisabledPanel label="Scan" />}
          </div>
          <div ref={systemRef} className={`grid-system${pulse('system')}`}>
            {enabled.system
              ? <SystemPanel
                  columns={sysColumns}
                  highlights={NO_HIGHLIGHTS}
                  onClickCode={onSysCodeClick}
                  flashCode={sysTargetInView ? sysTarget?.code : null}
                />
              : <TutorialDisabledPanel label="System" />}
          </div>
          <div className={`grid-scene${pulse('scene')}`}>
            {enabled.scene ? (
              <div
                className={`cbat-target-scene relative w-full h-full border rounded-lg overflow-hidden cursor-pointer transition-colors ${missFlash ? 'border-red-500' : 'border-[#1a3a5c]'}`}
                onClick={onSceneClick}
              >
                <Compass />
                {visibleShapes.map(s => (
                  <Shape key={s.id} shape={s} scale={shapeScale} />
                ))}
                {(engaged || focus === 'scene') && visibleShapes
                  .filter(s => s.kind === 'unknown')
                  .map(s => <TutorialArrow key={`arrow-${s.id}`} x={s.x} y={s.y} />)}
                {stepIdx === 0 && tutAlert && (
                  <AlertCircle alert={tutAlert} scale={shapeScale} onClick={onTutAlertClick} />
                )}
              </div>
            ) : <TutorialDisabledPanel label="Scene" />}
          </div>
          <div className={`grid-scene-target${pulse('sceneTarget')}`}>
            {enabled.sceneTarget
              ? <SceneTargetPanel labels={[]} diamondsActive={diamondsActive} highlightUnknown={focus === 'sceneTarget'} />
              : <TutorialDisabledPanel label="Scene Targets" />}
          </div>
          <div className={`grid-light-target${pulse('lightTarget')}`}>
            {enabled.lightTarget
              ? <LightTargetPanel pattern={lightTarget} />
              : <TutorialDisabledPanel label="Light Target" />}
          </div>
          <div className={`grid-scan-target${pulse('scanTarget')}`}>
            {enabled.scanTarget
              ? <ScanTargetPanel aircraft={scanTargetAc} />
              : <TutorialDisabledPanel label="Scan Target" />}
          </div>
          <div className={`grid-system-target${pulse('systemTarget')}`}>
            {enabled.systemTarget
              ? <SystemTargetPanel targets={sysTarget ? [sysTarget] : []} />
              : <TutorialDisabledPanel label="System Target" />}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function CbatTarget() {
  const { user, apiFetch, API } = useAuth()
  const { start: startTracking, markCompleted: markGameCompleted } = useCbatTracking()
  const { settings } = useAppSettings()
  const shapeScale = useShapeScale()

  const [phase, setPhase] = useState('intro')         // intro | playing | tutorial | results

  // Fire-and-forget tutorial usage tracking (admin Reports per-step drop-off).
  // Online-only by design — a learning aid, not a score, so no offline outbox.
  const reportTutorialProgress = useCallback((body) => {
    if (!user) return
    apiFetch(`${API}/api/games/cbat/target/tutorial`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {})
  }, [user, apiFetch, API])
  const { enterImmersive, exitImmersive } = useGameChrome()
  useEffect(() => {
    // Hide the nav chrome during the live game and the practice tutorial.
    if (phase === 'playing' || phase === 'tutorial') enterImmersive()
    else exitImmersive()
    return exitImmersive
  }, [phase, enterImmersive, exitImmersive])
  const [elapsedMs, setElapsedMs] = useState(0)
  const [personalBest, setPersonalBest] = useState(null)
  const [scoreSaved, setScoreSaved] = useState(false)
  const [queued, setQueued] = useState(false)
  const [aircraftList, setAircraftList] = useState([])

  // Game state
  const [shapes, setShapes] = useState([])            // all shapes with spawnAt
  const [clickedShapeIds, setClickedShapeIds] = useState(new Set())
  const [allTargets, setAllTargets] = useState([])    // pre-planned target labels
  const [activeTargetIds, setActiveTargetIds] = useState([])  // currently shown in label panel
  const [dismissedTargetIds, setDismissedTargetIds] = useState(new Set())

  // Light state
  const [lightPattern, setLightPattern] = useState(randomLightPattern)
  const [lightTarget, setLightTarget] = useState(randomLightPattern)
  const [lightFlash, setLightFlash] = useState(false)
  const [scanFlash, setScanFlash] = useState(false)
  const lightLastChangeRef = useRef(0)
  const lightChangeCountRef = useRef(0)
  const lightForceMatchAtRef = useRef(randRange(3, 6))

  // Scan state
  const [scanPanelAc, setScanPanelAc] = useState(null)
  const [scanTargetAc, setScanTargetAc] = useState(null)
  const scanLastChangeRef = useRef(0)
  const scanTargetLastChangeRef = useRef(0)
  // After a correct scan-panel match, keep the panel empty until this elapsedMs.
  const scanCooldownUntilRef = useRef(0)

  // Alert state — red pulsing circles that persist until clicked and stack.
  const [alerts, setAlerts] = useState([])          // [{ id, x, y, spawnAt }]
  const nextAlertAtRef = useRef(0)

  // System state — 3 columns of codes
  const [sysColumns, setSysColumns] = useState(() => initSysColumns())
  const [sysHighlights, setSysHighlights] = useState(new Set()) // key 'col:row'
  const [sysTargets, setSysTargets] = useState([])              // [{id, code}]

  // Score breakdown
  const [stats, setStats] = useState(() => blankStats())

  // Timers
  const tickRef = useRef(null)
  const startedAtRef = useRef(null)

  // ── Fetch personal best + aircraft on mount ────────────────────────────────
  useEffect(() => {
    if (!user) return
    apiFetch(`${API}/api/games/cbat/target/personal-best`)
      .then(r => r.json())
      .then(d => { if (d.data) setPersonalBest(d.data) })
      .catch(() => {})
    getAircraftRoster('aircraft-cutouts', { apiFetch, API })
      .then(d => {
        const allowlist = new Set((settings?.cbatTargetAircraftBriefIds ?? []).map(String))
        const list = (d.data || [])
          .filter(a => has3DModel(a.briefId, a.title))
          .filter(a => allowlist.has(String(a.briefId)))
          .map(a => ({ ...a, modelUrl: getModelUrl(a.briefId, a.title) }))
        setAircraftList(list)
      })
      .catch(() => {})
  }, [user, settings?.cbatTargetAircraftBriefIds])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Start game ─────────────────────────────────────────────────────────────
  const startGame = useCallback(() => {
    if (aircraftList.length < 1) return
    startTracking('target')
    resetPlacements()
    const { targets, shapes } = planGame()
    setShapes(shapes)
    setAllTargets(targets)
    setActiveTargetIds([])
    setDismissedTargetIds(new Set())
    setClickedShapeIds(new Set())
    setLightPattern(randomLightPattern())
    setLightTarget(randomLightPattern())
    setScanPanelAc(null)
    setScanTargetAc(null)
    setSysColumns(initSysColumns())
    setSysHighlights(new Set())
    setSysTargets([{ id: uid(), code: randomCode() }])
    setAlerts([])
    nextAlertAtRef.current = randRange(ALERT_GAP_MIN_MS, ALERT_GAP_MAX_MS)
    setStats(blankStats())
    setElapsedMs(0)
    setScoreSaved(false)
    lightLastChangeRef.current = 0
    lightChangeCountRef.current = 0
    lightForceMatchAtRef.current = randRange(3, 6)
    scanLastChangeRef.current = 0
    scanTargetLastChangeRef.current = 0
    scanCooldownUntilRef.current = 0
    startedAtRef.current = performance.now()
    setPhase('playing')
  }, [aircraftList])

  // ── Master tick ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'playing') return
    tickRef.current = setInterval(() => {
      const now = performance.now() - startedAtRef.current
      setElapsedMs(Math.min(now, GAME_MS))
      if (now >= GAME_MS) {
        clearInterval(tickRef.current)
      }
    }, 100)
    return () => clearInterval(tickRef.current)
  }, [phase])

  // System panel now scrolls via pure CSS animation (see .sys-column-inner).
  // We only mutate codes for target injection / post-match replacement.

  // Ensure every active system target exists somewhere in the scrolling columns.
  useEffect(() => {
    if (phase !== 'playing') return
    setSysColumns(prev => {
      const present = new Set(prev.flatMap(col => col.codes))
      const missing = sysTargets.filter(t => !present.has(t.code))
      if (missing.length === 0) return prev
      const next = prev.map(col => ({ ...col, codes: [...col.codes] }))
      for (const t of missing) {
        const ci = rand(3)
        const ri = rand(next[ci].codes.length)
        next[ci].codes[ri] = t.code
      }
      return next
    })
  }, [sysTargets, phase])

  // ── Check light-change schedule ────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'playing') return
    // When the current pattern already matches the target, hold it twice as
    // long so the player has a better chance of spotting and clicking it.
    const currentlyMatching = lightPattern.every((c, i) => c === lightTarget[i])
    const interval = currentlyMatching ? LIGHT_CHANGE_MS * 2 : LIGHT_CHANGE_MS
    if (elapsedMs - lightLastChangeRef.current < interval) return
    lightLastChangeRef.current = elapsedMs
    lightChangeCountRef.current += 1
    if (lightChangeCountRef.current >= lightForceMatchAtRef.current) {
      setLightPattern([...lightTarget])
      lightChangeCountRef.current = 0
      lightForceMatchAtRef.current = randRange(3, 6)
    } else {
      setLightPattern(randomLightPattern())
    }
  }, [elapsedMs, phase, lightTarget, lightPattern])

  // Pick an aircraft for the scan panel, biased toward the current scan target
  // so players can score ID points regularly rather than waiting on a pure
  // random-draw coincidence.
  const pickScanPanelAircraft = useCallback((target) => {
    if (target && Math.random() < SCAN_PANEL_MATCH_CHANCE) return target
    return pick(aircraftList)
  }, [aircraftList])

  // ── Scan panel / target schedules ──────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'playing' || aircraftList.length === 0) return
    const cooldownActive = elapsedMs < scanCooldownUntilRef.current
    // First scan target appears at 10s; scan panel starts at same time
    if (!scanTargetAc && elapsedMs >= SCAN_FIRST_APPEAR_MS) {
      const nextTarget = pick(aircraftList)
      setScanTargetAc(nextTarget)
      scanTargetLastChangeRef.current = elapsedMs
      if (!scanPanelAc && !cooldownActive) {
        setScanPanelAc(scanFrame(pickScanPanelAircraft(nextTarget)))
        scanLastChangeRef.current = elapsedMs
      }
      return
    }
    if (!scanPanelAc && !cooldownActive && elapsedMs >= SCAN_FIRST_APPEAR_MS) {
      setScanPanelAc(scanFrame(pickScanPanelAircraft(scanTargetAc)))
      scanLastChangeRef.current = elapsedMs
    }
    // Rotate scan target (SCAN_TARGET_CHANGE_MS)
    if (scanTargetAc && elapsedMs - scanTargetLastChangeRef.current >= SCAN_TARGET_CHANGE_MS) {
      setScanTargetAc(pick(aircraftList))
      scanTargetLastChangeRef.current = elapsedMs
    }
    // Rotate scan panel (SCAN_PANEL_CHANGE_MS) — biased to current target
    if (scanPanelAc && elapsedMs - scanLastChangeRef.current >= SCAN_PANEL_CHANGE_MS) {
      setScanPanelAc(scanFrame(pickScanPanelAircraft(scanTargetAc)))
      scanLastChangeRef.current = elapsedMs
    }
  }, [elapsedMs, phase, aircraftList, scanPanelAc, scanTargetAc, pickScanPanelAircraft])

  // ── Scene-target activation schedule ───────────────────────────────────────
  useEffect(() => {
    if (phase !== 'playing') return
    // Activate any target whose time has arrived and hasn't been activated yet.
    const toActivate = allTargets.filter(t =>
      elapsedMs >= t.activateAt &&
      !activeTargetIds.includes(t.id) &&
      !dismissedTargetIds.has(t.id)
    )
    if (toActivate.length === 0) return
    setActiveTargetIds(prev => {
      let next = prev
      for (const t of toActivate) {
        if (next.length >= MAX_ACTIVE_TARGETS) break
        next = [...next, t.id]
      }
      return next
    })
    // Targets that don't fit into the active panel are permanently skipped.
    const overflow = toActivate.slice(Math.max(0, MAX_ACTIVE_TARGETS - activeTargetIds.length))
    if (overflow.length) {
      setDismissedTargetIds(prev => {
        const ns = new Set(prev)
        overflow.forEach(t => ns.add(t.id))
        return ns
      })
    }
  }, [elapsedMs, phase, allTargets, activeTargetIds, dismissedTargetIds])

  // ── Second system-target at 60s ────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'playing') return
    if (elapsedMs >= SECOND_SYS_TARGET_MS && sysTargets.length < 2) {
      setSysTargets(prev => prev.length < 2 ? [...prev, { id: uid(), code: randomCode() }] : prev)
    }
  }, [elapsedMs, phase, sysTargets.length])

  // ── Alert spawn schedule ───────────────────────────────────────────────────
  // Drop a new alert once the next-spawn time has passed, then schedule the one
  // after it 8–15s out. Existing alerts stay put until clicked, so they stack.
  useEffect(() => {
    if (phase !== 'playing') return
    if (elapsedMs < nextAlertAtRef.current) return
    setAlerts(prev => [...prev, { id: uid(), spawnAt: elapsedMs, ...randomAlertPos() }])
    nextAlertAtRef.current = elapsedMs + randRange(ALERT_GAP_MIN_MS, ALERT_GAP_MAX_MS)
  }, [elapsedMs, phase])

  // ── End game ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'playing') return
    if (elapsedMs < GAME_MS) return
    // Submit + show results
    const finalTime = GAME_MS / 1000
    const grade = computeGrade(stats.totalScore)
    setScoreSaved(false)
    setQueued(false)
    markGameCompleted({ score: stats.totalScore })
    submitCbatResult(`target`, { ...stats, totalTime: finalTime, grade }, { apiFetch, API })
      .then((r) => {
        setScoreSaved(!!r?.synced)
        setQueued(!!r?.queued)
        apiFetch(`${API}/api/games/cbat/target/personal-best`)
          .then(r => r.json())
          .then(d => { if (d.data) setPersonalBest(d.data) })
          .catch(() => {})
      })
      .catch(() => {})
    setPhase('results')
  }, [elapsedMs, phase, stats])  // eslint-disable-line react-hooks/exhaustive-deps

  const goToIntro = useCallback(() => {
    clearInterval(tickRef.current)
    setPhase('intro')
  }, [])

  // ── Derived values ─────────────────────────────────────────────────────────
  const visibleShapes = useMemo(() => (
    shapes.filter(s => s.spawnAt <= elapsedMs && !clickedShapeIds.has(s.id))
  ), [shapes, elapsedMs, clickedShapeIds])

  const activeTargets = useMemo(() => {
    return activeTargetIds
      .map(id => allTargets.find(t => t.id === id))
      .filter(Boolean)
      .map(t => {
        const remaining = visibleShapes.filter(s => shapeMatches(s, t)).length
        return { ...t, remaining }
      })
  }, [activeTargetIds, allTargets, visibleShapes])

  // Auto-dismiss labels where remaining = 0
  useEffect(() => {
    if (phase !== 'playing') return
    const toRemove = activeTargets.filter(t => t.remaining === 0).map(t => t.id)
    if (toRemove.length === 0) return
    setActiveTargetIds(prev => prev.filter(id => !toRemove.includes(id)))
    setDismissedTargetIds(prev => {
      const ns = new Set(prev)
      toRemove.forEach(id => ns.add(id))
      return ns
    })
  }, [activeTargets, phase])

  const diamondsActive = visibleShapes.some(s => s.kind === 'unknown')

  const lightsMatch = lightPattern.every((c, i) => c === lightTarget[i])

  const scansMatch = scanPanelAc && scanTargetAc &&
    scanPanelAc.briefId === scanTargetAc.briefId

  // ── Event handlers ─────────────────────────────────────────────────────────
  const addScore = (delta, field) => {
    setStats(prev => ({
      ...prev,
      totalScore: prev.totalScore + delta,
      [field + 'Score']: prev[field + 'Score'] + delta,
    }))
  }
  const bumpCounter = (field) => setStats(prev => ({ ...prev, [field]: prev[field] + 1 }))

  // Scene-level click: hit-test every shape whose box contains the click, then
  // pick the most valuable candidate (active-target match > diamond > real non-
  // matching > fake). Prevents a fake octagon visually on top of a matching
  // shape from stealing the click.
  const onSceneClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const clickX = e.clientX - rect.left
    const clickY = e.clientY - rect.top
    const scaleX = rect.width / 1000
    const scaleY = rect.height / 800

    const hits = visibleShapes.filter(s => {
      const sx = s.x * scaleX
      const sy = s.y * scaleY
      const half = SHAPE_R_BASE * shapeScale * (KIND_SCALE[s.kind] || 1) + 8
      return Math.abs(sx - clickX) <= half && Math.abs(sy - clickY) <= half
    })
    if (hits.length === 0) return

    const priority = (s) => {
      if (s.fake) return 0
      if (s.kind === 'unknown') return 2
      if (activeTargets.some(t => shapeMatches(s, t))) return 4  // best
      return 1
    }
    hits.sort((a, b) => {
      const p = priority(b) - priority(a)
      if (p !== 0) return p
      const da = Math.hypot(a.x * scaleX - clickX, a.y * scaleY - clickY)
      const db = Math.hypot(b.x * scaleX - clickX, b.y * scaleY - clickY)
      return da - db
    })
    onShapeClick(hits[0])
  }

  const onShapeClick = (shape) => {
    if (shape.fake || shape.kind === 'octagon' || shape.kind === 'line' || shape.kind === 'pentagon') {
      bumpCounter('sceneMisses')
      addScore(SCORE.sceneMiss, 'scene')
      return
    }
    // Diamonds match the ever-present "unknown" pseudo-target
    if (shape.kind === 'unknown') {
      setClickedShapeIds(prev => new Set(prev).add(shape.id))
      bumpCounter('sceneHits')
      addScore(SCORE.sceneHit + SCORE.sceneHitBonus, 'scene')
      return
    }
    // Real shape — must match at least one active target to count as a hit
    const matched = activeTargets.some(t => shapeMatches(shape, t))
    if (!matched) {
      bumpCounter('sceneMisses')
      addScore(SCORE.sceneMiss, 'scene')
      return
    }
    setClickedShapeIds(prev => new Set(prev).add(shape.id))
    bumpCounter('sceneHits')
    addScore(SCORE.sceneHit + SCORE.sceneHitBonus, 'scene')
  }

  const onLightPress = () => {
    if (lightsMatch) {
      const dt = (elapsedMs - lightLastChangeRef.current) / LIGHT_CHANGE_MS
      const bonus = Math.max(0, Math.round(SCORE.lightBonus * (1 - dt)))
      bumpCounter('lightMatches')
      addScore(SCORE.lightMatch + bonus, 'light')
      setLightTarget(randomLightPattern())
      setLightPattern(randomLightPattern())
      lightLastChangeRef.current = elapsedMs
      lightChangeCountRef.current = 0
      lightForceMatchAtRef.current = randRange(3, 6)
      setLightFlash(true)
      setTimeout(() => setLightFlash(false), 350)
    } else {
      bumpCounter('lightMisclicks')
      addScore(SCORE.lightMiss, 'light')
    }
  }

  const onScanPress = () => {
    if (scansMatch) {
      const dt = (elapsedMs - scanLastChangeRef.current) / SCAN_PANEL_CHANGE_MS
      const bonus = Math.max(0, Math.round(SCORE.scanBonus * (1 - dt)))
      bumpCounter('scanMatches')
      addScore(SCORE.scanMatch + bonus, 'scan')
      // Clear the panel and hold it empty for SCAN_PANEL_MATCH_COOLDOWN_MS
      // so the player can't mash IDs in quick succession on the same target.
      setScanPanelAc(null)
      scanCooldownUntilRef.current = elapsedMs + SCAN_PANEL_MATCH_COOLDOWN_MS
      scanLastChangeRef.current = elapsedMs
      setScanFlash(true)
      setTimeout(() => setScanFlash(false), 350)
    } else {
      bumpCounter('scanMisclicks')
      addScore(SCORE.scanMiss, 'scan')
    }
  }

  const onAlertClick = (alert) => {
    const age = elapsedMs - alert.spawnAt
    const frac = Math.max(0, 1 - age / ALERT_SCORE_WINDOW_MS)
    const bonus = Math.round(SCORE.alertBonus * frac)
    setAlerts(prev => prev.filter(a => a.id !== alert.id))
    bumpCounter('alertHits')
    addScore(SCORE.alertHit + bonus, 'alert')
  }

  const onSysCodeClick = (col, row, code) => {
    const hitTarget = sysTargets.find(t => t.code === code)
    if (!hitTarget) {
      bumpCounter('systemMisclicks')
      addScore(SCORE.systemMiss, 'system')
      return
    }
    const key = `${col}:${row}`
    setSysHighlights(prev => new Set(prev).add(key))
    bumpCounter('systemMatches')
    addScore(SCORE.systemMatch, 'system')
    setTimeout(() => {
      setSysHighlights(prev => {
        const ns = new Set(prev); ns.delete(key); return ns
      })
      // Replace every instance of the old target code with a new random code,
      // and swap the target to a new 4-digit code.
      const newCode = randomCode()
      setSysColumns(prev => prev.map(c => ({
        ...c,
        codes: c.codes.map(cc => cc === hitTarget.code ? randomCode() : cc),
      })))
      setSysTargets(prev => prev.map(t => t.id === hitTarget.id ? { ...t, code: newCode } : t))
    }, SYS_GREEN_FADE_MS)
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const remainingS = Math.max(0, (GAME_MS - elapsedMs) / 1000)

  return (
    <div className="cbat-target-page">
      <SEO title="Target — CBAT" description="Multi-panel CBAT target identification game." />

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
        <div className="flex items-center gap-2 mb-2">
          {phase === 'intro'
            ? <Link to="/cbat" className="text-slate-500 hover:text-brand-400 transition-colors text-sm">&larr; CBAT</Link>
            : <button onClick={goToIntro} className="text-slate-500 hover:text-brand-400 transition-colors text-sm bg-transparent border-0 p-0 cursor-pointer">&larr; Instructions</button>
          }
          <h1 className="text-sm font-extrabold text-slate-900">{phase === 'tutorial' ? 'Target Tutorial' : 'Target'}</h1>
        </div>
      )}

      {user && (phase === 'intro' || phase === 'results') && (
        <div className="flex flex-col items-center">
          {phase === 'intro' && (
            <Intro onStart={startGame} onTutorial={() => setPhase('tutorial')} personalBest={personalBest} aircraftReady={aircraftList.length > 0} />
          )}
          {phase === 'results' && (
            <CbatGameOver
              gameKey="target"
              score={stats.totalScore}
              scoreSaved={scoreSaved}
              queued={queued}
              personalBest={personalBest}
              onPlayAgain={() => setPhase('intro')}
            >
              <ResultsScreen stats={stats} />
            </CbatGameOver>
          )}
        </div>
      )}

      {user && phase === 'tutorial' && (
        <TargetTutorial onExit={() => setPhase('intro')} shapeScale={shapeScale} aircraftList={aircraftList} onProgress={reportTutorialProgress} />
      )}

      {user && phase === 'playing' && (
        <div className="cbat-target-arena">
          {/* Top HUD strip */}
          <div className="cbat-target-hud">
            <span className="font-mono text-xs text-slate-400">
              ⏱ <span className="text-brand-300">{remainingS.toFixed(1)}s</span>
            </span>
            <span className="font-mono text-xs text-slate-400">
              Score: <span className={stats.totalScore >= 0 ? 'text-brand-300' : 'text-red-400'}>{stats.totalScore}</span>
            </span>
          </div>

          <div className="cbat-target-grid">
            <div className="grid-info"><InfoPanel /></div>
            <div className="grid-light"><LightPanel pattern={lightPattern} flash={lightFlash} onPress={onLightPress} /></div>
            <div className="grid-scan"><ScanPanel aircraft={scanPanelAc} onPress={onScanPress} flash={scanFlash} /></div>
            <div className="grid-system">
              <SystemPanel columns={sysColumns} highlights={sysHighlights} onClickCode={onSysCodeClick} />
            </div>
            <div className="grid-scene">
              <div
                className="cbat-target-scene relative w-full h-full border border-[#1a3a5c] rounded-lg overflow-hidden cursor-pointer"
                onClick={onSceneClick}
              >
                <Compass />
                {visibleShapes.map(s => (
                  <Shape key={s.id} shape={s} scale={shapeScale} />
                ))}
                {alerts.map(a => (
                  <AlertCircle key={a.id} alert={a} scale={shapeScale} onClick={onAlertClick} />
                ))}
              </div>
            </div>
            <div className="grid-scene-target"><SceneTargetPanel labels={activeTargets} diamondsActive={diamondsActive} /></div>
            <div className="grid-light-target"><LightTargetPanel pattern={lightTarget} /></div>
            <div className="grid-scan-target"><ScanTargetPanel aircraft={scanTargetAc} /></div>
            <div className="grid-system-target"><SystemTargetPanel targets={sysTargets} /></div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Helpers used by state init ───────────────────────────────────────────────
function blankStats() {
  return {
    totalScore: 0,
    sceneScore: 0, lightScore: 0, scanScore: 0, systemScore: 0, alertScore: 0,
    sceneHits: 0, sceneMisses: 0,
    lightMatches: 0, lightMisclicks: 0,
    scanMatches: 0, scanMisclicks: 0,
    systemMatches: 0, systemMisclicks: 0,
    alertHits: 0,
  }
}

const SYS_ROW_PX = 32

// Estimated height of one system column, used only to size the code list.
// Estimates are deliberately biased high: over-estimating just lengthens the
// loop, whereas under-estimating leaves the column shorter than its own
// viewport and a visible gap appears at the wrap.
function sysColumnHeightPx() {
  if (typeof window === 'undefined') return 240
  const h = window.innerHeight
  // Mobile: .grid-system takes a 1fr share of the arena, which is the viewport
  // minus ~260px of fixed rows — so it tracks device height rather than sitting
  // at a fixed floor.
  if (window.innerWidth <= 900) return Math.max(96, Math.min(300, h * 0.26))
  // Desktop: arena is 60vh (min 520px) and a column spans ~90% of it.
  return Math.max(520, h * 0.6) * 0.9
}

function initSysColumns() {
  // Row count scales with the column height so the duplicated list always
  // overflows and wraps with no visible edge — on tall desktops and short
  // phones alike. Keeping the list proportional to the column also keeps the
  // reappear time sane: speed is constant, so a code that leaves the top
  // returns after list-length/speed. A fixed 20-row floor made short phones
  // wait out a list twice as long as their own column. +4 rows of buffer.
  const colPx = sysColumnHeightPx()
  const rows = Math.max(10, Math.ceil(colPx / SYS_ROW_PX) + 4)
  // Constant scroll speed (px/ms) per column so a code that leaves the top
  // returns after one list length — reasonably quick and readable. Staggered
  // so the three tracks don't march in lockstep.
  const speeds = [0.0265, 0.0234, 0.0209]
  return [0, 1, 2].map((i) => ({
    codes: Array.from({ length: rows }, () => randomCode()),
    durationMs: Math.round((rows * SYS_ROW_PX) / speeds[i]),
  }))
}
