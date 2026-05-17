import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import CbatBg from './_cbatBg'

// Mirrors the real Code Duplicates play: digit squares animate in
// stagger-style during the display phase, an amber countdown bar shrinks at
// the bottom, then the answer phase shows a giant query digit + number input.
const SEQUENCE = [4, 7, 2, 7, 9, 7, 3, 5, 7, 1, 8]
const TARGET_DIGIT = 7
const TARGET_COUNT = 4

export default function CbatCodeDuplicatesScene({ runKey }) {
  // Tight pacing so the answer reveal happens well inside the scene's 2.5s
  // budget. Phases:
  //   'display'   → digits stagger in
  //   'highlight' → every matching digit (the 7s) lights up amber so the
  //                 user *sees* how many were there before the count appears
  //   'ask'       → query digit + count entry, sequence still visible above
  //                 with highlights kept on
  //   'feedback'  → entry box turns green
  const [phase, setPhase] = useState('display')
  const [typed, setTyped] = useState('')
  useEffect(() => {
    setPhase('display'); setTyped('')
    const t1 = setTimeout(() => setPhase('highlight'),         700)
    const t2 = setTimeout(() => setPhase('ask'),              1400)
    const t3 = setTimeout(() => setTyped(String(TARGET_COUNT)), 1700)
    const t4 = setTimeout(() => setPhase('feedback'),         2000)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4) }
  }, [runKey])

  const matchesShown = phase !== 'display'
  const showAnswer   = phase === 'ask' || phase === 'feedback'

  return (
    <div className="absolute inset-0 overflow-hidden">
      <CbatBg amber />
      <div className="absolute inset-0 px-4 pt-16 sm:pt-24 pb-3 flex flex-col items-center">

        {/* HUD */}
        <div className="flex justify-between items-center w-full mb-3 intel-mono" style={{ fontSize: 7 }}>
          <span style={{ color: '#5baaff', letterSpacing: '0.15em', fontWeight: 700 }}>TIER 2 · ROUND 4</span>
          <span style={{ color: '#fbbf24', letterSpacing: '0.15em', fontWeight: 700 }}>CORRECT 6</span>
        </div>

        {/* The sequence stays visible the whole round — only the
            matching-digit highlight changes — so users can count along. */}
        <p className="intel-mono mb-2" style={{ fontSize: 8, color: '#94a3b8', letterSpacing: '0.18em', fontWeight: 700, textTransform: 'uppercase' }}>
          {matchesShown ? `Every ${TARGET_DIGIT} highlighted` : 'Memorise the sequence'}
        </p>
        <div className="flex gap-1 w-full mb-3" style={{ maxWidth: 360 }}>
          {SEQUENCE.map((n, i) => {
            const isMatch = n === TARGET_DIGIT
            const lit = matchesShown && isMatch
            return (
              <motion.div
                key={`${i}-${runKey}`}
                initial={{ opacity: 0, scale: 0.4 }}
                animate={{
                  opacity: 1,
                  scale: lit ? 1.08 : 1,
                }}
                transition={{ delay: i * 0.05, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                style={{
                  flex: '1 1 0',
                  minWidth: 0,
                  aspectRatio: '3 / 4',
                  background: lit ? 'rgba(251,191,36,0.22)' : '#060e1a',
                  border: `1.5px solid ${lit ? '#fbbf24' : '#1a3a5c'}`,
                  borderRadius: 4,
                  color: lit ? '#fde68a' : '#5baaff',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 'clamp(14px, 3.6vw, 22px)',
                  fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: lit ? '0 0 8px rgba(251,191,36,0.45)' : 'none',
                  transition: 'background 0.25s, border-color 0.25s, color 0.25s, box-shadow 0.25s',
                }}
              >
                {n}
              </motion.div>
            )
          })}
        </div>

        {/* Query digit + count entry — appears once the highlight has done
            its job. Compact so the sequence above stays the focal point. */}
        {showAnswer && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="flex items-center gap-3"
          >
            <div
              className="rounded-lg flex items-center justify-center"
              style={{
                width: 56, height: 56,
                background: '#0a1628',
                border: '2px solid #fbbf24',
                boxShadow: '0 0 14px rgba(251,191,36,0.3)',
                color: '#fbbf24',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 38, fontWeight: 700,
                lineHeight: 1,
              }}
            >
              {TARGET_DIGIT}
            </div>
            <span className="intel-mono" style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, letterSpacing: '0.08em' }}>×</span>
            <div
              className="rounded text-center intel-mono"
              style={{
                background: '#060e1a',
                border: `1.5px solid ${phase === 'feedback' ? '#22c55e' : '#1a3a5c'}`,
                padding: '6px 18px',
                color: phase === 'feedback' ? '#86efac' : '#fff',
                fontSize: 22, fontWeight: 700, letterSpacing: '0.15em',
                minWidth: 56,
                boxShadow: phase === 'feedback' ? '0 0 10px rgba(34,197,94,0.4)' : 'none',
              }}
            >
              {typed || '_'}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  )
}
