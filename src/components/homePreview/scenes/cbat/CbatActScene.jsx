import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import CbatBg from './_cbatBg'

// Mirrors the real ACT play: a 3D tube-tunnel POV (player flies forward
// through a tunnel) with shapes appearing ahead, and audio callsigns +
// avoid/target instructions overlaid as text. Replicated with SVG depth
// lines + scaling shapes that simulate forward motion.

const TUNNEL_RINGS = [0.15, 0.25, 0.40, 0.60, 0.85] // depth (0 = far, 1 = near)
const APPROACH_SHAPES = [
  { e: '◆', x: 40, color: '#22c55e' },
  { e: '●', x: 65, color: '#ef4444' },
  { e: '▲', x: 25, color: '#5baaff' },
]

export default function CbatActScene({ runKey }) {
  const [callsign, setCallsign] = useState('HAWK-1, AVOID GREEN')
  const [reaction, setReaction] = useState(null) // 'avoid' | 'engage'
  useEffect(() => {
    setCallsign('HAWK-1, AVOID GREEN')
    setReaction(null)
    const t1 = setTimeout(() => setReaction('avoid'), 1200)
    const t2 = setTimeout(() => setCallsign('EAGLE-2, ENGAGE BLUE'), 2400)
    const t3 = setTimeout(() => setReaction('engage'), 3300)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
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

        {/* Approaching shapes — scale up to feel like they're flying at us */}
        {APPROACH_SHAPES.map((s, i) => (
          <motion.div
            key={`${i}-${runKey}`}
            initial={{ scale: 0.2, opacity: 0,    x: `${s.x}%`, y: '50%' }}
            animate={{ scale: 2.5, opacity: [0, 1, 1, 0], x: `${s.x}%`, y: '110%' }}
            transition={{ duration: 2.2, delay: i * 0.7, repeat: Infinity, ease: 'linear' }}
            className="absolute"
            style={{
              left: 0, top: 0,
              transform: 'translate(-50%, -50%)',
              color: s.color,
              fontSize: 22,
              filter: `drop-shadow(0 0 5px ${s.color})`,
              fontWeight: 800,
            }}
          >
            {s.e}
          </motion.div>
        ))}
      </div>

      {/* Callsign overlay (top centre) */}
      <motion.div
        key={`cs-${callsign}-${runKey}`}
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="absolute top-12 left-1/2 -translate-x-1/2 z-10 intel-mono px-3 py-1.5 rounded"
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

      {/* Ball (player marker) — sits low-centre as POV anchor */}
      <div
        className="absolute"
        style={{
          left: '50%', bottom: 22,
          transform: 'translateX(-50%)',
          width: 14, height: 14, borderRadius: 999,
          background: 'radial-gradient(circle at 30% 30%, #ffffff, #5baaff)',
          boxShadow: '0 0 14px rgba(91,170,255,0.8), inset 0 0 4px rgba(0,0,0,0.4)',
          zIndex: 5,
        }}
      />
    </div>
  )
}
