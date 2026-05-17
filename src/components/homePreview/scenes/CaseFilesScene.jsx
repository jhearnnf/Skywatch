import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// Case Files preview — manila folder opens onto a corkboard with evidence
// pinned + red string connecting clues, mirroring the real Case Files game
// (src/pages/CaseFiles.jsx + components/caseFiles/CorkboardView).
const EVIDENCE = [
  { id: 'e1', label: 'Witness',  emoji: '👤',  x: 18, y: 32 },
  { id: 'e2', label: 'Photo',    emoji: '📷',  x: 70, y: 22 },
  { id: 'e3', label: 'Note',     emoji: '📝',  x: 42, y: 60 },
  { id: 'e4', label: 'Map',      emoji: '🗺️',  x: 78, y: 64 },
]
const STRINGS = [
  { from: 'e1', to: 'e3' },
  { from: 'e3', to: 'e4' },
  { from: 'e2', to: 'e3' },
]

export default function CaseFilesScene({ runKey }) {
  const [phase, setPhase] = useState('folder') // 'folder' → 'open' → 'pinned' → 'connected'

  useEffect(() => {
    setPhase('folder')
    const t1 = setTimeout(() => setPhase('open'),      550)
    const t2 = setTimeout(() => setPhase('pinned'),    1700)
    const t3 = setTimeout(() => setPhase('connected'), 3000)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [runKey])

  const evMap = Object.fromEntries(EVIDENCE.map(e => [e.id, e]))

  return (
    <div className="absolute inset-0 overflow-hidden flex items-center justify-center">
      {/* Warm amber backdrop (case-files / corkboard mood) */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at 50% 60%, rgba(251,191,36,0.14), transparent 70%), #06101e',
        }}
      />

      {/* Folder phase */}
      <AnimatePresence>
        {phase === 'folder' && (
          <motion.div
            key="folder"
            initial={{ opacity: 0, y: 30, rotate: -2 }}
            animate={{ opacity: 1, y: 0, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.6, rotate: 8 }}
            transition={{ duration: 0.5 }}
            className="relative rounded-xl mt-16 sm:mt-24"
            style={{
              width: 220, height: 150,
              background: 'linear-gradient(160deg, #d4a849 0%, #b88a32 100%)',
              boxShadow: '0 12px 30px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(0,0,0,0.2)',
              padding: 12,
              zIndex: 6,
            }}
          >
            {/* Folder tab */}
            <div
              className="absolute"
              style={{
                top: -10, left: 16,
                width: 70, height: 14,
                background: '#d4a849',
                borderRadius: '6px 6px 0 0',
                boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.15)',
              }}
            />
            <span className="intel-mono" style={{ fontSize: 9, color: '#3a2a08', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
              CASE FILE #047
            </span>
            <h3 style={{ color: '#1a1003', fontSize: 16, fontWeight: 800, marginTop: 6 }}>
              The Coningsby Incident
            </h3>
            <p style={{ color: '#3a2a08', fontSize: 10, marginTop: 4, lineHeight: 1.4 }}>
              CLASSIFIED — 3 chapters · 12 pieces of evidence · 1 suspect
            </p>
            {/* CLASSIFIED stamp */}
            <div
              className="absolute"
              style={{
                bottom: 12, right: 12,
                color: '#a02828',
                fontSize: 9, fontWeight: 900,
                letterSpacing: '0.2em',
                border: '2px solid #a02828',
                padding: '2px 6px',
                transform: 'rotate(-6deg)',
                opacity: 0.85,
              }}
            >
              CLASSIFIED
            </div>
          </motion.div>
        )}

        {/* Open corkboard */}
        {phase !== 'folder' && (
          <motion.div
            key="board"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.45 }}
            className="relative mt-16 sm:mt-24"
            style={{
              width: 320, height: 200,
              background:
                'radial-gradient(ellipse at center, #8a5a2a, #5c3915),' +
                'repeating-radial-gradient(circle at 20% 20%, rgba(0,0,0,0.12) 0 2px, transparent 2px 6px),' +
                '#8a5a2a',
              borderRadius: 12,
              border: '4px solid #3b1f08',
              boxShadow: '0 12px 30px rgba(0,0,0,0.6), inset 0 0 30px rgba(0,0,0,0.4)',
              zIndex: 5,
            }}
          >
            {/* Red strings */}
            <svg viewBox="0 0 100 100" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} preserveAspectRatio="none">
              {STRINGS.map((s, i) => {
                const a = evMap[s.from]
                const b = evMap[s.to]
                const show = phase === 'connected'
                return (
                  <motion.line
                    key={`${s.from}-${s.to}`}
                    x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    stroke="#dc2626"
                    strokeWidth="0.8"
                    initial={{ pathLength: 0, opacity: 0 }}
                    animate={{ pathLength: show ? 1 : 0, opacity: show ? 0.85 : 0 }}
                    transition={{ duration: 0.6, delay: i * 0.18 }}
                  />
                )
              })}
            </svg>
            {/* Evidence cards */}
            {EVIDENCE.map((ev, i) => (
              <motion.div
                key={ev.id}
                initial={{ opacity: 0, scale: 0.5, y: -20 }}
                animate={phase === 'pinned' || phase === 'connected'
                  ? { opacity: 1, scale: 1, y: 0, rotate: i % 2 === 0 ? -4 : 6 }
                  : { opacity: 0, scale: 0.5, y: -20 }
                }
                transition={{ duration: 0.35, delay: i * 0.12, ease: [0.22, 1, 0.36, 1] }}
                className="absolute"
                style={{
                  left: `${ev.x}%`, top: `${ev.y}%`,
                  transform: 'translate(-50%, -50%)',
                  width: 64, height: 44,
                  background: '#f3eddc',
                  borderRadius: 4,
                  boxShadow: '0 6px 12px rgba(0,0,0,0.6)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 2,
                }}
              >
                {/* Pin */}
                <div style={{
                  position: 'absolute', top: -4, left: '50%', transform: 'translateX(-50%)',
                  width: 8, height: 8, borderRadius: 999, background: '#dc2626',
                  boxShadow: '0 0 4px rgba(0,0,0,0.5)',
                }} />
                <span style={{ fontSize: 18 }}>{ev.emoji}</span>
                <span className="intel-mono" style={{ fontSize: 7, color: '#1f1408', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  {ev.label}
                </span>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
