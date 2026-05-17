import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import CbatBg from './_cbatBg'
import {
  layoutComposite,
  regularPolygonVertices,
  SHAPES,
  bbox,
} from '../../../../utils/cbat/visualisation2DPuzzle'

// Mirrors the real Visualisation 2D reveal: prompt pieces fly into the correct
// answer tile and assemble into the welded composite. Uses the SAME geometry
// helpers the real game uses (`layoutComposite`, `regularPolygonVertices`).
//
// Animation approach: each polygon's `points` attribute is interpolated from
// its prompt-row position to its laid composite position. Vertices tween
// individually, so welded edges meet *exactly* in the laid state — no
// SVG rotate/scale + transform-origin guessing.

const PUZZLE = {
  shapes: [
    { key: 'pentagon' },
    { key: 'square'   },
    { key: 'triangle' },
  ],
  welds: [
    { shapeAIdx: 0, shapeBIdx: 1, edgeA: 1, edgeB: 3, letter: 'A' },
    { shapeAIdx: 1, shapeBIdx: 2, edgeA: 1, edgeB: 1, letter: 'B' },
  ],
}

const LAID = layoutComposite(PUZZLE.shapes, PUZZLE.welds)
const LAID_BBOX = bbox(LAID)
const LAID_CX = (LAID_BBOX.minX + LAID_BBOX.maxX) / 2
const LAID_CY = (LAID_BBOX.minY + LAID_BBOX.maxY) / 2

// Scene coordinate system.
const VB_W = 320
const VB_H = 240
const PROMPT_Y = 28
const TILE_W = 80
const TILE_H = 50
const TILE_GAP = 10
const TILE_ROW_Y = [115, 115 + TILE_H + TILE_GAP]
const TILE_COL_X = [VB_W / 2 - (TILE_W + TILE_GAP), VB_W / 2, VB_W / 2 + (TILE_W + TILE_GAP)]
const CORRECT_CX = TILE_COL_X[1]
const CORRECT_CY = TILE_ROW_Y[0]

const PROMPT_SCALE   = 0.40
const ASSEMBLY_SCALE = 0.36

const N = PUZZLE.shapes.length
const PROMPT_XS = PUZZLE.shapes.map((_, i) => (i + 1) * (VB_W / (N + 1)))

// For each piece, compute:
//   - canonicalVerts: vertex coords centred on the piece's own centroid
//   - promptPoints:   the `points` string for this piece in the prompt row
//   - stagePoints:    the `points` string for this piece in the laid composite
//   - labels:         welded-edge letters this piece carries (one per weld)
const PIECES = PUZZLE.shapes.map((s, i) => {
  const sides = SHAPES[s.key].sides
  const canonical = regularPolygonVertices(sides)
  const promptCX = PROMPT_XS[i]
  const promptCY = PROMPT_Y
  const promptPoints = canonical
    .map(v => `${(promptCX + v.x * PROMPT_SCALE).toFixed(3)},${(promptCY + v.y * PROMPT_SCALE).toFixed(3)}`)
    .join(' ')
  const laidVerts = LAID[i].vertices
  const stagePoints = laidVerts
    .map(v => {
      const x = CORRECT_CX + (v.x - LAID_CX) * ASSEMBLY_SCALE
      const y = CORRECT_CY + (v.y - LAID_CY) * ASSEMBLY_SCALE
      return `${x.toFixed(3)},${y.toFixed(3)}`
    })
    .join(' ')
  // Letters: each weld is "owned" by the lower-indexed shape so only one
  // letter renders per weld. Positioned just outside the labelled edge,
  // matching the real PromptShape rendering.
  const labels = PUZZLE.welds
    .filter(w => Math.min(w.shapeAIdx, w.shapeBIdx) === i)
    .map(w => {
      const edge = w.shapeAIdx === i ? w.edgeA : w.edgeB
      const v0 = canonical[edge]
      const v1 = canonical[(edge + 1) % sides]
      const mx = (v0.x + v1.x) / 2
      const my = (v0.y + v1.y) / 2
      const len = Math.hypot(mx, my) || 1
      const off = 14
      const lx = mx + (mx / len) * off
      const ly = my + (my / len) * off
      // Convert to prompt-row coords (the only place letters are visible).
      return {
        letter: w.letter,
        x: promptCX + lx * PROMPT_SCALE,
        y: promptCY + ly * PROMPT_SCALE,
      }
    })
  return { sides, promptPoints, stagePoints, labels }
})

// Decorative distractor silhouettes for the 5 wrong tiles. Drawn in a 0–100
// box, rendered via SVG transform to the tile's pixel size.
const DISTRACTOR_PATHS = [
  'M 25 70 L 50 30 L 75 30 L 75 70 Z',
  'M 20 50 L 50 20 L 80 50 L 50 80 Z',
  'M 25 35 L 75 35 L 60 70 L 40 70 Z',
  'M 30 60 L 50 30 L 70 60 L 60 80 L 40 80 Z',
  'M 20 40 L 80 40 L 60 80 L 40 80 Z',
]

const TILES = [
  { row: 0, col: 0, distractor: 0, correct: false },
  { row: 0, col: 1, distractor: null, correct: true },
  { row: 0, col: 2, distractor: 1, correct: false },
  { row: 1, col: 0, distractor: 2, correct: false },
  { row: 1, col: 1, distractor: 3, correct: false },
  { row: 1, col: 2, distractor: 4, correct: false },
]

export default function CbatVisualisation2DScene({ runKey }) {
  const [phase, setPhase] = useState('study')
  useEffect(() => {
    setPhase('study')
    const t1 = setTimeout(() => setPhase('flying'),   1100)
    const t2 = setTimeout(() => setPhase('revealed'), 2100)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [runKey])

  const assembled = phase !== 'study'
  const accentColor = phase === 'revealed' ? '#22c55e' : '#5baaff'

  return (
    <div className="absolute inset-0 overflow-hidden">
      <CbatBg amber />
      <div className="absolute inset-0 px-4 pt-16 sm:pt-24 pb-3 flex flex-col items-center">

        <div className="flex justify-between items-center w-full mb-2 intel-mono" style={{ fontSize: 8 }}>
          <span style={{ color: '#5baaff', letterSpacing: '0.15em', fontWeight: 700 }}>ROUND 4 · 30s</span>
          <span style={{ color: '#fbbf24', letterSpacing: '0.15em', fontWeight: 700 }}>CORRECT 3</span>
        </div>

        <p
          className="intel-mono mb-1"
          style={{
            fontSize: 9,
            color: phase === 'revealed' ? '#86efac' : '#cbd5e1',
            letterSpacing: '0.18em',
            fontWeight: 700,
            textTransform: 'uppercase',
            transition: 'color 0.4s',
          }}
        >
          {phase === 'revealed' ? '✓ Welded into answer B' : 'Pick the welded composite'}
        </p>

        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="xMidYMid meet"
          className="w-full"
          style={{ flex: 1, maxHeight: '100%', overflow: 'visible' }}
        >
          {/* Choice tiles render first so prompt pieces appear over them */}
          {TILES.map((tile, i) => {
            const x = TILE_COL_X[tile.col] - TILE_W / 2
            const y = TILE_ROW_Y[tile.row] - TILE_H / 2
            const isRevealedCorrect = phase === 'revealed' && tile.correct
            const isFaded = phase === 'revealed' && !tile.correct
            return (
              <g key={i} opacity={isFaded ? 0.25 : 1} style={{ transition: 'opacity 0.3s' }}>
                <rect
                  x={x} y={y}
                  width={TILE_W} height={TILE_H}
                  rx={6}
                  fill={isRevealedCorrect ? 'rgba(34,197,94,0.18)' : '#0a1628'}
                  stroke={isRevealedCorrect ? '#22c55e' : '#1a3a5c'}
                  strokeWidth={1.5}
                  style={{ transition: 'fill 0.3s, stroke 0.3s' }}
                />
                {tile.distractor !== null && (
                  <path
                    d={DISTRACTOR_PATHS[tile.distractor]}
                    transform={`translate(${x + TILE_W / 2 - TILE_W * 0.4}, ${y + TILE_H / 2 - TILE_H * 0.4}) scale(${TILE_W * 0.008}, ${TILE_H * 0.008})`}
                    fill="rgba(91,170,255,0.15)"
                    stroke="#5baaff"
                    strokeWidth={1.6}
                  />
                )}
                <text
                  x={x + 5} y={y + 10}
                  fontSize="7" fontWeight="700"
                  fill="#5baaff" fontFamily="ui-monospace, monospace"
                >
                  {String.fromCharCode(65 + i)}
                </text>
              </g>
            )
          })}

          {/* Reveal glow rings */}
          {phase === 'revealed' && (
            <>
              <motion.circle
                key={`g1-${runKey}`}
                cx={CORRECT_CX} cy={CORRECT_CY}
                fill="none" stroke="#22c55e" strokeWidth="1.5"
                initial={{ r: 6, opacity: 0.9 }}
                animate={{ r: 50, opacity: 0 }}
                transition={{ duration: 1.2, ease: 'easeOut' }}
              />
              <motion.circle
                key={`g2-${runKey}`}
                cx={CORRECT_CX} cy={CORRECT_CY}
                fill="none" stroke="#22c55e" strokeWidth="1"
                initial={{ r: 6, opacity: 0 }}
                animate={{ r: 75, opacity: [0, 0.4, 0] }}
                transition={{ duration: 1.2, ease: 'easeOut', delay: 0.2 }}
              />
            </>
          )}

          {/* Pieces — each polygon's vertices interpolate from prompt to laid
              position. By construction, welded edges meet exactly. */}
          {PIECES.map((piece, i) => (
            <motion.polygon
              key={i}
              initial={false}
              animate={{ points: assembled ? piece.stagePoints : piece.promptPoints }}
              fill={`${accentColor}38`}
              stroke={accentColor}
              strokeWidth="1.6"
              strokeLinejoin="round"
              transition={{
                duration: 0.7,
                delay: phase === 'flying' ? i * 0.1 : 0,
                ease: [0.16, 1, 0.3, 1],
              }}
              style={{ transition: 'stroke 0.35s, fill 0.35s' }}
            />
          ))}

          {/* Prompt-row letter labels — fade out as pieces fly. Only render
              while in 'study' so we don't drag them across the screen. */}
          {!assembled && PIECES.flatMap((piece, i) =>
            piece.labels.map((l, j) => (
              <motion.text
                key={`l-${i}-${j}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                x={l.x} y={l.y}
                textAnchor="middle" dominantBaseline="central"
                fontSize="10" fontWeight="700" fill="#5baaff"
                style={{ paintOrder: 'stroke', stroke: '#06101e', strokeWidth: 3 }}
              >
                {l.letter}
              </motion.text>
            ))
          )}
        </svg>
      </div>
    </div>
  )
}
