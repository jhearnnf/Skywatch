import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'

// Aptitude Sync preview — mirrors the CRT terminal aesthetic of
// src/pages/AptitudeSync.jsx (brand-600 cyan on dark, monospace, scanlines).
// Plays a fake interview: system asks a question, user types the answer
// letter by letter, terminal confirms with green ACK.
const G_BRIGHT = '#5baaff'
const G_DIM    = '#1a4a70'
const G_MID    = '#7aa6d6'

const LINES = [
  { type: 'sys',  text: 'aptitude_sync v2.4 — initialising knowledge probe…', delay: 200 },
  { type: 'sys',  text: 'target_brief: typhoon-fgr4', delay: 700 },
  { type: 'q',    text: 'Q1 / Identify the primary engine on the Typhoon FGR4:', delay: 1200 },
]
const ANSWER = 'EJ200'
const ACK = '✓ MATCH — +20 airstars'

export default function AptitudeSyncScene({ runKey }) {
  const [linesShown, setLinesShown] = useState(0)
  const [typed,      setTyped]      = useState('')
  const [acked,      setAcked]      = useState(false)

  useEffect(() => {
    setLinesShown(0); setTyped(''); setAcked(false)
    const timers = []
    LINES.forEach((line, i) => {
      timers.push(setTimeout(() => setLinesShown(i + 1), line.delay))
    })
    const startTyping = (LINES[LINES.length - 1].delay) + 350
    for (let i = 1; i <= ANSWER.length; i++) {
      timers.push(setTimeout(() => setTyped(ANSWER.slice(0, i)), startTyping + i * 90))
    }
    timers.push(setTimeout(() => setAcked(true), startTyping + ANSWER.length * 90 + 350))
    return () => timers.forEach(clearTimeout)
  }, [runKey])

  return (
    <div className="absolute inset-0 overflow-hidden flex items-center justify-center">
      {/* Pure dark backdrop */}
      <div aria-hidden="true" className="absolute inset-0" style={{ background: '#020a14' }} />

      {/* CRT scanlines (extra-strong for this scene) */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(91,170,255,0.06) 2px, rgba(91,170,255,0.06) 3px)',
        }}
      />

      {/* Faint phosphor flicker */}
      <motion.div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        animate={{ opacity: [0.0, 0.04, 0.0] }}
        transition={{ duration: 0.18, repeat: Infinity, repeatDelay: 2.4, ease: 'easeInOut' }}
        style={{ background: G_BRIGHT, mixBlendMode: 'screen' }}
      />

      <div
        className="relative rounded-lg px-5 py-4 mt-12 mx-4"
        style={{
          width: '100%',
          maxWidth: 460,
          minHeight: 180,
          background: 'rgba(6,16,30,0.85)',
          border: `1px solid ${G_DIM}`,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 12,
          lineHeight: 1.55,
          boxShadow: `0 0 32px rgba(91,170,255,0.18)`,
          zIndex: 5,
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-2" style={{ borderBottom: `1px solid ${G_DIM}`, paddingBottom: 4 }}>
          <span style={{ color: G_BRIGHT, fontWeight: 700, letterSpacing: '0.12em', fontSize: 10 }}>
            APTITUDE_SYNC
          </span>
          <span style={{ color: G_MID, fontSize: 9 }}>
            <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.6, repeat: Infinity }}>●</motion.span>
            {' '}LIVE
          </span>
        </div>

        {LINES.slice(0, linesShown).map((line, i) => (
          <motion.div
            key={`${i}-${runKey}`}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2 }}
            style={{ color: line.type === 'sys' ? G_DIM : G_BRIGHT, marginBottom: 2 }}
          >
            <span style={{ marginRight: 6, color: G_MID }}>{line.type === 'sys' ? '·' : '?'}</span>
            {line.text}
          </motion.div>
        ))}

        {/* Input prompt — typing */}
        {linesShown >= LINES.length && (
          <div className="mt-3" style={{ color: G_BRIGHT }}>
            <span style={{ marginRight: 6, color: G_MID }}>›</span>
            <span style={{ textShadow: `0 0 6px ${G_BRIGHT}` }}>{typed}</span>
            <motion.span
              animate={{ opacity: [0, 1, 0] }}
              transition={{ duration: 0.7, repeat: Infinity }}
              style={{ marginLeft: 1, color: G_BRIGHT }}
            >
              ▍
            </motion.span>
          </div>
        )}

        {/* ACK */}
        {acked && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-2 rounded px-2 py-1"
            style={{
              border: '1px solid #22c55e',
              background: 'rgba(34,197,94,0.1)',
              color: '#86efac',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textShadow: '0 0 6px rgba(34,197,94,0.5)',
            }}
          >
            {ACK}
          </motion.div>
        )}
      </div>
    </div>
  )
}
