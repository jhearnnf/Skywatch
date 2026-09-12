import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { submitCbatResult } from '../lib/cbatOutbox'
import { getAircraftRoster } from '../lib/offlineRoster'
import { useCbatTracking } from '../utils/cbat/useCbatTracking'
import { useGameChrome } from '../context/GameChromeContext'
import SEO from '../components/SEO'
import CbatQuitButton from '../components/CbatQuitButton'
import CbatGameOver from '../components/CbatGameOver'
import SkywatchLogoIntro, { SKYWATCH_LOGO_INTRO_MS } from '../components/SkywatchLogoIntro'
import { has3DModel, getModelUrl } from '../data/aircraftModels'
import DptAircraftLayer from '../components/DptAircraftLayer'
import { useGLTF } from '@react-three/drei'
import { useGameBodyClass } from '../hooks/useGameBodyClass'
import { useAdminRoundParam } from '../utils/cbat/useAdminRoundParam'
import { CbatModeRow, ModeMarker } from '../components/CbatModeSelector'
import CbatPersonalBest from '../components/CbatPersonalBest'
import { useCbatPersonalBest } from '../hooks/useCbatPersonalBest'
import {
  DPT_DIFFICULTIES, dptTuning, dptGameKey, firstRound, lastRound, displayRound,
  readStoredDptDifficulty, storeDptDifficulty,
} from '../utils/cbat/dptDifficulty'
import { initialDifficulty } from '../utils/cbat/difficultyParam'
import {
  SCOPE_SIZE, SCOPE_HALF, ARENA_HALF, EDGE_BUFFER, ALT_MIN, ALT_MAX,
  DZ_RADIUS, DZ_ALT_2K, DZ_ALT_3K, DZ_SEP_REQUIRED,
  normalizeDeg, bearingToVec, bearingToCenter, segmentsIntersect, moveAircraft, zoneStatus,
} from '../utils/cbat/dptPhysics'
import {
  DPT_PRACTICE_DRILLS, buildDrillAircraft, buildDrillGates, judgeCommand,
  judgeAltitudeCommand, altitudeFromDigits, altitudeSettled, altProse,
  headingSettled, gateCrossing, bearingSector, sweepExtent, onTrackForGate, pad3,
} from '../utils/cbat/dptPractice'
import GuideArrow from '../components/cbat/GuideArrow'

// ── Constants ────────────────────────────────────────────────────────────────
// The full ladder. A run no longer plays all eight: Easier serves rounds 1-4
// and Hard serves rounds 5-8 (see utils/cbat/dptDifficulty.js). This is still
// the ladder's length — what the admin round-jump cheats address, and what
// startRound() indexes — not the length of a run.
const TOTAL_ROUNDS = 8

// The arena's coordinate space (a 1000×1000 SVG viewBox) and the flight model
// live in utils/cbat/dptPhysics.js, shared with the practice mode.
const LABEL_INSET = 22                      // how far labels sit inside the boundary

// Ray from centre to the bounding square at the given bearing
function squareBoundaryT(bearing, halfSize) {
  const { dx, dy } = bearingToVec(bearing)
  const tx = Math.abs(dx) < 1e-9 ? Infinity : halfSize / Math.abs(dx)
  const ty = Math.abs(dy) < 1e-9 ? Infinity : halfSize / Math.abs(dy)
  return Math.min(tx, ty)
}

// Major bearing labels — every 45°, placing 045/135/225/315 at the corners
// of the playable square per the spec.
const BEARING_LABELS = [360, 45, 90, 135, 180, 225, 270, 315]
// Minor tick bearings — every 10°, skipping the bearings that have a label
const MINOR_TICKS = Array.from({ length: 36 }, (_, i) => i * 10)
  .filter(b => b % 45 !== 0 && b !== 0)

// ── Aircraft motion ─────────────────────────────────────────────────────────
const AIRCRAFT_ICON  = 40    // visual icon size in scope units (label offset)

// ── Gates / rounds ──────────────────────────────────────────────────────────
// Rounds 1–3: 105s (1m 45s) — basic CA-A flow.
// Rounds 4–5: 120s (2m)     — CA-N joins.
// Rounds 6–8: 180s (3m)     — Fighter + enemies; +60s on top of rounds 4–5.
function roundDurationMs(roundNum) {
  if (roundNum >= 6) return 180_000
  if (roundNum >= 4) return 120_000
  return 105_000
}

// Admin-only cheat codes typed into the numpad jump to the matching round
// number. Using any of these flags the run as a debug session: score stops
// being tracked and the final result is NOT submitted to the leaderboard.
const ADMIN_ROUND_CHEATS = {
  111: 1, 222: 2, 333: 3, 444: 4, 555: 5, 666: 6, 777: 7, 888: 8,
}
const POINTS_PER_GATE   = 100
const GATE_HALF_LEN     = 50      // half the visual length of a gate
const GATE_DOT_R        = 9       // endpoint dot radius
const GATE_HIT_PAD      = 6       // small fudge so brushing the dot still counts
const MIN_GATE_DIST     = 200     // min distance between gate centres
const SPAWN_R_MIN       = 160     // gates spawn this far from arena centre min
const SPAWN_R_MAX       = ARENA_HALF - 130   // …and at most this far (keeps off the edge)
const ROUND_OVERLAY_MS  = 1800    // duration of the round-complete overlay
const INTRO_DURATION_MS = SKYWATCH_LOGO_INTRO_MS  // alias — choreography lives in SkywatchLogoIntro

const LETTERS = 'ABCDEFGHIJ'
const NUMBERS = '123456789'

// ── Interception ────────────────────────────────────────────────────────────
// Every "intercept" — Fighter→Enemy, CA-A/CA-N→Enemy, or Player→Player — uses
// the same distance ring and altitude threshold. Anything closer horizontally
// AND within INTERCEPT_ALT_DIFF feet vertically counts as in-contact.
const POINTS_PER_INTERCEPT      = 250   // Fighter killing an enemy (good)
const POINTS_PENALTY_BAD_HIT    = 150   // any other in-contact event (bad)
const WHITE_RING_R              = 70    // enemy hitbox visual + intercept range
const BLUE_RING_R               = 70    // player aircraft hitbox visual (same range)
// Bad-intercept penalties (CA-A/CA-N hitting an enemy, or any two player
// aircraft hitting each other) fire within 3000ft. The good Fighter kill is
// stricter: must be within 1000ft of the enemy's altitude to count.
const INTERCEPT_ALT_DIFF        = 3000
const FIGHTER_INTERCEPT_ALT_DIFF = 1000
const ENEMY_AI_INTERVAL_MIN     = 2.5
const ENEMY_AI_INTERVAL_MAX     = 5.0
// Enemies pick a new ±1000ft altitude target every 20–30s after spawn.
const ENEMY_ALT_CHANGE_MIN_MS   = 20_000
const ENEMY_ALT_CHANGE_MAX_MS   = 30_000
// Initial spread altitudes (in ft) by V-formation index — 0 = lead stays at
// 5000ft, odd indices climb, even indices descend. Capped at 5 to cover
// future expansion; for now we only spawn up to 3 enemies (round 8).
const ENEMY_SPAWN_SPREAD_FT     = [5000, 8000, 2000, 10000, 1000]
const ENEMY_SPAWN_BASE_ALT      = 5000

function pickEnemyNextAltChange() {
  return ENEMY_ALT_CHANGE_MIN_MS + Math.random() * (ENEMY_ALT_CHANGE_MAX_MS - ENEMY_ALT_CHANGE_MIN_MS)
}

function pickEnemyAltStep(currentAlt) {
  // ±1000ft step; flip direction if it would clamp at the operational band.
  const dir = Math.random() < 0.5 ? -1 : 1
  const proposed = currentAlt + dir * 1000
  if (proposed < ALT_MIN || proposed > ALT_MAX) {
    return Math.max(ALT_MIN, Math.min(ALT_MAX, currentAlt - dir * 1000))
  }
  return proposed
}

// ── Danger zones (Chunk 9) ───────────────────────────────────────────────────
// Radius, the two heights and the separation rule live in dptPhysics.js,
// shared with the tutorial's zone drill.
const DZ_PENALTY_PER_S    = 10     // score loss per sec inside danger zone

// ── Round completion bonus ───────────────────────────────────────────────────
const ROUND_BONUS_PER_ROUND = 50   // × roundNum awarded when all gates hit

// Generate `count` gates of the given kind ('letter' | 'number'), each at a
// random position within the spawn annulus and with a random orientation.
// Gates are spaced at least MIN_GATE_DIST apart.
function generateGates(count, kind, existingCenters = []) {
  const labels = kind === 'letter' ? LETTERS : NUMBERS
  const gates  = []
  const centers = [...existingCenters]

  for (let i = 0; i < count; i++) {
    let cx, cy, attempts = 0, ok = false
    while (attempts < 60 && !ok) {
      const r  = SPAWN_R_MIN + Math.random() * (SPAWN_R_MAX - SPAWN_R_MIN)
      const a  = Math.random() * Math.PI * 2
      cx = SCOPE_HALF + Math.cos(a) * r
      cy = SCOPE_HALF + Math.sin(a) * r
      ok = centers.every(c => Math.hypot(cx - c.x, cy - c.y) >= MIN_GATE_DIST)
      attempts++
    }
    centers.push({ x: cx, y: cy })

    // Random orientation 0..π (line is symmetric so we only need half a turn)
    const ang = Math.random() * Math.PI
    const ex  = Math.cos(ang) * GATE_HALF_LEN
    const ey  = Math.sin(ang) * GATE_HALF_LEN
    gates.push({
      id:    labels[i],
      index: i,
      kind,
      p1:    { x: cx + ex, y: cy + ey },
      p2:    { x: cx - ex, y: cy - ey },
      hit:   false,
    })
  }
  return gates
}

// Spawn a danger zone — sometimes deliberately between two existing gates.
function generateDangerZones(count, gates) {
  const zones = []
  for (let i = 0; i < count; i++) {
    let cx, cy
    if (Math.random() < 0.5 && gates.length >= 2) {
      // Place midway between two random gates
      const g1 = gates[Math.floor(Math.random() * gates.length)]
      let g2 = g1
      let safety = 8
      while (g2 === g1 && safety-- > 0) g2 = gates[Math.floor(Math.random() * gates.length)]
      const m1 = { x: (g1.p1.x + g1.p2.x) / 2, y: (g1.p1.y + g1.p2.y) / 2 }
      const m2 = { x: (g2.p1.x + g2.p2.x) / 2, y: (g2.p1.y + g2.p2.y) / 2 }
      cx = (m1.x + m2.x) / 2
      cy = (m1.y + m2.y) / 2
    } else {
      const r = SPAWN_R_MIN + Math.random() * (SPAWN_R_MAX - SPAWN_R_MIN)
      const a = Math.random() * Math.PI * 2
      cx = SCOPE_HALF + Math.cos(a) * r
      cy = SCOPE_HALF + Math.sin(a) * r
    }
    zones.push({
      id:       i,
      position: { x: cx, y: cy },
      band:     Math.random() < 0.5 ? '2k' : '3k',
      radius:   DZ_RADIUS,
    })
  }
  return zones
}

// Spawn a squadron of enemies in V formation at the corner of the arena
// that no player aircraft has claimed. All share a single altitude chosen
// to be ≥3000ft from every player aircraft, so they don't appear inside
// any player's blue intercept ring on round 6 / 7 / 8 spawn.
const ENEMY_FORMATION_PERP = 90  // side-to-side spacing inside the V
const ENEMY_FORMATION_BACK = 70  // forward-back stagger per rank

function spawnEnemySquadron(modelUrls, playerAircraft) {
  // Pick the corner none of the player aircraft is using. If every corner
  // is taken (unlikely with our 3-aircraft cap) we fall back to a random one.
  const usedCorners = new Set(playerAircraft.map(a => getCornerIndex(a.position)))
  const free = [0, 1, 2, 3].filter(c => !usedCorners.has(c))
  const cornerIdx = free.length > 0
    ? free[Math.floor(Math.random() * free.length)]
    : Math.floor(Math.random() * 4)

  const xLow  = SCOPE_HALF - ARENA_HALF + SPAWN_CORNER_INSET
  const xHigh = SCOPE_HALF + ARENA_HALF - SPAWN_CORNER_INSET
  const yLow  = SCOPE_HALF - ARENA_HALF + SPAWN_CORNER_INSET
  const yHigh = SCOPE_HALF + ARENA_HALF - SPAWN_CORNER_INSET
  const corners = [
    { x: xLow,  y: yLow  },
    { x: xHigh, y: yLow  },
    { x: xLow,  y: yHigh },
    { x: xHigh, y: yHigh },
  ]
  const leadPos = corners[cornerIdx]
  const headingDeg = Math.round(bearingToCenter(leadPos.x, leadPos.y))

  // Forward / right unit vectors in scope-space (SVG y is inverted, so
  // right-of-heading = (-fy, fx)).
  const rad = (headingDeg * Math.PI) / 180
  const fx = Math.sin(rad), fy = -Math.cos(rad)
  const rx = -fy, ry = fx

  const now = Date.now()
  const enemies = []
  for (let i = 0; i < modelUrls.length; i++) {
    let dxPerp = 0, dxBack = 0
    if (i > 0) {
      // i=1 → left wing, i=2 → right wing, i=3 → outer left, i=4 → outer right…
      const side = i % 2 === 1 ? -1 : 1
      const rank = Math.ceil(i / 2)
      dxPerp = side * rank * ENEMY_FORMATION_PERP
      dxBack = rank * ENEMY_FORMATION_BACK
    }
    // All start at 5000ft; the per-index spread target kicks in immediately
    // so the squadron fans vertically as it advances. Lead (i=0) stays at
    // 050; wings climb / descend from the spread table.
    const spreadIdx    = Math.min(i, ENEMY_SPAWN_SPREAD_FT.length - 1)
    const initialTarget = ENEMY_SPAWN_SPREAD_FT[spreadIdx]
    enemies.push({
      id:                 `E${i + 1}`,
      kind:               'Enemy',
      modelUrl:           modelUrls[i],
      position: {
        x: leadPos.x + rx * dxPerp - fx * dxBack,
        y: leadPos.y + ry * dxPerp - fy * dxBack,
      },
      altitudeFt:         ENEMY_SPAWN_BASE_ALT,
      targetAltitudeFt:   initialTarget === ENEMY_SPAWN_BASE_ALT ? null : initialTarget,
      headingDeg,
      targetHeadingDeg:   null,
      turnDirection:      null,
      aiNextDecision:     0,
      altNextChange:      now + pickEnemyNextAltChange(),
      wasInEdgeBuffer:    false,
    })
  }
  return enemies
}

// Distance inboard from the arena corners that user aircraft spawn at.
const SPAWN_CORNER_INSET = 150
// Extra inboard offset stacked per additional aircraft sharing a corner —
// keeps later spawns from sitting on top of earlier ones in the same corner.
const SPAWN_STACK_STEP   = 110

// Map a position back to one of the 4 arena quadrants (corner indices).
function getCornerIndex(position) {
  const isLeft = position.x < SCOPE_HALF
  const isTop  = position.y < SCOPE_HALF
  if (isLeft && isTop)   return 0  // TL
  if (!isLeft && isTop)  return 1  // TR
  if (isLeft && !isTop)  return 2  // BL
  return 3                          // BR
}

// Spawn options to try for a 3000ft-separated altitude (each 1000ft step in
// the operational band). At most 8 candidates; if none satisfy the constraint
// against `existing`, we fall back to a deterministic stack.
const ALT_OPTIONS = [2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000]

function pickSeparatedAltitude(existingAlts) {
  const valid = ALT_OPTIONS.filter(a =>
    existingAlts.every(u => Math.abs(u - a) >= INTERCEPT_ALT_DIFF),
  )
  if (valid.length > 0) return valid[Math.floor(Math.random() * valid.length)]
  // Fallback: stack on top of the highest existing altitude, clamped to ALT_MAX.
  const highest = existingAlts.length ? Math.max(...existingAlts) : ALT_MIN
  return Math.min(ALT_MAX, highest + INTERCEPT_ALT_DIFF)
}

function spawnPlayerAircraft(id, kind, modelUrl, existing = []) {
  // Prefer a corner that hasn't been used by any already-spawned aircraft;
  // if all four are taken we'll re-use one and stagger the inset further in
  // so the new aircraft doesn't sit on the previous one.
  const usedCorners = new Set(existing.map(a => getCornerIndex(a.position)))
  const free        = [0, 1, 2, 3].filter(c => !usedCorners.has(c))
  const corner      = free.length > 0
    ? free[Math.floor(Math.random() * free.length)]
    : Math.floor(Math.random() * 4)

  const sameCornerCount = existing.filter(a => getCornerIndex(a.position) === corner).length
  const inset = SPAWN_CORNER_INSET + sameCornerCount * SPAWN_STACK_STEP

  const xLow  = SCOPE_HALF - ARENA_HALF + inset
  const xHigh = SCOPE_HALF + ARENA_HALF - inset
  const yLow  = SCOPE_HALF - ARENA_HALF + inset
  const yHigh = SCOPE_HALF + ARENA_HALF - inset
  const corners = [
    { x: xLow,  y: yLow  },  // top-left      → bearing ~135 (SE)
    { x: xHigh, y: yLow  },  // top-right     → bearing ~225 (SW)
    { x: xLow,  y: yHigh },  // bottom-left   → bearing ~045 (NE)
    { x: xHigh, y: yHigh },  // bottom-right  → bearing ~315 (NW)
  ]
  const position = corners[corner]
  // Altitude with ≥3000ft vertical separation from every existing aircraft.
  const altitudeFt = pickSeparatedAltitude(existing.map(a => a.altitudeFt))
  return {
    id,
    kind,
    modelUrl,
    position,
    altitudeFt,
    targetAltitudeFt:   null,
    headingDeg:         Math.round(bearingToCenter(position.x, position.y)),
    targetHeadingDeg:   null,
    turnDirection:      null,
    wasInEdgeBuffer:    false,
  }
}

// ── Static arena chrome (rings / ticks / bearing labels / crosshair) ────────
// Extracted as a memo'd component because nothing here changes during play —
// re-rendering it 60×/sec was significant per-frame work for the GC. The
// brgPulseKey prop bumps when the user picks BRG mode; the bearing labels
// use it in their key so they remount with the dpt-select-pulse class and
// briefly scale up as a "this is what BRG controls" cue.
const ArenaChrome = memo(function ArenaChrome({ brgPulseKey = 0 }) {
  const ringRadii = [0.20, 0.40, 0.60, 0.80].map(f => f * ARENA_HALF)
  return (
    <>
      {ringRadii.map((r, i) => (
        <circle key={i} cx={SCOPE_HALF} cy={SCOPE_HALF} r={r} fill="none" stroke="rgba(91,170,255,0.10)" strokeWidth={1.4} />
      ))}
      <rect
        x={SCOPE_HALF - ARENA_HALF}
        y={SCOPE_HALF - ARENA_HALF}
        width={ARENA_HALF * 2}
        height={ARENA_HALF * 2}
        fill="none" stroke="rgba(91,170,255,0.16)" strokeWidth={1} strokeDasharray="4 4"
      />
      {MINOR_TICKS.map(b => {
        const { dx, dy } = bearingToVec(b)
        const tEnd   = squareBoundaryT(b, ARENA_HALF)
        const tStart = tEnd - 8
        return <line key={`tick-${b}`} x1={SCOPE_HALF + dx * tStart} y1={SCOPE_HALF + dy * tStart} x2={SCOPE_HALF + dx * tEnd} y2={SCOPE_HALF + dy * tEnd} stroke="rgba(91,170,255,0.30)" strokeWidth={1} />
      })}
      {BEARING_LABELS.map(b => {
        const { dx, dy } = bearingToVec(b)
        const tEnd   = squareBoundaryT(b, ARENA_HALF)
        const tStart = tEnd - 16
        return <line key={`major-${b}`} x1={SCOPE_HALF + dx * tStart} y1={SCOPE_HALF + dy * tStart} x2={SCOPE_HALF + dx * tEnd} y2={SCOPE_HALF + dy * tEnd} stroke="rgba(91,170,255,0.55)" strokeWidth={1.6} />
      })}
      {BEARING_LABELS.map(b => {
        const { dx, dy } = bearingToVec(b)
        const t = squareBoundaryT(b, ARENA_HALF) - LABEL_INSET
        return (
          <text
            key={`lbl-${b}-${brgPulseKey}`}
            className={brgPulseKey > 0 ? 'dpt-select-pulse' : undefined}
            x={SCOPE_HALF + dx * t} y={SCOPE_HALF + dy * t}
            fill="#5baaff" fontSize={26}
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontWeight={700}
            textAnchor="middle" dominantBaseline="middle" opacity={0.85}>
            {String(b === 360 ? 360 : b).padStart(3, '0')}
          </text>
        )
      })}
      <g stroke="#5baaff" strokeWidth={2} strokeLinecap="round" opacity={0.45}>
        <line x1={SCOPE_HALF - 14} y1={SCOPE_HALF} x2={SCOPE_HALF + 14} y2={SCOPE_HALF} />
        <line x1={SCOPE_HALF} y1={SCOPE_HALF - 14} x2={SCOPE_HALF} y2={SCOPE_HALF + 14} />
        <circle cx={SCOPE_HALF} cy={SCOPE_HALF} r={2.5} fill="#5baaff" stroke="none" />
      </g>
    </>
  )
})

// ── Arena scope ─────────────────────────────────────────────────────────────
function ArenaScope({ children, brgPulseKey }) {
  return (
    <svg
      viewBox={`0 0 ${SCOPE_SIZE} ${SCOPE_SIZE}`}
      className="absolute inset-0 w-full h-full"
      aria-hidden="true"
      // geometricPrecision turns off font hinting — without this, moving
      // aircraft labels shimmer/shake at low panel sizes as glyphs snap
      // between integer pixel positions.
      textRendering="geometricPrecision"
    >
      <ArenaChrome brgPulseKey={brgPulseKey} />
      {children}
    </svg>
  )
}

// ── Gate marker (two endpoint dots + connecting line + letter/number label) ─
// Memo'd: each gate's render output only depends on { gate, isNext }, and
// gate identity is preserved across frames unless it gets hit (we only clone
// the gate object when its hit flag flips). This skips the per-frame SVG
// reconciliation for unchanged gates.
// All letter gates share LETTER_GATE_COLOR, all number gates share NUMBER_GATE_COLOR.
// Both blue but distinct shades; "next" status is signalled by a glow filter,
// not a colour change, so each gate kind reads as a single consistent colour.
const LETTER_GATE_COLOR = '#5baaff'   // brand electric blue
const NUMBER_GATE_COLOR = '#9ed5ff'   // lighter cyan-blue

const GateMarker = memo(function GateMarker({ gate, isNext }) {
  const { p1, p2, id, hit, kind } = gate
  const baseColor = hit
    ? '#3a4f6c'
    : (kind === 'letter' ? LETTER_GATE_COLOR : NUMBER_GATE_COLOR)
  const opacity = hit ? 0.35 : 1
  const cx = (p1.x + p2.x) / 2
  const cy = (p1.y + p2.y) / 2
  return (
    <g opacity={opacity}>
      <line
        x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
        stroke={baseColor}
        strokeWidth={3}
        strokeLinecap="round"
        opacity={0.7}
      />
      <circle cx={p1.x} cy={p1.y} r={9} fill={baseColor}
              filter={isNext && !hit ? 'drop-shadow(0 0 8px rgba(91,170,255,0.7))' : undefined} />
      <circle cx={p2.x} cy={p2.y} r={9} fill={baseColor}
              filter={isNext && !hit ? 'drop-shadow(0 0 8px rgba(91,170,255,0.7))' : undefined} />
      <text x={cx} y={cy - 22} fill={baseColor} fontSize={28} fontWeight={800}
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            textAnchor="middle" dominantBaseline="middle">
        {id}
      </text>
    </g>
  )
})

// ── Bearing-command visualisation ──────────────────────────────────────────
const COMMAND_VIZ_DURATION_MS = 1600

// Render a temporary line from the aircraft's commit-time position outward in
// the new bearing direction, plus an arc showing the turn from the previous
// heading to the new bearing. Both fade out via the CSS pulse class. The
// `kind` field selects the colour: 'user' = brand-blue (player issued the
// command) vs 'edgeAuto' = yellow (auto-turn redirected at the boundary).
function CommandViz({ viz }) {
  const { capturedPos, fromHeading, targetBearing, direction, kind } = viz
  const color = kind === 'edgeAuto' ? '#ffd84a' : '#5baaff'
  const LINE_LEN = 260
  const ARC_R    = 38

  const targetRad = (targetBearing * Math.PI) / 180
  const ex = capturedPos.x + Math.sin(targetRad) * LINE_LEN
  const ey = capturedPos.y - Math.cos(targetRad) * LINE_LEN

  // Arc endpoints — at ARC_R distance from the aircraft, along the current
  // heading and the target bearing.
  const fromRad = (fromHeading * Math.PI) / 180
  const ax = capturedPos.x + Math.sin(fromRad) * ARC_R
  const ay = capturedPos.y - Math.cos(fromRad) * ARC_R
  const bx = capturedPos.x + Math.sin(targetRad) * ARC_R
  const by = capturedPos.y - Math.cos(targetRad) * ARC_R

  // Sweep flag: 1 = clockwise in screen space (SVG y is inverted, but compass
  // R-turn already corresponds to clockwise on screen). Large-arc flag = 1
  // when the actual turn distance in the chosen direction exceeds 180°.
  const turn180 = direction === 'R'
    ? ((targetBearing - fromHeading) + 360) % 360
    : ((fromHeading - targetBearing) + 360) % 360
  const largeArc = turn180 > 180 ? 1 : 0
  const sweep    = direction === 'R' ? 1 : 0
  const arcPath  = `M ${ax} ${ay} A ${ARC_R} ${ARC_R} 0 ${largeArc} ${sweep} ${bx} ${by}`

  return (
    <g className="dpt-command-pulse">
      <line
        x1={capturedPos.x} y1={capturedPos.y} x2={ex} y2={ey}
        stroke={color} strokeWidth={2.2} strokeDasharray="6 4" strokeLinecap="round"
      />
      <circle cx={ex} cy={ey} r={4} fill={color} />
      <path d={arcPath} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" />
    </g>
  )
}

// Returns the list of arena edges (top/right/bottom/left) the aircraft is
// currently within EDGE_BUFFER of. Used to drive the yellow pulse warning.
function nearEdges(position) {
  const edges = []
  if (position.y - (SCOPE_HALF - ARENA_HALF) < EDGE_BUFFER)  edges.push('top')
  if ((SCOPE_HALF + ARENA_HALF) - position.y < EDGE_BUFFER)  edges.push('bottom')
  if (position.x - (SCOPE_HALF - ARENA_HALF) < EDGE_BUFFER)  edges.push('left')
  if ((SCOPE_HALF + ARENA_HALF) - position.x < EDGE_BUFFER)  edges.push('right')
  return edges
}

// ── Edge warning — yellow pulsing segment on the boundary near an aircraft ──
function EdgeWarning({ edge, x, y }) {
  const SEG = 140       // half-length of highlight segment
  const STROKE = 10
  const TL = SCOPE_HALF - ARENA_HALF
  const BR = SCOPE_HALF + ARENA_HALF
  const props = {
    stroke: '#ffd84a',
    strokeWidth: STROKE,
    strokeLinecap: 'round',
    className: 'dpt-edge-pulse',
  }
  if (edge === 'top')    return <line {...props} x1={x - SEG} y1={TL} x2={x + SEG} y2={TL} />
  if (edge === 'bottom') return <line {...props} x1={x - SEG} y1={BR} x2={x + SEG} y2={BR} />
  if (edge === 'left')   return <line {...props} x1={TL} y1={y - SEG} x2={TL} y2={y + SEG} />
  if (edge === 'right')  return <line {...props} x1={BR} y1={y - SEG} x2={BR} y2={y + SEG} />
  return null
}

// ── Aircraft data block (callsign + altitude — sprite renders in Canvas layer) ─
function AircraftSprite({ aircraft, active, edgeWarn, dim, altPulseKey = 0 }) {
  const { position, id, altitudeFt, kind, headingDeg } = aircraft

  // Bump a local key whenever this aircraft transitions to active — the
  // sprite remounts with the pulse class, drawing the player's eye to it.
  // Initial-mount activations are skipped (pulseKey stays 0) so newly-spawned
  // aircraft don't auto-pulse just because the active aircraft happens to be
  // them on round start.
  const [selectPulseKey, setSelectPulseKey] = useState(0)
  const prevActiveRef = useRef(active)
  useEffect(() => {
    if (active && !prevActiveRef.current) setSelectPulseKey(k => k + 1)
    prevActiveRef.current = active
  }, [active])

  // Round positions to 0.1-unit precision before serialising to the SVG
  // transform — keeps the text from re-laying out on imperceptible drift
  // every frame, which the browser otherwise picks up as glyph shimmer.
  const tx = Math.round(position.x * 10) / 10
  const ty = Math.round(position.y * 10) / 10

  // Enemies render as a white interception ring + red triangle (no callsign
  // — per spec — but altitude IS shown so the player can plan vertical
  // separation for CA-A/CA-N or matching alt for a Fighter intercept).
  if (kind === 'Enemy') {
    const enemyAltLabel = String(Math.round(altitudeFt / 100)).padStart(3, '0')
    return (
      <g transform={`translate(${tx}, ${ty})`}>
        <circle r={WHITE_RING_R} fill="none" stroke="#ffffff" strokeWidth={1} opacity={0.18} strokeDasharray="6 4" />
        <g transform={`rotate(${headingDeg})`}>
          <polygon points="0,-6.3 -3.5,4.9 0,3.2 3.5,4.9" fill="#ff5050" stroke="#ff8080" strokeWidth={1} strokeLinejoin="round" />
        </g>
        <text
          key={`alt-${altPulseKey}`}
          className={altPulseKey > 0 ? 'dpt-select-pulse' : undefined}
          x={10} y={22} fill="#ff8a8a" fontSize={22}
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontWeight={700}
        >
          {enemyAltLabel}
        </text>
      </g>
    )
  }

  const altLabel = String(Math.round(altitudeFt / 100)).padStart(3, '0')
  const tone     = active ? '#5baaff' : '#88a4c4'
  return (
    <g transform={`translate(${tx}, ${ty})`} opacity={dim ? 0.2 : 1}>
      {/* Faint blue interception ring — mirrors the enemy white ring; any
          other player aircraft entering this circle (with <3000ft altitude
          difference) triggers the player-on-player intercept penalty. */}
      <circle r={BLUE_RING_R} fill="none" stroke="#5baaff" strokeWidth={1} opacity={0.18} strokeDasharray="6 4" />
      {/* Yellow pulse halo — only when the aircraft is in the edge buffer
          and auto-turn has taken control. Signals "I'm bringing you back". */}
      {edgeWarn && (
        <circle r={36} fill="none" stroke="#ffd84a" strokeWidth={2.5} className="dpt-edge-pulse" />
      )}
      {/* Sprite-wide select pulse — remounts on selectPulseKey change so the
          triangle + labels briefly scale up when the user switches to this
          aircraft. Inner g; the parent g handles position/dim. */}
      <g key={`sel-${selectPulseKey}`} className={selectPulseKey > 0 ? 'dpt-select-pulse' : undefined}>
        {/* Small heading triangle — sits over the GLB to clearly mark the
            aircraft's position and direction at a glance. */}
        <g transform={`rotate(${headingDeg})`}>
          <polygon points="0,-10 -6,8 0,5.5 6,8" fill={tone} stroke={tone} strokeWidth={1} strokeLinejoin="round" />
        </g>
        {/* Data block — upright so labels stay readable. */}
        <text x={AIRCRAFT_ICON / 2 + 6} y={-6} fill={tone} fontSize={20}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontWeight={700}>
          {id}
        </text>
        <text
          key={`alt-${altPulseKey}`}
          className={altPulseKey > 0 ? 'dpt-select-pulse' : undefined}
          x={AIRCRAFT_ICON / 2 + 6} y={22} fill={tone} fontSize={26}
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontWeight={600}
        >
          {altLabel}
        </text>
      </g>
    </g>
  )
}

// ── Danger zone marker ──────────────────────────────────────────────────────
// Memo'd: zone objects are stable for the entire round, so this never needs
// to re-render once mounted. The ring colour communicates the safe-altitude
// band — see the key under the numpad for which is which.
const DangerZoneMarker = memo(function DangerZoneMarker({ zone }) {
  const { position, band, radius } = zone
  const ringColor = band === '2k' ? '#ffffff' : '#000000'
  return (
    <circle
      cx={position.x} cy={position.y} r={radius}
      fill="rgba(255,80,80,0.22)"
      stroke={ringColor}
      strokeWidth={4}
    />
  )
})

// Per-aircraft accent — CA-A matches the lettered-gate colour, CA-N matches
// the numbered-gate colour, Fighter is red. Hoisted to module scope so the
// standalone AircraftButtons component (rendered next to the arena panel)
// and any future selectors can share the same palette.
const AIRCRAFT_ACCENT = {
  'CA-A':    { bg: LETTER_GATE_COLOR, border: '#86c0ff', textActive: '#0a1628', textInactive: '#5baaff' },
  'CA-N':    { bg: NUMBER_GATE_COLOR, border: '#c2e3ff', textActive: '#0a1628', textInactive: '#9ed5ff' },
  'Fighter': { bg: '#d83b3b',         border: '#ff6868', textActive: '#ffffff', textInactive: '#ff7a7a' },
}

// ── Aircraft selector strip — sits flush under the arena panel and uses
//    -mt-2 + z-index 0 so it appears to emerge from beneath the arena
//    (which has z-10). Reduced height vs the original DptControls strip
//    so mobile screens fit everything without scrolling. ─────────────────
// `guideId` is practice-only and defaults off: hang a guide arrow under that
// button, for the drill that teaches selecting an aircraft before commanding it.
function AircraftButtons({ aircraftList, activeId, onSelectActive, guideId = null }) {
  const has = (id) => aircraftList.some(a => a.id === id)
  return (
    <div className="relative z-0 -mt-2 flex gap-1.5 px-1">
      {['CA-A', 'CA-N', 'Fighter'].map(id => {
        const exists   = has(id)
        const isActive = id === activeId && exists
        const acc      = AIRCRAFT_ACCENT[id]
        const inactiveCls = exists
          ? 'bg-[#0a1628] border-[#1a3a5c] hover:bg-[#0f2240]'
          : 'bg-[#060e1a] border-[#1a3a5c] text-slate-600 cursor-not-allowed opacity-50'
        return (
          <button
            key={id}
            type="button"
            disabled={!exists}
            onClick={() => exists && onSelectActive(id)}
            className={`relative flex-1 pt-3 pb-1.5 rounded-b-lg font-mono font-bold text-sm border transition-colors ${
              isActive ? '' : inactiveCls
            }${guideId === id ? ' cbat-triple-pulse' : ''}`}
            style={
              isActive
                ? { background: acc.bg, borderColor: acc.border, color: acc.textActive }
                : exists
                  ? { color: acc.textInactive }
                  : undefined
            }
          >
            {id}
            {guideId === id && <GuideArrow dir="up" />}
          </button>
        )
      })}
    </div>
  )
}

// ── Numpad / L-R / aircraft switcher ────────────────────────────────────────
// Memo'd so the 30fps game-loop renders of the parent don't re-reconcile
// the numpad subtree — that competed with click handling on mobile and
// caused taps to be dropped in later, busier rounds.
//
// `guideDir` / `guideDigit` / `guideMode` are practice-only and default off:
// the L or R button, the numpad key, or the BRG/ALT toggle the current drill
// wants pressed next gets a guide arrow.
const DptControls = memo(function DptControls({
  turnDir, onTurnDir,
  inputMode, onInputMode,
  bearingInput, onDigit,
  guideDir = null, guideDigit = null, guideMode = null,
}) {
  const display = bearingInput.padEnd(3, '_')
  // Track the most recent pointerdown fire so the synthesized click that
  // follows on some browsers doesn't double-trigger the same digit.
  const lastPointerFireRef = useRef({ label: '', t: 0 })

  // Background tint + accent colour for the numpad area, communicating the
  // current input dispatch at a glance:
  //   ALT mode          → subtle white  (typing an altitude)
  //   BRG mode, L       → subtle sea-blue (next bearing turns left)
  //   BRG mode, R       → subtle yellow  (next bearing turns right)
  const accent = (() => {
    if (inputMode === 'ALT') return { tint: 'rgba(255,255,255,0.06)', solid: '#5a6072', border: '#838ba0' }
    if (turnDir === 'L')     return { tint: 'rgba(110,210,130,0.10)', solid: '#3a7d4a', border: '#5fa56a' }
    return                          { tint: 'rgba(255,210,80,0.10)',  solid: '#9a7e22', border: '#c9a73a' }
  })()

  // L/R only apply when committing a bearing — they're meaningless in ALT
  // mode, so visually disabled when the user is typing an altitude.
  const dirDisabled = inputMode === 'ALT'
  const dirBtn = (d, label) => {
    const isActive = turnDir === d && !dirDisabled
    const inactiveCls = 'bg-[#0a1628] border-[#1a3a5c] text-brand-600 hover:bg-[#0f2240]'
    const disabledCls = 'bg-[#060e1a] border-[#1a3a5c] text-slate-600 cursor-not-allowed opacity-50'
    return (
      <button
        type="button"
        disabled={dirDisabled}
        onClick={() => !dirDisabled && onTurnDir(d)}
        data-demo-answer
        className={`relative w-full h-full py-3 rounded-lg font-mono font-extrabold text-lg border transition-colors ${
          dirDisabled ? disabledCls : isActive ? 'text-white' : inactiveCls
        }${guideDir === d ? ' cbat-triple-pulse' : ''}`}
        style={isActive
          ? { background: accent.solid, borderColor: accent.border, touchAction: 'manipulation' }
          : { touchAction: 'manipulation' }}
      >
        {label}
        {guideDir === d && <GuideArrow dir="up" />}
      </button>
    )
  }

  const modeBtn = (mode, label) => {
    const isActive = inputMode === mode
    // BRG keeps the brand-blue active style; ALT picks up the white-ish
    // accent so the mode toggle visually matches the numpad tint. Buttons
    // are rounded-top-only with asymmetric padding so they look like they
    // slide DOWN into the numpad container (which has z-10 to hide the
    // bottom of these buttons behind it).
    const useAltAccent = isActive && mode === 'ALT'
    return (
      <button
        type="button"
        onClick={() => onInputMode(mode)}
        className={`relative flex-1 pt-1.5 pb-3 rounded-t-lg font-mono font-bold text-xs border transition-colors ${
          isActive
            ? (useAltAccent ? 'text-white' : 'bg-brand-600 border-brand-400 text-white')
            : 'bg-[#0a1628] border-[#1a3a5c] text-brand-600 hover:bg-[#0f2240]'
        }${guideMode === mode ? ' cbat-triple-pulse' : ''}`}
        style={useAltAccent
          ? { background: accent.solid, borderColor: accent.border, touchAction: 'manipulation' }
          : { touchAction: 'manipulation' }}
      >
        {label}
        {guideMode === mode && <GuideArrow dir="down" />}
      </button>
    )
  }

  // Fires on pointerdown so the digit registers on contact rather than
  // waiting for the browser's click synthesis — that synthesis was getting
  // delayed/dropped on mobile when the 30fps game loop saturated the main
  // thread in later rounds. onClick is kept as a keyboard-activation
  // fallback (Enter/Space on a focused button), guarded against the
  // pointer-then-click double fire.
  const padBtn = (val, label, fire) => (
    <button
      key={label}
      type="button"
      onPointerDown={(e) => {
        e.preventDefault()
        lastPointerFireRef.current = { label, t: Date.now() }
        fire()
      }}
      onClick={() => {
        const r = lastPointerFireRef.current
        if (r.label === label && Date.now() - r.t < 500) return
        fire()
      }}
      className={`relative aspect-square rounded-lg font-mono font-bold text-xl bg-[#0a1628] border border-[#1a3a5c] text-brand-600 hover:bg-[#0f2240] active:bg-[#163055] transition-colors select-none${guideDigit === label ? ' cbat-triple-pulse' : ''}`}
      style={{ touchAction: 'manipulation' }}
    >
      {label}
      {guideDigit === label && <GuideArrow dir="down" />}
    </button>
  )

  return (
    <div className="mt-2">
      {/* BRG/ALT mode toggle — slides down -8px with z-0 so the bottoms
          tuck behind the numpad container (which has z-10), matching the
          aircraft-buttons-emerging-from-arena visual. */}
      <div className="relative z-0 -mb-2 flex gap-2">
        {modeBtn('BRG', 'BRG (heading)')}
        {modeBtn('ALT', 'ALT (altitude)')}
      </div>

      {/* L on the left, numpad in the middle, R on the right. Container
          tint reflects the current dispatch (BRG L / BRG R / ALT). The
          backgroundColor gives a solid base layer so the BRG/ALT button
          bottoms (z-0, tucked under) actually get hidden — the tint alone
          is only ~10% opaque and would show them through. */}
      <div
        className="relative z-10 grid grid-cols-[3.5rem_1fr_3.5rem] gap-2 p-2 rounded-lg"
        style={{
          backgroundImage: `linear-gradient(${accent.tint}, ${accent.tint})`,
          backgroundColor: '#0a1628',
          transition:      'background-image 200ms ease',
        }}
      >
        {dirBtn('L', 'L')}
        <div>
          <div className="bg-[#060e1a] border border-[#1a3a5c] rounded-lg py-2 mb-2 text-center font-mono text-xl tracking-[0.3em] text-brand-600 flex items-center justify-center gap-3">
            <span className="text-[10px] text-slate-500 tracking-normal">{inputMode}</span>
            <span className="text-2xl tracking-[0.4em]">{display}</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {[1,2,3,4,5,6,7,8,9].map(n => padBtn(n, String(n), () => onDigit(String(n))))}
            <div />
            {padBtn(0, '0', () => onDigit('0'))}
            <div />
          </div>
        </div>
        {dirBtn('R', 'R')}
      </div>
      <p className="text-[10px] text-slate-500 mt-2 text-center">
        {inputMode === 'BRG'
          ? <>Pick L/R, type a 3-digit bearing (e.g. <span className="font-mono">010</span> = north). Press <span className="font-mono">M</span> for altitude.</>
          : <>Type 3 digits in 100s of ft (e.g. <span className="font-mono">035</span> = 3500ft, range 010–100). Press <span className="font-mono">M</span> for heading.</>}
      </p>
      <p className="text-[10px] text-slate-600 mt-1 text-center">
        Keys: <span className="font-mono">0–9</span>, <span className="font-mono">←→</span> L/R, <span className="font-mono">↑↓</span> BRG/ALT, <span className="font-mono">A/N/F</span>
      </p>

      {/* Danger-zone legend — replaces the in-circle altitude labels. */}
      <div className="mt-3 pt-3 border-t border-[#1a3a5c] space-y-1.5 text-[10px] text-slate-400">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block w-3.5 h-3.5 rounded-full"
            style={{ background: 'rgba(255,80,80,0.45)', border: '2px solid #ffffff' }}
          />
          <span>White-ring zone at <span className="font-mono text-slate-700">020</span> — keep ≥<span className="font-mono text-slate-700">1,000ft</span> above or below</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block w-3.5 h-3.5 rounded-full"
            style={{ background: 'rgba(255,80,80,0.45)', border: '2px solid #000000' }}
          />
          <span>Black-ring zone at <span className="font-mono text-slate-700">030</span> — keep ≥<span className="font-mono text-slate-700">1,000ft</span> above or below</span>
        </div>
      </div>
    </div>
  )
})

// ── Aircraft Selection Screen ───────────────────────────────────────────────
// Doubles as DPT's instructions card, so the difficulty pair sits under the
// title here the way it does on every other split game. There is no launch flash:
// picking an aircraft IS the Start button, and the logo intro that follows
// already marks the moment the run begins.
function AircraftSelect({ aircraft, onSelect, loading, personalBest, bestLoading, difficulty, onDifficulty, onPractice }) {
  const tuning = dptTuning(difficulty)
  return (
    <div>
      {/* DPT_DIFFICULTIES is ordered [easier, hard], so the easier option lands
          left and hard lands right. The pair sits UNDER the title, matching
          FLAG, CUT and every other split game. */}
      <h2 className="text-lg lg:text-xl font-bold text-text text-center mb-2">Dynamic Projection Test</h2>
      <CbatModeRow
        modes={DPT_DIFFICULTIES}
        value={difficulty}
        onSelect={onDifficulty}
      />
      <p className="text-[11px] text-brand-600 text-center mb-3">{tuning.blurb}</p>

      <p className="text-xs lg:text-sm text-slate-400 text-center mb-3 lg:mb-4 lg:max-w-lg lg:mx-auto">
        Vector multiple aircraft through gates and intercept enemy contacts.
      </p>

      {/* Instructions */}
      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-4 lg:p-6 max-w-md lg:max-w-2xl mx-auto mb-4 lg:mb-5 text-sm lg:text-base text-[#ddeaf8] space-y-1.5 lg:space-y-2">
        <div className="flex items-start gap-2">
          <span className="text-brand-600 shrink-0">🎯</span>
          <span>Vector aircraft through gates using compass bearings</span>
        </div>
        <div className="flex items-start gap-2">
          <span className="shrink-0">🛩️</span>
          <span><span className="font-mono text-slate-700">CA-A</span> hits lettered gates in order (A→B→C)</span>
        </div>
        {difficulty === 'easier' ? (
          <div className="flex items-start gap-2">
            <span className="shrink-0">✈️</span>
            <span><span className="font-mono text-slate-700">CA-N</span> joins the final round — numbered gates (1→2→3)</span>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-2">
              <span className="shrink-0">✈️</span>
              <span><span className="font-mono text-slate-700">CA-N</span> is up from round 1 — numbered gates (1→2→3)</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="shrink-0">🛫</span>
              <span><span className="font-mono text-slate-700">Fighter</span> arrives round 2 — intercept enemy contacts</span>
            </div>
          </>
        )}
        <div className="flex items-start gap-2">
          <span className="text-brand-600 shrink-0">⌨️</span>
          <span><span className="font-mono text-slate-700">BRG</span>: type a 3-digit compass bearing (e.g. <span className="font-mono text-slate-700">010</span>, <span className="font-mono text-slate-700">250</span>)</span>
        </div>
        <div className="flex items-start gap-2">
          <span className="text-brand-600 shrink-0">📏</span>
          <span><span className="font-mono text-slate-700">ALT</span>: type 3 digits in 100s of ft &mdash; <span className="font-mono text-slate-700">020</span> = 2,000ft, <span className="font-mono text-slate-700">055</span> = 5,500ft, <span className="font-mono text-slate-700">100</span> = 10,000ft (max)</span>
        </div>
        <div className="flex items-start gap-2">
          <span className="text-brand-600 shrink-0">⏱</span>
          <span>{tuning.lengthBlurb}</span>
        </div>
      </div>

      {/* Intercept rules — asymmetric scoring around the white/blue rings.
          Easier plays rounds 1-4, which have no enemies (the Fighter and the
          enemy squadron arrive at ladder round 6) and no danger zones (they
          start at ladder round 5), so it lists only the rule it can actually
          break: CA-A and CA-N closing on each other once both are up. */}
      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-4 lg:p-6 max-w-md lg:max-w-2xl mx-auto mb-4 text-sm lg:text-base text-[#ddeaf8] space-y-1.5 lg:space-y-2">
        <p className="text-[10px] lg:text-xs uppercase tracking-wide text-slate-500 mb-1">
          {difficulty === 'easier' ? 'Separation rule' : 'Intercept rules'}
        </p>
        {difficulty !== 'easier' && (
          <>
            <div className="flex items-start gap-2">
              <span className="text-green-400 shrink-0">＋</span>
              <span><span className="font-mono text-slate-700">Fighter</span> on enemy ring within <span className="font-mono text-slate-700">1,000ft</span> alt &rarr; <span className="text-green-400">+250</span>, kill</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-red-400 shrink-0">−</span>
              <span><span className="font-mono text-slate-700">CA-A / CA-N</span> on enemy ring within <span className="font-mono text-slate-700">3,000ft</span> alt &rarr; <span className="text-red-400">−150</span></span>
            </div>
          </>
        )}
        <div className="flex items-start gap-2">
          <span className="text-red-400 shrink-0">−</span>
          <span>Two player aircraft inside each other's blue ring within <span className="font-mono text-slate-700">3,000ft</span> alt &rarr; <span className="text-red-400">−150</span></span>
        </div>
        {difficulty !== 'easier' && (
          <div className="flex items-start gap-2">
            <span className="text-amber-400 shrink-0">⚠</span>
            <span>Danger zones at <span className="font-mono text-slate-700">020</span> (white ring) and <span className="font-mono text-slate-700">030</span> (black ring) — stay ≥<span className="font-mono text-slate-700">1,000ft</span> above or below</span>
          </div>
        )}
      </div>

      <CbatPersonalBest label={tuning.label} best={personalBest} loading={bestLoading} className="max-w-md lg:max-w-2xl mx-auto">
        {best => (
          <>
            {best.bestScore} pts
            {best.bestTime != null && (
              <>
                <span className="text-slate-500 mx-1">·</span>
                {best.bestTime.toFixed(1)}s
              </>
            )}
          </>
        )}
      </CbatPersonalBest>

      <div className="text-center mb-4">
        <Link to={`/cbat/${tuning.gameKey}/leaderboard`} className="text-xs lg:text-sm text-brand-600 hover:text-brand-700 transition-colors">
          View Leaderboard →
        </Link>
      </div>

      {/* Practice sits apart from the aircraft grid because picking an aircraft
          IS the Start button: it must not read as one more way to begin a run. */}
      <div className="flex flex-col items-center mb-5">
        <button
          type="button"
          onClick={onPractice}
          className="px-6 py-3 lg:px-8 lg:py-3.5 bg-[#1a3a5c] hover:bg-[#254a6e] text-[#ddeaf8] font-bold rounded-lg transition-colors text-sm lg:text-base cursor-pointer"
        >
          Tutorial
        </button>
        <p className="text-[11px] text-slate-500 mt-2 text-center">
          Twelve short drills on turning and height. No score, no timer.
        </p>
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
          <p className="font-bold text-slate-700 mb-1">No 3D aircraft available</p>
          <p className="text-sm text-slate-400">Add .glb files to <span className="font-mono">public/models/</span> first.</p>
        </div>
      )}

      {!loading && aircraft.length > 0 && (
        <>
          <h3 className="text-lg lg:text-xl font-bold text-text text-center mb-1">Choose Your Aircraft</h3>
          <p className="text-xs lg:text-sm text-slate-400 text-center mb-3 lg:mb-4">
            Used as the visual for CA-A and CA-N — Fighter is randomly assigned per round 6+.
          </p>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 max-w-md lg:max-w-2xl mx-auto">
          {aircraft.map((a, i) => (
            <motion.button
              key={a.briefId}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.04 }}
              onClick={() => onSelect(a)}
              data-demo-start
              className="relative flex flex-col items-center gap-1.5 p-3 rounded-xl border border-[#1a3a5c] bg-[#0a1628] hover:border-[#5baaff] hover:bg-[#0f2240] transition-all group cursor-pointer"
            >
              <span className="absolute top-1 right-1 text-[8px] font-bold px-1.5 py-0.5 rounded bg-brand-600/80 text-white leading-none">
                3D
              </span>
              <img
                src={a.cutoutUrl}
                alt={a.title}
                className="w-14 h-14 object-contain group-hover:scale-110 transition-transform drop-shadow-[0_0_6px_rgba(91,170,255,0.4)]"
              />
              <span className="text-[10px] text-slate-400 group-hover:text-brand-600 text-center leading-tight truncate w-full">
                {a.title}
              </span>
            </motion.button>
          ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── Practice mode ───────────────────────────────────────────────────────────
// Twelve drills on the real arena with the real numpad, teaching the one idea
// DPT never explains on screen: the three digits are an absolute compass
// bearing, and the L/R press before them decides which way round the aircraft
// turns to reach it. The last three do the same for height: ALT, hundreds of
// feet, and the danger zone that is the reason height matters. The drills themselves (poses, gates, goals, the judging of
// a command) live in utils/cbat/dptPractice.js; this component owns the loop,
// the input and the rendering, and it flies the same `moveAircraft` a run does.
//
// A wrong command is not blocked. The aircraft does what it was told, the
// command line and arc draw as they would in a run, the card says what went
// wrong, and the drill snaps back to its start once that has had time to
// register. Seeing a long-way-round arc is the lesson.

// How long a wrong command plays out before the drill resets — the command
// visualisation's own lifetime, so the arc is seen in full.
const PRACTICE_RESET_MS   = COMMAND_VIZ_DURATION_MS
// A settled heading or a cleared gate holds for this long before the next
// drill loads, so the aircraft is seen flying straight on the new heading.
const PRACTICE_ADVANCE_MS = 900
const PRACTICE_NO_DONE    = new Set()
// Header tag while practising, in the slot the difficulty marker uses in a run.
const PRACTICE_MODE_MARKER = { key: 'practice', label: 'Tutorial' }

// Per-playthrough id for practice usage tracking. Stamped once per mount; the
// admin Reports funnel keys on it.
function makePracticeRunId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch { /* fall through */ }
  return `prac_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

// ── Mini compass ────────────────────────────────────────────────────────────
// A north-up compass ring drawn around the selected aircraft, travelling with
// it. It makes the one thing the numpad never shows visible where the eye is:
// the three digits are a place on this ring, and each digit narrows down where.
//   nothing typed   ring, ticks every 10 degrees, the four cardinals, and a
//                   white tick at the aircraft's current heading
//   one digit       a 100 degree band lit, with a label every 10 degrees
//   two digits      a 10 degree band, labelled at both edges
//   committed       the bearing blinks at its angle until the turn settles
// And while no turn is in progress, an arrow sweeps round the outside of the
// ring from the aircraft's nose in the direction L/R would take it, in the
// colour that button wears on the numpad. It is the answer to "which way is
// L", shown before the digits go in rather than after.
//
// Sizes are in scope units at desktop size, where the arena renders at about
// 700px. `scale` (from the arena's rendered width, see DptPractice) grows them
// on a phone, where the same units come out at half the pixels and 12-unit
// text is unreadable: text scales fully so it keeps its desktop pixel size,
// radii by 70% of that so the ring does not swallow the arena.
const MC_RING_R  = 112   // ring radius, outside the aircraft's own blue ring
const MC_BAND    = 14    // lit band thickness, outward from the ring
const MC_SWEEP_R = 134   // the turn-direction arrow's track, outside the band
const MC_LABEL_R = 156   // label radius
const MC_LABEL_STAGGER = 22   // every other band label sits this much further out
const MC_FONT_CARDINAL = 15
const MC_FONT_LABEL    = 15
const MC_FONT_TARGET   = 19
const MC_DESKTOP_ARENA_PX = 700
const MC_MAX_SCALE = 2.2
const MC_SWEEP_COLOR = { L: '#6fd28a', R: '#ffd84a' }

// How much to grow the mini compass for an arena rendered `arenaPx` wide.
function miniCompassScale(arenaPx) {
  if (!arenaPx || arenaPx <= 0) return 1
  return Math.min(MC_MAX_SCALE, Math.max(1, MC_DESKTOP_ARENA_PX / arenaPx))
}
const MC_TICKS   = Array.from({ length: 36 }, (_, i) => i * 10)
const MC_CARDINALS = [360, 90, 180, 270]

function mcPolar(deg, r) {
  const rad = (deg * Math.PI) / 180
  return { x: Math.sin(rad) * r, y: -Math.cos(rad) * r }
}
// Annular sector between two radii, clockwise from startDeg to endDeg. The
// degrees may run past 360 (a first digit of 3 lights 300 to 400); sin/cos
// wrap on their own and the sweep is never 180 or more.
function mcSector(startDeg, endDeg, r1, r2) {
  const a = mcPolar(startDeg, r1), b = mcPolar(endDeg, r1)
  const c = mcPolar(endDeg, r2),   d = mcPolar(startDeg, r2)
  return `M ${a.x} ${a.y} A ${r1} ${r1} 0 0 1 ${b.x} ${b.y} L ${c.x} ${c.y} A ${r2} ${r2} 0 0 0 ${d.x} ${d.y} Z`
}
const MC_FONT = 'ui-monospace, SFMono-Regular, Menlo, monospace'

function MiniCompass({ aircraft, sector, turnDir = null, scale = 1 }) {
  const { position, headingDeg, targetHeadingDeg } = aircraft
  const tx = Math.round(position.x * 10) / 10
  const ty = Math.round(position.y * 10) / 10
  const committed = targetHeadingDeg != null ? targetHeadingDeg : null
  const quiet = !sector && committed == null
  const kf = scale                      // text and strokes
  const kr = 1 + (scale - 1) * 0.7      // radii
  const ringR  = MC_RING_R * kr
  const band   = MC_BAND * kr
  const sweepR = MC_SWEEP_R * kr
  const labelR = MC_LABEL_R * kr
  const h1 = mcPolar(headingDeg, ringR - 12 * kr)
  const h2 = mcPolar(headingDeg, ringR)
  const sweep  = committed == null && (turnDir === 'L' || turnDir === 'R') ? turnDir : null
  const extent = sweep ? sweepExtent(headingDeg, sweep, sector) : null
  return (
    <g transform={`translate(${tx}, ${ty})`} pointerEvents="none" data-mini-compass
       data-compass-scale={scale.toFixed(2)}
       data-compass-sector={sector ? `${sector.start}-${sector.end}` : undefined}
       data-compass-commit={committed != null ? pad3(committed) : undefined}
       data-compass-sweep={sweep && extent ? sweep : undefined}
       data-compass-sweep-rotation={extent ? Math.round(extent.rotation) : undefined}>
      <circle r={ringR} fill="none" stroke="#5baaff" strokeWidth={1 * kf} opacity={0.4} />
      {MC_TICKS.map(b => {
        const major = b % 30 === 0
        const p1 = mcPolar(b, ringR)
        const p2 = mcPolar(b, ringR + (major ? 7 : 4) * kr)
        return <line key={b} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#5baaff" strokeWidth={(major ? 1.4 : 1) * kf} opacity={major ? 0.7 : 0.4} />
      })}
      {/* Current heading: where the aircraft is pointing now. */}
      <line x1={h1.x} y1={h1.y} x2={h2.x} y2={h2.y} stroke="#ffffff" strokeWidth={2.5 * kf} strokeLinecap="round" opacity={0.9} />
      {/* Turn-direction sweep. The outer g points "up" at the nose; the inner
          g carries the CSS rotation, which spins it about the compass centre
          (the group's origin) the way the chosen direction would. */}
      {sweep && extent && (() => {
        const r = sweepR
        const s = sweep === 'R' ? 1 : -1
        const LEAD = extent.lead
        // The arrow's tail starts AT the nose and its head sits LEAD degrees
        // ahead in the direction of travel, so nothing is ever drawn behind
        // the nose: the aircraft turns forward from where it is pointing, and
        // the arrow only ever occupies ground it would cover. The rotation is
        // capped by sweepExtent so the head stops short of a lit band, and
        // the run time scales with it so a short sweep does not crawl.
        const tail = mcPolar(0, r)
        const head = mcPolar(s * LEAD, r)
        const sweepStyle = {
          '--sweep': `${s * extent.rotation}deg`,
          '--sweep-dur': `${(0.45 + (extent.rotation / 140) * 1.05).toFixed(2)}s`,
        }
        return (
          <g transform={`rotate(${headingDeg})`}>
            <g className={sweep === 'R' ? 'dpt-compass-sweep-r' : 'dpt-compass-sweep-l'} style={sweepStyle}>
              <path d={`M ${tail.x} ${tail.y} A ${r} ${r} 0 0 ${s === 1 ? 1 : 0} ${head.x} ${head.y}`}
                    fill="none" stroke={MC_SWEEP_COLOR[sweep]} strokeWidth={3 * kf} strokeLinecap="round" opacity={0.7} />
              {/* Chevron at the head, pointing along the tangent there. */}
              <g transform={`rotate(${s * LEAD})`}>
                <polygon points={`${s * 12 * kf},${-r} 0,${-r - 8 * kf} 0,${-r + 8 * kf}`} fill={MC_SWEEP_COLOR[sweep]} />
              </g>
            </g>
          </g>
        )
      })()}
      {quiet && MC_CARDINALS.map(b => {
        const p = mcPolar(b, ringR + 26 * kr)
        return (
          <text key={b} x={p.x} y={p.y} fill="#5baaff" fontSize={MC_FONT_CARDINAL * kf} fontFamily={MC_FONT} fontWeight={700}
                textAnchor="middle" dominantBaseline="middle" opacity={0.6}>{pad3(b)}</text>
        )
      })}
      {sector && (
        <g data-compass-band>
          <path d={mcSector(sector.start, sector.end, ringR, ringR + band)} fill="#5baaff" opacity={0.4} />
          {sector.labels.map((v, i) => {
            // Ten labels 10 degrees apart do not fit on one radius at this
            // size, so they alternate between two, the way tick labels on a
            // crowded axis are staggered.
            const stagger = sector.labels.length > 2 && i % 2 === 1 ? MC_LABEL_STAGGER * kr : 0
            const p = mcPolar(v, labelR + stagger)
            return (
              <text key={v} x={p.x} y={p.y} fill="#9ed5ff" fontSize={MC_FONT_LABEL * kf} fontFamily={MC_FONT} fontWeight={700}
                    textAnchor="middle" dominantBaseline="middle" data-compass-label>{pad3(normalizeDeg(v))}</text>
            )
          })}
        </g>
      )}
      {committed != null && (() => {
        const l1 = mcPolar(committed, ringR + band)
        const l2 = mcPolar(committed, labelR - 13 * kf)
        const p  = mcPolar(committed, labelR)
        return (
          <g className="dpt-compass-flash" data-compass-target>
            <path d={mcSector(committed - 2, committed + 2, ringR, ringR + band)} fill="#ffffff" />
            <line x1={l1.x} y1={l1.y} x2={l2.x} y2={l2.y} stroke="#ffffff" strokeWidth={1.5 * kf} />
            <text x={p.x} y={p.y} fill="#ffffff" fontSize={MC_FONT_TARGET * kf} fontFamily={MC_FONT} fontWeight={800}
                  textAnchor="middle" dominantBaseline="middle">{pad3(committed)}</text>
          </g>
        )
      })()}
    </g>
  )
}

function PracticeComplete({ onExit }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="w-full max-w-md bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-6 text-center"
    >
      <p className="text-5xl mb-3">✅</p>
      <p className="text-2xl font-extrabold text-white mb-1">Tutorial Complete</p>
      <p className="text-sm text-slate-400 mb-2">
        That is every control: a side and a bearing for heading, ALT and a height for altitude.
      </p>
      <p className="text-sm text-slate-400 mb-6">
        Pick an aircraft on the briefing to start a run.
      </p>
      <button
        onClick={onExit}
        className="px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg transition-colors text-sm cursor-pointer"
      >
        Back to Briefing
      </button>
    </motion.div>
  )
}

function DptPractice({ modelUrl, onExit, onProgress }) {
  const [stepIdx, setStepIdx] = useState(0)
  const [done, setDone]       = useState(false)
  const [runId]               = useState(makePracticeRunId)
  const drill    = DPT_PRACTICE_DRILLS[stepIdx]
  const drillRef = useRef(drill)
  const stepRef  = useRef(stepIdx)
  useEffect(() => { drillRef.current = drill; stepRef.current = stepIdx }, [drill, stepIdx])

  // Same state + ref split the live game uses: the loop reads refs, the
  // render tree reads state. Refs are written directly wherever a change must
  // be visible to the next frame before React has committed it.
  const [aircraftList, setAircraftList] = useState(() => buildDrillAircraft(drill, null))
  const [gateList, setGateList]         = useState(() => buildDrillGates(drill))
  const aircraftRef = useRef(aircraftList)
  const gatesRef    = useRef(gateList)
  useEffect(() => { aircraftRef.current = aircraftList }, [aircraftList])
  useEffect(() => { gatesRef.current    = gateList },     [gateList])

  // The roster can still be loading when practice opens, so the model is not
  // baked into the aircraft: it is stamped on at render, and the GLB layer
  // picks it up the frame it arrives.
  const aircraftWithModel = useMemo(
    () => aircraftList.map(a => ({ ...a, modelUrl })),
    [aircraftList, modelUrl],
  )

  const [activeId, setActiveId]         = useState('CA-A')
  const [turnDir, setTurnDir]           = useState('R')
  // The sides pressed since the drill loaded, for the L/R drill. R is selected
  // to begin with but has not been PRESSED, so it counts only once it is.
  const [dirsPressed, setDirsPressed]   = useState([])
  const dirsPressedRef                  = useRef([])
  const [inputMode, setInputMode]       = useState('BRG')
  const [bearingInput, setBearingInput] = useState('')
  const bearingInputRef                 = useRef('')
  const [commandViz, setCommandViz]     = useState({})
  const [brgPulseKey, setBrgPulseKey]   = useState(0)
  const [altPulseKey, setAltPulseKey]   = useState(0)
  // { tone: 'ok' | 'bad', text } shown under the drill card.
  const [feedback, setFeedback]         = useState(null)
  // A correct command is in and the drill is waiting for the aircraft to
  // settle on it. Held twice: the ref is what the loop reads, the state is
  // what takes the guide arrows down.
  const armedRef                        = useRef(false)
  const [armed, setArmed]               = useState(false)
  // A reset or an advance is queued; the loop stops judging outcomes until it
  // has fired, so a miss cannot be reported twice.
  const pendingRef                      = useRef(null)
  // Zone drill: the aircraft has been inside the circle (with the height to
  // spare). Leaving it again is the drill done.
  const zoneEnteredRef                  = useRef(false)
  const activeIdRef                     = useRef('CA-A')
  useEffect(() => { activeIdRef.current = activeId }, [activeId])
  // The loop reads the pad's mode for the "then switch back" height drill.
  const inputModeRef                    = useRef('BRG')
  useEffect(() => { inputModeRef.current = inputMode }, [inputMode])
  // The arena's rendered width, for sizing the mini compass: its text is in
  // scope units, and a phone renders those at half the pixels a desktop does.
  const arenaRef                        = useRef(null)
  const [arenaPx, setArenaPx]           = useState(0)
  useEffect(() => {
    const el = arenaRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect?.width
      if (w) setArenaPx(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Put the aircraft and gates back where the drill starts them, and nothing
  // else: the numpad, the chosen side and any digits typed so far are kept.
  // This is what the boundary triggers while the player is still reading —
  // the aircraft has flown out of room, not the player out of turn.
  const resetFlight = useCallback((idx) => {
    const d  = DPT_PRACTICE_DRILLS[idx]
    const ac = buildDrillAircraft(d, null)
    const gs = buildDrillGates(d)
    aircraftRef.current = ac
    gatesRef.current    = gs
    setAircraftList(ac)
    setGateList(gs)
    setCommandViz({})
    armedRef.current = false
    setArmed(false)
    zoneEnteredRef.current = false
  }, [])

  // Rebuild the drill's whole pose, input included. `keepFeedback` leaves the
  // card's verdict up on a reset, so what went wrong stays readable after the
  // aircraft has snapped back to its start.
  const loadPose = useCallback((idx, { keepFeedback = false } = {}) => {
    clearTimeout(pendingRef.current)
    pendingRef.current = null
    const d = DPT_PRACTICE_DRILLS[idx]
    resetFlight(idx)
    setActiveId('CA-A')
    activeIdRef.current = 'CA-A'
    setTurnDir('R')
    dirsPressedRef.current = []
    setDirsPressed([])
    // The height drills open on ALT where the lesson is that the pad stays
    // there; everything else opens on BRG as a run does.
    setInputMode(d.startMode ?? 'BRG')
    bearingInputRef.current = ''
    setBearingInput('')
    if (!keepFeedback) setFeedback(null)
  }, [resetFlight])

  // Every step change goes through here so the pose is rebuilt in the same
  // handler as the index change, not in an effect chasing it.
  const goToStep = useCallback((idx) => {
    loadPose(idx)
    setStepIdx(idx)
  }, [loadPose])

  const advance = useCallback(() => {
    const idx = stepRef.current
    if (idx >= DPT_PRACTICE_DRILLS.length - 1) {
      clearTimeout(pendingRef.current)
      pendingRef.current = null
      setDone(true)
      return
    }
    goToStep(idx + 1)
  }, [goToStep])

  const scheduleReset = useCallback((text, delay) => {
    if (pendingRef.current) return
    setFeedback(text ? { tone: 'bad', text } : null)
    pendingRef.current = setTimeout(() => {
      pendingRef.current = null
      loadPose(stepRef.current, { keepFeedback: true })
    }, delay)
  }, [loadPose])

  const scheduleAdvance = useCallback((text) => {
    if (pendingRef.current) return
    setFeedback({ tone: 'ok', text })
    pendingRef.current = setTimeout(() => {
      pendingRef.current = null
      advance()
    }, PRACTICE_ADVANCE_MS)
  }, [advance])

  useEffect(() => () => clearTimeout(pendingRef.current), [])

  // Choosing a side. On the L/R drill this IS the task: each press is named,
  // and once both sides have been seen the drill moves on.
  const handleTurnDir = useCallback((d) => {
    setTurnDir(d)
    if (!dirsPressedRef.current.includes(d)) {
      dirsPressedRef.current = [...dirsPressedRef.current, d]
      setDirsPressed(dirsPressedRef.current)
    }
    if (drillRef.current.goal.type !== 'direction' || pendingRef.current) return
    if (dirsPressedRef.current.length === 2) {
      scheduleAdvance('Both sides seen. Now to use one.')
    } else {
      setFeedback({ tone: 'ok', text: `${d}: the arrow now sweeps ${d === 'L' ? 'anticlockwise' : 'clockwise'}. Now press ${d === 'L' ? 'R' : 'L'}.` })
    }
  }, [scheduleAdvance])

  useEffect(() => {
    onProgress?.({ clientRunId: runId, furthestStep: stepIdx, totalSteps: DPT_PRACTICE_DRILLS.length, completed: false })
  }, [stepIdx, runId, onProgress])
  useEffect(() => {
    if (done) onProgress?.({ clientRunId: runId, furthestStep: DPT_PRACTICE_DRILLS.length - 1, totalSteps: DPT_PRACTICE_DRILLS.length, completed: true })
  }, [done, runId, onProgress])

  // Show a command's line + arc for its lifetime, exactly as a run does.
  const showViz = useCallback((id, snapshot) => {
    setCommandViz(prev => ({ ...prev, [id]: snapshot }))
    setTimeout(() => {
      setCommandViz(prev => {
        if (prev[id] !== snapshot) return prev
        const next = { ...prev }
        delete next[id]
        return next
      })
    }, COMMAND_VIZ_DURATION_MS + 100)
  }, [])

  // ── Movement loop ──────────────────────────────────────────────────────────
  // The live loop's cadence and the live flight model. On top of that, only
  // what a drill needs: gate crossings for the next gate in order, and the
  // three ways a drill ends — the edge took the aircraft, a gate was missed,
  // or the goal was met.
  useEffect(() => {
    if (done) return
    let raf
    let last  = performance.now()
    let accum = 0
    const STEP_INTERVAL = 1 / 30

    function step(now) {
      raf = requestAnimationFrame(step)
      const realDt = (now - last) / 1000
      last = now
      accum += realDt
      if (accum < STEP_INTERVAL) return
      const dt = Math.min(0.05, accum)
      accum = 0

      const d    = drillRef.current
      const prev = aircraftRef.current
      if (prev.length === 0) return
      let   gates        = gatesRef.current
      let   gatesChanged = false
      let   missed       = null
      let   edgeTook     = false
      const vizs         = []

      const moved = prev.map(a => {
        const { aircraft: m, edgeAuto } = moveAircraft(a, dt)
        if (edgeAuto) {
          edgeTook = true
          vizs.push({ id: a.id, snapshot: { ...edgeAuto, kind: 'edgeAuto' } })
        }
        if (d.goal.type === 'gates' && a.id === 'CA-A') {
          const nextIdx = gates.findIndex(g => !g.hit)
          if (nextIdx >= 0) {
            const crossing = gateCrossing(a.position, m.position, gates[nextIdx])
            if (crossing === 'hit') {
              gates = gates.map((g, i) => (i === nextIdx ? { ...g, hit: true } : g))
              gatesChanged = true
            } else if (crossing === 'miss') {
              missed = gates[nextIdx].id
            }
          }
        }
        return m
      })

      aircraftRef.current = moved
      setAircraftList(moved)
      if (gatesChanged) {
        gatesRef.current = gates
        setGateList(gates)
      }

      if (pendingRef.current) return

      // The boundary turning the aircraft round is a run's safety net, not
      // something a drill should teach against. Before any command it just
      // means the player is still reading, so the aircraft quietly goes back
      // to its start and the numpad is left exactly as they had it; after
      // one, it means the command sent the aircraft the wrong way, and the
      // card says so.
      if (edgeTook) {
        if (armedRef.current) {
          for (const { id, snapshot } of vizs) showViz(id, snapshot)
          scheduleReset('The aircraft reached the edge and turned itself back toward the middle. Back to the start.', PRACTICE_RESET_MS)
        } else {
          resetFlight(stepRef.current)
        }
        return
      }
      if (missed) {
        scheduleReset(`Missed gate ${missed}. Back to the start.`, PRACTICE_RESET_MS)
        return
      }
      if (d.goal.type === 'gates' && gates.length > 0 && gates.every(g => g.hit)) {
        scheduleAdvance(gates.length > 1 ? 'Through both. Well flown.' : 'Through. Well flown.')
        return
      }
      if (d.goal.type === 'heading' && armedRef.current && headingSettled(d, moved)) {
        scheduleAdvance(`Heading ${pad3(d.goal.target)}. Well done.`)
        return
      }
      // A height drill is done once the aircraft has levelled off, and, where
      // the drill also wants the pad switched back, once that has happened.
      if (d.goal.type === 'altitude' && armedRef.current && altitudeSettled(d, moved)) {
        if (d.goal.thenMode && inputModeRef.current !== d.goal.thenMode) return
        scheduleAdvance(d.goal.thenMode
          ? `Level at ${altProse(d.goal.target)}, and the pad is back on ${d.goal.thenMode}. Well done.`
          : `Level at ${altProse(d.goal.target)}. Well done.`)
        return
      }
      // The zone drill: inside its band is a run's penalty and a restart here;
      // through it with the height to spare is the drill done.
      if (d.goal.type === 'zone') {
        const ac = moved.find(a => a.id === 'CA-A')
        const zone = d.zones[0]
        if (!ac || !zone) return
        const status = zoneStatus(ac, zone)
        if (status === 'violating') {
          scheduleReset(`Inside the zone at ${altProse(Math.round(ac.altitudeFt))}, within 1,000ft of its ${altProse(zone.band === '2k' ? DZ_ALT_2K : DZ_ALT_3K)}. Back to the start.`, PRACTICE_RESET_MS)
          return
        }
        if (status === 'inside') zoneEnteredRef.current = true
        else if (zoneEnteredRef.current) scheduleAdvance('Through the zone with room to spare. Well done.')
      }
    }

    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [done, resetFlight, scheduleReset, scheduleAdvance, showViz])

  // ── Commands ───────────────────────────────────────────────────────────────
  const commitInput = useCallback((digits) => {
    const value = parseInt(digits, 10)
    const id    = activeIdRef.current
    if (inputMode === 'ALT') {
      const ft = altitudeFromDigits(value)
      // The aircraft does what it was told, right or wrong.
      const next = aircraftRef.current.map(a => (a.id === id ? { ...a, targetAltitudeFt: ft } : a))
      aircraftRef.current = next
      setAircraftList(next)
      setAltPulseKey(k => k + 1)

      if (pendingRef.current) return
      const d = drillRef.current
      const verdict = judgeAltitudeCommand(d, ft)
      if (verdict.verdict !== 'ok') {
        scheduleReset(verdict.text, PRACTICE_RESET_MS)
        return
      }
      if (d.goal.type === 'altitude' || d.goal.type === 'zone') {
        armedRef.current = true
        setArmed(true)
        setFeedback({ tone: 'ok', text: verdict.text })
      }
      return
    }
    const bearing = normalizeDeg(value)
    const target  = aircraftRef.current.find(a => a.id === id)
    if (!target) return
    showViz(id, {
      fromHeading:   target.headingDeg,
      targetBearing: bearing,
      direction:     turnDir,
      capturedPos:   { x: target.position.x, y: target.position.y },
      kind:          'user',
    })
    // The aircraft does what it was told, right or wrong.
    const next = aircraftRef.current.map(a => (a.id === id ? { ...a, targetHeadingDeg: bearing, turnDirection: turnDir } : a))
    aircraftRef.current = next
    setAircraftList(next)

    if (pendingRef.current) return
    const d = drillRef.current
    const verdict = judgeCommand(d, target, id, bearing, turnDir)
    if (verdict.verdict !== 'ok') {
      scheduleReset(verdict.text, PRACTICE_RESET_MS)
      return
    }
    armedRef.current = true
    setArmed(true)
    if (d.goal.type === 'heading') {
      setFeedback({ tone: 'ok', text: verdict.note ? `${verdict.text} ${verdict.note}` : verdict.text })
    }
  }, [inputMode, turnDir, showViz, scheduleReset])

  useEffect(() => { bearingInputRef.current = bearingInput }, [bearingInput])

  const handleInputModeChange = useCallback((m) => {
    setInputMode(m)
    setBearingInput('')
    bearingInputRef.current = ''
    if (m === 'ALT') setAltPulseKey(k => k + 1)
    else if (m === 'BRG') setBrgPulseKey(k => k + 1)
  }, [])

  const handleDigit = useCallback((dgt) => {
    const prev = bearingInputRef.current
    if (prev.length >= 3) return
    const next = prev + dgt
    if (next.length === 3) {
      bearingInputRef.current = ''
      setBearingInput('')
      commitInput(next)
      return
    }
    bearingInputRef.current = next
    setBearingInput(next)
  }, [commitInput])

  const selectAircraft = useCallback((id) => {
    if (!aircraftRef.current.some(a => a.id === id)) return
    activeIdRef.current = id
    setActiveId(id)
  }, [])

  // The run's keyboard shortcuts, so what is learnt here is what a run takes.
  useEffect(() => {
    if (done) return
    function onKey(e) {
      if (e.key >= '0' && e.key <= '9') { handleDigit(e.key); e.preventDefault(); return }
      if (e.key === 'ArrowLeft')  { handleTurnDir('L'); e.preventDefault(); return }
      if (e.key === 'ArrowRight') { handleTurnDir('R'); e.preventDefault(); return }
      if (e.key === 'ArrowUp')    { handleInputModeChange('BRG'); e.preventDefault(); return }
      if (e.key === 'ArrowDown')  { handleInputModeChange('ALT'); e.preventDefault(); return }
      const k = e.key.toLowerCase()
      if (k === 'l') { handleTurnDir('L'); return }
      if (k === 'r') { handleTurnDir('R'); return }
      if (k === 'm') { handleInputModeChange(inputMode === 'BRG' ? 'ALT' : 'BRG'); return }
      if (k === 'a') { selectAircraft('CA-A'); return }
      if (k === 'n') { selectAircraft('CA-N'); return }
      if (k === 'f') { selectAircraft('Fighter'); return }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [done, handleDigit, handleInputModeChange, handleTurnDir, selectAircraft, inputMode])

  if (done) {
    return (
      <div className="flex flex-col items-center">
        <PracticeComplete onExit={() => onExit('viewed')} />
      </div>
    )
  }

  // What the arrows point at right now: the aircraft to select, then the
  // direction, then each digit in turn. Nothing once a correct command is in.
  const guide = (() => {
    const g = drill.guide
    if (g.aircraft && activeId !== g.aircraft) return { aircraft: g.aircraft }
    if (drill.goal.type === 'direction') {
      // L first: R is already lit, so L is the press that visibly changes something.
      const next = ['L', 'R'].find(d => !dirsPressed.includes(d))
      return next ? { dir: next } : {}
    }
    // Height drills: ALT, then the digits; then, where the drill asks for it,
    // the switch back to BRG once the height command is in.
    if (drill.goal.type === 'altitude' || drill.goal.type === 'zone') {
      if (!armed) {
        if (inputMode !== 'ALT') return { mode: 'ALT' }
        return g.digits ? { digit: g.digits[bearingInput.length] } : {}
      }
      const then = drill.goal.thenMode
      if (then && inputMode !== then) return { mode: then }
      return {}
    }
    if (armed) return {}
    if (inputMode !== 'BRG') return { mode: 'BRG' }
    if (g.dir && turnDir !== g.dir) return { dir: g.dir }
    if (g.digits) return { digit: g.digits[bearingInput.length] }
    return {}
  })()

  const nextGateIndex = gateList.findIndex(g => !g.hit)
  const total = DPT_PRACTICE_DRILLS.length
  // The compass follows the selected aircraft and lights up with the digits
  // only while they are a bearing; an altitude being typed lights nothing.
  const activeAircraft = aircraftList.find(a => a.id === activeId) ?? null
  const compassSector  = inputMode === 'BRG' ? bearingSector(bearingInput) : null
  // On a gate drill, lined up on the next gate means no turn is needed, so the
  // turn-direction arrow comes down; it returns if the line is lost or the
  // gate after this one needs a turn.
  const onTrack = drill.goal.type === 'gates' && !!activeAircraft
    && onTrackForGate(activeAircraft, gateList[nextGateIndex])
  // No turn is wanted on a height drill, so no turn-direction arrow either.
  const heightDrill = drill.goal.type === 'altitude' || drill.goal.type === 'zone'
  const zoneList = drill.zones ?? []

  return (
    <div className="w-full flex flex-col md:grid md:grid-cols-[auto_440px] md:gap-4 md:justify-center">
      {/* Arena — the live game's sizing (see the playing branch) so the drills
          are flown on the arena a run will use. Second on a phone, under the
          card; the left column on desktop, spanning both rows on the right. */}
      <div className="order-2 md:order-none md:row-span-2 md:col-start-1 w-full max-w-md md:max-w-none mx-auto md:mx-0 md:w-[min(calc(100vh_-_134px),calc(100vw_-_704px))]">
        <div className="flex items-center justify-between text-xs font-mono mb-2 px-1">
          <span className="text-slate-400">DRILL <span className="text-brand-600">{stepIdx + 1}</span>/{total}</span>
          <span className="text-slate-400">TUTORIAL · NO SCORE</span>
        </div>
        <div ref={arenaRef} className="relative z-10 bg-[#060e1a] border-2 border-[#1a3a5c] rounded-xl shadow-[0_0_30px_rgba(91,170,255,0.08)] overflow-hidden" style={{ width: '100%', aspectRatio: '1' }}>
          <DptAircraftLayer aircraftList={aircraftWithModel} sizeMultiplier={1} doneIds={PRACTICE_NO_DONE} />
          <ArenaScope brgPulseKey={brgPulseKey}>
            {zoneList.map(z => (
              <DangerZoneMarker key={`dz-${z.id}`} zone={z} />
            ))}
            {gateList.map((g, i) => (
              <GateMarker key={`${g.kind}-${g.id}`} gate={g} isNext={i === nextGateIndex} />
            ))}
            {Object.entries(commandViz).map(([id, viz]) => (
              <CommandViz key={`viz-${id}-${viz.capturedPos.x}-${viz.capturedPos.y}`} viz={viz} />
            ))}
            {aircraftList.flatMap(a => nearEdges(a.position).map(edge => (
              <EdgeWarning key={`edge-${a.id}-${edge}`} edge={edge} x={a.position.x} y={a.position.y} />
            )))}
            {activeAircraft && (
              <MiniCompass
                aircraft={activeAircraft}
                sector={compassSector}
                turnDir={inputMode === 'BRG' && !onTrack && !heightDrill ? turnDir : null}
                scale={miniCompassScale(arenaPx)}
              />
            )}
            {aircraftList.map(a => (
              <AircraftSprite
                key={a.id}
                aircraft={a}
                active={a.id === activeId}
                edgeWarn={nearEdges(a.position).length > 0}
                dim={false}
                altPulseKey={altPulseKey}
              />
            ))}
          </ArenaScope>
        </div>
        <AircraftButtons
          aircraftList={aircraftList}
          activeId={activeId}
          onSelectActive={selectAircraft}
          guideId={guide.aircraft ?? null}
        />
      </div>

      {/* Drill card — first on a phone, top of the right column on desktop. */}
      <div className="order-1 md:order-none md:col-start-2 md:row-start-1 w-full max-w-md md:max-w-none mx-auto md:mx-0 mb-3 md:mb-0">
        <div className="w-full bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-4" data-practice-card>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase tracking-wide text-brand-600 font-bold">Tutorial</span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => goToStep(Math.max(0, stepIdx - 1))}
                disabled={stepIdx === 0}
                aria-label="Previous drill"
                className="px-1.5 py-0.5 text-base leading-none text-slate-400 hover:text-brand-600 disabled:opacity-30 disabled:cursor-not-allowed bg-transparent border-0 cursor-pointer"
              >
                {'‹'}
              </button>
              <span className="text-[10px] text-slate-500 tabular-nums">{stepIdx + 1} / {total}</span>
              <button
                onClick={advance}
                aria-label="Next drill"
                className="px-1.5 py-0.5 text-base leading-none text-slate-400 hover:text-brand-600 bg-transparent border-0 cursor-pointer"
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
              <h2 className="text-base font-extrabold text-white mb-1">{drill.title}</h2>
              <p className="text-sm text-[#ddeaf8] leading-relaxed">{drill.body}</p>
            </motion.div>
          </AnimatePresence>
          {/* Verdict line. Held at a fixed minimum height so the numpad below
              does not jump when a verdict comes and goes. */}
          <p
            className={`mt-3 min-h-[2.5rem] text-sm font-semibold leading-snug ${feedback?.tone === 'ok' ? 'text-green-400' : 'text-amber-400'}`}
            data-practice-feedback={feedback?.tone ?? 'none'}
            aria-live="polite"
          >
            {feedback?.text ?? ''}
          </p>
          <div className="flex items-center gap-3 mt-2">
            <button
              onClick={() => onExit('skipped')}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors bg-transparent border-0 cursor-pointer"
            >
              Exit tutorial
            </button>
          </div>
        </div>
      </div>

      {/* Numpad — the run's own, arrows and all. */}
      <div className="order-3 md:order-none md:col-start-2 md:row-start-2 w-full max-w-md md:max-w-none mx-auto md:mx-0 mt-2 md:mt-0">
        <DptControls
          turnDir={turnDir}
          onTurnDir={handleTurnDir}
          inputMode={inputMode}
          onInputMode={handleInputModeChange}
          bearingInput={bearingInput}
          onDigit={handleDigit}
          guideDir={guide.dir ?? null}
          guideDigit={guide.digit ?? null}
          guideMode={guide.mode ?? null}
        />
      </div>
    </div>
  )
}

// ── Main Component ──────────────────────────────────────────────────────────
export default function CbatDpt() {
  const { user, apiFetch, API } = useAuth()
  const { start: startTracking, markCompleted: markGameCompleted } = useCbatTracking()

  // Aircraft selection — only 3D-enabled aircraft per spec
  const [aircraft, setAircraft]               = useState([])
  const [loadingAircraft, setLoadingAircraft] = useState(true)
  const [selected, setSelected]               = useState(null)
  // Fighter pool used for the player's Fighter and the enemy aircraft (rounds 6+)
  const [fighterPool, setFighterPool]         = useState([])

  // ── Difficulty ─────────────────────────────────────────────────────────────
  // `difficulty` is the card's current choice; `runDifficulty` is what the run
  // in progress was started on and is what the render tree reads (changing the
  // card mid-run must not repoint a live run's board). `runTuningRef` is the
  // same thing for the game loop and the round scheduler, which run outside
  // render and cannot read state.
  //
  // `?difficulty=hard` overrides the remembered choice for this arrival only —
  // the Aptitude Report links here that way, since it scores the Hard board.
  const [difficulty, setDifficulty]       = useState(() => initialDifficulty(readStoredDptDifficulty))
  const [runDifficulty, setRunDifficulty] = useState(difficulty)
  const runTuningRef                      = useRef(dptTuning(difficulty))
  const runTuning                         = dptTuning(runDifficulty)
  const handleDifficulty = useCallback((key) => {
    setDifficulty(key)
    storeDptDifficulty(key)
  }, [])

  // Phase state machine: select → playing → finished. (`over` reserved for
  // mid-round death/abandon overlays once the game loop lands in Chunk 5.)
  // 'practice' is the drills, reached from the select card and always
  // returning to it: starting a scored run stays a deliberate pick.
  const [phase, setPhase] = useState('select')
  const { enterImmersive, exitImmersive } = useGameChrome()
  useEffect(() => {
    // Practice hides the nav chrome like a run does — it lays the arena and
    // numpad out exactly where a run will put them.
    if (phase === 'playing' || phase === 'over' || phase === 'intro' || phase === 'practice') enterImmersive()
    else exitImmersive()
    return exitImmersive
  }, [phase, enterImmersive, exitImmersive])

  // While playing, opt the AppShell content area out of its max-w-3xl cap so
  // the side-by-side arena+controls layout can use the full main width
  // (which is already offset for the sidebar via md:ml-56 on app-shell-main).
  // 'intro' is included so the arena mounts behind the curtain at the same
  // width it'll have once the curtain lifts — avoids a layout shift on reveal.
  useGameBodyClass('cbat-dpt-fullwidth', phase === 'playing' || phase === 'intro' || phase === 'practice')

  // ── Practice ───────────────────────────────────────────────────────────────
  // Fire-and-forget usage tracking (admin Reports per-drill drop-off). Online-
  // only by design — a learning aid, not a score, so no offline outbox.
  const reportPracticeProgress = useCallback((body) => {
    if (!user) return
    apiFetch(`${API}/api/games/cbat/dpt/tutorial`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {})
  }, [user, apiFetch, API])
  const openPractice  = useCallback(() => setPhase('practice'), [])
  const closePractice = useCallback(() => setPhase('select'), [])

  // Game state — wired up properly in Chunks 4–9
  const [round, setRound]                                 = useState(1)
  const [totalScore, setTotalScore]                       = useState(0)
  const [gatesHit, setGatesHit]                           = useState(0)
  const [interceptions, setInterceptions]                 = useState(0)
  const [dangerZoneViolations, setDangerZoneViolations]   = useState(0)
  const [separationViolations, setSeparationViolations]   = useState(0)
  const [elapsed, setElapsed]                             = useState(0)

  const [scoreSaved, setScoreSaved]     = useState(false)
  const [queued, setQueued]             = useState(false)
  // Admin cheats — round-skip (111/222/.../888) and aircraft-size (9XX).
  // Either one flips cheatUsed for the rest of the run, suppressing score
  // tracking and leaderboard submission.
  const [cheatUsed, setCheatUsed]       = useState(false)
  const cheatUsedRef                    = useRef(false)
  useEffect(() => { cheatUsedRef.current = cheatUsed }, [cheatUsed])
  // Tracks the previous phase so the round-1 spawn effect can distinguish
  // "first entry into intro/playing" (spawn aircraft) from the "intro→playing"
  // transition (aircraft already spawned, just start the round timer).
  const prevPhaseRef = useRef('select')
  // Skip the intro overlay on Play Again within the same aircraft selection.
  // Reset by handleMenu (back to aircraft select).
  const introPlayedRef = useRef(false)
  // Aircraft GLB scale multiplier — 1.0 means default size; admin can set
  // anywhere 0.50..1.49 via a 9XX numpad code (50 + last two digits as %).
  const [aircraftSizeMultiplier, setAircraftSizeMultiplier] = useState(1.0)
  // Bearing-command visualisations keyed by aircraft id. Each entry holds
  // the snapshot taken at commit time so the line + arc remain anchored to
  // the position the aircraft was at when the command was given (rather
  // than chasing the moving aircraft for the 1.6s lifetime).
  const [commandViz, setCommandViz] = useState({})
  // Pulse counters — incremented whenever the user makes a selection so the
  // relevant elements remount with the dpt-select-pulse class and replay
  // the keyframe. Initial values of 0 mean "no pulse yet"; ArenaChrome /
  // AircraftSprite skip the class until these go > 0.
  const [altPulseKey, setAltPulseKey] = useState(0)
  const [brgPulseKey, setBrgPulseKey] = useState(0)

  // ── Active simulation state ────────────────────────────────────────────────
  // List of aircraft currently in the arena. Chunks 7 & 8 will append CA-N,
  // Fighter, and enemies — Chunk 5 only spawns CA-A.
  const [aircraftList, setAircraftList] = useState([])
  // Which aircraft the numpad currently commands.
  const [activeId, setActiveId]         = useState('CA-A')
  // 0–3 digits typed so far (e.g. "01" displayed as "01_")
  const [bearingInput, setBearingInput] = useState('')
  // Mirror of bearingInput for synchronous reads from the keydown handler.
  // Rapid keypresses fire faster than React can commit + re-render, so the
  // handler can't rely on the state value or a functional updater (which
  // must be pure — calling commitInput from inside one drops presses).
  const bearingInputRef = useRef('')
  // Direction the next bearing input will turn the active aircraft.
  const [turnDir, setTurnDir]           = useState('R')
  // Whether the next 3-digit commit sets a heading (BRG) or altitude (ALT).
  const [inputMode, setInputMode]       = useState('BRG')

  // ── Round / gate state ─────────────────────────────────────────────────────
  // Gates active for the current round. Each gate has { id, index, kind,
  // p1, p2, hit }. Chunk 6 only spawns lettered gates; Chunk 7 will append
  // numbered ones once CA-N joins in round 4.
  const [gateList, setGateList]                 = useState([])
  const [nextLetterIndex, setNextLetterIndex]   = useState(0)
  const [nextNumberIndex, setNextNumberIndex]   = useState(0)
  const [dangerZoneList, setDangerZoneList]     = useState([])
  const [roundEndTime, setRoundEndTime]         = useState(0)
  // When set, we're showing the post-round overlay; movement / hit detection
  // pauses while this is non-null.
  const [roundOverlay, setRoundOverlay]         = useState(null)  // { round, success } | null

  const startTimeRef        = useRef(0)
  const aircraftRef         = useRef([])
  const gatesRef            = useRef([])
  const nextLetterRef       = useRef(0)
  const nextNumberRef       = useRef(0)
  const dangerZonesRef      = useRef([])
  const roundEndTimeRef     = useRef(0)
  const roundOverlayRef     = useRef(null)
  const roundRef            = useRef(1)
  // (a.id|zone.id) keys currently inside a danger zone — used to fire the
  // violation counter once per entry while applying the per-sec score
  // penalty every frame the player aircraft sits in the unsafe band.
  const dzActiveRef         = useRef(new Set())
  // (CA-A|enemy id) and (CA-N|enemy id) pairs currently inside the white
  // ring. Used to fire the "bad intercept" penalty once per entry rather
  // than every frame the player's transport sits in the enemy's hitbox.
  const enemyContactRef     = useRef(new Set())
  // Two player aircraft inside each other's interception range (closer + at
  // similar altitude than the separation-rule threshold). One-shot penalty
  // per pair entry — separation rule still applies continuously alongside.
  const playerInterceptRef  = useRef(new Set())
  // Continuous penalties (separation + danger zone) accrue fractional points
  // per frame (e.g. -15 × 0.016s = -0.24/frame). Keeping totalScore as an
  // integer requires bucketing those into whole-point deductions, so we hold
  // the running fraction here and only deduct integer amounts from state.
  const fractionalPenaltyRef = useRef(0)
  // startRound() is called from effects that must NOT re-run when the aircraft
  // roster or the fighter pool finish loading — a pool that arrives mid-game
  // would otherwise respawn the round under the player. It therefore reads both
  // through refs and carries no dependencies of its own.
  const selectedRef    = useRef(null)
  const fighterPoolRef = useRef([])
  useEffect(() => { selectedRef.current    = selected },    [selected])
  useEffect(() => { fighterPoolRef.current = fighterPool }, [fighterPool])
  useEffect(() => { aircraftRef.current     = aircraftList },     [aircraftList])
  useEffect(() => { gatesRef.current        = gateList },         [gateList])
  useEffect(() => { nextLetterRef.current   = nextLetterIndex },  [nextLetterIndex])
  useEffect(() => { nextNumberRef.current   = nextNumberIndex },  [nextNumberIndex])
  useEffect(() => { dangerZonesRef.current  = dangerZoneList },   [dangerZoneList])
  useEffect(() => { roundEndTimeRef.current = roundEndTime },     [roundEndTime])
  useEffect(() => { roundOverlayRef.current = roundOverlay },     [roundOverlay])
  useEffect(() => { roundRef.current        = round },            [round])

  // Fetch aircraft on mount (filter to 3D-enabled only)
  useEffect(() => {
    if (!user) return
    getAircraftRoster('aircraft-cutouts', { apiFetch, API })
      .then(d => {
        const all = d.data || []
        setAircraft(all.filter(a => has3DModel(a.briefId, a.title)))
      })
      .catch(() => {})
      .finally(() => setLoadingAircraft(false))
  }, [user])

  // Fetch the fighter pool used for the player's Fighter and for enemy aircraft.
  // The backend can't reliably check for GLB presence (its filesystem view of
  // public/models/ depends on deployment layout — Railway ships only backend/),
  // so we filter to 3D-modelled briefs here via the Vite virtual module.
  useEffect(() => {
    if (!user) return
    getAircraftRoster('fighter-aircraft', { apiFetch, API })
      .then(d => setFighterPool((d.data || []).filter(a => has3DModel(a.briefId, a.title))))
      .catch(() => {})
  }, [user])

  // Keyed off the card's difficulty rather than the run's: the two boards have
  // different ceilings (1,700 and 5,200), so showing one difficulty's best
  // beside the other's Start button would be meaningless. The cache holds the
  // panel's height across a flip instead of blanking it.
  const { best: personalBest, refresh: refreshBest, loading: bestLoading } =
    useCbatPersonalBest(dptGameKey(difficulty), { user, apiFetch, API })

  // Pre-warm the GLB cache as soon as the selectable aircraft and fighter
  // pool are known. Without this the first aircraft's .glb isn't fetched
  // until the playing screen mounts, leaving CA-A invisible on round 1
  // until the model finishes downloading. By round 2 the model is cached
  // and renders instantly — that's the symptom the user reported.
  useEffect(() => {
    for (const a of aircraft) useGLTF.preload(getModelUrl(a.briefId, a.title))
  }, [aircraft])
  useEffect(() => {
    for (const f of fighterPool) useGLTF.preload(getModelUrl(f.briefId, f.title))
  }, [fighterPool])

  // ── Round lifecycle ────────────────────────────────────────────────────────
  // Per spec:
  //  - Rounds 1–2: CA-A only, 2 lettered gates
  //  - Round 3:    CA-A only, 3 lettered gates
  //  - Round 4:    + CA-N joins, 2 numbered gates (lettered: 3)
  //  - Round 5:    CA-A + CA-N, 3 numbered gates, danger zones begin
  //  - Round 6:    + Fighter joins, + enemies appear, more danger zones
  //  - Rounds 7–8: more enemies, harder spawns
  const playerModel = () => {
    const sel = selectedRef.current
    return sel ? getModelUrl(sel.briefId, sel.title) : null
  }
  const pickFighterModel = () => {
    const pool = fighterPoolRef.current
    if (pool.length === 0) return null
    const fp = pool[Math.floor(Math.random() * pool.length)]
    return getModelUrl(fp.briefId, fp.title)
  }

  // Builds and starts one rung of the ladder. `roundNum` is always the LADDER
  // number (1-8), not the round's position in the run: a Hard run walks 5, 6,
  // 7, 8 and shows them as 1/4 to 4/4. Everything a round is made of — how many
  // aircraft, how many gates, how many enemies, how long it lasts, and the
  // 50 × roundNum completion bonus — keys off this number and is unchanged by
  // the split.
  //
  // `holdTimer` leaves the round clock at 0 for the logo intro, which spawns
  // the round behind the curtain and only starts it once the curtain lifts.
  const startRound = useCallback((roundNum, { holdTimer = false } = {}) => {
    // Deliberately shadows the state variable of the same name: this callback
    // has no dependencies, so the outer one would be the value from the render
    // that created it. Shadowing means anything added here reads the live one.
    const selected = selectedRef.current
    if (!selected) return

    // Player-controlled aircraft. Each subsequent spawn sees the already-
    // spawned list so it can pick a free corner and a 3000ft-separated
    // altitude rather than landing on top of an earlier aircraft.
    const ac = []
    ac.push(spawnPlayerAircraft('CA-A', 'CA-A', playerModel(), ac))
    if (roundNum >= 4) ac.push(spawnPlayerAircraft('CA-N', 'CA-N', playerModel(), ac))
    if (roundNum >= 6) {
      const fm = pickFighterModel()
      if (fm) ac.push(spawnPlayerAircraft('Fighter', 'Fighter', fm, ac))
    }

    // Enemy aircraft (round 6 → 1, round 7 → 2, round 8 → 3) all spawn
    // together in V formation at the corner no player aircraft is using.
    if (roundNum >= 6) {
      const enemyCount = Math.max(1, roundNum - 5)
      const modelUrls = []
      for (let i = 0; i < enemyCount; i++) {
        const em = pickFighterModel()
        if (em) modelUrls.push(em)
      }
      if (modelUrls.length > 0) {
        const players = ac.filter(a => a.kind !== 'Enemy')
        ac.push(...spawnEnemySquadron(modelUrls, players))
      }
    }

    // Lettered gates (always present)
    const letterCount = roundNum < 3 ? 2 : 3
    let gates = generateGates(letterCount, 'letter')
    // Numbered gates (round 4+)
    if (roundNum >= 4) {
      const numberCount = roundNum === 4 ? 2 : 3
      const existingCenters = gates.map(g => ({ x: (g.p1.x + g.p2.x) / 2, y: (g.p1.y + g.p2.y) / 2 }))
      gates = [...gates, ...generateGates(numberCount, 'number', existingCenters)]
    }

    // Danger zones (round 5+)
    let zones = []
    if (roundNum >= 5) {
      const dzCount = Math.min(3, roundNum - 4)  // round 5 → 1, round 6 → 2, round 7+ → 3
      zones = generateDangerZones(dzCount, gates)
    }

    setAircraftList(ac)
    setGateList(gates)
    setDangerZoneList(zones)
    setNextLetterIndex(0)
    setNextNumberIndex(0)
    setRoundEndTime(holdTimer ? 0 : Date.now() + roundDurationMs(roundNum))
    setRoundOverlay(null)
    setBearingInput('')
    setActiveId('CA-A')
    setTurnDir('R')
    setInputMode('BRG')
    setRound(roundNum)
    dzActiveRef.current = new Set()
    enemyContactRef.current = new Set()
    playerInterceptRef.current = new Set()
    fractionalPenaltyRef.current = 0
  }, [])

  // ?round=N — the same jump as the typed 555 codes, without needing a
  // keyboard or a game that will accept digits. See adminRoundParam.js.
  // Addresses LADDER rounds 1-8, not the four in the current difficulty's run,
  // so ?round=6 works from either card. The run then plays on to its own last
  // round and stops. Debug runs are flagged and never submitted either way.
  useAdminRoundParam({
    totalRounds: TOTAL_ROUNDS,
    ready: phase === 'playing',
    onJump: (roundNum) => {
      setCheatUsed(true)
      cheatUsedRef.current = true
      startRound(roundNum)
    },
  })

  // Entering intro/playing phase → kick off the difficulty's FIRST round
  // (1 on Easier, 5 on Hard). startRound carries no dependencies — it reads the
  // selected aircraft and the fighter pool through refs — so a pool that loads
  // after the user is already in 'playing' can't respawn the round mid-game.
  //
  // Intro choreography: aircraft spawn at intro entry (so GLBs and positions
  // are warm by the time the curtain lifts), but the round timer is HELD at 0
  // and only starts on the intro→playing transition. The movement loop also
  // skips during intro (`phase !== 'playing'`), so aircraft sit at their spawn
  // poses behind the curtain.
  useEffect(() => {
    const prevPhase = prevPhaseRef.current
    prevPhaseRef.current = phase

    if (phase !== 'playing' && phase !== 'intro') {
      setAircraftList([])
      setGateList([])
      setDangerZoneList([])
      setNextLetterIndex(0)
      setNextNumberIndex(0)
      setRoundEndTime(0)
      setRoundOverlay(null)
      setBearingInput('')
      setActiveId('CA-A')
      setTurnDir('R')
      setInputMode('BRG')
      setCommandViz({})
      return
    }
    if (!selected) return

    // Intro→playing: aircraft already spawned during intro; just start the
    // round timer now that the curtain has lifted. The duration is the first
    // round's own, which differs by difficulty (105s on Easier, 120s on Hard).
    if (prevPhase === 'intro' && phase === 'playing') {
      setRoundEndTime(Date.now() + roundDurationMs(roundRef.current))
      return
    }

    // First entry (select→intro, or select→playing on a replay that skips the
    // intro): spawn the difficulty's opening round. Held at 0 on the clock
    // during the intro — the prevPhase==='intro' branch above starts it once
    // the curtain lifts.
    startRound(firstRound(runTuningRef.current), { holdTimer: phase !== 'playing' })
  }, [phase, selected, startRound])

  // Intro → playing transition is fired by SkywatchLogoIntro's onComplete
  // callback below. Cleanup if the user backs out mid-intro is handled by
  // the component itself (it clears its setTimeout on unmount, and we
  // unmount it by flipping phase off 'intro' from handleMenu).
  const handleIntroComplete = useCallback(() => {
    introPlayedRef.current = true
    setPhase('playing')
  }, [])

  // Round-complete overlay → advance to the next rung (or finish after the
  // difficulty's last one: round 4 on Easier, round 8 on Hard).
  // submitScore is defined later in the file but the timeout closure resolves
  // it after render commits, so it's in scope when this fires.
  useEffect(() => {
    if (!roundOverlay) return
    const timer = setTimeout(() => {
      const tuning = runTuningRef.current
      const next   = roundOverlay.round + 1
      // Walking the ladder by +1 rather than by index into tuning.rounds keeps
      // an admin round-jump sane: a debug run that lands outside the
      // difficulty's own slice still plays on to that slice's end and stops.
      if (roundOverlay.round >= lastRound(tuning)) {
        const totalTime = (Date.now() - startTimeRef.current) / 1000
        setElapsed(totalTime)
        // Cheat-flagged runs do not write to the leaderboard.
        if (selected && !cheatUsedRef.current) {
          submitScore(totalScore, totalTime, selected.title, roundOverlay.round, {
            gatesHit, interceptions, dangerZoneViolations, separationViolations,
          })
        }
        setRoundOverlay(null)
        setPhase('finished')
        return
      }
      startRound(next)
    }, ROUND_OVERLAY_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundOverlay])

  // ── Movement loop + hit detection ──────────────────────────────────────────
  // Runs while phase==='playing' and no round-complete overlay is showing.
  // Reads previous state via refs, computes the next aircraft positions,
  // checks gate hits along each aircraft's previous→new movement segment,
  // applies score/gate updates, and detects round-end conditions.
  useEffect(() => {
    if (phase !== 'playing') return
    let raf
    let last = performance.now()
    let accum = 0
    // Run the simulation step + React state updates at ~30fps even though
    // the browser fires rAF at 60fps. Halves React's reconciliation work,
    // which on lower-end mobile was the main source of judder. Aircraft
    // physics still feel continuous because dt for each step is the real
    // accumulated delta, not a fixed 1/60 slice.
    const STEP_INTERVAL = 1 / 30

    function step(now) {
      raf = requestAnimationFrame(step)

      const realDt = (now - last) / 1000
      last = now
      accum += realDt
      if (accum < STEP_INTERVAL) return

      const dt = Math.min(0.05, accum)
      accum = 0

      // Pause game logic while showing the round-complete overlay
      if (roundOverlayRef.current) return

      const prevAircraft = aircraftRef.current
      // Guard: when phase first transitions to 'playing', this loop and the
      // round-1 spawn effect both start in the same render. The first step()
      // can fire before the aircraftRef sync has caught up to the spawn's
      // setAircraftList — reading prevAircraft as [] then. Without this skip,
      // setAircraftList([]) at the bottom of step() would clobber the spawn.
      if (prevAircraft.length === 0) return

      const prevGates    = gatesRef.current
      const zones        = dangerZonesRef.current
      let   nextLetIdx   = nextLetterRef.current
      let   nextNumIdx   = nextNumberRef.current
      let   scoreDelta        = 0   // integer (gates + intercepts)
      let   penaltyAccrued    = 0   // float (separation + danger zone, per-sec × dt)
      let   gatesDelta   = 0
      let   interceptDelta = 0
      // Defer the gate-array clone until we actually need to mutate one.
      // Gates change only when hit, so we save N×prevGates allocations every
      // frame in the common no-hit case — that drove visible GC stutter.
      let   gates          = prevGates
      let   gatesMutable   = false
      const ensureGatesMutable = () => {
        if (!gatesMutable) {
          gates = prevGates.map(g => ({ ...g }))
          gatesMutable = true
        }
      }
      const nowMs        = Date.now()

      const edgeAutoVizSnapshots = []  // collected during the map, applied after

      const newAircraft = prevAircraft.map(a => {
        let { headingDeg, targetHeadingDeg, turnDirection, position, altitudeFt, targetAltitudeFt, aiNextDecision, altNextChange } = a

        // 0. Enemy AI — pick a new bearing every few seconds. 60% random, 25%
        //    aim at a player aircraft, 15% aim at a gate. Erratic by design.
        if (a.kind === 'Enemy') {
          // Altitude shift: 20–30s after the last change, pick a new ±1000ft
          // target. The existing altitude-interpolation step (#3 below)
          // handles the smooth transition.
          if (altNextChange && nowMs > altNextChange) {
            targetAltitudeFt = pickEnemyAltStep(altitudeFt)
            altNextChange    = nowMs + pickEnemyNextAltChange()
          }
          if (aiNextDecision === 0 || nowMs > aiNextDecision) {
            const r = Math.random()
            let newBearing
            if (r < 0.15 && prevGates.length > 0) {
              const g = prevGates[Math.floor(Math.random() * prevGates.length)]
              const cx = (g.p1.x + g.p2.x) / 2
              const cy = (g.p1.y + g.p2.y) / 2
              newBearing = normalizeDeg((Math.atan2(cx - position.x, -(cy - position.y)) * 180) / Math.PI)
            } else if (r < 0.40) {
              const players = prevAircraft.filter(p => p.kind !== 'Enemy')
              if (players.length > 0) {
                const p = players[Math.floor(Math.random() * players.length)]
                newBearing = normalizeDeg((Math.atan2(p.position.x - position.x, -(p.position.y - position.y)) * 180) / Math.PI)
              } else {
                newBearing = Math.floor(Math.random() * 360)
              }
            } else {
              newBearing = Math.floor(Math.random() * 360)
            }
            targetHeadingDeg = newBearing
            turnDirection    = normalizeDeg(newBearing - headingDeg) <= 180 ? 'R' : 'L'
            aiNextDecision   = nowMs + (ENEMY_AI_INTERVAL_MIN + Math.random() * (ENEMY_AI_INTERVAL_MAX - ENEMY_AI_INTERVAL_MIN)) * 1000
          }
        }

        // 1–4. Edge auto-turn, rotate toward the target heading, altitude
        //      interpolation, advance forward — the shared flight model in
        //      utils/cbat/dptPhysics.js. `edgeAuto` is set on the frame the
        //      boundary took the heading over.
        const { aircraft: moved, edgeAuto } = moveAircraft(
          { ...a, headingDeg, targetHeadingDeg, turnDirection, altitudeFt, targetAltitudeFt, aiNextDecision, altNextChange },
          dt,
        )
        // Player aircraft get a yellow degree-calc line + arc so the
        // player sees the auto-redirect direction. Enemies skip the viz.
        if (edgeAuto && (a.kind === 'CA-A' || a.kind === 'CA-N' || a.kind === 'Fighter')) {
          edgeAutoVizSnapshots.push({ id: a.id, snapshot: { ...edgeAuto, kind: 'edgeAuto' } })
        }
        const next = moved.position

        // 5. Gate hit detection — CA-A → letter, CA-N → number, in order only.
        // Iterate by index so we can mutate the cloned array after lazily
        // upgrading from prevGates → cloned gates on first hit.
        for (let gi = 0; gi < gates.length; gi++) {
          const g = gates[gi]
          if (g.hit) continue
          if (a.kind === 'CA-A' && g.kind === 'letter' && g.index === nextLetIdx) {
            if (segmentsIntersect(position, next, g.p1, g.p2)) {
              ensureGatesMutable()
              gates[gi].hit = true
              nextLetIdx += 1; scoreDelta += POINTS_PER_GATE; gatesDelta += 1
            }
          }
          if (a.kind === 'CA-N' && g.kind === 'number' && g.index === nextNumIdx) {
            if (segmentsIntersect(position, next, g.p1, g.p2)) {
              ensureGatesMutable()
              gates[gi].hit = true
              nextNumIdx += 1; scoreDelta += POINTS_PER_GATE; gatesDelta += 1
            }
          }
        }

        return moved
      })

      // 6. Interception — Fighter intersecting an enemy's white ring at
      //    altitude diff < 1000ft (stricter than the 3000ft used for bad
      //    intercepts) destroys the enemy. Multiple intercepts per frame
      //    allowed.
      const fighter = newAircraft.find(a => a.kind === 'Fighter')
      const destroyed = new Set()
      if (fighter) {
        for (const e of newAircraft) {
          if (e.kind !== 'Enemy') continue
          const d = Math.hypot(fighter.position.x - e.position.x, fighter.position.y - e.position.y)
          const altDiff = Math.abs(fighter.altitudeFt - e.altitudeFt)
          if (d < WHITE_RING_R && altDiff < FIGHTER_INTERCEPT_ALT_DIFF) {
            destroyed.add(e.id)
            scoreDelta     += POINTS_PER_INTERCEPT
            interceptDelta += 1
          }
        }
      }
      const survivingAircraft = destroyed.size > 0 ? newAircraft.filter(a => !destroyed.has(a.id)) : newAircraft

      // 6b. Bad intercept — CA-A / CA-N straying into an enemy's white ring
      //     at compatible altitude (transports aren't combat aircraft, so
      //     contact = penalty, not a kill). One-shot penalty per entry: fire
      //     when the pair WASN'T contacting last frame, suppress otherwise.
      const newEnemyContacts = new Set()
      const transports = survivingAircraft.filter(a => a.kind === 'CA-A' || a.kind === 'CA-N')
      for (const e of survivingAircraft) {
        if (e.kind !== 'Enemy') continue
        for (const p of transports) {
          const d = Math.hypot(p.position.x - e.position.x, p.position.y - e.position.y)
          const altDiff = Math.abs(p.altitudeFt - e.altitudeFt)
          if (d < WHITE_RING_R && altDiff < INTERCEPT_ALT_DIFF) {
            const key = `${p.id}|${e.id}`
            newEnemyContacts.add(key)
            if (!enemyContactRef.current.has(key)) scoreDelta -= POINTS_PENALTY_BAD_HIT
          }
        }
      }
      enemyContactRef.current = newEnemyContacts

      // 7. Player-on-player interception — any two player aircraft inside
      //    each other's blue ring AND within INTERCEPT_ALT_DIFF (3000ft)
      //    altitude. One-shot penalty per pair entry; we bump the
      //    separationViolations counter so the stat reflects total close
      //    contacts. (No continuous penalty any more — the unified intercept
      //    rule subsumes it.)
      const players = survivingAircraft.filter(a => a.kind === 'CA-A' || a.kind === 'CA-N' || a.kind === 'Fighter')
      const newPlayerIntercepts = new Set()
      for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
          const A = players[i], B = players[j]
          const d = Math.hypot(A.position.x - B.position.x, A.position.y - B.position.y)
          const altDiff = Math.abs(A.altitudeFt - B.altitudeFt)
          if (d < BLUE_RING_R && altDiff < INTERCEPT_ALT_DIFF) {
            const key = [A.id, B.id].sort().join('|')
            newPlayerIntercepts.add(key)
            if (!playerInterceptRef.current.has(key)) {
              scoreDelta -= POINTS_PENALTY_BAD_HIT
              setSeparationViolations(v => v + 1)
            }
          }
        }
      }
      playerInterceptRef.current = newPlayerIntercepts

      // 8. Danger zones — penalise player aircraft inside a zone horizontally
      //    AND within DZ_SEP_REQUIRED (1,000ft) of the zone's altitude (above
      //    OR below). Aircraft must stay ≥1,000ft clear of the zone alt to be
      //    safe. New entries bump the counter.
      const newDzActive = new Set()
      for (const z of zones) {
        const zoneAlt = z.band === '2k' ? DZ_ALT_2K : DZ_ALT_3K
        for (const a of players) {
          const d = Math.hypot(a.position.x - z.position.x, a.position.y - z.position.y)
          const altGap = Math.abs(a.altitudeFt - zoneAlt)
          if (d < z.radius && altGap < DZ_SEP_REQUIRED) {
            const key = `${a.id}|${z.id}`
            newDzActive.add(key)
            penaltyAccrued += DZ_PENALTY_PER_S * dt
            if (!dzActiveRef.current.has(key)) setDangerZoneViolations(v => v + 1)
          }
        }
      }
      dzActiveRef.current = newDzActive

      // ── Apply state updates ──
      // Accumulate fractional penalty into the running ref; only deduct whole
      // points from totalScore so the displayed score stays an integer.
      fractionalPenaltyRef.current += penaltyAccrued
      const wholePenalty = Math.floor(fractionalPenaltyRef.current)
      if (wholePenalty > 0) {
        fractionalPenaltyRef.current -= wholePenalty
        scoreDelta -= wholePenalty
      }

      setAircraftList(survivingAircraft)
      if (gatesDelta > 0) {
        if (gatesMutable) setGateList(gates)
        setNextLetterIndex(nextLetIdx)
        setNextNumberIndex(nextNumIdx)
        setGatesHit(g => g + gatesDelta)
      }
      if (interceptDelta > 0) setInterceptions(i => i + interceptDelta)
      // Score is always calculated, even in debug mode — only the final
      // leaderboard submission is suppressed when cheatUsed is set.
      if (scoreDelta !== 0) setTotalScore(s => s + scoreDelta)

      // Apply edge auto-turn visualisations collected this frame. Each
      // entry overrides any existing CommandViz for that aircraft (so a
      // subsequent user-issued bearing — same key, different snapshot —
      // visually replaces the yellow auto line with the blue user line).
      if (edgeAutoVizSnapshots.length > 0) {
        setCommandViz(prev => {
          const next = { ...prev }
          for (const { id, snapshot } of edgeAutoVizSnapshots) next[id] = snapshot
          return next
        })
        for (const { id, snapshot } of edgeAutoVizSnapshots) {
          setTimeout(() => {
            setCommandViz(prev => {
              if (prev[id] !== snapshot) return prev
              const n = { ...prev }
              delete n[id]
              return n
            })
          }, COMMAND_VIZ_DURATION_MS + 100)
        }
      }

      // 9. Round end — all gates hit OR timer expired. Award completion bonus
      //    when all gates were hit before time ran out.
      const allHit = gates.length > 0 && gates.every(g => g.hit)
      const timeUp = roundEndTimeRef.current > 0 && nowMs >= roundEndTimeRef.current
      if ((allHit || timeUp) && gates.length > 0) {
        if (allHit) setTotalScore(s => s + ROUND_BONUS_PER_ROUND * roundRef.current)
        setRoundOverlay({ round: roundRef.current, success: allHit })
      }
    }

    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [phase])

  // ── Elapsed timer ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'playing') return
    const t0 = startTimeRef.current
    const id = setInterval(() => setElapsed((Date.now() - t0) / 1000), 100)
    return () => clearInterval(id)
  }, [phase])

  // ── Command handlers (numpad + L/R + active aircraft switch) ───────────────
  // Commit 3-digit input as either bearing or altitude depending on inputMode.
  const commitInput = useCallback((digits) => {
    const value = parseInt(digits, 10)
    // Admin-only round-skip cheat: types 111 → round 1, 222 → 2, …, 888 → 8.
    // Flips cheatUsed permanently for the rest of the run so the final score
    // is excluded from the leaderboard. Intercepted before the bearing /
    // altitude logic so the digits aren't also applied as a heading.
    if (user?.isAdmin && ADMIN_ROUND_CHEATS[value] != null) {
      const targetRound = ADMIN_ROUND_CHEATS[value]
      setCheatUsed(true)
      cheatUsedRef.current = true
      startRound(targetRound)
      return
    }
    // Admin-only aircraft-size cheat: 9XX → size = 50 + XX percent.
    //   900 →  50%   |   910 →  60%   |   950 → 100%   |   980 → 130%
    // Also flips cheatUsed so the run is excluded from the leaderboard.
    if (user?.isAdmin && value >= 900 && value <= 999) {
      const lastTwo   = value - 900
      const multiplier = (50 + lastTwo) / 100
      setAircraftSizeMultiplier(multiplier)
      setCheatUsed(true)
      cheatUsedRef.current = true
      return
    }
    if (inputMode === 'ALT') {
      // ALT input is in 100s of ft (035 = 3500ft). Clamp to the operational
      // band — outside-range inputs snap to the nearest legal altitude.
      const ft = Math.max(ALT_MIN, Math.min(ALT_MAX, value * 100))
      setAircraftList(prev => prev.map(a =>
        a.id === activeId ? { ...a, targetAltitudeFt: ft } : a
      ))
    } else {
      // BRG input is a compass bearing modulo 360.
      const bearing = normalizeDeg(value)
      // Snapshot the aircraft's position + heading AT COMMIT TIME so the
      // visualisation stays anchored where the command was given.
      const target = aircraftRef.current.find(a => a.id === activeId)
      if (target) {
        const snapshot = {
          fromHeading:   target.headingDeg,
          targetBearing: bearing,
          direction:     turnDir,
          capturedPos:   { x: target.position.x, y: target.position.y },
          kind:          'user',
        }
        setCommandViz(prev => ({ ...prev, [activeId]: snapshot }))
        setTimeout(() => {
          setCommandViz(prev => {
            // Only remove if the entry is still the same snapshot (the user
            // may have issued another command for this aircraft in between).
            if (prev[activeId] !== snapshot) return prev
            const next = { ...prev }
            delete next[activeId]
            return next
          })
        }, COMMAND_VIZ_DURATION_MS + 100)
      }
      setAircraftList(prev => prev.map(a =>
        a.id === activeId ? { ...a, targetHeadingDeg: bearing, turnDirection: turnDir } : a
      ))
    }
  }, [inputMode, activeId, turnDir, user, startRound])

  // Keep the ref in sync with state for code paths that reset bearingInput
  // outside handleDigit (mode switches, round starts, etc.).
  useEffect(() => { bearingInputRef.current = bearingInput }, [bearingInput])

  // Stable handler so memo(DptControls) doesn't re-render on every parent
  // tick from a fresh inline lambda.
  const handleInputModeChange = useCallback((m) => {
    setInputMode(m)
    setBearingInput('')
    if (m === 'ALT') setAltPulseKey(k => k + 1)
    else if (m === 'BRG') setBrgPulseKey(k => k + 1)
  }, [])

  const handleDigit = useCallback((d) => {
    const prev = bearingInputRef.current
    if (prev.length >= 3) return
    const next = prev + d
    if (next.length === 3) {
      // Clear input first, then commit — keeps the setter pure and prevents
      // rapid follow-up presses from racing the commit.
      bearingInputRef.current = ''
      setBearingInput('')
      commitInput(next)
      return
    }
    bearingInputRef.current = next
    setBearingInput(next)
  }, [commitInput])

  // Keyboard shortcuts
  useEffect(() => {
    if (phase !== 'playing') return
    function onKey(e) {
      if (e.key >= '0' && e.key <= '9') { handleDigit(e.key); e.preventDefault(); return }
      // Arrow keys: ←/→ pick L/R turn direction, ↑/↓ pick BRG/ALT input mode.
      // preventDefault stops the page from scrolling on arrow press during play.
      if (e.key === 'ArrowLeft')  { setTurnDir('L'); e.preventDefault(); return }
      if (e.key === 'ArrowRight') { setTurnDir('R'); e.preventDefault(); return }
      if (e.key === 'ArrowUp')    { setInputMode('BRG'); setBearingInput(''); setBrgPulseKey(k => k + 1); e.preventDefault(); return }
      if (e.key === 'ArrowDown')  { setInputMode('ALT'); setBearingInput(''); setAltPulseKey(k => k + 1); e.preventDefault(); return }
      const k = e.key.toLowerCase()
      if (k === 'l') { setTurnDir('L'); return }
      if (k === 'r') { setTurnDir('R'); return }
      if (k === 'm') {
        setInputMode(m => {
          const next = m === 'BRG' ? 'ALT' : 'BRG'
          if (next === 'ALT') setAltPulseKey(p => p + 1)
          else                setBrgPulseKey(p => p + 1)
          return next
        })
        setBearingInput('')
        return
      }
      if (k === 'a') { setActiveId('CA-A'); return }
      if (k === 'n') {
        if (aircraftRef.current.some(a => a.id === 'CA-N')) setActiveId('CA-N')
        return
      }
      if (k === 'f') {
        if (aircraftRef.current.some(a => a.id === 'Fighter')) setActiveId('Fighter')
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, handleDigit])

  // Submit score at end of run. `finalRound` is the ladder round the run
  // finished on (4 on Easier, 8 on Hard), which is what the pre-split
  // eight-round rows already hold.
  const submitScore = useCallback((finalScore, finalTime, aircraftTitle, finalRound, breakdown) => {
    setScoreSaved(false)
    setQueued(false)
    const tuning  = runTuningRef.current
    const gameKey = tuning.gameKey
    markGameCompleted({ score: finalScore, round: finalRound })
    submitCbatResult(gameKey, {
        totalScore: finalScore,
        totalTime:  finalTime,
        finalRound,
        // Which rung the run STARTED on — 1 on Easier, 5 on Hard. It is also
        // how the backend recognises a submission from a client that predates
        // the split: the old eight-round build finished on round 8 exactly as
        // Hard does, so finalRound cannot tell them apart, but only a post-split
        // build sends this. See backend/routes/games.js submitDptResult.
        firstRound: firstRound(tuning),
        aircraftUsed: aircraftTitle,
        ...breakdown,
      }, { apiFetch, API })
      .then((r) => {
        setScoreSaved(!!r?.synced)
        setQueued(!!r?.queued)
        refreshBest()
      })
      .catch(() => {})
  }, [apiFetch, API])

  // Handlers
  const handleSelect = useCallback((a) => {
    // Picking an aircraft is DPT's Start button, so this is where the run's
    // difficulty is pinned. Changing the card afterwards can't repoint a run
    // that's already flying.
    const tuning = dptTuning(difficulty)
    runTuningRef.current = tuning
    setRunDifficulty(difficulty)
    setSelected(a)
    selectedRef.current = a
    startTracking(tuning.gameKey)
    setRound(firstRound(tuning))
    setTotalScore(0)
    setGatesHit(0)
    setInterceptions(0)
    setDangerZoneViolations(0)
    setSeparationViolations(0)
    setElapsed(0)
    setScoreSaved(false)
    setCheatUsed(false)
    cheatUsedRef.current = false
    setAircraftSizeMultiplier(1.0)
    startTimeRef.current = Date.now()

    // Skip the intro on replay within the same aircraft selection
    // (introPlayedRef set after first run).
    setPhase(introPlayedRef.current ? 'playing' : 'intro')
  }, [apiFetch, API, difficulty, startTracking])

  const handleMenu = useCallback(() => {
    setSelected(null)
    // Back to aircraft select → next pick should replay the intro.
    introPlayedRef.current = false
    setPhase('select')
  }, [])

  const handlePlayAgain = useCallback(() => {
    if (selected) handleSelect(selected)
  }, [selected, handleSelect])

  // The model the practice drills fly. Nobody has picked an aircraft yet on
  // the select card, so it takes the Typhoon if the roster has one and the
  // first 3D aircraft otherwise; null (a triangle only) until the roster loads.
  const practiceModelUrl = (() => {
    const pick = aircraft.find(a => /typhoon/i.test(a.title)) || aircraft[0]
    return pick ? getModelUrl(pick.briefId, pick.title) : null
  })()

  // Set of aircraft ids that have finished their assigned task this round —
  // dimmed to 20% in both SVG and GLB layers. State derives from gate-hit
  // counts and live enemy presence, so it auto-clears when the next round
  // re-spawns gates and enemies.
  const doneIds = (() => {
    const ids = new Set()
    const letterTotal = gateList.reduce((n, g) => g.kind === 'letter' ? n + 1 : n, 0)
    const numberTotal = gateList.reduce((n, g) => g.kind === 'number' ? n + 1 : n, 0)
    if (letterTotal > 0 && nextLetterIndex >= letterTotal) ids.add('CA-A')
    if (numberTotal > 0 && nextNumberIndex >= numberTotal) ids.add('CA-N')
    // Fighter is "done" once enemies were spawned this round (round 6+) and
    // none remain in the air — i.e. the Fighter has cleared the squadron.
    if (round >= 6 && aircraftList.some(a => a.kind === 'Fighter') && !aircraftList.some(a => a.kind === 'Enemy')) {
      ids.add('Fighter')
    }
    return ids
  })()

  return (
    <div className="cbat-page">
      <SEO title="DPT" description="Dynamic Projection Test — vector aircraft and intercept enemy contacts." />

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          {phase === 'select'
            ? <Link to="/cbat" className="text-slate-500 hover:text-brand-400 transition-colors text-sm">&larr; CBAT</Link>
            : <CbatQuitButton onConfirm={phase === 'practice' ? closePractice : handleMenu} confirmNeeded={['intro', 'playing', 'over'].includes(phase)} label={<>&larr; Quit</>} />
          }
          <h1 className="text-sm font-extrabold text-text">DPT</h1>
          {phase === 'practice' && <ModeMarker mode={PRACTICE_MODE_MARKER} />}
          {phase !== 'select' && phase !== 'practice' && <ModeMarker mode={runTuning} />}
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

      {/* Logged in */}
      {user && (
        <div className="flex flex-col items-center">

          {/* Aircraft selection */}
          {phase === 'select' && (
            <div className="w-full max-w-md lg:max-w-2xl bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-5 lg:p-8">
              <AircraftSelect
                aircraft={aircraft}
                onSelect={handleSelect}
                loading={loadingAircraft}
                personalBest={personalBest}
                bestLoading={bestLoading}
                difficulty={difficulty}
                onDifficulty={handleDifficulty}
                onPractice={openPractice}
              />
            </div>
          )}

          {/* Practice — the drills, on the run's own arena and numpad. Always
              exits back to the select card rather than into a run. */}
          {phase === 'practice' && (
            <DptPractice
              modelUrl={practiceModelUrl}
              onExit={closePractice}
              onProgress={reportPracticeProgress}
            />
          )}

          {/* Game arena — mounted during 'intro' too so it sits ready behind
              the curtain. Movement loop and round timer stay paused until the
              phase flips to 'playing' (see effects above). */}
          {(phase === 'playing' || phase === 'intro') && selected && (
            <div className="w-full flex flex-col md:flex-row md:items-start md:justify-center md:gap-4">
            {/* HUD + arena — on md+ sized so arena width fits the available
                content area beside the controls column AND the viewport
                height. Horizontal budget: 100vw − 224px (sidebar) − 24px
                (px-3 padding) − 440px (controls) − 16px (gap) ≈ 100vw − 704px.
                Vertical budget: 100vh − 56 (topbar) − 48 (py-6) − ~30 HUD ≈
                100vh − 134px. */}
            <div
              className="w-full max-w-md md:max-w-none md:w-[min(calc(100vh_-_134px),calc(100vw_-_704px))] md:flex-shrink-0"
            >
              {(() => {
                const roundLeft = Math.max(0, (roundEndTime - Date.now()) / 1000)
                const lowTime   = roundLeft < 10
                return (
                  <div className="flex items-center justify-between text-xs font-mono mb-2 px-1">
                    <span className="text-slate-400">RND <span className="text-brand-600">{displayRound(round, runTuning)}</span>/{runTuning.rounds.length}</span>
                    <span className="text-slate-400">
                      SCORE <span className="text-brand-600">{totalScore}</span>
                      {cheatUsed && <span className="ml-2 text-amber-400">DEBUG · NO SUBMIT</span>}
                    </span>
                    <span className="text-slate-400">⏱ <span className={lowTime ? 'text-red-400' : 'text-brand-600'}>{roundLeft.toFixed(1)}s</span></span>
                  </div>
                )
              })()}
              <div className="relative z-10 bg-[#060e1a] border-2 border-[#1a3a5c] rounded-xl shadow-[0_0_30px_rgba(91,170,255,0.08)] overflow-hidden" style={{ width: '100%', aspectRatio: '1' }}>
                {/* Layer 1: Three.js Canvas with GLB aircraft, top-down ortho */}
                <DptAircraftLayer aircraftList={aircraftList} sizeMultiplier={aircraftSizeMultiplier} doneIds={doneIds} />
                {/* Layer 2: SVG arena chrome + gates + aircraft data blocks */}
                <ArenaScope brgPulseKey={brgPulseKey}>
                  {/* Danger zones rendered first so gates / aircraft draw on top */}
                  {dangerZoneList.map(z => (
                    <DangerZoneMarker key={`dz-${z.id}`} zone={z} />
                  ))}
                  {gateList.map(g => {
                    const isNext =
                      (g.kind === 'letter' && g.index === nextLetterIndex && !g.hit) ||
                      (g.kind === 'number' && g.index === nextNumberIndex && !g.hit)
                    return <GateMarker key={`${g.kind}-${g.id}`} gate={g} isNext={isNext} />
                  })}
                  {/* Bearing-command visualisations — line + arc rendered
                      briefly after a bearing is committed. Keyed by aircraft
                      id so multiple simultaneous commands stack. */}
                  {Object.entries(commandViz).map(([id, viz]) => (
                    <CommandViz key={`viz-${id}-${viz.capturedPos.x}-${viz.capturedPos.y}`} viz={viz} />
                  ))}
                  {/* Edge-warning highlights — yellow pulse on each boundary
                      segment a player aircraft is currently approaching. */}
                  {aircraftList.flatMap(a => {
                    if (a.kind === 'Enemy') return []
                    return nearEdges(a.position).map(edge => (
                      <EdgeWarning key={`edge-${a.id}-${edge}`} edge={edge} x={a.position.x} y={a.position.y} />
                    ))
                  })}
                  {aircraftList.map(a => {
                    const isPlayer = a.kind !== 'Enemy'
                    const edgeWarn = isPlayer && nearEdges(a.position).length > 0
                    const dim      = doneIds.has(a.id)
                    return (
                      <AircraftSprite
                        key={a.id}
                        aircraft={a}
                        active={a.id === activeId}
                        edgeWarn={edgeWarn}
                        dim={dim}
                        altPulseKey={altPulseKey}
                      />
                    )
                  })}
                </ArenaScope>
                {/* Round-complete overlay */}
                <AnimatePresence>
                  {roundOverlay && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 z-30 flex items-center justify-center bg-black/65"
                    >
                      <motion.div
                        initial={{ scale: 0.85 }}
                        animate={{ scale: 1 }}
                        className="text-center px-6 py-5 rounded-xl bg-[#0a1628] border border-[#1a3a5c]"
                      >
                        <p className="text-3xl mb-1">{roundOverlay.success ? '✅' : '⏱'}</p>
                        <p className="text-lg font-extrabold text-white mb-0.5">
                          Round {displayRound(roundOverlay.round, runTuning)} {roundOverlay.success ? 'Complete' : 'Time Up'}
                        </p>
                        <p className="text-xs text-slate-400">
                          {roundOverlay.round < lastRound(runTuning)
                            ? `Next: Round ${displayRound(roundOverlay.round + 1, runTuning)}`
                            : 'Final score…'}
                        </p>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              {/* Aircraft selector — sits flush under the arena panel, sliding
                  up 8px with z-0 so its top is hidden behind the arena's
                  z-10 panel. Emerges-from-underneath visual. */}
              <AircraftButtons
                aircraftList={aircraftList}
                activeId={activeId}
                onSelectActive={setActiveId}
              />
            </div>

            {/* Controls — narrow fixed column on md+, full width on mobile.
                Stays a fixed footprint so the arena to its left can grow into
                whatever viewport space remains. */}
            <div className="w-full max-w-md mt-2 md:mt-0 md:w-[440px] md:flex-shrink-0">
              <DptControls
                turnDir={turnDir}
                onTurnDir={setTurnDir}
                inputMode={inputMode}
                onInputMode={handleInputModeChange}
                bearingInput={bearingInput}
                onDigit={handleDigit}
              />
            </div>
            </div>
          )}

          {/* Final score */}
          <AnimatePresence>
            {phase === 'finished' && selected && (
              <CbatGameOver
                gameKey={runTuning.gameKey}
                score={totalScore}
                time={elapsed}
                scoreSaved={scoreSaved}
                queued={queued}
                personalBest={personalBest}
                onPlayAgain={handlePlayAgain}
              >
                <div className="w-full bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-8 text-center">
                  <p className="text-5xl mb-3">🎖️</p>
                  <p className="text-2xl font-extrabold text-white mb-1">Run Complete</p>
                  <p className="text-sm text-slate-400 mb-6">Reached round {displayRound(round, runTuning)} of {runTuning.rounds.length}.</p>

                  <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-5 mb-6">
                    <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">Final Score</p>
                    <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400">
                      <div className="flex justify-between"><span>Gates hit</span><span className="text-brand-600 font-mono">{gatesHit}</span></div>
                      <div className="flex justify-between"><span>Intercepts</span><span className="text-brand-600 font-mono">{interceptions}</span></div>
                      <div className="flex justify-between"><span>Danger zones</span><span className="text-red-400 font-mono">{dangerZoneViolations}</span></div>
                      <div className="flex justify-between"><span>Separation</span><span className="text-red-400 font-mono">{separationViolations}</span></div>
                    </div>
                  </div>

                  {cheatUsed && <p className="text-xs text-amber-400 mb-4">DEBUG MODE · run not submitted to leaderboard</p>}

                </div>
              </CbatGameOver>
            )}
          </AnimatePresence>

          {/* Logo-boot intro overlay — covers the viewport while the arena
              boots behind it. Choreography + sound + completion timer all
              live in <SkywatchLogoIntro>; we just gate it on phase. */}
          {phase === 'intro' && <SkywatchLogoIntro onComplete={handleIntroComplete} />}

        </div>
      )}
    </div>
  )
}
