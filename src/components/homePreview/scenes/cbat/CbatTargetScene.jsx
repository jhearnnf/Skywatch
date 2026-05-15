import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import CbatBg from './_cbatBg'

// Mirrors the real CBAT Target play screen: a large left-pane "scene" with
// scattered colour-coded shapes (circles=trucks, squares=tanks, triangles=
// buildings) plus a stacked right column of side-panels (scan radar with
// rotating sweep, light pattern, scrolling system codes). HUD on top.

// Shape pool — colours mirror the real game palette (#ef4444 hostile,
// #5baaff friendly, #facc15 neutral).
const SHAPES = [
  { type: 'circle',   color: '#ef4444', x: 22, y: 32 },
  { type: 'square',   color: '#facc15', x: 56, y: 18 },
  { type: 'triangle', color: '#5baaff', x: 14, y: 70 },
  { type: 'circle',   color: '#ef4444', x: 70, y: 60 },
  { type: 'diamond',  color: '#5baaff', x: 38, y: 50 },
  { type: 'square',   color: '#ef4444', x: 84, y: 30 },
  { type: 'circle',   color: '#facc15', x: 30, y: 84 },
  { type: 'triangle', color: '#ef4444', x: 62, y: 78 },
]

const CODES = ['AX-441', 'KL-208', 'QR-117', 'TM-883', 'WV-072', 'HJ-394']

function Shape({ s, locked }) {
  const size = 14
  const props = {
    fill: s.color,
    opacity: locked ? 0.45 : 1,
    filter: locked ? 'none' : `drop-shadow(0 0 5px ${s.color})`,
  }
  if (s.type === 'circle')   return <circle cx="0" cy="0" r={size / 2} {...props} />
  if (s.type === 'square')   return <rect   x={-size/2} y={-size/2} width={size} height={size} {...props} />
  if (s.type === 'triangle') return <polygon points={`0,${-size/2} ${size/2},${size/2} ${-size/2},${size/2}`} {...props} />
  return <polygon points={`0,${-size/2} ${size/2},0 0,${size/2} ${-size/2},0`} {...props} />
}

export default function CbatTargetScene({ runKey }) {
  const [lockedIdx, setLockedIdx] = useState(null)
  useEffect(() => {
    setLockedIdx(null)
    // Lock onto a hostile (red circle) — second shape in the array order is the goal
    const t = setTimeout(() => setLockedIdx(3), 1100)
    return () => clearTimeout(t)
  }, [runKey])

  return (
    <div className="absolute inset-0 overflow-hidden">
      <CbatBg amber />
      <div className="absolute inset-0 px-4 pt-14 pb-4 flex gap-3">

        {/* Left: scene scope with shapes */}
        <div
          className="relative rounded-lg flex-1"
          style={{
            background: '#0a1628',
            border: '1.5px solid #1a3a5c',
            overflow: 'hidden',
          }}
        >
          {/* Grid backdrop */}
          <div
            aria-hidden="true"
            className="absolute inset-0 opacity-30"
            style={{
              background:
                'linear-gradient(90deg, rgba(91,170,255,0.25) 1px, transparent 1px) 0 0/24px 24px,' +
                'linear-gradient(0deg,  rgba(91,170,255,0.25) 1px, transparent 1px) 0 0/24px 24px',
            }}
          />
          {/* HUD row */}
          <div className="absolute top-1.5 left-2 right-2 z-10 flex items-center justify-between intel-mono" style={{ fontSize: 8 }}>
            <span style={{ color: '#fbbf24', letterSpacing: '0.12em', fontWeight: 700 }}>TIME 00:42</span>
            <span style={{ color: '#5baaff', letterSpacing: '0.12em', fontWeight: 700 }}>SCORE 12</span>
          </div>
          {/* Shapes */}
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
            {SHAPES.map((s, i) => (
              <g key={i} transform={`translate(${s.x} ${s.y})`}>
                <Shape s={s} locked={lockedIdx !== null && i !== lockedIdx} />
                {lockedIdx === i && (
                  <>
                    {/* Crosshair lock */}
                    <circle cx="0" cy="0" r="11" fill="none" stroke="#fbbf24" strokeWidth="0.8" />
                    <line x1="-14" y1="0" x2="-7" y2="0" stroke="#fbbf24" strokeWidth="0.6" />
                    <line x1="7"   y1="0" x2="14"  y2="0" stroke="#fbbf24" strokeWidth="0.6" />
                    <line x1="0" y1="-14" x2="0" y2="-7" stroke="#fbbf24" strokeWidth="0.6" />
                    <line x1="0" y1="7"   x2="0" y2="14"  stroke="#fbbf24" strokeWidth="0.6" />
                  </>
                )}
              </g>
            ))}
          </svg>
        </div>

        {/* Right column: 3 stacked side panels */}
        <div className="flex flex-col gap-1.5" style={{ width: 92 }}>

          {/* Scan radar (rotating sweep) */}
          <div
            className="relative rounded"
            style={{ height: 60, background: '#0a1628', border: '1px solid #1a3a5c', overflow: 'hidden' }}
          >
            <svg viewBox="0 0 60 60" style={{ width: '100%', height: '100%' }}>
              <circle cx="30" cy="30" r="24" fill="none" stroke="#5baaff" strokeOpacity="0.2" strokeWidth="0.5" />
              <circle cx="30" cy="30" r="14" fill="none" stroke="#5baaff" strokeOpacity="0.2" strokeWidth="0.5" />
              <motion.g
                animate={{ rotate: 360 }}
                transition={{ duration: 2.4, repeat: Infinity, ease: 'linear' }}
                style={{ transformOrigin: '30px 30px' }}
              >
                <defs>
                  <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0" stopColor="#5baaff" stopOpacity="0.7" />
                    <stop offset="1" stopColor="#5baaff" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d="M 30 30 L 30 6 A 24 24 0 0 1 50 22 Z" fill="url(#sweep)" />
              </motion.g>
              {/* contacts */}
              <circle cx="22" cy="18" r="1.2" fill="#ef4444" />
              <circle cx="42" cy="34" r="1.2" fill="#5baaff" />
              <circle cx="34" cy="44" r="1.2" fill="#facc15" />
            </svg>
            <span className="intel-mono absolute top-1 left-1.5" style={{ fontSize: 6, color: '#5baaff', letterSpacing: '0.15em', fontWeight: 700 }}>SCAN</span>
          </div>

          {/* Light pattern (3×3 of lights) */}
          <div
            className="rounded p-1"
            style={{ background: '#0a1628', border: '1px solid #1a3a5c', position: 'relative' }}
          >
            <span className="intel-mono absolute top-1 left-1.5" style={{ fontSize: 6, color: '#5baaff', letterSpacing: '0.15em', fontWeight: 700 }}>LIGHTS</span>
            <div className="grid grid-cols-3 gap-1 mt-2.5">
              {[0,1,2,3,4,5,6,7,8].map(i => {
                const on = [1, 3, 5, 7].includes(i)
                return (
                  <div
                    key={i}
                    style={{
                      width: '100%', aspectRatio: '1 / 1', borderRadius: 999,
                      background: on ? '#22c55e' : 'rgba(255,255,255,0.05)',
                      boxShadow: on ? '0 0 4px #22c55e' : 'none',
                    }}
                  />
                )
              })}
            </div>
          </div>

          {/* System codes (scrolling) */}
          <div
            className="relative rounded flex-1"
            style={{ background: '#0a1628', border: '1px solid #1a3a5c', overflow: 'hidden', minHeight: 70 }}
          >
            <span className="intel-mono absolute top-1 left-1.5 z-10" style={{ fontSize: 6, color: '#5baaff', letterSpacing: '0.15em', fontWeight: 700, background: '#0a1628', paddingRight: 4 }}>SYSTEM</span>
            <motion.div
              animate={{ y: [0, -60] }}
              transition={{ duration: 3.5, repeat: Infinity, ease: 'linear' }}
              className="mt-4 px-1"
            >
              {[...CODES, ...CODES].map((c, i) => (
                <p
                  key={i}
                  className="intel-mono"
                  style={{ fontSize: 7, color: i % 4 === 0 ? '#fbbf24' : '#5baaff', lineHeight: 1.5, fontWeight: 700 }}
                >
                  {c}
                </p>
              ))}
            </motion.div>
          </div>

        </div>
      </div>
    </div>
  )
}
