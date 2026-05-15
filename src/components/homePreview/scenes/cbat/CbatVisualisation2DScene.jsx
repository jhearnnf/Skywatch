import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import CbatBg from './_cbatBg'

// Mirrors the real Visualisation 2D play: 3 labelled-edge shapes at the top
// (small SVG outlines with letter labels at edges), and 6 composite-shape
// choices in a 3×2 grid below. Player mentally welds matching letters and
// picks the correct final figure.

// Each prompt shape is rendered as a polygon with letter labels at specific edges.
// Letters indicate which edges match between shapes — players "weld" matching letters.
const PROMPTS = [
  { d: 'M 10 30 L 50 10 L 90 30 L 50 50 Z', labels: [
    { x: 30, y: 18, t: 'A' },
    { x: 30, y: 42, t: 'B' },
  ] },
  { d: 'M 10 20 L 90 20 L 50 80 Z', labels: [
    { x: 50, y: 16, t: 'B' },
    { x: 25, y: 50, t: 'C' },
  ] },
  { d: 'M 20 20 L 80 20 L 80 80 L 20 80 Z', labels: [
    { x: 16, y: 50, t: 'C' },
    { x: 84, y: 50, t: 'D' },
  ] },
]

// 6 composite-shape choices. Correct index = 2.
const CHOICES = [
  'M 20 60 L 50 30 L 80 60 L 65 80 L 35 80 Z',                                              // 0
  'M 20 30 L 80 30 L 80 70 L 50 90 L 20 70 Z',                                              // 1
  'M 15 40 L 50 15 L 85 40 L 85 70 L 50 85 L 15 70 Z',                                       // 2 ✓
  'M 30 25 L 70 25 L 80 50 L 70 75 L 30 75 L 20 50 Z',                                       // 3
  'M 20 50 L 50 20 L 80 50 L 50 80 Z',                                                       // 4
  'M 25 30 L 75 30 L 75 80 L 25 80 Z',                                                       // 5
]
const CORRECT = 2

export default function CbatVisualisation2DScene({ runKey }) {
  const [picked, setPicked] = useState(null)
  useEffect(() => {
    setPicked(null)
    const t = setTimeout(() => setPicked(CORRECT), 1500)
    return () => clearTimeout(t)
  }, [runKey])

  return (
    <div className="absolute inset-0 overflow-hidden">
      <CbatBg amber />
      <div className="absolute inset-0 px-4 pt-14 pb-3 flex flex-col items-center">

        {/* HUD */}
        <div className="flex justify-between items-center w-full mb-2 intel-mono" style={{ fontSize: 7 }}>
          <span style={{ color: '#5baaff', letterSpacing: '0.15em', fontWeight: 700 }}>ROUND 4 · 30s</span>
          <span style={{ color: '#fbbf24', letterSpacing: '0.15em', fontWeight: 700 }}>CORRECT 3</span>
        </div>

        {/* Prompt row */}
        <p className="intel-mono mb-1" style={{ fontSize: 7, color: '#94a3b8', letterSpacing: '0.18em', fontWeight: 700, textTransform: 'uppercase' }}>
          Weld matching edges
        </p>
        <div className="flex gap-2 mb-3">
          {PROMPTS.map((p, i) => (
            <svg key={i} viewBox="0 0 100 100" style={{ width: 50, height: 50 }}>
              <path d={p.d} fill="rgba(91,170,255,0.18)" stroke="#5baaff" strokeWidth="1.4" />
              {p.labels.map((l, j) => (
                <text
                  key={j}
                  x={l.x}
                  y={l.y}
                  fill="#fff"
                  stroke="#06101e"
                  strokeWidth="0.8"
                  paintOrder="stroke"
                  fontFamily="ui-monospace, monospace"
                  fontSize="10"
                  fontWeight="700"
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  {l.t}
                </text>
              ))}
            </svg>
          ))}
        </div>

        {/* 3×2 choices */}
        <div className="grid grid-cols-3 gap-1.5 flex-1 w-full">
          {CHOICES.map((d, i) => {
            const isCorrect = i === CORRECT
            const showResult = picked !== null
            const isPicked   = picked === i
            return (
              <motion.div
                key={i}
                animate={showResult && isCorrect ? { scale: [1, 1.08, 1] } : {}}
                transition={{ duration: 0.55 }}
                className="rounded-lg relative flex items-center justify-center"
                style={{
                  background: showResult && isCorrect ? 'rgba(34,197,94,0.15)' : '#0a1628',
                  border: `1.5px solid ${showResult && isCorrect ? '#22c55e' : '#1a3a5c'}`,
                  boxShadow: showResult && isCorrect ? '0 0 12px rgba(34,197,94,0.4)' : 'none',
                  opacity: showResult && !isCorrect ? 0.35 : 1,
                  transition: 'all 0.3s',
                }}
              >
                <svg viewBox="0 0 100 100" style={{ width: '85%', height: '85%' }}>
                  <path d={d} fill="rgba(91,170,255,0.18)" stroke={showResult && isCorrect ? '#22c55e' : '#5baaff'} strokeWidth="1.6" />
                </svg>
                <span className="intel-mono absolute top-0.5 left-1" style={{ fontSize: 7, color: '#5baaff', fontWeight: 700 }}>
                  {String.fromCharCode(65 + i)}
                </span>
              </motion.div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
