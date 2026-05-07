import { useState, useEffect, useCallback, useRef, memo } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { recordCbatStart } from '../utils/cbat/recordStart'
import { useGameChrome } from '../context/GameChromeContext'
import SEO from '../components/SEO'
import SkywatchLogoIntro, { SKYWATCH_LOGO_INTRO_MS } from '../components/SkywatchLogoIntro'
import { has3DModel, getModelUrl } from '../data/aircraftModels'
import DptAircraftLayer from '../components/DptAircraftLayer'
import { useGLTF } from '@react-three/drei'

// ── Constants ────────────────────────────────────────────────────────────────
const TOTAL_ROUNDS = 8

// Arena uses an internal SVG viewBox of 1000×1000. Aircraft, gates and danger
// zones in later chunks position themselves in this coordinate space, then
// scale to whatever pixel size the panel renders at.
const SCOPE_SIZE  = 1000
const SCOPE_HALF  = SCOPE_SIZE / 2          // 500 — centre of the scope
const ARENA_HALF  = 480                     // half-size of playable square
const LABEL_INSET = 22                      // how far labels sit inside the boundary

// Compass bearing → unit vector (SVG y is inverted, so north = (0, -1))
function bearingToVec(bearing) {
  const rad = (bearing * Math.PI) / 180
  return { dx: Math.sin(rad), dy: -Math.cos(rad) }
}

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
const AIRCRAFT_SPEED = 18    // scope units per second (cross-arena ≈ 53s)
const TURN_RATE      = 35    // degrees per second
const AIRCRAFT_ICON  = 40    // visual icon size in scope units (label offset)
const ALT_RATE       = 500   // ft per second climb/descent
const ALT_MIN        = 1000  // ft — lowest commandable altitude
const ALT_MAX        = 10000 // ft — highest commandable altitude
const EDGE_BUFFER    = 90    // scope units inside boundary that triggers auto-turn

function normalizeDeg(d) {
  let x = d % 360
  if (x < 0) x += 360
  return x
}

// Distance the heading must travel to reach `target` going `direction`.
// Result is in [0, 360).
function turnDistance(heading, target, direction) {
  if (direction === 'L') return normalizeDeg(heading - target)
  return normalizeDeg(target - heading)
}

// Compass bearing from (x, y) toward arena centre.
function bearingToCenter(x, y) {
  const dx = SCOPE_HALF - x
  const dy = SCOPE_HALF - y
  return normalizeDeg((Math.atan2(dx, -dy) * 180) / Math.PI)
}

// ── Gates / rounds ──────────────────────────────────────────────────────────
// Rounds 1–3: 90s (1m 30s) — basic CA-A flow.
// Rounds 4–5: 120s (2m)    — CA-N joins; +30s.
// Rounds 6–8: 180s (3m)    — Fighter + enemies; +60s on top of rounds 4–5.
function roundDurationMs(roundNum) {
  if (roundNum >= 6) return 180_000
  if (roundNum >= 4) return 120_000
  return 90_000
}
const ROUND_DURATION_MS = 90_000  // base — used by round-1 inline spawn

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
const DZ_PENALTY_PER_S    = 10     // score loss per sec inside danger zone
const DZ_RADIUS           = 70     // visual radius of danger zone circle
const DZ_ALT_2K           = 2000   // ft — white-ring zone is centred at 2,000ft
const DZ_ALT_3K           = 3000   // ft — black-ring zone is centred at 3,000ft
const DZ_SEP_REQUIRED     = 1000   // ft — aircraft must stay this far above/below the zone alt

// ── Round completion bonus ───────────────────────────────────────────────────
const ROUND_BONUS_PER_ROUND = 50   // × roundNum awarded when all gates hit

// Segment-segment intersection test using cross-product orientation.
function cross(ax, ay, bx, by) { return ax * by - ay * bx }
function segmentsIntersect(p1, p2, q1, q2) {
  const d1 = cross(q2.x - q1.x, q2.y - q1.y, p1.x - q1.x, p1.y - q1.y)
  const d2 = cross(q2.x - q1.x, q2.y - q1.y, p2.x - q1.x, p2.y - q1.y)
  const d3 = cross(p2.x - p1.x, p2.y - p1.y, q1.x - p1.x, q1.y - p1.y)
  const d4 = cross(p2.x - p1.x, p2.y - p1.y, q2.x - p1.x, q2.y - p1.y)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true
  return false
}

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
function AircraftButtons({ aircraftList, activeId, onSelectActive }) {
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
            className={`flex-1 pt-3 pb-1.5 rounded-b-lg font-mono font-bold text-sm border transition-colors ${
              isActive ? '' : inactiveCls
            }`}
            style={
              isActive
                ? { background: acc.bg, borderColor: acc.border, color: acc.textActive }
                : exists
                  ? { color: acc.textInactive }
                  : undefined
            }
          >{id}</button>
        )
      })}
    </div>
  )
}

// ── Numpad / L-R / aircraft switcher ────────────────────────────────────────
function DptControls({
  aircraftList, activeId, onSelectActive,
  turnDir, onTurnDir,
  inputMode, onInputMode,
  bearingInput, onDigit, onBackspace,
}) {
  const has = (id) => aircraftList.some(a => a.id === id)
  const display = bearingInput.padEnd(3, '_')

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
    const inactiveCls = 'bg-[#0a1628] border-[#1a3a5c] text-brand-300 hover:bg-[#0f2240]'
    const disabledCls = 'bg-[#060e1a] border-[#1a3a5c] text-slate-600 cursor-not-allowed opacity-50'
    return (
      <button
        type="button"
        disabled={dirDisabled}
        onClick={() => !dirDisabled && onTurnDir(d)}
        className={`w-full h-full py-3 rounded-lg font-mono font-extrabold text-lg border transition-colors ${
          dirDisabled ? disabledCls : isActive ? 'text-white' : inactiveCls
        }`}
        style={isActive ? { background: accent.solid, borderColor: accent.border } : undefined}
      >{label}</button>
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
        className={`flex-1 pt-1.5 pb-3 rounded-t-lg font-mono font-bold text-xs border transition-colors ${
          isActive
            ? (useAltAccent ? 'text-white' : 'bg-brand-600 border-brand-400 text-white')
            : 'bg-[#0a1628] border-[#1a3a5c] text-brand-300 hover:bg-[#0f2240]'
        }`}
        style={useAltAccent ? { background: accent.solid, borderColor: accent.border } : undefined}
      >{label}</button>
    )
  }

  const padBtn = (val, label, onClick) => (
    <button
      key={label}
      type="button"
      onClick={onClick}
      className="aspect-square rounded-lg font-mono font-bold text-xl bg-[#0a1628] border border-[#1a3a5c] text-brand-300 hover:bg-[#0f2240] active:bg-[#163055] transition-colors select-none"
    >{label}</button>
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
          <div className="bg-[#060e1a] border border-[#1a3a5c] rounded-lg py-2 mb-2 text-center font-mono text-xl tracking-[0.3em] text-brand-300 flex items-center justify-center gap-3">
            <span className="text-[10px] text-slate-500 tracking-normal">{inputMode}</span>
            <span className="text-2xl tracking-[0.4em]">{display}</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {[1,2,3,4,5,6,7,8,9].map(n => padBtn(n, String(n), () => onDigit(String(n))))}
            <div />
            {padBtn(0, '0', () => onDigit('0'))}
            {padBtn('bksp', '⌫', onBackspace)}
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
        Keys: <span className="font-mono">0–9</span>, <span className="font-mono">⌫</span>, <span className="font-mono">←→</span> L/R, <span className="font-mono">↑↓</span> BRG/ALT, <span className="font-mono">A/N/F</span>
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
}

// ── Aircraft Selection Screen ───────────────────────────────────────────────
function AircraftSelect({ aircraft, onSelect, loading, personalBest }) {
  return (
    <div>
      <h2 className="text-lg font-bold text-text text-center mb-1">Choose Your Aircraft</h2>
      <p className="text-xs text-slate-400 text-center mb-3">
        Used as the visual for CA-A and CA-N — Fighter is randomly assigned per round 6+.
      </p>

      {/* Instructions */}
      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-4 max-w-md mx-auto mb-4 text-sm text-[#ddeaf8] space-y-1.5">
        <div className="flex items-start gap-2">
          <span className="text-brand-300 shrink-0">🎯</span>
          <span>Vector aircraft through gates using compass bearings</span>
        </div>
        <div className="flex items-start gap-2">
          <span className="shrink-0">🛩️</span>
          <span><span className="font-mono text-slate-700">CA-A</span> hits lettered gates in order (A→B→C)</span>
        </div>
        <div className="flex items-start gap-2">
          <span className="shrink-0">✈️</span>
          <span><span className="font-mono text-slate-700">CA-N</span> joins round 4 — numbered gates (1→2→3)</span>
        </div>
        <div className="flex items-start gap-2">
          <span className="shrink-0">🛫</span>
          <span><span className="font-mono text-slate-700">Fighter</span> arrives round 6 — intercept enemy contacts</span>
        </div>
        <div className="flex items-start gap-2">
          <span className="text-brand-300 shrink-0">⌨️</span>
          <span><span className="font-mono text-slate-700">BRG</span>: type a 3-digit compass bearing (e.g. <span className="font-mono text-slate-700">010</span>, <span className="font-mono text-slate-700">250</span>)</span>
        </div>
        <div className="flex items-start gap-2">
          <span className="text-brand-300 shrink-0">📏</span>
          <span><span className="font-mono text-slate-700">ALT</span>: type 3 digits in 100s of ft &mdash; <span className="font-mono text-slate-700">020</span> = 2,000ft, <span className="font-mono text-slate-700">055</span> = 5,500ft, <span className="font-mono text-slate-700">100</span> = 10,000ft (max)</span>
        </div>
        <div className="flex items-start gap-2">
          <span className="text-brand-300 shrink-0">⏱</span>
          <span>90s per round &middot; {TOTAL_ROUNDS} rounds total</span>
        </div>
      </div>

      {/* Intercept rules — asymmetric scoring around the white/blue rings. */}
      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-4 max-w-md mx-auto mb-4 text-sm text-[#ddeaf8] space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Intercept rules</p>
        <div className="flex items-start gap-2">
          <span className="text-green-400 shrink-0">＋</span>
          <span><span className="font-mono text-slate-700">Fighter</span> on enemy ring within <span className="font-mono text-slate-700">1,000ft</span> alt &rarr; <span className="text-green-400">+250</span>, kill</span>
        </div>
        <div className="flex items-start gap-2">
          <span className="text-red-400 shrink-0">−</span>
          <span><span className="font-mono text-slate-700">CA-A / CA-N</span> on enemy ring within <span className="font-mono text-slate-700">3,000ft</span> alt &rarr; <span className="text-red-400">−150</span></span>
        </div>
        <div className="flex items-start gap-2">
          <span className="text-red-400 shrink-0">−</span>
          <span>Two player aircraft inside each other's blue ring within <span className="font-mono text-slate-700">3,000ft</span> alt &rarr; <span className="text-red-400">−150</span></span>
        </div>
        <div className="flex items-start gap-2">
          <span className="text-amber-400 shrink-0">⚠</span>
          <span>Danger zones at <span className="font-mono text-slate-700">020</span> (white ring) and <span className="font-mono text-slate-700">030</span> (black ring) — stay ≥<span className="font-mono text-slate-700">1,000ft</span> above or below</span>
        </div>
      </div>

      {personalBest && (
        <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 max-w-md mx-auto mb-2 text-center">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Personal Best</p>
          <p className="text-lg font-mono font-bold text-brand-300">
            {personalBest.bestScore} pts
            {personalBest.bestTime != null && (
              <>
                <span className="text-slate-500 mx-1">·</span>
                {personalBest.bestTime.toFixed(1)}s
              </>
            )}
          </p>
          <p className="text-[10px] text-slate-500 mt-0.5">{personalBest.attempts} attempt{personalBest.attempts !== 1 ? 's' : ''}</p>
        </div>
      )}

      <div className="text-center mb-4">
        <Link to="/cbat/dpt/leaderboard" className="text-xs text-brand-300 hover:text-brand-200 transition-colors">
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
          <p className="font-bold text-slate-700 mb-1">No 3D aircraft available</p>
          <p className="text-sm text-slate-400">Add .glb files to <span className="font-mono">public/models/</span> first.</p>
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
              <span className="absolute top-1 right-1 text-[8px] font-bold px-1.5 py-0.5 rounded bg-brand-600/80 text-white leading-none">
                3D
              </span>
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

// ── Main Component ──────────────────────────────────────────────────────────
export default function CbatDpt() {
  const { user, apiFetch, API } = useAuth()

  // Aircraft selection — only 3D-enabled aircraft per spec
  const [aircraft, setAircraft]               = useState([])
  const [loadingAircraft, setLoadingAircraft] = useState(true)
  const [selected, setSelected]               = useState(null)
  // Fighter pool used for the player's Fighter and the enemy aircraft (rounds 6+)
  const [fighterPool, setFighterPool]         = useState([])

  // Phase state machine: select → playing → finished. (`over` reserved for
  // mid-round death/abandon overlays once the game loop lands in Chunk 5.)
  const [phase, setPhase] = useState('select')
  const { enterImmersive, exitImmersive } = useGameChrome()
  useEffect(() => {
    if (phase === 'playing' || phase === 'over' || phase === 'intro') enterImmersive()
    else exitImmersive()
    return exitImmersive
  }, [phase, enterImmersive, exitImmersive])

  // While playing, opt the AppShell content area out of its max-w-3xl cap so
  // the side-by-side arena+controls layout can use the full main width
  // (which is already offset for the sidebar via md:ml-56 on app-shell-main).
  // 'intro' is included so the arena mounts behind the curtain at the same
  // width it'll have once the curtain lifts — avoids a layout shift on reveal.
  useEffect(() => {
    if (phase !== 'playing' && phase !== 'intro') return
    document.body.classList.add('cbat-dpt-fullwidth')
    return () => document.body.classList.remove('cbat-dpt-fullwidth')
  }, [phase])

  // Game state — wired up properly in Chunks 4–9
  const [round, setRound]                                 = useState(1)
  const [totalScore, setTotalScore]                       = useState(0)
  const [gatesHit, setGatesHit]                           = useState(0)
  const [interceptions, setInterceptions]                 = useState(0)
  const [dangerZoneViolations, setDangerZoneViolations]   = useState(0)
  const [separationViolations, setSeparationViolations]   = useState(0)
  const [elapsed, setElapsed]                             = useState(0)

  const [personalBest, setPersonalBest] = useState(null)
  const [scoreSaved, setScoreSaved]     = useState(false)
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
    apiFetch(`${API}/api/games/cbat/aircraft-cutouts`)
      .then(res => res.json())
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
    apiFetch(`${API}/api/games/cbat/fighter-aircraft`)
      .then(res => res.json())
      .then(d => setFighterPool((d.data || []).filter(a => has3DModel(a.briefId, a.title))))
      .catch(() => {})
  }, [user])

  // Fetch personal best
  useEffect(() => {
    if (!user) return
    apiFetch(`${API}/api/games/cbat/dpt/personal-best`)
      .then(r => r.json())
      .then(d => { if (d.data) setPersonalBest(d.data) })
      .catch(() => {})
  }, [user])

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
  const playerModel = () => selected ? getModelUrl(selected.briefId, selected.title) : null
  const pickFighterModel = () => {
    if (fighterPool.length === 0) return null
    const fp = fighterPool[Math.floor(Math.random() * fighterPool.length)]
    return getModelUrl(fp.briefId, fp.title)
  }

  const startRound = useCallback((roundNum) => {
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
    setRoundEndTime(Date.now() + roundDurationMs(roundNum))
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, fighterPool])

  // Entering intro/playing phase → kick off round 1 INLINE (not via startRound),
  // so this effect's closure doesn't depend on startRound's identity — that
  // way fighterPool loading after the user is already in 'playing' won't
  // respawn round 1 mid-game. Round 2+ still go through startRound, called
  // from the round-overlay timeout below.
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
    // round timer now that the curtain has lifted.
    if (prevPhase === 'intro' && phase === 'playing') {
      setRoundEndTime(Date.now() + ROUND_DURATION_MS)
      return
    }

    // First entry (select→intro, or select→playing under reduced-motion /
    // replay-skip): spawn round 1.
    const ac    = [spawnPlayerAircraft('CA-A', 'CA-A', getModelUrl(selected.briefId, selected.title))]
    const gates = generateGates(2, 'letter')

    setRound(1)
    setAircraftList(ac)
    setGateList(gates)
    setDangerZoneList([])
    setNextLetterIndex(0)
    setNextNumberIndex(0)
    // Hold timer at 0 during intro — the prevPhase==='intro' branch above
    // will set it once the curtain lifts.
    setRoundEndTime(phase === 'playing' ? Date.now() + ROUND_DURATION_MS : 0)
    setRoundOverlay(null)
    setBearingInput('')
    setActiveId('CA-A')
    setTurnDir('R')
    setInputMode('BRG')
    dzActiveRef.current = new Set()
    enemyContactRef.current = new Set()
    playerInterceptRef.current = new Set()
    fractionalPenaltyRef.current = 0
  }, [phase, selected])

  // Intro → playing transition is fired by SkywatchLogoIntro's onComplete
  // callback below. Cleanup if the user backs out mid-intro is handled by
  // the component itself (it clears its setTimeout on unmount, and we
  // unmount it by flipping phase off 'intro' from handleMenu).
  const handleIntroComplete = useCallback(() => {
    introPlayedRef.current = true
    setPhase('playing')
  }, [])

  // Round-complete overlay → advance to next round (or finish after round 8).
  // submitScore is defined later in the file but the timeout closure resolves
  // it after render commits, so it's in scope when this fires.
  useEffect(() => {
    if (!roundOverlay) return
    const timer = setTimeout(() => {
      const next = roundOverlay.round + 1
      if (next > TOTAL_ROUNDS) {
        const totalTime = (Date.now() - startTimeRef.current) / 1000
        setElapsed(totalTime)
        // Cheat-flagged runs do not write to the leaderboard.
        if (selected && !cheatUsedRef.current) {
          submitScore(totalScore, totalTime, selected.title, TOTAL_ROUNDS, {
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
        let { headingDeg, targetHeadingDeg, turnDirection, position, altitudeFt, targetAltitudeFt, aiNextDecision, altNextChange, wasInEdgeBuffer } = a

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

        // 1. Edge auto-turn — fires ONCE on entry into the buffer rather
        //    than every frame. That way a user-issued bearing while the
        //    yellow pulse is still active sticks instead of being blown
        //    away the next frame. Auto-turn re-fires only after the
        //    aircraft has left the buffer and re-entered.
        const dxFromEdge = ARENA_HALF - Math.abs(position.x - SCOPE_HALF)
        const dyFromEdge = ARENA_HALF - Math.abs(position.y - SCOPE_HALF)
        const inBuffer = dxFromEdge < EDGE_BUFFER || dyFromEdge < EDGE_BUFFER
        if (inBuffer && !wasInEdgeBuffer) {
          const t  = bearingToCenter(position.x, position.y)
          targetHeadingDeg = t
          turnDirection    = normalizeDeg(t - headingDeg) <= 180 ? 'R' : 'L'
          // Player aircraft get a yellow degree-calc line + arc so the
          // player sees the auto-redirect direction. Enemies skip the viz.
          if (a.kind === 'CA-A' || a.kind === 'CA-N' || a.kind === 'Fighter') {
            edgeAutoVizSnapshots.push({
              id: a.id,
              snapshot: {
                fromHeading:   headingDeg,
                targetBearing: t,
                direction:     turnDirection,
                capturedPos:   { x: position.x, y: position.y },
                kind:          'edgeAuto',
              },
            })
          }
        }
        wasInEdgeBuffer = inBuffer

        // 2. Rotate toward target heading
        if (targetHeadingDeg != null) {
          const angleStep = TURN_RATE * dt
          const remaining = turnDistance(headingDeg, targetHeadingDeg, turnDirection)
          if (remaining <= angleStep) {
            headingDeg       = targetHeadingDeg
            targetHeadingDeg = null
            turnDirection    = null
          } else if (turnDirection === 'L') {
            headingDeg = normalizeDeg(headingDeg - angleStep)
          } else {
            headingDeg = normalizeDeg(headingDeg + angleStep)
          }
        }

        // 3. Altitude interpolation
        if (targetAltitudeFt != null) {
          const altStep = ALT_RATE * dt
          const altDiff = targetAltitudeFt - altitudeFt
          if (Math.abs(altDiff) <= altStep) {
            altitudeFt       = targetAltitudeFt
            targetAltitudeFt = null
          } else {
            altitudeFt += Math.sign(altDiff) * altStep
          }
        }

        // 4. Advance forward
        const rad = (headingDeg * Math.PI) / 180
        let nx  = position.x + Math.sin(rad) * AIRCRAFT_SPEED * dt
        let ny  = position.y - Math.cos(rad) * AIRCRAFT_SPEED * dt
        nx = Math.max(SCOPE_HALF - ARENA_HALF, Math.min(SCOPE_HALF + ARENA_HALF, nx))
        ny = Math.max(SCOPE_HALF - ARENA_HALF, Math.min(SCOPE_HALF + ARENA_HALF, ny))

        // 5. Gate hit detection — CA-A → letter, CA-N → number, in order only.
        // Iterate by index so we can mutate the cloned array after lazily
        // upgrading from prevGates → cloned gates on first hit.
        for (let gi = 0; gi < gates.length; gi++) {
          const g = gates[gi]
          if (g.hit) continue
          if (a.kind === 'CA-A' && g.kind === 'letter' && g.index === nextLetIdx) {
            if (segmentsIntersect(position, { x: nx, y: ny }, g.p1, g.p2)) {
              ensureGatesMutable()
              gates[gi].hit = true
              nextLetIdx += 1; scoreDelta += POINTS_PER_GATE; gatesDelta += 1
            }
          }
          if (a.kind === 'CA-N' && g.kind === 'number' && g.index === nextNumIdx) {
            if (segmentsIntersect(position, { x: nx, y: ny }, g.p1, g.p2)) {
              ensureGatesMutable()
              gates[gi].hit = true
              nextNumIdx += 1; scoreDelta += POINTS_PER_GATE; gatesDelta += 1
            }
          }
        }

        return { ...a, headingDeg, targetHeadingDeg, turnDirection, position: { x: nx, y: ny }, altitudeFt, targetAltitudeFt, aiNextDecision, altNextChange, wasInEdgeBuffer }
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

  const handleDigit = useCallback((d) => {
    setBearingInput(prev => {
      if (prev.length >= 3) return prev
      const next = prev + d
      if (next.length === 3) {
        commitInput(next)
        return ''
      }
      return next
    })
  }, [commitInput])

  const handleBackspace = useCallback(() => {
    setBearingInput(prev => prev.slice(0, -1))
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    if (phase !== 'playing') return
    function onKey(e) {
      if (e.key >= '0' && e.key <= '9') { handleDigit(e.key); e.preventDefault(); return }
      if (e.key === 'Backspace')         { handleBackspace(); e.preventDefault(); return }
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
  }, [phase, handleDigit, handleBackspace])

  // Submit score at end of run
  const submitScore = useCallback((finalScore, finalTime, aircraftTitle, finalRound, breakdown) => {
    setScoreSaved(false)
    apiFetch(`${API}/api/games/cbat/dpt/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        totalScore: finalScore,
        totalTime:  finalTime,
        finalRound,
        aircraftUsed: aircraftTitle,
        ...breakdown,
      }),
    })
      .then(r => r.json())
      .then(() => {
        setScoreSaved(true)
        apiFetch(`${API}/api/games/cbat/dpt/personal-best`)
          .then(r => r.json())
          .then(d => { if (d.data) setPersonalBest(d.data) })
          .catch(() => {})
      })
      .catch(() => {})
  }, [apiFetch, API])

  // Handlers
  const handleSelect = useCallback((a) => {
    setSelected(a)
    recordCbatStart('dpt', apiFetch, API)
    setRound(1)
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
  }, [apiFetch, API])

  const handleMenu = useCallback(() => {
    setSelected(null)
    // Back to aircraft select → next pick should replay the intro.
    introPlayedRef.current = false
    setPhase('select')
  }, [])

  const handlePlayAgain = useCallback(() => {
    if (selected) handleSelect(selected)
  }, [selected, handleSelect])

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
            : <button onClick={handleMenu} className="text-slate-500 hover:text-brand-400 transition-colors text-sm bg-transparent border-0 p-0 cursor-pointer">&larr; Quit</button>
          }
          <h1 className="text-sm font-extrabold text-text">DPT &mdash; Dynamic Projection Test</h1>
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
            <div className="w-full max-w-md bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-5">
              <AircraftSelect
                aircraft={aircraft}
                onSelect={handleSelect}
                loading={loadingAircraft}
                personalBest={personalBest}
              />
            </div>
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
                    <span className="text-slate-400">RND <span className="text-brand-300">{round}</span>/{TOTAL_ROUNDS}</span>
                    <span className="text-slate-400">
                      SCORE <span className="text-brand-300">{totalScore}</span>
                      {cheatUsed && <span className="ml-2 text-amber-400">DEBUG · NO SUBMIT</span>}
                    </span>
                    <span className="text-slate-400">⏱ <span className={lowTime ? 'text-red-400' : 'text-brand-300'}>{roundLeft.toFixed(1)}s</span></span>
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
                          Round {roundOverlay.round} {roundOverlay.success ? 'Complete' : 'Time Up'}
                        </p>
                        <p className="text-xs text-slate-400">
                          {roundOverlay.round < TOTAL_ROUNDS ? `Next: Round ${roundOverlay.round + 1}` : 'Final score…'}
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
                aircraftList={aircraftList}
                activeId={activeId}
                onSelectActive={setActiveId}
                turnDir={turnDir}
                onTurnDir={setTurnDir}
                inputMode={inputMode}
                onInputMode={(m) => {
                  setInputMode(m)
                  setBearingInput('')
                  if (m === 'ALT') setAltPulseKey(k => k + 1)
                  else if (m === 'BRG') setBrgPulseKey(k => k + 1)
                }}
                bearingInput={bearingInput}
                onDigit={handleDigit}
                onBackspace={handleBackspace}
              />
            </div>
            </div>
          )}

          {/* Final score */}
          <AnimatePresence>
            {phase === 'finished' && selected && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="w-full max-w-md bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-8 text-center"
              >
                <p className="text-5xl mb-3">🎖️</p>
                <p className="text-2xl font-extrabold text-white mb-1">Run Complete</p>
                <p className="text-sm text-slate-400 mb-6">Reached round {round} of {TOTAL_ROUNDS}.</p>

                <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-5 mb-6">
                  <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">Final Score</p>
                  <div className="flex justify-center gap-8 mb-4">
                    <div>
                      <p className="text-3xl font-mono font-bold text-brand-300">{totalScore}</p>
                      <p className="text-xs text-slate-500 mt-1">points</p>
                    </div>
                    <div className="w-px bg-[#1a3a5c]" />
                    <div>
                      <p className="text-3xl font-mono font-bold text-brand-300">{elapsed.toFixed(1)}s</p>
                      <p className="text-xs text-slate-500 mt-1">total time</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400">
                    <div className="flex justify-between"><span>Gates hit</span><span className="text-brand-300 font-mono">{gatesHit}</span></div>
                    <div className="flex justify-between"><span>Intercepts</span><span className="text-brand-300 font-mono">{interceptions}</span></div>
                    <div className="flex justify-between"><span>Danger zones</span><span className="text-red-400 font-mono">{dangerZoneViolations}</span></div>
                    <div className="flex justify-between"><span>Separation</span><span className="text-red-400 font-mono">{separationViolations}</span></div>
                  </div>
                </div>

                {cheatUsed
                  ? <p className="text-xs text-amber-400 mb-4">DEBUG MODE · run not submitted to leaderboard</p>
                  : scoreSaved && <p className="text-xs text-green-400 mb-4">✓ Score saved</p>}

                <div className="flex flex-wrap gap-3 justify-center">
                  <button
                    onClick={handlePlayAgain}
                    className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-lg transition-colors"
                  >
                    Play Again
                  </button>
                  <Link
                    to="/cbat/dpt/leaderboard"
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
