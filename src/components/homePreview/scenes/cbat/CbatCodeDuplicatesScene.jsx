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
  const [phase, setPhase] = useState('display') // 'display' → 'ask' → 'feedback'
  const [typed, setTyped] = useState('')
  useEffect(() => {
    setPhase('display'); setTyped('')
    const t1 = setTimeout(() => setPhase('ask'),      2200)
    const t2 = setTimeout(() => setTyped(String(TARGET_COUNT)), 2900)
    const t3 = setTimeout(() => setPhase('feedback'), 3500)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [runKey])

  return (
    <div className="absolute inset-0 overflow-hidden">
      <CbatBg amber />
      <div className="absolute inset-0 px-4 pt-14 pb-3 flex flex-col items-center">

        {/* HUD */}
        <div className="flex justify-between items-center w-full mb-3 intel-mono" style={{ fontSize: 7 }}>
          <span style={{ color: '#5baaff', letterSpacing: '0.15em', fontWeight: 700 }}>TIER 2 · ROUND 4</span>
          <span style={{ color: '#fbbf24', letterSpacing: '0.15em', fontWeight: 700 }}>CORRECT 6</span>
        </div>

        {phase === 'display' && (
          <div className="flex flex-col items-center justify-center flex-1 w-full">
            <p className="intel-mono mb-3" style={{ fontSize: 8, color: '#94a3b8', letterSpacing: '0.18em', fontWeight: 700, textTransform: 'uppercase' }}>
              Memorise the sequence
            </p>
            <div className="flex gap-1.5 flex-wrap justify-center max-w-md">
              {SEQUENCE.map((n, i) => (
                <motion.div
                  key={`${i}-${runKey}`}
                  initial={{ opacity: 0, scale: 0.4 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.08, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  style={{
                    width: 28, height: 36,
                    background: '#060e1a',
                    border: '1.5px solid #1a3a5c',
                    borderRadius: 4,
                    color: '#5baaff',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    fontSize: 18, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {n}
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {(phase === 'ask' || phase === 'feedback') && (
          <div className="flex flex-col items-center justify-center flex-1">
            <p className="intel-mono mb-3" style={{ fontSize: 8, color: '#94a3b8', letterSpacing: '0.18em', fontWeight: 700, textTransform: 'uppercase' }}>
              How many times did this digit appear?
            </p>
            <div
              className="rounded-lg flex items-center justify-center mb-3"
              style={{
                width: 90, height: 90,
                background: '#0a1628',
                border: '2px solid #fbbf24',
                boxShadow: '0 0 20px rgba(251,191,36,0.3)',
                color: '#fbbf24',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 64, fontWeight: 700,
                lineHeight: 1,
              }}
            >
              {TARGET_DIGIT}
            </div>
            <div
              className="rounded text-center intel-mono"
              style={{
                background: '#060e1a',
                border: `1.5px solid ${phase === 'feedback' ? '#22c55e' : '#1a3a5c'}`,
                padding: '4px 24px',
                color: phase === 'feedback' ? '#86efac' : '#fff',
                fontSize: 18, fontWeight: 700, letterSpacing: '0.15em',
                minWidth: 70,
                boxShadow: phase === 'feedback' ? '0 0 10px rgba(34,197,94,0.4)' : 'none',
              }}
            >
              {typed || '_'}
              {phase !== 'feedback' && <motion.span animate={{ opacity: [0, 1, 0] }} transition={{ duration: 0.7, repeat: Infinity }} style={{ marginLeft: 1 }}>▍</motion.span>}
            </div>
          </div>
        )}

        {/* Countdown bar */}
        {phase === 'display' && (
          <div className="h-1.5 rounded-full w-full mt-2" style={{ background: 'rgba(255,255,255,0.08)' }}>
            <motion.div
              key={`cd-${runKey}`}
              initial={{ width: '100%' }}
              animate={{ width: '0%' }}
              transition={{ duration: 2.2, ease: 'linear' }}
              style={{ height: '100%', background: '#fbbf24', borderRadius: 999 }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
