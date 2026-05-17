import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import CbatBg from './_cbatBg'

// Mirrors the real ACT play: a 3D tube-tunnel POV with shape gates the
// player steers through, audio callsigns + avoid/engage instructions, a
// score HUD, and a bleep button. The real game uses R3F + GLSL shaders +
// a TubeGeometry — too heavy to embed in a 2.5s preview, so this is an SVG
// evocation that keeps the gate-flying interaction readable.

const TUNNEL_RINGS = [0.15, 0.25, 0.40, 0.60, 0.85] // depth (0 = far, 1 = near)

// Each gate carries a coloured shape (square / diamond / triangle) — these
// are the targets the player either flies through (ENGAGE) or avoids per the
// callsign. Order tuned so the avoided shape passes after the user reacts.
const GATES = [
  { kind: 'square',   color: '#22c55e', x: 40 },   // green — avoided
  { kind: 'triangle', color: '#5baaff', x: 50 },   // blue — engaged
  { kind: 'diamond',  color: '#ef4444', x: 30 },   // red — distractor
]

function GateShape({ kind, color, size = 22 }) {
  const half = size / 2
  if (kind === 'square') {
    return <rect x={-half} y={-half} width={size} height={size} fill="none" stroke={color} strokeWidth={2} rx="2" />
  }
  if (kind === 'diamond') {
    return <polygon points={`0,${-half} ${half},0 0,${half} ${-half},0`} fill="none" stroke={color} strokeWidth={2} />
  }
  return <polygon points={`0,${-half} ${half},${half} ${-half},${half}`} fill="none" stroke={color} strokeWidth={2} />
}

export default function CbatActScene({ runKey }) {
  const [callsign, setCallsign] = useState('HAWK-1, AVOID GREEN')
  const [reaction, setReaction] = useState(null) // 'avoid' | 'engage'
  // Ball drifts left/right as the player steers — matches the real game's
  // touch-pad steering. Values are CSS-px offsets from the bottom-centre.
  const [steerX,   setSteerX]   = useState(0)
  useEffect(() => {
    setCallsign('HAWK-1, AVOID GREEN')
    setReaction(null); setSteerX(0)
    const tA = setTimeout(() => setSteerX(-22), 600)   // steer left to avoid green
    const t1 = setTimeout(() => setReaction('avoid'), 1200)
    const tB = setTimeout(() => setSteerX(0),    1700)
    const t2 = setTimeout(() => setCallsign('EAGLE-2, ENGAGE BLUE'), 2400)
    const tC = setTimeout(() => setSteerX(8),    2900)
    const t3 = setTimeout(() => setReaction('engage'), 3300)
    return () => { [tA, t1, tB, t2, tC, t3].forEach(clearTimeout) }
  }, [runKey])

  return (
    <div className="absolute inset-0 overflow-hidden">
      <CbatBg amber />
      {/* Tunnel POV */}
      <div className="absolute inset-0">
        <svg viewBox="0 0 100 70" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
          <defs>
            <radialGradient id="tunnel-bg" cx="50%" cy="55%" r="60%">
              <stop offset="0%"   stopColor="#0a1628" />
              <stop offset="100%" stopColor="#020812" />
            </radialGradient>
          </defs>
          <rect x="0" y="0" width="100" height="70" fill="url(#tunnel-bg)" />
          {/* Concentric tunnel rings (rectangles converging to centre) */}
          {TUNNEL_RINGS.map((depth, i) => {
            const halfW = 4 + depth * 46
            const halfH = 3 + depth * 32
            const opacity = 0.15 + depth * 0.6
            return (
              <rect
                key={i}
                x={50 - halfW}
                y={35 - halfH}
                width={halfW * 2}
                height={halfH * 2}
                fill="none"
                stroke="#5baaff"
                strokeOpacity={opacity}
                strokeWidth={0.4 + depth * 0.5}
                rx="4"
              />
            )
          })}
          {/* Radial depth lines */}
          {[[0,0], [100,0], [100,70], [0,70]].map(([x, y], i) => (
            <line
              key={i}
              x1={x} y1={y}
              x2={50} y2={35}
              stroke="#5baaff"
              strokeOpacity="0.18"
              strokeWidth="0.3"
              strokeDasharray="2 2"
            />
          ))}
          {/* Floor markings (rectangles below centre, fanning forward) */}
          {[0.3, 0.5, 0.75].map((d, i) => (
            <line
              key={`f-${i}`}
              x1={50 - 4 - d * 46} y1={35 + 3 + d * 32}
              x2={50 + 4 + d * 46} y2={35 + 3 + d * 32}
              stroke="#5baaff"
              strokeOpacity={0.25}
              strokeWidth="0.4"
            />
          ))}
        </svg>

        {/* Approaching gates — coloured ring outlines that grow from the
            vanishing point. Each carries a square / diamond / triangle
            target. Players steer the ball through the right one per
            callsign. Scaling + fade simulates forward motion. */}
        {GATES.map((g, i) => (
          <motion.svg
            key={`${i}-${runKey}`}
            viewBox="-30 -30 60 60"
            initial={{ scale: 0.15, opacity: 0,    x: `${g.x}%`, y: '50%' }}
            animate={{ scale: 3.2,  opacity: [0, 1, 1, 0], x: `${g.x}%`, y: '115%' }}
            transition={{ duration: 2.3, delay: i * 0.7, repeat: Infinity, ease: 'linear' }}
            width="48" height="48"
            style={{
              position: 'absolute',
              left: 0, top: 0,
              transform: 'translate(-50%, -50%)',
              overflow: 'visible',
              filter: `drop-shadow(0 0 6px ${g.color})`,
            }}
          >
            {/* Outer gate ring */}
            <circle cx="0" cy="0" r="24" fill="none" stroke={g.color} strokeWidth="2" strokeOpacity="0.4" />
            {/* Inner shape — the actual target */}
            <GateShape kind={g.kind} color={g.color} size={20} />
          </motion.svg>
        ))}
      </div>

      {/* Callsign overlay (top centre) */}
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

      {/* Reaction indicator (bottom centre — what the player just did) */}
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

      {/* Ball (player marker) — sits low-centre as POV anchor. Drifts
          left/right with the user's "steer" so they fly through the
          right gate per the callsign. */}
      <motion.div
        animate={{ x: steerX }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="absolute"
        style={{
          left: '50%', bottom: 22,
          transform: 'translateX(-50%)',
          width: 16, height: 16, borderRadius: 999,
          background: 'radial-gradient(circle at 30% 30%, #ffffff, #5baaff)',
          boxShadow: '0 0 16px rgba(91,170,255,0.85), inset 0 0 5px rgba(0,0,0,0.4)',
          zIndex: 5,
        }}
      />

      {/* Bleep button — bottom-right pill, matches the real game's UI */}
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
