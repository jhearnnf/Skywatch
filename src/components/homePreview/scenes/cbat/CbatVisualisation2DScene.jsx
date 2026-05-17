import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import CbatBg from './_cbatBg'

// Mirrors the real Visualisation 2D play: 3 prompt shapes with letter-labelled
// edges (top), 6 composite-shape choices (3×2 grid, bottom). The reveal
// echoes the real game's assembly animation — prompt pieces fly down to
// converge on the correct answer tile, where the welded composite resolves.
//
// The real reveal uses createPortal and measured DOM positions; here we use
// fixed grid coordinates because the scene's layout is known and stable.

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

const CHOICES = [
  'M 20 60 L 50 30 L 80 60 L 65 80 L 35 80 Z',
  'M 15 40 L 50 15 L 85 40 L 85 70 L 50 85 L 15 70 Z',  // 1 ✓ — top centre
  'M 20 30 L 80 30 L 80 70 L 50 90 L 20 70 Z',
  'M 30 25 L 70 25 L 80 50 L 70 75 L 30 75 L 20 50 Z',
  'M 20 50 L 50 20 L 80 50 L 50 80 Z',
  'M 25 30 L 75 30 L 75 80 L 25 80 Z',
]
const CORRECT = 1 // top row, centre column

// The real game's reveal *keeps the prompt pieces visible* — they fly into
// their welded positions inside the assembly and the player can see "these
// pieces, in this arrangement, are the answer". The preview mirrors that:
// shapes don't disappear; they assemble together so the user reads the
// final placement, with the correct answer tile glowing to confirm.
//
// Each prompt has a "snap" target — the position/rotation it lands at when
// the assembly resolves. The trio assembles into a tight horizontal weld
// directly under the prompt row, then the correct answer tile glows below.
const ASSEMBLY = [
  { dx: -38, dy: 14, rot: -12, scale: 0.85 }, // left  (rhombus tilts up-left)
  { dx:   0, dy: 18, rot:   0, scale: 0.95 }, // centre (triangle holds level)
  { dx:  38, dy: 14, rot:  12, scale: 0.85 }, // right (square tilts up-right)
]

// Caps tile height so the choices row stays compact and the assembly above
// (with z-index 30) stays the visual focal point.
const TILE_H = 56

export default function CbatVisualisation2DScene({ runKey }) {
  // 'study'    → prompts spread in the row, choices visible below
  // 'assembling' → prompts translate + rotate into their weld positions
  // 'revealed' → prompts hold in place; correct tile glows; others fade out
  const [phase, setPhase] = useState('study')
  useEffect(() => {
    setPhase('study')
    const t1 = setTimeout(() => setPhase('assembling'), 1300)
    const t2 = setTimeout(() => setPhase('revealed'),   2200)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [runKey])

  const assembled = phase === 'assembling' || phase === 'revealed'

  return (
    <div className="absolute inset-0 overflow-hidden">
      <CbatBg amber />
      <div className="absolute inset-0 px-4 pt-16 sm:pt-24 pb-3 flex flex-col items-center">

        {/* HUD */}
        <div className="flex justify-between items-center w-full mb-2 intel-mono" style={{ fontSize: 8 }}>
          <span style={{ color: '#5baaff', letterSpacing: '0.15em', fontWeight: 700 }}>ROUND 4 · 30s</span>
          <span style={{ color: '#fbbf24', letterSpacing: '0.15em', fontWeight: 700 }}>CORRECT 3</span>
        </div>

        {/* Prompt row — bigger than before so letters are legible. The shapes
            stay in this slot during 'study'; during 'flying' they translate
            via FLIGHT[] toward the correct tile's centre. */}
        <p className="intel-mono mb-2" style={{ fontSize: 9, color: '#cbd5e1', letterSpacing: '0.18em', fontWeight: 700, textTransform: 'uppercase' }}>
          Weld matching edges
        </p>
        <div className="flex gap-4 mb-2 relative" style={{ minHeight: 70, zIndex: 30 }}>
          {PROMPTS.map((p, i) => {
            const snap = ASSEMBLY[i]
            // 'study' = spread out (labels visible, easy to read)
            // 'assembling'/'revealed' = snapped to weld positions, slight
            //   rotate so the labelled edges face each other, labels fade
            //   (they've done their job).
            const animate = assembled
              ? { x: snap.dx, y: snap.dy, rotate: snap.rot, scale: snap.scale }
              : { x: 0, y: 0, rotate: 0, scale: 1 }
            return (
              <motion.svg
                key={i}
                animate={animate}
                transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                viewBox="0 0 100 100"
                style={{ width: 60, height: 60, overflow: 'visible', position: 'relative', zIndex: 30 }}
              >
                <path
                  d={p.d}
                  fill={phase === 'revealed' ? 'rgba(34,197,94,0.28)' : 'rgba(91,170,255,0.22)'}
                  stroke={phase === 'revealed' ? '#22c55e' : '#5baaff'}
                  strokeWidth="1.6"
                  style={{ transition: 'fill 0.35s, stroke 0.35s' }}
                />
                {p.labels.map((l, j) => (
                  <motion.text
                    key={j}
                    animate={{ opacity: assembled ? 0.25 : 1 }}
                    transition={{ duration: 0.5 }}
                    x={l.x}
                    y={l.y}
                    fill="#fff"
                    stroke="#06101e"
                    strokeWidth="0.8"
                    paintOrder="stroke"
                    fontFamily="ui-monospace, monospace"
                    fontSize="12"
                    fontWeight="700"
                    textAnchor="middle"
                    dominantBaseline="middle"
                  >
                    {l.t}
                  </motion.text>
                ))}
              </motion.svg>
            )
          })}
        </div>

        {/* 3×2 choice tiles — small thumbnails of the candidate composite
            figures. The correct tile glows green at reveal; the assembled
            prompts above are the actual "answer" the player sees. Other
            tiles fade so the eye lands on the correct one. */}
        <div className="grid grid-cols-3 gap-1.5 w-full">
          {CHOICES.map((d, i) => {
            const isCorrect = i === CORRECT
            const isRevealedCorrect = phase === 'revealed' && isCorrect
            return (
              <motion.div
                key={i}
                animate={isRevealedCorrect ? { scale: [1, 1.12, 1.06] } : {}}
                transition={{ duration: 0.6 }}
                className="rounded-lg relative flex items-center justify-center"
                style={{
                  height: TILE_H,
                  background: isRevealedCorrect ? 'rgba(34,197,94,0.22)' : '#0a1628',
                  border: `1.5px solid ${isRevealedCorrect ? '#22c55e' : '#1a3a5c'}`,
                  boxShadow: isRevealedCorrect ? '0 0 18px rgba(34,197,94,0.55)' : 'none',
                  opacity: phase === 'revealed' && !isCorrect ? 0.25 : 1,
                  transition: 'background 0.3s, border-color 0.3s, opacity 0.3s, box-shadow 0.3s',
                }}
              >
                <svg
                  viewBox="0 0 100 100"
                  style={{ width: '80%', height: '80%' }}
                >
                  <path
                    d={d}
                    fill={isRevealedCorrect ? 'rgba(34,197,94,0.28)' : 'rgba(91,170,255,0.15)'}
                    stroke={isRevealedCorrect ? '#22c55e' : '#5baaff'}
                    strokeWidth="1.6"
                    style={{ transition: 'fill 0.35s, stroke 0.35s' }}
                  />
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
