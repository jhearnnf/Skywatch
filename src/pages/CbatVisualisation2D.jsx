import { useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { recordCbatStart } from '../utils/cbat/recordStart'
import { useGameChrome } from '../context/GameChromeContext'
import SEO from '../components/SEO'
import {
  buildRounds,
  regularPolygonVertices,
  rotateVerts,
  SHAPES,
} from '../utils/cbat/visualisation2DPuzzle'

const TOTAL_ROUNDS = 8
const ROUND_TIMER_S = 30
// Animation timing — out-expo "click into place" feel.
const ANIM_DELAY_MS   = 150  // brief pause so the green/red feedback flash registers first
const ANIM_FLIGHT_MS  = 600  // per-shape flight duration
const ANIM_STAGGER_MS = 90   // delay between successive shapes
// When the assembly animation finishes (last piece + last stagger + flight),
// reveal the Next button. Conservative buffer so it never appears mid-flight.
const NEXT_REVEAL_S = (ANIM_DELAY_MS + 4 * ANIM_STAGGER_MS + ANIM_FLIGHT_MS + 80) / 1000

// ── SVG helpers ──────────────────────────────────────────────────────────────

const STROKE = '#5baaff'
const FILL   = 'rgba(91,170,255,0.18)'
const LABEL_OFFSET = 14

function svgViewBox(verts, pad = 18) {
  if (!verts.length) return '0 0 100 100'
  const minX = Math.min(...verts.map(v => v.x)) - pad
  const minY = Math.min(...verts.map(v => v.y)) - pad
  const maxX = Math.max(...verts.map(v => v.x)) + pad
  const maxY = Math.max(...verts.map(v => v.y)) + pad
  return `${minX} ${minY} ${maxX - minX} ${maxY - minY}`
}

// One prompt shape with its letter labels.
function PromptShape({ shape, rotation, labels, svgRef }) {
  const verts = rotateVerts(regularPolygonVertices(SHAPES[shape.key].sides), rotation)
  const points = verts.map(v => `${v.x},${v.y}`).join(' ')
  const sides = verts.length
  return (
    <svg
      ref={svgRef}
      viewBox={svgViewBox(verts, 22)}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      className="block"
      style={{ overflow: 'visible' }}
    >
      <polygon points={points} fill={FILL} stroke={STROKE} strokeWidth={2} strokeLinejoin="round" />
      {labels.map(({ edge, letter }) => {
        const v0 = verts[edge]
        const v1 = verts[(edge + 1) % sides]
        const mx = (v0.x + v1.x) / 2
        const my = (v0.y + v1.y) / 2
        const len = Math.hypot(mx, my) || 1
        const lx = mx + (mx / len) * LABEL_OFFSET
        const ly = my + (my / len) * LABEL_OFFSET
        return (
          <text
            key={edge}
            x={lx}
            y={ly}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="14"
            fontWeight="700"
            fill="#5baaff"
            style={{ paintOrder: 'stroke', stroke: '#06101e', strokeWidth: 3 }}
          >
            {letter}
          </text>
        )
      })}
    </svg>
  )
}

// A welded composite — render each polygon's fill, then draw stroke only on
// outer (non-welded) edges so the union reads as a single connected shape.
function CompositeShape({ layout, svgRef }) {
  const allVerts = layout.flatMap(p => p.vertices)
  const polygons = layout.map((piece, i) => {
    const pts = piece.vertices.map(v => `${v.x.toFixed(2)},${v.y.toFixed(2)}`).join(' ')
    return <polygon key={i} points={pts} fill={FILL} stroke="none" />
  })
  const outerLines = []
  layout.forEach((piece, i) => {
    const sides = piece.vertices.length
    for (let e = 0; e < sides; e++) {
      if (piece.weldedEdges.has(e)) continue
      const v0 = piece.vertices[e]
      const v1 = piece.vertices[(e + 1) % sides]
      outerLines.push(
        <line
          key={`${i}-${e}`}
          x1={v0.x}
          y1={v0.y}
          x2={v1.x}
          y2={v1.y}
          stroke={STROKE}
          strokeWidth={2}
          strokeLinecap="round"
        />
      )
    }
  })
  return (
    <svg
      ref={svgRef}
      viewBox={svgViewBox(allVerts, 14)}
      width="100%"
      height="100%"
      className="block"
      style={{ maxWidth: '100%', maxHeight: '100%' }}
      preserveAspectRatio="xMidYMid meet"
    >
      {polygons}
      {outerLines}
    </svg>
  )
}

// ── Assembly animation ──────────────────────────────────────────────────────
// Pieces and letters animate as separate top-level motion.divs so letters
// can stay upright (no rotation) and so we can render exactly one letter per
// weld (no duplicates across the welded pair).

function AnimatedPiece({ shape }) {
  const verts = regularPolygonVertices(SHAPES[shape.key].sides)
  const points = verts.map(v => `${v.x.toFixed(2)},${v.y.toFixed(2)}`).join(' ')
  return (
    <polygon points={points} fill={FILL} stroke={STROKE} strokeWidth={2} strokeLinejoin="round" />
  )
}

// Each piece gets its own absolutely-positioned motion.div carrying an SVG
// whose viewBox is centred at (0,0). This puts the polygon centroid exactly
// at the div's centre, where HTML's default `transform-origin: 50% 50%` lives,
// so rotation and scale pivot around the centroid for *every* shape — no
// transformBox tricks needed and no per-shape bbox offsets to compensate for.
const ANIM_SLOT = 200
const ANIM_HALF = ANIM_SLOT / 2
// Letter overlay box — small, just enough for the glyph + stroke outline.
const LETTER_SLOT = 30
const LETTER_HALF = LETTER_SLOT / 2

function AssemblyAnimation({ data }) {
  if (!data || !data.pieces || !data.pieces.length || typeof document === 'undefined') return null
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 60 }}>
      {/* Shape bodies — rotate + scale */}
      {data.pieces.map((d, i) => (
        <motion.div
          key={`piece-${i}`}
          initial={{
            x: d.src.x - ANIM_HALF,
            y: d.src.y - ANIM_HALF,
            rotate: d.src.rotateDeg,
            scale: d.src.scale,
          }}
          animate={{
            x: d.tgt.x - ANIM_HALF,
            y: d.tgt.y - ANIM_HALF,
            rotate: d.tgt.rotateDeg,
            scale: d.tgt.scale,
          }}
          transition={{
            duration: ANIM_FLIGHT_MS / 1000,
            delay: (ANIM_DELAY_MS + i * ANIM_STAGGER_MS) / 1000,
            ease: [0.16, 1, 0.3, 1],
          }}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: ANIM_SLOT,
            height: ANIM_SLOT,
            transformOrigin: '50% 50%',
            willChange: 'transform',
          }}
        >
          <svg
            viewBox={`${-ANIM_HALF} ${-ANIM_HALF} ${ANIM_SLOT} ${ANIM_SLOT}`}
            width={ANIM_SLOT}
            height={ANIM_SLOT}
            style={{ overflow: 'visible', display: 'block' }}
          >
            <AnimatedPiece shape={d.shape} />
          </svg>
        </motion.div>
      ))}

      {/* Letters — translate + scale only (no rotate), one per weld */}
      {data.letters.map((d, i) => (
        <motion.div
          key={`letter-${i}`}
          initial={{
            x: d.src.x - LETTER_HALF,
            y: d.src.y - LETTER_HALF,
            scale: d.src.scale,
          }}
          animate={{
            x: d.tgt.x - LETTER_HALF,
            y: d.tgt.y - LETTER_HALF,
            scale: d.tgt.scale,
          }}
          transition={{
            duration: ANIM_FLIGHT_MS / 1000,
            delay: (ANIM_DELAY_MS + d.carrierIdx * ANIM_STAGGER_MS) / 1000,
            ease: [0.16, 1, 0.3, 1],
          }}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: LETTER_SLOT,
            height: LETTER_SLOT,
            transformOrigin: '50% 50%',
            willChange: 'transform',
          }}
        >
          <svg
            viewBox={`${-LETTER_HALF} ${-LETTER_HALF} ${LETTER_SLOT} ${LETTER_SLOT}`}
            width={LETTER_SLOT}
            height={LETTER_SLOT}
            style={{ overflow: 'visible', display: 'block' }}
          >
            <text
              x={0}
              y={0}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={14}
              fontWeight={700}
              fill="#5baaff"
              style={{ paintOrder: 'stroke', stroke: '#06101e', strokeWidth: 3 }}
            >
              {d.letter}
            </text>
          </svg>
        </motion.div>
      ))}
    </div>,
    document.body,
  )
}

// Compute viewport-px source/target transforms for each prompt shape, plus
// one letter per weld carried by the lower-index shape so the welded pair
// produces a single label (no duplicates) at the seam in the final figure.
function computeAnimationData(round, correctIdx, promptSvgs, tileSvgs) {
  if (!round) return null
  const tileSvg = tileSvgs[correctIdx]
  if (!tileSvg) return null
  const tileCtm = tileSvg.getScreenCTM()
  if (!tileCtm) return null
  const targetScale = Math.hypot(tileCtm.a, tileCtm.b)
  const correctLayout = round.choices[correctIdx].layout

  // Cache CTM/scale per prompt shape — used by both pieces and letters.
  const srcCtms = []
  const srcScales = []
  for (let i = 0; i < round.shapes.length; i++) {
    const promptSvg = promptSvgs[i]
    if (!promptSvg) return null
    const ctm = promptSvg.getScreenCTM()
    if (!ctm) return null
    srcCtms.push(ctm)
    srcScales.push(Math.hypot(ctm.a, ctm.b))
  }

  const pieces = []
  for (let i = 0; i < round.shapes.length; i++) {
    const srcCtm = srcCtms[i]
    const sourceScale = srcScales[i]
    const sourceX = srcCtm.e
    const sourceY = srcCtm.f
    const srcDeg  = (round.promptRotations[i] * 180 / Math.PI) % 360

    const piece = correctLayout[i]
    const verts = piece.vertices
    const cx = verts.reduce((s, v) => s + v.x, 0) / verts.length
    const cy = verts.reduce((s, v) => s + v.y, 0) / verts.length
    // Recover the rigid rotation the layout BFS applied to this piece —
    // canonical v0 sits at (0, -R); after rotation θ it lands at
    // (R sin θ, -R cos θ), so θ = atan2(v0.x − cx, cy − v0.y).
    const v0 = verts[0]
    const targetRotRad = Math.atan2(v0.x - cx, cy - v0.y)
    let tgtDeg = (targetRotRad * 180 / Math.PI) % 360
    while (tgtDeg - srcDeg >  180) tgtDeg -= 360
    while (tgtDeg - srcDeg < -180) tgtDeg += 360

    const tgtX = tileCtm.a * cx + tileCtm.c * cy + tileCtm.e
    const tgtY = tileCtm.b * cx + tileCtm.d * cy + tileCtm.f

    pieces.push({
      shape: round.shapes[i],
      src: { x: sourceX, y: sourceY, rotateDeg: srcDeg, scale: sourceScale },
      tgt: { x: tgtX,    y: tgtY,    rotateDeg: tgtDeg, scale: targetScale },
    })
  }

  // One letter per weld — owned by the lower-index shape.
  const letters = []
  for (const w of round.welds) {
    const carrierIdx = Math.min(w.shapeAIdx, w.shapeBIdx)
    const carrierEdge = (carrierIdx === w.shapeAIdx) ? w.edgeA : w.edgeB
    const carrierShape = round.shapes[carrierIdx]
    const sides = SHAPES[carrierShape.key].sides
    const canonicalVerts = regularPolygonVertices(sides)

    // Source: canonical edge midpoint + outward offset, rotated by the
    // carrier's prompt rotation, mapped to viewport via the prompt SVG CTM.
    const cv0 = canonicalVerts[carrierEdge]
    const cv1 = canonicalVerts[(carrierEdge + 1) % sides]
    const cmx = (cv0.x + cv1.x) / 2
    const cmy = (cv0.y + cv1.y) / 2
    const clen = Math.hypot(cmx, cmy) || 1
    const clx = cmx + (cmx / clen) * LABEL_OFFSET
    const cly = cmy + (cmy / clen) * LABEL_OFFSET
    const rot = round.promptRotations[carrierIdx]
    const rc = Math.cos(rot), rs = Math.sin(rot)
    const promptX = clx * rc - cly * rs
    const promptY = clx * rs + cly * rc
    const carrierSrcCtm = srcCtms[carrierIdx]
    const srcLetterX = carrierSrcCtm.a * promptX + carrierSrcCtm.c * promptY + carrierSrcCtm.e
    const srcLetterY = carrierSrcCtm.b * promptX + carrierSrcCtm.d * promptY + carrierSrcCtm.f

    // Target: midpoint + outward offset of the carrier's *laid* edge, mapped
    // to viewport via the tile SVG CTM. Outward = midpoint − laid centroid.
    const laidPiece = correctLayout[carrierIdx]
    const lv = laidPiece.vertices
    const ln = lv.length
    const lcx = lv.reduce((s, v) => s + v.x, 0) / ln
    const lcy = lv.reduce((s, v) => s + v.y, 0) / ln
    const lv0 = lv[carrierEdge]
    const lv1 = lv[(carrierEdge + 1) % ln]
    const lmx = (lv0.x + lv1.x) / 2
    const lmy = (lv0.y + lv1.y) / 2
    const lox = lmx - lcx
    const loy = lmy - lcy
    const llen = Math.hypot(lox, loy) || 1
    const tileLetterX = lmx + (lox / llen) * LABEL_OFFSET
    const tileLetterY = lmy + (loy / llen) * LABEL_OFFSET
    const tgtLetterX = tileCtm.a * tileLetterX + tileCtm.c * tileLetterY + tileCtm.e
    const tgtLetterY = tileCtm.b * tileLetterX + tileCtm.d * tileLetterY + tileCtm.f

    letters.push({
      letter: w.letter,
      carrierIdx,
      src: { x: srcLetterX, y: srcLetterY, scale: srcScales[carrierIdx] },
      tgt: { x: tgtLetterX, y: tgtLetterY, scale: targetScale },
    })
  }

  return { pieces, letters }
}

// ── Results screen ───────────────────────────────────────────────────────────
function ResultsScreen({ answers, totalTime, onPlayAgain, scoreSaved }) {
  const correct = answers.filter(a => a.correct).length
  const pct = Math.round((correct / TOTAL_ROUNDS) * 100)
  const tierCorrect = [0, 1].map(t => ({
    total: answers.filter(a => a.tier === t).length,
    correct: answers.filter(a => a.tier === t && a.correct).length,
  }))
  const correctTimes = answers.filter(a => a.correct).map(a => a.roundTime)
  const avgTime = correctTimes.length
    ? correctTimes.reduce((s, v) => s + v, 0) / correctTimes.length
    : 0

  const grade = pct >= 90 ? { label: 'Outstanding', emoji: '\u{1F396}️', color: 'text-green-400' }
    : pct >= 70 ? { label: 'Good', emoji: '✈️', color: 'text-brand-300' }
    : pct >= 50 ? { label: 'Needs Work', emoji: '\u{1F527}', color: 'text-amber-400' }
    : { label: 'Failed', emoji: '\u{1F4A5}', color: 'text-red-400' }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="w-full max-w-md bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-8 text-center"
    >
      <p className="text-5xl mb-3">{grade.emoji}</p>
      <p className={`text-2xl font-extrabold mb-1 ${grade.color}`}>{grade.label}</p>
      <p className="text-sm text-slate-400 mb-6">Visualisation Complete</p>

      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-5 mb-4">
        <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">Overall Score</p>
        <div className="flex justify-center gap-8 items-end">
          <div>
            <p className="text-4xl font-mono font-bold text-brand-300 mb-1">{pct}%</p>
            <p className="text-sm text-slate-400">{correct} / {TOTAL_ROUNDS} correct</p>
          </div>
          <div className="w-px h-12 bg-[#1a3a5c]" />
          <div>
            <p className="text-4xl font-mono font-bold text-brand-300 mb-1">{totalTime.toFixed(1)}s</p>
            <p className="text-sm text-slate-400">total time</p>
          </div>
        </div>
        {correctTimes.length > 0 && (
          <p className="text-xs text-slate-500 mt-3">
            Avg solve time: <span className="text-brand-300 font-mono">{avgTime.toFixed(2)}s</span>
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 mb-6">
        {['Tier 1', 'Tier 2'].map((label, i) => (
          <div key={i} className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">{label}</p>
            <p className="text-xl font-mono font-bold text-brand-300">
              {tierCorrect[i].correct}/{tierCorrect[i].total}
            </p>
          </div>
        ))}
      </div>

      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 mb-6 max-h-48 overflow-y-auto">
        <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-2 sticky top-0 bg-[#060e1a]">Round Review</p>
        <div className="space-y-1">
          {answers.map((a, i) => (
            <div key={i} className={`flex items-center justify-between text-xs px-2 py-1 rounded ${a.correct ? 'text-green-400' : 'text-red-400'}`}>
              <span className="text-slate-500 w-6 text-left">#{i + 1}</span>
              <span>{a.correct ? '✓' : '✗'}</span>
              <span className="font-mono text-slate-500">
                {a.timedOut ? 'time-out' : a.correct ? `${a.roundTime.toFixed(2)}s` : 'wrong'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {scoreSaved && (
        <p className="text-xs text-green-400 mb-4">{'✓'} Score saved</p>
      )}

      <div className="flex flex-wrap gap-3 justify-center">
        <button
          onClick={onPlayAgain}
          className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-lg transition-colors"
        >
          Play Again
        </button>
        <Link
          to="/cbat/visualisation-2d/leaderboard"
          className="px-5 py-2.5 bg-[#1a3a5c] hover:bg-[#254a6e] text-[#ddeaf8] text-sm font-bold rounded-lg transition-colors no-underline"
        >
          {'\u{1F3C6}'} Leaderboard
        </Link>
      </div>
    </motion.div>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function CbatVisualisation2D() {
  const { user, apiFetch, API } = useAuth()

  const [phase, setPhase] = useState('intro') // intro | playing | feedback | results
  const { enterImmersive, exitImmersive } = useGameChrome()
  useEffect(() => {
    if (phase === 'playing' || phase === 'feedback') enterImmersive()
    else exitImmersive()
    return exitImmersive
  }, [phase, enterImmersive, exitImmersive])

  // Mobile scroll lock — only active while a round is in progress so the
  // intro/results screens still scroll normally on short phones.
  useEffect(() => {
    const active = phase === 'playing' || phase === 'feedback'
    if (active) {
      document.body.classList.add('cbat-vis2d-locked')
      return () => document.body.classList.remove('cbat-vis2d-locked')
    }
  }, [phase])

  const [rounds, setRounds] = useState([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [answers, setAnswers] = useState([])
  const [pickedIdx, setPickedIdx] = useState(null)
  const [wasCorrect, setWasCorrect] = useState(null)
  const [lastRoundTime, setLastRoundTime] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [roundTimeLeft, setRoundTimeLeft] = useState(ROUND_TIMER_S)
  const timerRef = useRef(null)
  const startTimeRef = useRef(null)
  const roundStartRef = useRef(0)
  const advanceTimeoutRef = useRef(null)
  const roundTimeoutRef = useRef(null)
  const [personalBest, setPersonalBest] = useState(null)
  const [scoreSaved, setScoreSaved] = useState(false)
  const [animationData, setAnimationData] = useState(null)
  const promptSvgRefs = useRef([])
  const tileSvgRefs = useRef([])

  // Personal best
  useEffect(() => {
    if (!user) return
    apiFetch(`${API}/api/games/cbat/visualisation-2d/personal-best`)
      .then(r => r.json())
      .then(d => { if (d.data) setPersonalBest(d.data) })
      .catch(() => {})
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  const submitScore = useCallback((finalAnswers, finalTime) => {
    const correct = finalAnswers.filter(a => a.correct).length
    const pct = Math.round((correct / TOTAL_ROUNDS) * 100)
    const tier1 = finalAnswers.filter(a => a.tier === 0 && a.correct).length
    const tier2 = finalAnswers.filter(a => a.tier === 1 && a.correct).length
    const grade = pct >= 90 ? 'Outstanding' : pct >= 70 ? 'Good' : pct >= 50 ? 'Needs Work' : 'Failed'

    setScoreSaved(false)
    apiFetch(`${API}/api/games/cbat/visualisation-2d/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        correctCount: correct,
        tier1Correct: tier1,
        tier2Correct: tier2,
        totalTime: finalTime,
        grade,
      }),
    })
      .then(r => r.json())
      .then(() => {
        setScoreSaved(true)
        apiFetch(`${API}/api/games/cbat/visualisation-2d/personal-best`)
          .then(r => r.json())
          .then(d => { if (d.data) setPersonalBest(d.data) })
          .catch(() => {})
      })
      .catch(() => {})
  }, [apiFetch, API])

  const currentRound = rounds[currentIdx] || null

  // Total elapsed timer — runs only during 'playing' so the user isn't
  // penalised for studying the assembly animation or pausing on the
  // post-round screen before pressing Next.
  useEffect(() => {
    if (phase === 'playing') {
      const offset = elapsed * 1000
      const t0 = Date.now() - offset
      startTimeRef.current = t0
      timerRef.current = setInterval(() => {
        setElapsed((Date.now() - t0) / 1000)
      }, 100)
      return () => clearInterval(timerRef.current)
    } else {
      clearInterval(timerRef.current)
    }
  }, [phase]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      if (advanceTimeoutRef.current) clearTimeout(advanceTimeoutRef.current)
      if (roundTimeoutRef.current) clearInterval(roundTimeoutRef.current)
    }
  }, [])

  const handlePick = useCallback((choiceIdx, opts = {}) => {
    if (phase !== 'playing') return
    const round = rounds[currentIdx]
    if (!round) return

    // Capture animation source/target transforms BEFORE flipping to 'feedback' —
    // we hide the correct tile's static composite during feedback, which
    // unmounts its <svg> and nulls its ref. Compute the CTMs while refs are
    // still mounted.
    const animData = computeAnimationData(
      round,
      round.correctIdx,
      promptSvgRefs.current,
      tileSvgRefs.current,
    )

    const correct = !opts.timedOut && choiceIdx === round.correctIdx
    const roundTime = elapsed - roundStartRef.current
    const newAnswers = [
      ...answers,
      {
        correct,
        pickedIdx: choiceIdx,
        correctIdx: round.correctIdx,
        roundTime,
        tier: round.tier,
        timedOut: !!opts.timedOut,
      },
    ]
    setAnswers(newAnswers)
    setPickedIdx(opts.timedOut ? null : choiceIdx)
    setWasCorrect(correct)
    setLastRoundTime(roundTime)
    setAnimationData(animData)
    setPhase('feedback')
  }, [phase, rounds, currentIdx, answers, elapsed])

  const handleNext = useCallback(() => {
    if (phase !== 'feedback') return
    const nextIdx = currentIdx + 1
    if (nextIdx >= TOTAL_ROUNDS) {
      submitScore(answers, elapsed)
      setAnimationData(null)
      setPhase('results')
      return
    }
    setCurrentIdx(nextIdx)
    setPickedIdx(null)
    setWasCorrect(null)
    setAnimationData(null)
    setPhase('playing')
  }, [phase, currentIdx, answers, elapsed, submitScore])

  // Stash handlePick in a ref so the round-timer effect doesn't tear down and
  // restart every time `elapsed` changes (which would reset the 30s deadline
  // every tick and the timer would never expire).
  const handlePickRef = useRef(handlePick)
  useEffect(() => { handlePickRef.current = handlePick }, [handlePick])

  // Per-round 30s timer.
  useEffect(() => {
    if (phase !== 'playing') return
    const deadline = Date.now() + ROUND_TIMER_S * 1000
    setRoundTimeLeft(ROUND_TIMER_S)
    roundTimeoutRef.current = setInterval(() => {
      const left = (deadline - Date.now()) / 1000
      if (left <= 0) {
        clearInterval(roundTimeoutRef.current)
        setRoundTimeLeft(0)
        handlePickRef.current(-1, { timedOut: true })
      } else {
        setRoundTimeLeft(left)
      }
    }, 100)
    return () => clearInterval(roundTimeoutRef.current)
  }, [phase, currentIdx])

  const startGame = useCallback(() => {
    recordCbatStart('visualisation-2d', apiFetch, API)
    setRounds(buildRounds(TOTAL_ROUNDS))
    setCurrentIdx(0)
    setAnswers([])
    setPickedIdx(null)
    setWasCorrect(null)
    setLastRoundTime(0)
    setElapsed(0)
    setAnimationData(null)
    roundStartRef.current = 0
    setPhase('playing')
  }, [apiFetch, API])

  const goToIntro = useCallback(() => {
    clearInterval(timerRef.current)
    if (advanceTimeoutRef.current) clearTimeout(advanceTimeoutRef.current)
    if (roundTimeoutRef.current) clearInterval(roundTimeoutRef.current)
    setPhase('intro')
    setRounds([])
    setCurrentIdx(0)
    setAnswers([])
    setPickedIdx(null)
    setWasCorrect(null)
    setElapsed(0)
    setScoreSaved(false)
    setAnimationData(null)
  }, [])

  // Reset per-round start timestamp when a new round begins.
  useEffect(() => {
    if (phase === 'playing') roundStartRef.current = elapsed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx, phase])

  // Edges + letters per shape, looked up from the round's welds.
  const labelsForShape = useCallback((shapeIdx) => {
    if (!currentRound) return []
    return currentRound.welds.flatMap(w => {
      if (w.shapeAIdx === shapeIdx) return [{ edge: w.edgeA, letter: w.letter }]
      if (w.shapeBIdx === shapeIdx) return [{ edge: w.edgeB, letter: w.letter }]
      return []
    })
  }, [currentRound])

  return (
    <div className="cbat-visualisation-2d-page">
      <SEO title="Visualisation 2D — CBAT" description="Mentally weld labelled shapes into the correct final figure." />

      <div className="flex items-center gap-2 mb-2">
        {phase === 'intro'
          ? <Link to="/cbat" className="text-slate-500 hover:text-brand-400 transition-colors text-sm">&larr; CBAT</Link>
          : <button onClick={goToIntro} className="text-slate-500 hover:text-brand-400 transition-colors text-sm bg-transparent border-0 p-0 cursor-pointer">&larr; Instructions</button>
        }
        <h1 className="text-sm font-extrabold text-slate-900">Visualisation 2D</h1>
      </div>

      {!user && (
        <div className="bg-surface rounded-2xl border border-slate-200 p-6 text-center card-shadow">
          <div className="text-4xl mb-3">{'\u{1F512}'}</div>
          <p className="font-bold text-slate-800 mb-1">Sign in to play</p>
          <p className="text-sm text-slate-500 mb-4">Create a free account to access CBAT games.</p>
          <Link to="/login" className="inline-flex px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors">
            Sign In
          </Link>
        </div>
      )}

      {user && (
        <div className="flex flex-col items-center">

          {phase === 'intro' && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full max-w-md bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-6 text-center"
            >
              <p className="text-4xl mb-3">{'\u{1F9EE}'}</p>
              <p className="text-xl font-extrabold text-white mb-2">Visualisation 2D</p>
              <p className="text-sm text-slate-400 mb-5">
                Each round shows a few shapes with letter-labelled sides. Sides
                sharing the same letter weld together. Pick the correct final
                figure from the six options.
              </p>

              <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-4 mb-5 text-left space-y-2">
                <div className="flex items-start gap-2 text-sm text-[#ddeaf8]">
                  <span className="text-brand-300 font-bold shrink-0">{'\u{1F551}'}</span>
                  <span>{'30 seconds per round · 8 rounds'}</span>
                </div>
                <div className="flex items-start gap-2 text-sm text-[#ddeaf8]">
                  <span className="text-brand-300 font-bold shrink-0">{'\u{1F4A1}'}</span>
                  <span>{'Match letters — e.g. side “A” meets the other side “A”'}</span>
                </div>
                <div className="flex items-start gap-2 text-xs text-[#8a9bb5]">
                  <span className="shrink-0">{'⚠️'}</span>
                  <span>{'Tap your answer — it’s locked in immediately'}</span>
                </div>
              </div>

              {personalBest && (
                <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 mb-4 text-center">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Personal Best</p>
                  <p className="text-lg font-mono font-bold text-brand-300">
                    {personalBest.bestScore}/{TOTAL_ROUNDS} ({Math.round((personalBest.bestScore / TOTAL_ROUNDS) * 100)}%)
                    <span className="text-slate-500 mx-1">{'·'}</span>
                    {personalBest.bestTime.toFixed(1)}s
                  </p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{personalBest.attempts} attempt{personalBest.attempts !== 1 ? 's' : ''}</p>
                </div>
              )}

              <div className="text-center mb-4">
                <Link to="/cbat/visualisation-2d/leaderboard" className="text-xs text-brand-300 hover:text-brand-200 transition-colors">
                  {'View Leaderboard →'}
                </Link>
              </div>

              <button
                onClick={startGame}
                className="px-8 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg transition-colors text-sm"
              >
                Start
              </button>
            </motion.div>
          )}

          {(phase === 'playing' || phase === 'feedback') && currentRound && (
            <div className="w-full max-w-2xl">
              {/* HUD */}
              <div className="flex items-center justify-between text-xs font-mono mb-2 px-1">
                <span className="text-slate-400">
                  Round <span className="text-brand-300">{currentIdx + 1}</span>/{TOTAL_ROUNDS}
                </span>
                <span className="text-slate-400">
                  {'✓'} <span className="text-green-400">{answers.filter(a => a.correct).length}</span>
                </span>
                <span className="text-slate-400">
                  {'⏱'} <span className={roundTimeLeft <= 5 ? 'text-red-400' : 'text-brand-300'}>{Math.max(0, roundTimeLeft).toFixed(1)}s</span>
                </span>
                <span className="text-slate-400">
                  Total <span className="text-brand-300">{elapsed.toFixed(1)}s</span>
                </span>
              </div>

              {/* Progress */}
              <div className="w-full h-1 bg-[#1a3a5c] rounded-full mb-3 overflow-hidden">
                <motion.div
                  className="h-full bg-brand-600 rounded-full"
                  initial={false}
                  animate={{ width: `${((currentIdx + (phase === 'feedback' ? 1 : 0)) / TOTAL_ROUNDS) * 100}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>

              {/* Prompt shapes */}
              <motion.div
                key={`prompt-${currentIdx}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-2 sm:p-3 mb-2 sm:mb-3"
              >
                <p className="text-[10px] text-slate-500 uppercase tracking-wide text-center mb-2 sm:mb-3">
                  These pieces weld on matching letters
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-5">
                  {currentRound.shapes.map((s, i) => (
                    <div key={i} className="flex items-center justify-center w-14 h-14 sm:w-24 sm:h-24">
                      <PromptShape
                        shape={s}
                        rotation={currentRound.promptRotations[i]}
                        labels={labelsForShape(i)}
                        svgRef={el => { promptSvgRefs.current[i] = el }}
                      />
                    </div>
                  ))}
                </div>
              </motion.div>

              {/* Answer choices */}
              <motion.div
                key={`choices-${currentIdx}`}
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-2 sm:p-3"
              >
                <p className="text-[10px] text-slate-500 uppercase tracking-wide text-center mb-2 sm:mb-3">
                  Which is the correct final figure?
                </p>
                <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                  {currentRound.choices.map((choice, i) => {
                    let btnClass = 'bg-[#060e1a] border-[#1a3a5c] hover:border-brand-400 hover:bg-[#0f2240]'
                    if (phase === 'feedback') {
                      if (i === currentRound.correctIdx) {
                        btnClass = 'bg-green-500/20 border-green-500/50'
                      } else if (i === pickedIdx && !wasCorrect) {
                        btnClass = 'bg-red-500/20 border-red-500/50'
                      } else {
                        btnClass = 'bg-[#060e1a] border-[#1a3a5c] opacity-50'
                      }
                    }
                    return (
                      <button
                        key={i}
                        onClick={() => handlePick(i)}
                        disabled={phase === 'feedback'}
                        className={`flex items-center justify-center rounded-lg border-2 p-1 sm:p-2 transition-all aspect-square ${btnClass} ${
                          phase === 'feedback' ? 'cursor-default' : 'cursor-pointer'
                        }`}
                      >
                        {phase === 'feedback' && i === currentRound.correctIdx
                          ? <div className="w-full h-full" />
                          : <CompositeShape
                              layout={choice.layout}
                              svgRef={el => { tileSvgRefs.current[i] = el }}
                            />}
                      </button>
                    )
                  })}
                </div>

                <AnimatePresence>
                  {phase === 'feedback' && (
                    <motion.div
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className={`mt-3 text-center px-3 py-1.5 rounded-lg text-xs font-bold ${
                        wasCorrect
                          ? 'bg-green-500/20 border border-green-500/40 text-green-400'
                          : 'bg-red-500/20 border border-red-500/40 text-red-400'
                      }`}
                    >
                      {wasCorrect
                        ? `✓ Solved in ${lastRoundTime.toFixed(2)}s`
                        : (pickedIdx === null ? '✗ Time-up' : '✗ Wrong')}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Next button — appears once the assembly animation finishes */}
                <AnimatePresence>
                  {phase === 'feedback' && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ delay: NEXT_REVEAL_S, duration: 0.25 }}
                      className="mt-3 text-center"
                    >
                      <button
                        onClick={handleNext}
                        className="px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-lg transition-colors"
                      >
                        {currentIdx + 1 >= TOTAL_ROUNDS ? 'View Results' : 'Next Round'}
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            </div>
          )}

          {phase === 'results' && (
            <ResultsScreen
              answers={answers}
              totalTime={elapsed}
              onPlayAgain={() => { setScoreSaved(false); startGame() }}
              scoreSaved={scoreSaved}
            />
          )}
        </div>
      )}

      {phase === 'feedback' && animationData && (
        <AssemblyAnimation data={animationData} />
      )}
    </div>
  )
}
