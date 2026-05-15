import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import CbatBg from './_cbatBg'

// Mirrors the real DPT play: a true PPI radar scope with concentric range
// rings, paired gate markers (two dots joined by a line + letter or number
// label), multiple aircraft triangles flying tracks, and a temporary command
// arc when a new bearing is set.

// Gates: pairs of dots forming a "gate". Letter gates = brand-blue,
// number gates = lighter cyan. Real game uses #5baaff and #9ed5ff.
const GATES = [
  { id: 'A', kind: 'letter', p1: { x: 22, y: 30 }, p2: { x: 32, y: 38 } },
  { id: 'B', kind: 'letter', p1: { x: 64, y: 24 }, p2: { x: 74, y: 30 } },
  { id: '1', kind: 'number', p1: { x: 30, y: 70 }, p2: { x: 38, y: 76 } },
  { id: '2', kind: 'number', p1: { x: 70, y: 64 }, p2: { x: 78, y: 70 } },
]

// 3 aircraft with start/end positions across the scope.
const AIRCRAFT = [
  { id: 'AC1', from: { x: 12, y: 12 }, to: { x: 60, y: 50 }, color: '#5baaff', cs: 'HW01' },
  { id: 'AC2', from: { x: 92, y: 12 }, to: { x: 50, y: 55 }, color: '#9ed5ff', cs: 'EG02' },
  { id: 'AC3', from: { x: 88, y: 88 }, to: { x: 40, y: 50 }, color: '#5baaff', cs: 'RV03' },
]

export default function CbatDptScene({ runKey }) {
  const [commandActive, setCommandActive] = useState(false)
  useEffect(() => {
    setCommandActive(false)
    const t = setTimeout(() => setCommandActive(true), 1100)
    return () => clearTimeout(t)
  }, [runKey])

  return (
    <div className="absolute inset-0 overflow-hidden">
      <CbatBg amber />
      <div className="absolute inset-0 px-3 pt-14 pb-3 flex flex-col items-center">

        {/* HUD strip */}
        <div className="flex justify-between items-center w-full mb-1.5 intel-mono" style={{ fontSize: 7 }}>
          <span style={{ color: '#5baaff', letterSpacing: '0.15em', fontWeight: 700 }}>SCOPE · 3 TRACKS</span>
          <span style={{ color: '#fbbf24', letterSpacing: '0.15em', fontWeight: 700 }}>NEXT: A → 1</span>
        </div>

        {/* Scope */}
        <div
          className="relative rounded-full"
          style={{
            width: 240, maxWidth: '88%', aspectRatio: '1 / 1',
            background: 'radial-gradient(circle at 50% 50%, #061425, #03070f)',
            border: '2px solid #1a3a5c',
            overflow: 'hidden',
            boxShadow: 'inset 0 0 28px rgba(91,170,255,0.18)',
          }}
        >
          <svg viewBox="0 0 100 100" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
            {/* Range rings */}
            {[15, 30, 45].map(r => (
              <circle key={r} cx="50" cy="50" r={r} fill="none" stroke="#5baaff" strokeOpacity="0.25" strokeWidth="0.3" />
            ))}
            {/* Crosshair lines through centre */}
            <line x1="50" y1="4" x2="50" y2="96" stroke="#5baaff" strokeOpacity="0.18" strokeWidth="0.25" />
            <line x1="4" y1="50" x2="96" y2="50" stroke="#5baaff" strokeOpacity="0.18" strokeWidth="0.25" />
            {/* Bearing labels */}
            <g fontFamily="ui-monospace, monospace" fontSize="3" fill="#5baaff" opacity="0.6" textAnchor="middle">
              <text x="50" y="7">N · 360</text>
              <text x="50" y="98">S · 180</text>
              <text x="6" y="50">W</text>
              <text x="94" y="50">E</text>
            </g>

            {/* Gates */}
            {GATES.map(g => {
              const color = g.kind === 'letter' ? '#5baaff' : '#9ed5ff'
              const cx = (g.p1.x + g.p2.x) / 2
              const cy = (g.p1.y + g.p2.y) / 2 - 4
              return (
                <g key={g.id}>
                  <line x1={g.p1.x} y1={g.p1.y} x2={g.p2.x} y2={g.p2.y} stroke={color} strokeWidth="0.7" strokeLinecap="round" opacity="0.7" />
                  <circle cx={g.p1.x} cy={g.p1.y} r="1.4" fill={color} />
                  <circle cx={g.p2.x} cy={g.p2.y} r="1.4" fill={color} />
                  <text x={cx} y={cy} fill={color} fontSize="4.5" fontWeight="800" fontFamily="ui-monospace, monospace" textAnchor="middle">{g.id}</text>
                </g>
              )
            })}

            {/* Bearing-command arc (appears when player issues a new bearing) */}
            {commandActive && (
              <motion.path
                key={`cmd-${runKey}`}
                d="M 12 12 Q 30 32, 60 50"
                fill="none"
                stroke="#5baaff"
                strokeWidth="0.5"
                strokeDasharray="2 1.5"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: [0, 0.85, 0.5] }}
                transition={{ duration: 1.3 }}
              />
            )}

            {/* Aircraft tracks */}
            {AIRCRAFT.map((ac, i) => (
              <g key={ac.id}>
                {/* Trail (dashed) */}
                <motion.line
                  key={`t-${i}-${runKey}`}
                  x1={ac.from.x} y1={ac.from.y}
                  x2={ac.to.x}   y2={ac.to.y}
                  stroke={ac.color}
                  strokeWidth="0.4"
                  strokeDasharray="1 1.5"
                  opacity="0.35"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 2.2, delay: i * 0.15, ease: 'linear' }}
                />
                {/* Moving aircraft triangle */}
                <motion.g
                  key={`a-${i}-${runKey}`}
                  initial={{ offsetDistance: '0%' }}
                  animate={{ offsetDistance: '100%' }}
                  transition={{ duration: 2.2, delay: i * 0.15, ease: 'linear' }}
                  style={{ offsetPath: `path("M ${ac.from.x} ${ac.from.y} L ${ac.to.x} ${ac.to.y}")` }}
                >
                  <polygon
                    points="0,-2.4 1.8,1.6 -1.8,1.6"
                    fill={ac.color}
                    stroke="#06101e"
                    strokeWidth="0.3"
                  />
                </motion.g>
                {/* Static-position callsign label (at midpoint) */}
                <text
                  x={(ac.from.x + ac.to.x) / 2 + 3}
                  y={(ac.from.y + ac.to.y) / 2}
                  fill={ac.color}
                  fontSize="3"
                  fontFamily="ui-monospace, monospace"
                  fontWeight="700"
                  opacity="0.85"
                >
                  {ac.cs}
                </text>
              </g>
            ))}

            {/* Centre dot */}
            <circle cx="50" cy="50" r="1.2" fill="#5baaff" />
          </svg>
        </div>
      </div>
    </div>
  )
}
