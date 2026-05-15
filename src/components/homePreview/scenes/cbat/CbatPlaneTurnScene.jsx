import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import CbatBg from './_cbatBg'

// Mirrors the real Plane Turn play: 10×10 grid with aircraft cutout in the
// centre, package emoji in a random cell, green chevrons ahead of the plane
// showing the next-move direction. Radar sweep slowly rotates in the bg.
// HUD shows level + collected count.

const GRID = 10
const PLANE_START = { c: 5, r: 5, rot: 0 }      // facing north
const PACKAGE = { c: 8, r: 2 }
const PLANE_END   = { c: 7, r: 3, rot: 45 }     // turned northeast, approached package

export default function CbatPlaneTurnScene({ runKey }) {
  const [plane, setPlane] = useState(PLANE_START)
  const [collected, setCollected] = useState(false)
  useEffect(() => {
    setPlane(PLANE_START); setCollected(false)
    const t1 = setTimeout(() => setPlane({ c: 5, r: 5, rot: 45 }), 700)
    const t2 = setTimeout(() => setPlane({ c: 6, r: 4, rot: 45 }), 1500)
    const t3 = setTimeout(() => setPlane(PLANE_END), 2200)
    const t4 = setTimeout(() => setCollected(true), 2900)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4) }
  }, [runKey])

  // Cell size as a percentage of grid container
  const cellPct = 100 / GRID

  return (
    <div className="absolute inset-0 overflow-hidden">
      <CbatBg amber />
      <div className="absolute inset-0 px-4 pt-14 pb-4 flex flex-col items-center">

        {/* HUD */}
        <div className="flex justify-between items-center w-full mb-2 intel-mono" style={{ fontSize: 7 }}>
          <span style={{ color: '#5baaff', letterSpacing: '0.15em', fontWeight: 700 }}>LEVEL 2 · 2D</span>
          <span style={{ color: '#fbbf24', letterSpacing: '0.15em', fontWeight: 700 }}>📦 {collected ? '2/5' : '1/5'}</span>
        </div>

        {/* Grid container */}
        <div
          className="relative rounded-lg flex-1 w-full"
          style={{
            maxWidth: 280, aspectRatio: '1 / 1',
            background: '#0a1628',
            border: '1.5px solid #1a3a5c',
            overflow: 'hidden',
          }}
        >
          {/* Radar sweep underlay */}
          <motion.div
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none"
            animate={{ rotate: 360 }}
            transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
            style={{
              background: 'conic-gradient(from 0deg, rgba(91,170,255,0.18), transparent 25%, transparent 100%)',
              opacity: 0.6,
            }}
          />

          {/* Grid lines */}
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
            {Array.from({ length: GRID + 1 }).map((_, i) => (
              <g key={i}>
                <line x1={i * cellPct} y1="0" x2={i * cellPct} y2="100" stroke="#0f2440" strokeWidth="0.25" />
                <line x1="0" y1={i * cellPct} x2="100" y2={i * cellPct} stroke="#0f2440" strokeWidth="0.25" />
              </g>
            ))}
          </svg>

          {/* Package */}
          {!collected && (
            <motion.div
              animate={{ scale: [1, 1.15, 1] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
              className="absolute flex items-center justify-center"
              style={{
                left: `${PACKAGE.c * cellPct}%`,
                top:  `${PACKAGE.r * cellPct}%`,
                width:  `${cellPct}%`,
                height: `${cellPct}%`,
                filter: 'drop-shadow(0 0 6px rgba(251,191,36,0.7))',
                fontSize: 14,
              }}
            >
              📦
            </motion.div>
          )}

          {/* Aircraft */}
          <motion.div
            animate={{
              left: `${plane.c * cellPct}%`,
              top:  `${plane.r * cellPct}%`,
            }}
            transition={{ duration: 0.6, ease: 'easeInOut' }}
            className="absolute flex items-center justify-center"
            style={{
              width: `${cellPct}%`,
              height: `${cellPct}%`,
            }}
          >
            <motion.div
              animate={{ rotate: plane.rot }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              style={{
                fontSize: 18,
                color: '#5baaff',
                textShadow: '0 0 8px rgba(91,170,255,0.7)',
              }}
            >
              ▲
            </motion.div>
          </motion.div>

          {/* Direction chevrons — pointing where the plane will go next */}
          {!collected && (
            <motion.div
              animate={{ rotate: plane.rot }}
              transition={{ duration: 0.5 }}
              className="absolute flex flex-col items-center gap-0.5"
              style={{
                left: `${(plane.c + 0.5) * cellPct}%`,
                top:  `${(plane.r + 0.5) * cellPct}%`,
                transform: 'translate(-50%, -50%)',
                transformOrigin: 'center',
                width: cellPct + '%',
                pointerEvents: 'none',
              }}
            >
              <motion.span animate={{ y: [-1, -3, -1], opacity: [0.5, 1, 0.5] }} transition={{ duration: 0.9, repeat: Infinity }} style={{ position: 'absolute', top: -28, color: '#22c55e', fontSize: 8 }}>▲</motion.span>
              <motion.span animate={{ y: [-1, -3, -1], opacity: [0.3, 0.7, 0.3] }} transition={{ duration: 0.9, repeat: Infinity, delay: 0.2 }} style={{ position: 'absolute', top: -36, color: '#22c55e', fontSize: 7 }}>▲</motion.span>
            </motion.div>
          )}

          {/* Collection burst */}
          {collected && (
            <motion.div
              initial={{ scale: 0.3, opacity: 0.9 }}
              animate={{ scale: 2.5, opacity: 0 }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
              className="absolute rounded-full pointer-events-none"
              style={{
                left: `${(PACKAGE.c + 0.5) * cellPct}%`,
                top:  `${(PACKAGE.r + 0.5) * cellPct}%`,
                transform: 'translate(-50%, -50%)',
                width: 32, height: 32,
                border: '2px solid #fbbf24',
                boxShadow: '0 0 16px #fbbf24',
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
