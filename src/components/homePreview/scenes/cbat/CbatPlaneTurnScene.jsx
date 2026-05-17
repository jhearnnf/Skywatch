import { lazy, Suspense, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import CbatBg from './_cbatBg'

// Lazy so the Three.js bundle (Canvas + drei useGLTF) doesn't load on landing
// page mount — it streams in only once this scene becomes active.
const AircraftTopDown = lazy(() => import('../../../AircraftTopDown'))
const HAWK_T2_URL = '/models/hawk t2.glb'
// The Hawk T2 GLB is authored with its nose along +X; from the top-down
// camera that puts the nose pointing screen-right. We want "north" (rot=0)
// to mean nose-up, so apply a -90° yaw correction at the model level. CSS
// rotation on the wrapper then steers from there.
const HAWK_T2_NOSE_YAW = -90

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
      <div className="absolute inset-0 px-4 pt-16 sm:pt-24 pb-4 flex flex-col items-center">

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

          {/* Aircraft — real top-down render of the Hawk T2 GLB the real game
              uses. The motion.div positions the cell on the grid; an inner
              rotating wrapper applies the heading. Sized at ~2.5 cells so the
              silhouette is clearly readable in the preview. */}
          <motion.div
            animate={{
              left: `${(plane.c - 0.75) * cellPct}%`,
              top:  `${(plane.r - 0.75) * cellPct}%`,
            }}
            transition={{ duration: 0.6, ease: 'easeInOut' }}
            className="absolute"
            style={{
              width:  `${cellPct * 2.5}%`,
              height: `${cellPct * 2.5}%`,
              pointerEvents: 'none',
            }}
          >
            <motion.div
              animate={{ rotate: plane.rot }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              style={{
                width: '100%',
                height: '100%',
                filter: 'drop-shadow(0 0 6px rgba(91,170,255,0.55))',
              }}
            >
              <Suspense fallback={null}>
                <AircraftTopDown
                  modelUrl={HAWK_T2_URL}
                  clear
                  transparent
                  yawDeg={HAWK_T2_NOSE_YAW}
                />
              </Suspense>
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
