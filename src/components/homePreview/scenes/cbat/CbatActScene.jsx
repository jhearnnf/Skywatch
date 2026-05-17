import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import CbatBg from './_cbatBg'

// Mirrors the real ACT play: a cylindrical 3D tunnel POV (player flies forward
// through a tube) with shape gates the player steers through, audio callsigns
// + avoid/engage instructions, and a bleep button. The real game uses R3F +
// GLSL shaders + a TubeGeometry — too heavy to embed in a 2.5s preview, so
// this is an SVG evocation that keeps the gate-flying interaction readable.
//
// Realism cues borrowed from the real game:
//   - Wall colour #0c2a4a (the real MeshStandardMaterial colour)
//   - Concentric ELLIPSES (not rectangles) so the tunnel reads as cylindrical
//   - 8 radial vanishing-point lines (not 4 corner lines) for a stronger sense
//     of forward motion
//   - Real game's shape palette (#5baaff blue, #ff7066 red, #ffd166 amber, #80f0a0 green)
//   - Subtle warp-streaks travelling outward from the vanishing point
//   - Floor "horizon" curve below the centre for atmospheric depth

// Concentric tunnel rings (depth 0 = vanishing point, 1 = mouth of tunnel).
const TUNNEL_RINGS = [0.10, 0.18, 0.28, 0.42, 0.60, 0.82]

// Shape gates carry coloured targets the player either flies through (ENGAGE)
// or avoids per the callsign. Order tuned so the avoided shape passes after
// the user reacts.
const GATES = [
  { kind: 'square',   color: '#80f0a0', x: 38, delay: 0   },   // green — avoided
  { kind: 'circle',   color: '#5baaff', x: 52, delay: 0.7 },   // blue — engaged
  { kind: 'square',   color: '#ff7066', x: 28, delay: 1.4 },   // red — distractor
]

// "Warp streaks" — short lines travelling from the vanishing point outward,
// fanning around the tunnel to suggest forward motion at all angles.
const STREAK_ANGLES = Array.from({ length: 12 }).map((_, i) => (i * 360) / 12)

function GateMarker({ kind, color, size = 24 }) {
  // Real game uses torus (circle) and square-of-bars; we approximate with
  // an outer rim + thicker stroke for the "emissive 3D border" feel.
  const half = size / 2
  if (kind === 'circle') {
    return (
      <g>
        <circle cx="0" cy="0" r={half + 3} fill="none" stroke={color} strokeWidth="1.2" strokeOpacity="0.35" />
        <circle cx="0" cy="0" r={half}     fill="none" stroke={color} strokeWidth="3" />
        <circle cx="0" cy="0" r={half - 2} fill="none" stroke={color} strokeWidth="1" strokeOpacity="0.6" />
      </g>
    )
  }
  // square — chunky 3D-bar frame approximation
  return (
    <g>
      <rect x={-half - 3} y={-half - 3} width={size + 6} height={size + 6} fill="none" stroke={color} strokeWidth="1.2" strokeOpacity="0.35" rx="2" />
      <rect x={-half} y={-half} width={size} height={size} fill="none" stroke={color} strokeWidth="3" rx="2" />
      <rect x={-half + 2} y={-half + 2} width={size - 4} height={size - 4} fill="none" stroke={color} strokeWidth="1" strokeOpacity="0.6" rx="1" />
    </g>
  )
}

export default function CbatActScene({ runKey }) {
  const [callsign, setCallsign] = useState('HAWK-1, AVOID GREEN')
  const [reaction, setReaction] = useState(null) // 'avoid' | 'engage'
  // Ball drifts left/right as the player steers — matches the real game's
  // touch-pad steering.
  const [steerX,   setSteerX]   = useState(0)
  const [warning,  setWarning]  = useState(false) // wall-proximity glow flicker
  useEffect(() => {
    setCallsign('HAWK-1, AVOID GREEN')
    setReaction(null); setSteerX(0); setWarning(false)
    const tA = setTimeout(() => setSteerX(-24), 600)
    const tW = setTimeout(() => setWarning(true), 800)
    const tW2 = setTimeout(() => setWarning(false), 1300)
    const t1 = setTimeout(() => setReaction('avoid'), 1200)
    const tB = setTimeout(() => setSteerX(0),    1700)
    const t2 = setTimeout(() => setCallsign('EAGLE-2, ENGAGE BLUE'), 2400)
    const tC = setTimeout(() => setSteerX(10),    2900)
    const t3 = setTimeout(() => setReaction('engage'), 3300)
    return () => { [tA, tW, tW2, t1, tB, t2, tC, t3].forEach(clearTimeout) }
  }, [runKey])

  return (
    <div className="absolute inset-0 overflow-hidden">
      <CbatBg amber />
      {/* Tunnel POV */}
      <div className="absolute inset-0">
        <svg viewBox="0 0 100 70" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
          <defs>
            {/* Tunnel interior — darker at the centre (deep into the tube)
                using the real game's #0c2a4a wall colour, fading to near-black
                at the rim. Slight asymmetry simulates the curved tube. */}
            <radialGradient id="tunnel-bg" cx="50%" cy="55%" r="58%">
              <stop offset="0%"   stopColor="#0c2a4a" />
              <stop offset="55%"  stopColor="#061425" />
              <stop offset="100%" stopColor="#020812" />
            </radialGradient>
            {/* Linear gradient for the rim glow effect on the closest ring */}
            <radialGradient id="rim-glow" cx="50%" cy="55%" r="50%">
              <stop offset="80%" stopColor="#5baaff" stopOpacity="0" />
              <stop offset="100%" stopColor="#5baaff" stopOpacity="0.25" />
            </radialGradient>
          </defs>
          <rect x="0" y="0" width="100" height="70" fill="url(#tunnel-bg)" />

          {/* Concentric ELLIPTICAL rings — the cylindrical tunnel looking
              down its length. Wider than tall to match 16:9 viewport feel. */}
          {TUNNEL_RINGS.map((depth, i) => {
            const rx = 4 + depth * 48
            const ry = 3 + depth * 33
            const opacity = 0.15 + depth * 0.55
            return (
              <ellipse
                key={i}
                cx={50} cy={35}
                rx={rx} ry={ry}
                fill="none"
                stroke="#5baaff"
                strokeOpacity={opacity}
                strokeWidth={0.3 + depth * 0.45}
              />
            )
          })}

          {/* Rim glow on the outermost ring — suggests light spill */}
          <ellipse cx={50} cy={35} rx="52" ry="35" fill="url(#rim-glow)" />

          {/* Radial vanishing-point spokes — 12 evenly spaced lines from
              centre to the screen edges. Sells the depth perspective. */}
          {STREAK_ANGLES.map((deg) => {
            const rad = (deg * Math.PI) / 180
            const x2 = 50 + Math.cos(rad) * 60
            const y2 = 35 + Math.sin(rad) * 60
            return (
              <line
                key={deg}
                x1={50} y1={35}
                x2={x2} y2={y2}
                stroke="#5baaff"
                strokeOpacity="0.10"
                strokeWidth="0.25"
              />
            )
          })}

          {/* Animated warp streaks travelling outward — pure motion sense */}
          {STREAK_ANGLES.map((deg, i) => {
            const rad = (deg * Math.PI) / 180
            return (
              <motion.line
                key={`s-${deg}`}
                x1={50} y1={35}
                stroke="#9fc5ff"
                strokeWidth="0.35"
                strokeLinecap="round"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{
                  // Each streak grows from centre to a point along its angle,
                  // then fades. Staggered around the ring so the effect is
                  // continuous, not pulsing.
                  pathLength: 1,
                  opacity: [0, 0.6, 0],
                  x2:  50 + Math.cos(rad) * 55,
                  y2:  35 + Math.sin(rad) * 55,
                }}
                transition={{
                  duration: 1.4,
                  delay: i * 0.12,
                  repeat: Infinity,
                  ease: 'easeOut',
                }}
                x2={50 + Math.cos(rad) * 8}
                y2={35 + Math.sin(rad) * 8}
              />
            )
          })}

          {/* Floor horizon — curved line slightly below centre to sell the
              cylindrical interior */}
          <path
            d="M 0 55 Q 50 47, 100 55"
            fill="none"
            stroke="#5baaff"
            strokeOpacity="0.18"
            strokeWidth="0.4"
          />
        </svg>

        {/* Approaching gates — glow + scale from vanishing point. Outer ring,
            inner stroke, faint mid ring give a 3D "torus" feel. */}
        {GATES.map((g, i) => (
          <motion.svg
            key={`${i}-${runKey}`}
            viewBox="-30 -30 60 60"
            initial={{ scale: 0.10, opacity: 0, x: `${g.x}%`, y: '50%' }}
            animate={{ scale: 3.6,  opacity: [0, 1, 1, 0], x: `${g.x}%`, y: '120%' }}
            transition={{ duration: 2.2, delay: i * 0.7, repeat: Infinity, ease: 'linear' }}
            width="56" height="56"
            style={{
              position: 'absolute',
              left: 0, top: 0,
              transform: 'translate(-50%, -50%)',
              overflow: 'visible',
              filter: `drop-shadow(0 0 8px ${g.color})`,
            }}
          >
            <GateMarker kind={g.kind} color={g.color} size={22} />
          </motion.svg>
        ))}
      </div>

      {/* Callsign overlay */}
      <motion.div
        key={`cs-${callsign}-${runKey}`}
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="absolute top-16 sm:top-24 left-1/2 -translate-x-1/2 z-10 intel-mono px-3 py-1.5 rounded"
        style={{
          background: 'rgba(6,16,30,0.92)',
          border: '1.5px solid #fbbf24',
          color: '#fde68a',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.18em',
          boxShadow: '0 0 18px rgba(251,191,36,0.3)',
          whiteSpace: 'nowrap',
        }}
      >
        🎧 {callsign}
      </motion.div>

      {/* Reaction indicator */}
      {reaction && (
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.8 }}
          animate={{ opacity: [0, 1, 1, 0], y: 0, scale: 1 }}
          transition={{ duration: 1.4 }}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 intel-mono px-3 py-1 rounded-full"
          style={{
            background: reaction === 'avoid' ? 'rgba(34,197,94,0.18)' : 'rgba(91,170,255,0.18)',
            border: `1.5px solid ${reaction === 'avoid' ? '#22c55e' : '#5baaff'}`,
            color: reaction === 'avoid' ? '#86efac' : '#bfdbfe',
            fontSize: 9, fontWeight: 800, letterSpacing: '0.18em',
          }}
        >
          {reaction === 'avoid' ? '✓ AVOIDED' : '✓ ENGAGED'}
        </motion.div>
      )}

      {/* Player ball — emissive white-blue, with a warning halo that flashes
          orange→red when steering close to the tunnel wall (mirrors the real
          game's GLSL proximity warning). */}
      <motion.div
        animate={{ x: steerX }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="absolute"
        style={{
          left: '50%', bottom: 70,
          width: 18, height: 18,
          transform: 'translateX(-50%)',
          zIndex: 5,
        }}
      >
        {/* Warning halo — only visible when steering near the wall */}
        <motion.div
          animate={{
            opacity: warning ? [0.4, 0.8, 0.4] : 0,
            scale:   warning ? [1, 1.25, 1]   : 1,
          }}
          transition={{ duration: 0.5, repeat: warning ? Infinity : 0 }}
          className="absolute inset-0 rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(244,114,18,0.65) 0%, rgba(244,114,18,0) 70%)',
            transform: 'scale(2.4)',
          }}
        />
        {/* Ball itself */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: 'radial-gradient(circle at 35% 30%, #ffffff 0%, #c4d8ff 40%, #5baaff 100%)',
            boxShadow: '0 0 14px rgba(91,170,255,0.85), 0 0 24px rgba(91,170,255,0.4), inset 0 0 5px rgba(0,0,0,0.35)',
          }}
        />
      </motion.div>

      {/* Bleep button */}
      <div
        className="absolute intel-mono"
        style={{
          right: 10, bottom: 16,
          fontSize: 8, fontWeight: 800, letterSpacing: '0.18em',
          color: '#fde68a',
          background: 'rgba(6,16,30,0.85)',
          border: '1.5px solid #fbbf24',
          borderRadius: 999,
          padding: '4px 10px',
          boxShadow: '0 0 10px rgba(251,191,36,0.35)',
          zIndex: 5,
        }}
      >
        🔔 BLEEP
      </div>
    </div>
  )
}
