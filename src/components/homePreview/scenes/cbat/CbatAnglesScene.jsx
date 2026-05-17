import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import CbatBg from './_cbatBg'

// Mirrors the real Angles play: an SVG angle diagram (horizontal baseline +
// angled line forming a bearing) over faint grid circles, with 5 angle-option
// buttons in a row below (multiples of 10°). Feedback paints the right
// answer green, wrong red.

const OPTIONS = [30, 45, 60, 90, 120]
const CORRECT_INDEX = 1 // 45°

export default function CbatAnglesScene({ runKey }) {
  const [picked, setPicked] = useState(null)
  useEffect(() => {
    setPicked(null)
    const t = setTimeout(() => setPicked(CORRECT_INDEX), 1300)
    return () => clearTimeout(t)
  }, [runKey])

  return (
    <div className="absolute inset-0 overflow-hidden">
      <CbatBg amber />
      <div className="absolute inset-0 px-4 pt-16 sm:pt-24 pb-4 flex flex-col items-center">

        {/* HUD */}
        <div className="flex justify-between items-center w-full mb-2 intel-mono" style={{ fontSize: 7 }}>
          <span style={{ color: '#5baaff', letterSpacing: '0.15em', fontWeight: 700 }}>ROUND 1 · BEARING</span>
          <span style={{ color: '#fbbf24', letterSpacing: '0.15em', fontWeight: 700 }}>CORRECT 4</span>
        </div>

        {/* Angle diagram — vertex centred horizontally so the arc opens
            symmetrically inside the SVG box rather than hugging the corner. */}
        <div className="flex items-center justify-center w-full" style={{ marginBottom: 8 }}>
          <svg viewBox="0 0 100 70" style={{ width: 260, maxWidth: '92%' }}>
            {/* Grid circles centred on the vertex */}
            {[12, 22, 32].map(r => (
              <circle key={r} cx="50" cy="55" r={r} fill="none" stroke="#1a3a5c" strokeWidth="0.4" strokeDasharray="1 2" />
            ))}
            {/* Baseline (horizontal, vertex centred) */}
            <line x1="20" y1="55" x2="80" y2="55" stroke="#fff" strokeWidth="1" />
            {/* Angled line (~45° up-right from vertex) */}
            <motion.line
              key={`l-${runKey}`}
              x1="50" y1="55" x2="71" y2="34"
              stroke="#5baaff" strokeWidth="1.4" strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
              filter="drop-shadow(0 0 3px rgba(91,170,255,0.6))"
            />
            {/* Arc between baseline and angled line */}
            <path d="M 63 55 A 13 13 0 0 0 59.2 46" fill="none" stroke="#5baaff" strokeOpacity="0.7" strokeWidth="0.8" />
            {/* Vertex dot */}
            <circle cx="50" cy="55" r="1.5" fill="#5baaff" />
            {/* "?" mark inside the arc */}
            <text x="63" y="50" fill="#5baaff" fontSize="6" fontFamily="ui-monospace, monospace" fontWeight="700">?</text>
            {/* End-points */}
            <circle cx="80" cy="55" r="1" fill="#fff" />
            <circle cx="71" cy="34" r="1" fill="#5baaff" />
            <g fontFamily="ui-monospace, monospace" fontSize="3" fill="#64748b">
              <text x="80" y="62" textAnchor="middle">N</text>
            </g>
          </svg>
        </div>

        {/* Answer row — sits right under the diagram, not flex-spaced away. */}
        <div className="flex gap-1.5 w-full">
          {OPTIONS.map((deg, i) => {
            const isPicked = picked === i
            const isCorrect = i === CORRECT_INDEX
            const showResult = picked !== null
            return (
              <motion.div
                key={deg}
                animate={isPicked && showResult ? { scale: [1, 1.1, 1] } : {}}
                transition={{ duration: 0.4 }}
                className="intel-mono flex-1"
                style={{
                  background: showResult && isCorrect ? 'rgba(34,197,94,0.18)' : '#0a1628',
                  border: `1.5px solid ${showResult && isCorrect ? '#22c55e' : '#1a3a5c'}`,
                  borderRadius: 6,
                  color: showResult && isCorrect ? '#86efac' : '#fff',
                  fontSize: 12, fontWeight: 700,
                  textAlign: 'center',
                  padding: '8px 0',
                  boxShadow: showResult && isCorrect ? '0 0 10px rgba(34,197,94,0.35)' : 'none',
                  opacity: showResult && !isCorrect ? 0.45 : 1,
                  transition: 'all 0.3s',
                }}
              >
                {deg}°
              </motion.div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
