import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { getModelUrl, has3DModel } from '../data/aircraftModels'
import SEO from '../components/SEO'

const AircraftTopDown = lazy(() => import('../components/AircraftTopDown'))

// ── Constants ────────────────────────────────────────────────────────────────
const GAME_MS = 120_000
const FIRST_TARGET_MS = 15_000
const NEXT_TARGET_MS = 20_000
const MAX_ACTIVE_TARGETS = 5
const LIGHT_CHANGE_MS = 5_000
const SCAN_PANEL_CHANGE_MS = 10_000
const SCAN_TARGET_CHANGE_MS = 30_000
const SCAN_FIRST_APPEAR_MS = 10_000
const SECOND_SYS_TARGET_MS = 60_000
const SYS_SCROLL_MS = 1_000        // ms per row of system-panel scroll
const SYS_GREEN_FADE_MS = 1_500

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

  // For each target: pre-place N matching shapes. Half are present in the
  // opening seconds (so the scene reads as populated from the start); the
  // rest drift in at even intervals through the target's pre-activation window.
  for (const t of targets) {
    const n = randRange(3, 8)
    const earlyCount = Math.ceil(n * 0.5)
    const windowEnd = t.activateAt - 2000
    const laterTimes = evenlySpread(Math.max(1, n - earlyCount), 5000, Math.max(6000, windowEnd))
    for (let k = 0; k < n; k++) {
      const spawnAt = k < earlyCount
        ? Math.random() * 4500                 // scatter in the first ~4.5s
        : laterTimes[k - earlyCount]
      shapes.push({
        id: uid(),
        kind: t.kind,
        color: t.color,
        damaged: t.damaged,
        highPriority: t.highPriority,
        direction: t.direction || (Math.random() < 0.3 ? pick(DIRECTIONS) : null),
        spawnAt,
        fake: false,
        ...placeRandom(),
      })
    }
  }

  // Diamonds (unknown) — always yellow, spawn at t=0
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

  // Fake shapes (octagons, lines) — ~75% present from the start, the rest
  // trickle in evenly across the remainder of the game.
  const fakeCount = randRange(16, 20)
  const fakeImmediateCount = Math.round(fakeCount * 0.75)
  const fakeLaterTimes = evenlySpread(
    Math.max(1, fakeCount - fakeImmediateCount),
    18_000,
    110_000,
  )
  for (let i = 0; i < fakeCount; i++) {
    const isLine = Math.random() < 0.5
    shapes.push({
      id: uid(),
      kind: isLine ? 'line' : 'octagon',
      lineHorizontal: isLine ? Math.random() < 0.5 : undefined,
      color: pick(SHAPE_COLOURS),
      damaged: false,
      highPriority: false,
      direction: null,
      spawnAt: i < fakeImmediateCount ? 0 : fakeLaterTimes[i - fakeImmediateCount],
      fake: true,
      ...placeRandom(),
    })
  }

  // Random noise shapes — ~60% immediate, rest evenly paced through the game.
  const noiseCount = randRange(10, 14)
  const noiseImmediateCount = Math.round(noiseCount * 0.6)
  const noiseLaterTimes = evenlySpread(
    Math.max(1, noiseCount - noiseImmediateCount),
    22_000,
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
let _placed = []
function placeRandom() {
  const pad = 40
  for (let attempt = 0; attempt < 12; attempt++) {
    const x = pad + Math.random() * (1000 - 2 * pad)
    const y = pad + Math.random() * (800 - 2 * pad)
    const ok = _placed.every(p => Math.hypot(p.x - x, p.y - y) > 55)
    if (ok) { _placed.push({ x, y }); return { x, y } }
  }
  const x = pad + Math.random() * (1000 - 2 * pad)
  const y = pad + Math.random() * (800 - 2 * pad)
  _placed.push({ x, y })
  return { x, y }
}
function resetPlacements() { _placed = [] }

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
  octagon: 1.45,          // octagons bigger
  line: 1.05,
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
    const h = R * 1.55
    shapeEl = <polygon points={`0,${-h} ${-R},${R * 0.9} ${R},${R * 0.9}`} fill="none" stroke={strokeCol} strokeWidth="2.5" />
  } else if (kind === 'unknown') {
    shapeEl = <rect x={-R} y={-R} width={R * 2} height={R * 2} fill="none" stroke={strokeCol} strokeWidth="2.5" transform="rotate(45)" />
  } else if (kind === 'octagon') {
    const pts = []
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i + Math.PI / 8
      pts.push(`${Math.cos(a) * R},${Math.sin(a) * R}`)
    }
    shapeEl = <polygon points={pts.join(' ')} fill="none" stroke={strokeCol} strokeWidth="2.5" />
  } else if (kind === 'line') {
    shapeEl = lineHorizontal
      ? <line x1={-R * 1.4} y1={0} x2={R * 1.4} y2={0} stroke={strokeCol} strokeWidth="3" />
      : <line x1={0} y1={-R * 1.4} x2={0} y2={R * 1.4} stroke={strokeCol} strokeWidth="3" />
  }

  const crosshairArms = isReal && highPriority ? (
    <g stroke={strokeCol} strokeWidth="2.5" opacity="0.85">
      <line x1={0} y1={-R * 1.9} x2={0} y2={-R * 1.2} />
      <line x1={0} y1={R * 1.2} x2={0} y2={R * 1.9} />
      <line x1={-R * 1.9} y1={0} x2={-R * 1.2} y2={0} />
      <line x1={R * 1.9} y1={0} x2={R * 1.2} y2={0} />
    </g>
  ) : null

  const damagedX = isReal && damaged ? (
    <g stroke={strokeCol} strokeWidth="3" strokeLinecap="round">
      <line x1={-R * 0.55} y1={-R * 0.55} x2={R * 0.55} y2={R * 0.55} />
      <line x1={-R * 0.55} y1={R * 0.55} x2={R * 0.55} y2={-R * 0.55} />
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

// ── Info panel: legend/key ───────────────────────────────────────────────────
function InfoPanel() {
  const Item = ({ icon, label }) => (
    <span className="flex items-center gap-1 whitespace-nowrap">
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
        <Item icon={outlineSvg(<polygon points="0,-5 -4.5,4 4.5,4" fill="none" stroke="#94a3b8" strokeWidth="1.3" />)} label="building" />
        <Item icon={outlineSvg(<rect x="-3.5" y="-3.5" width="7" height="7" fill="none" stroke="#facc15" strokeWidth="1.3" transform="rotate(45)" />)} label="unknown" />
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
function LightPanel({ pattern, flash, onPress }) {
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
        className="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-[11px] font-bold rounded transition-colors cursor-pointer"
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
function ScanPanel({ aircraft, onPress }) {
  return (
    <div className="h-full w-full bg-[#0a1628] border border-[#1a3a5c] rounded-lg p-1 flex items-center gap-1">
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
          <div className="w-full h-full bg-[#020a18] rounded flex items-center justify-center text-[10px] text-slate-600">— scanning —</div>
        )}
      </div>
      <button
        onClick={onPress}
        className="px-2 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-[10px] font-bold rounded transition-colors cursor-pointer shrink-0"
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
function SceneTargetPanel({ labels, diamondsActive }) {
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
          <span key={l.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-[#060e1a] border border-[#1a3a5c] rounded text-[10px] text-[#ddeaf8]">
            {l.text}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── System panel ─────────────────────────────────────────────────────────────
function SystemPanel({ columns, highlights, onClickCode }) {
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
                return (
                  <button
                    key={ri}
                    onClick={() => onClickCode(ci, actualRow, code)}
                    className={`sys-row w-full text-center font-mono text-[12px] cursor-pointer transition-colors ${
                      isGreen ? 'bg-green-500/40 text-green-200' : 'text-[#ddeaf8] hover:bg-[#0f2240]'
                    }`}
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
          <span key={t.id} className="px-2 py-0.5 bg-[#060e1a] border border-[#1a3a5c] rounded font-mono text-[13px] text-brand-300">
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
      className="absolute top-1.5 left-1.5 pointer-events-none opacity-85"
      style={{ zIndex: 25 }}
    >
      <circle cx="23" cy="23" r="20" fill="#060e1a" stroke="#1a3a5c" strokeWidth="1.3" />
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
function ResultsScreen({ stats, onPlayAgain, scoreSaved }) {
  const grade = computeGrade(stats.totalScore)
  const gradeStyle = {
    'Outstanding': { emoji: '\u{1F396}\uFE0F', color: 'text-green-400' },
    'Good':        { emoji: '\u2708\uFE0F',    color: 'text-brand-300' },
    'Needs Work':  { emoji: '\u{1F527}',       color: 'text-amber-400' },
    'Failed':      { emoji: '\u{1F4A5}',       color: 'text-red-400' },
  }[grade]

  const row = (label, val, sub) => (
    <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3">
      <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-xl font-mono font-bold text-brand-300">{val}</p>
      {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  )

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="w-full max-w-lg bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-6 text-center"
    >
      <p className="text-5xl mb-3">{gradeStyle.emoji}</p>
      <p className={`text-2xl font-extrabold mb-1 ${gradeStyle.color}`}>{grade}</p>
      <p className="text-sm text-slate-400 mb-5">Target Complete</p>

      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-4 mb-4">
        <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">Total Score</p>
        <p className={`text-4xl font-mono font-bold ${stats.totalScore >= 0 ? 'text-brand-300' : 'text-red-400'}`}>
          {stats.totalScore}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-5">
        {row('Scene', stats.sceneScore, `${stats.sceneHits} hit / ${stats.sceneMisses} miss`)}
        {row('Light', stats.lightScore, `${stats.lightMatches} match / ${stats.lightMisclicks} miss`)}
        {row('Scan',  stats.scanScore,  `${stats.scanMatches} match / ${stats.scanMisclicks} miss`)}
        {row('System',stats.systemScore,`${stats.systemMatches} match / ${stats.systemMisclicks} miss`)}
      </div>

      {scoreSaved && <p className="text-xs text-green-400 mb-4">{'\u2713'} Score saved</p>}

      <div className="flex flex-wrap gap-3 justify-center">
        <button
          onClick={onPlayAgain}
          className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-lg transition-colors"
        >
          Play Again
        </button>
        <Link
          to="/cbat/target/leaderboard"
          className="px-5 py-2.5 bg-[#1a3a5c] hover:bg-[#254a6e] text-[#ddeaf8] text-sm font-bold rounded-lg transition-colors no-underline"
        >
          {'\u{1F3C6}'} Leaderboard
        </Link>
      </div>
    </motion.div>
  )
}

// ── Intro ────────────────────────────────────────────────────────────────────
function Intro({ onStart, personalBest, aircraftReady }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-lg bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-6 text-center"
    >
      <p className="text-4xl mb-3">🎯</p>
      <p className="text-xl font-extrabold text-white mb-2">Target</p>
      <p className="text-sm text-slate-400 mb-5">
        Multi-task across eight panels for 2 minutes. Hunt shapes, match light patterns,
        identify aircraft on radar, and find strings in the system feed.
      </p>

      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-4 mb-5 text-left space-y-1.5 text-[12px] text-[#ddeaf8]">
        <div>• <span className="text-brand-300">Scene:</span> click shapes matching each target label</div>
        <div>• <span className="text-brand-300">Light:</span> press LOCK when your 3-light pattern matches the target</div>
        <div>• <span className="text-brand-300">Scan:</span> press ID when your radar aircraft matches the scan target</div>
        <div>• <span className="text-brand-300">System:</span> click any scrolling code matching a system target</div>
        <div className="text-[11px] text-amber-300 pt-1">Wrong clicks lose points. Score can go negative.</div>
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

      <button
        onClick={onStart}
        disabled={!aircraftReady}
        className="px-8 py-3 bg-brand-600 hover:bg-brand-700 disabled:bg-[#1a3a5c] disabled:text-slate-500 text-white font-bold rounded-lg transition-colors text-sm cursor-pointer disabled:cursor-not-allowed"
      >
        {aircraftReady ? 'Start' : 'Loading aircraft…'}
      </button>
    </motion.div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function CbatTarget() {
  const { user, apiFetch, API } = useAuth()
  const shapeScale = useShapeScale()

  const [phase, setPhase] = useState('intro')         // intro | playing | results
  const [elapsedMs, setElapsedMs] = useState(0)
  const [personalBest, setPersonalBest] = useState(null)
  const [scoreSaved, setScoreSaved] = useState(false)
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
  const lightLastChangeRef = useRef(0)
  const lightChangeCountRef = useRef(0)
  const lightForceMatchAtRef = useRef(randRange(3, 6))

  // Scan state
  const [scanPanelAc, setScanPanelAc] = useState(null)
  const [scanTargetAc, setScanTargetAc] = useState(null)
  const scanLastChangeRef = useRef(0)
  const scanTargetLastChangeRef = useRef(0)

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
    apiFetch(`${API}/api/games/cbat/aircraft-cutouts`)
      .then(r => r.json())
      .then(d => {
        const list = (d.data || [])
          .filter(a => has3DModel(a.briefId, a.title))
          .map(a => ({ ...a, modelUrl: getModelUrl(a.briefId, a.title) }))
        setAircraftList(list)
      })
      .catch(() => {})
  }, [user])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Start game ─────────────────────────────────────────────────────────────
  const startGame = useCallback(() => {
    if (aircraftList.length < 1) return
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
    setStats(blankStats())
    setElapsedMs(0)
    setScoreSaved(false)
    lightLastChangeRef.current = 0
    lightChangeCountRef.current = 0
    lightForceMatchAtRef.current = randRange(3, 6)
    scanLastChangeRef.current = 0
    scanTargetLastChangeRef.current = 0
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
    if (elapsedMs - lightLastChangeRef.current < LIGHT_CHANGE_MS) return
    lightLastChangeRef.current = elapsedMs
    lightChangeCountRef.current += 1
    if (lightChangeCountRef.current >= lightForceMatchAtRef.current) {
      setLightPattern([...lightTarget])
      lightChangeCountRef.current = 0
      lightForceMatchAtRef.current = randRange(3, 6)
    } else {
      setLightPattern(randomLightPattern())
    }
  }, [elapsedMs, phase, lightTarget])

  // ── Scan panel / target schedules ──────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'playing' || aircraftList.length === 0) return
    // First scan target appears at 10s; scan panel starts at same time
    if (!scanTargetAc && elapsedMs >= SCAN_FIRST_APPEAR_MS) {
      setScanTargetAc(pick(aircraftList))
      scanTargetLastChangeRef.current = elapsedMs
    }
    if (!scanPanelAc && elapsedMs >= SCAN_FIRST_APPEAR_MS) {
      setScanPanelAc(scanFrame(pick(aircraftList)))
      scanLastChangeRef.current = elapsedMs
    }
    // Rotate scan target every 30s
    if (scanTargetAc && elapsedMs - scanTargetLastChangeRef.current >= SCAN_TARGET_CHANGE_MS) {
      setScanTargetAc(pick(aircraftList))
      scanTargetLastChangeRef.current = elapsedMs
    }
    // Rotate scan panel every 10s
    if (scanPanelAc && elapsedMs - scanLastChangeRef.current >= SCAN_PANEL_CHANGE_MS) {
      setScanPanelAc(scanFrame(pick(aircraftList)))
      scanLastChangeRef.current = elapsedMs
    }
  }, [elapsedMs, phase, aircraftList, scanPanelAc, scanTargetAc])

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

  // ── End game ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'playing') return
    if (elapsedMs < GAME_MS) return
    // Submit + show results
    const finalTime = GAME_MS / 1000
    const grade = computeGrade(stats.totalScore)
    setScoreSaved(false)
    apiFetch(`${API}/api/games/cbat/target/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...stats, totalTime: finalTime, grade }),
    })
      .then(r => r.json())
      .then(() => {
        setScoreSaved(true)
        apiFetch(`${API}/api/games/cbat/target/personal-best`)
          .then(r => r.json())
          .then(d => { if (d.data) setPersonalBest(d.data) })
          .catch(() => {})
      })
      .catch(() => {})
    setPhase('results')
  }, [elapsedMs, phase, stats])  // eslint-disable-line react-hooks/exhaustive-deps

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
    if (shape.fake || shape.kind === 'octagon' || shape.kind === 'line') {
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
      // rotate scan panel immediately; scan target keeps its 30s schedule
      setScanPanelAc(scanFrame(pick(aircraftList)))
      scanLastChangeRef.current = elapsedMs
    } else {
      bumpCounter('scanMisclicks')
      addScore(SCORE.scanMiss, 'scan')
    }
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

      {user && (phase === 'intro' || phase === 'results') && (
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-2 mb-4 self-start">
            <Link to="/cbat" className="text-slate-500 hover:text-brand-400 transition-colors text-sm">&larr; CBAT</Link>
            <h1 className="text-xl font-extrabold text-slate-900">Target</h1>
          </div>
          {phase === 'intro' && (
            <Intro onStart={startGame} personalBest={personalBest} aircraftReady={aircraftList.length > 0} />
          )}
          {phase === 'results' && (
            <ResultsScreen stats={stats} onPlayAgain={() => setPhase('intro')} scoreSaved={scoreSaved} />
          )}
        </div>
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
            <button
              onClick={() => { setPhase('intro') }}
              className="text-xs text-slate-500 hover:text-red-400 transition-colors"
            >
              Abort
            </button>
          </div>

          <div className="cbat-target-grid">
            <div className="grid-info"><InfoPanel /></div>
            <div className="grid-light"><LightPanel pattern={lightPattern} flash={lightFlash} onPress={onLightPress} /></div>
            <div className="grid-scan"><ScanPanel aircraft={scanPanelAc} onPress={onScanPress} /></div>
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
    sceneScore: 0, lightScore: 0, scanScore: 0, systemScore: 0,
    sceneHits: 0, sceneMisses: 0,
    lightMatches: 0, lightMisclicks: 0,
    scanMatches: 0, scanMisclicks: 0,
    systemMatches: 0, systemMisclicks: 0,
  }
}

function initSysColumns() {
  // Each column has its own speed so the three tracks don't march in lockstep.
  const durations = [26000, 30000, 34000]
  return [0, 1, 2].map((i) => ({
    codes: Array.from({ length: 50 }, () => randomCode()),
    durationMs: durations[i],
  }))
}
