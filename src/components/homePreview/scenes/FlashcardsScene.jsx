import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// Flashcard montage — mirrors the real FlashcardGameModal visual language
// (amber glow, dark gradient card, typeahead row). Sequence:
//   1. Deck flourish: 6 cards fan out from a stack
//   2. One card flips, content reveals
//   3. Typeahead types the brief name letter by letter
//   4. Card flashes green (correct)
const DECK = [
  { id: 'd1', label: 'F-35B',     rot: -22, x: -160, y: -8  },
  { id: 'd2', label: 'Typhoon',   rot: -10, x: -88,  y: -22 },
  { id: 'd3', label: 'Lossiemouth', rot: 0, x: 0,    y: -28 },
  { id: 'd4', label: 'Voyager',   rot: 8,   x: 88,   y: -22 },
  { id: 'd5', label: 'Coningsby', rot: 18,  x: 160,  y: -8  },
  { id: 'd6', label: 'Wildcat',   rot: -4,  x: -40,  y: -24 },
]

const TARGET_TITLE = 'Typhoon FGR4'
const HINT_BODY = 'A twin-engine multirole fighter and the RAF\'s primary air-defence platform. Operates from Coningsby and Lossiemouth.'

export default function FlashcardsScene({ runKey }) {
  const [phase, setPhase] = useState('stack')
  // 'stack' → cards stacked; 'fan' → cards spread; 'focus' → one card centred; 'reveal' → content shown; 'typed' → answer typed; 'correct' → green flash
  const [typed, setTyped] = useState('')

  useEffect(() => {
    setPhase('stack')
    setTyped('')
    const t1 = setTimeout(() => setPhase('fan'),    250)
    const t2 = setTimeout(() => setPhase('focus'),  1200)
    const t3 = setTimeout(() => setPhase('reveal'), 1800)
    // letter-by-letter typing
    const typeTimers = []
    const startTyping = 2300
    for (let i = 1; i <= TARGET_TITLE.length; i++) {
      typeTimers.push(setTimeout(() => setTyped(TARGET_TITLE.slice(0, i)), startTyping + i * 55))
    }
    const t4 = setTimeout(() => setPhase('correct'), startTyping + TARGET_TITLE.length * 55 + 200)
    return () => {
      [t1, t2, t3, t4, ...typeTimers].forEach(clearTimeout)
    }
  }, [runKey])

  return (
    <div className="absolute inset-0 overflow-hidden flex items-center justify-center">
      {/* Backdrop — soft amber radial */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at 50% 60%, rgba(245,158,11,0.18), transparent 70%), #06101e',
        }}
      />

      {/* Deck flourish (fanning cards) */}
      <div className="absolute inset-0 flex items-center justify-center" style={{ marginTop: 16 }}>
        {DECK.map((card, i) => {
          const target = phase === 'stack'
            ? { x: 0, y: 0, rotate: 0, scale: 0.6, opacity: 0 }
            : phase === 'fan'
              ? { x: card.x, y: card.y, rotate: card.rot, scale: 0.95, opacity: 1 }
              : { x: card.x * 1.4, y: card.y - 40, rotate: card.rot, scale: 0.9, opacity: 0 }
          return (
            <motion.div
              key={card.id}
              initial={{ x: 0, y: 0, rotate: 0, scale: 0.6, opacity: 0 }}
              animate={target}
              transition={{ duration: 0.55, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] }}
              className="absolute"
              style={{
                width: 96,
                height: 130,
                borderRadius: 14,
                background: 'linear-gradient(160deg, #0d1f3c 0%, #091529 100%)',
                border: '1px solid rgba(245,158,11,0.45)',
                boxShadow: '0 8px 22px rgba(0,0,0,0.5), 0 0 18px rgba(245,158,11,0.18)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 6,
                textAlign: 'center',
                zIndex: 2,
              }}
            >
              <div>
                <div style={{ fontSize: 22, marginBottom: 4 }}>⚡</div>
                <p className="intel-mono" style={{ fontSize: 8, color: '#f59e0b', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  {card.label}
                </p>
              </div>
            </motion.div>
          )
        })}
      </div>

      {/* Focus card — main flashcard with content + typeahead */}
      <AnimatePresence>
        {(phase === 'focus' || phase === 'reveal' || phase === 'correct') && (
          <motion.div
            key={`focus-${runKey}`}
            initial={{ opacity: 0, scale: 0.5, rotateY: -90 }}
            animate={{ opacity: 1, scale: 1, rotateY: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="relative rounded-3xl overflow-hidden"
            style={{
              width: 260,
              maxWidth: '70%',
              background: 'linear-gradient(160deg, #0d1f3c 0%, #091529 100%)',
              border: `2px solid ${phase === 'correct' ? '#22c55e' : 'rgba(245,158,11,0.55)'}`,
              boxShadow: phase === 'correct'
                ? '0 0 40px rgba(34,197,94,0.5), 0 12px 30px rgba(0,0,0,0.5)'
                : '0 0 30px rgba(245,158,11,0.25), 0 12px 30px rgba(0,0,0,0.5)',
              zIndex: 5,
              padding: 16,
              transition: 'box-shadow 0.3s, border-color 0.3s',
            }}
          >
            {/* Title hidden marker */}
            <div className="flex items-center justify-between mb-2">
              <span
                className="intel-mono"
                style={{ fontSize: 9, color: '#f59e0b', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase' }}
              >
                Recall Drill
              </span>
              <span style={{ fontSize: 18 }}>⚡</span>
            </div>
            {/* Hidden title bar */}
            <div
              className="mb-3 rounded-lg"
              style={{
                height: 16,
                background: 'repeating-linear-gradient(45deg, rgba(245,158,11,0.18) 0, rgba(245,158,11,0.18) 4px, rgba(245,158,11,0.32) 4px, rgba(245,158,11,0.32) 8px)',
              }}
            />
            {/* Body excerpt */}
            <p style={{ fontSize: 10, color: '#cbd5e1', lineHeight: 1.45, marginBottom: 10 }}>
              {HINT_BODY}
            </p>
            {/* Typeahead row */}
            <div
              className="rounded-xl px-3 py-2"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: `1.5px solid ${phase === 'correct' ? '#22c55e' : 'rgba(245,158,11,0.4)'}`,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                minHeight: 32,
              }}
            >
              <span style={{ fontSize: 11, color: '#f59e0b' }}>›</span>
              <span style={{ fontSize: 11, color: '#fff', fontWeight: 600, letterSpacing: '0.02em' }}>
                {typed}
                <motion.span
                  animate={{ opacity: [0, 1, 0] }}
                  transition={{ duration: 0.8, repeat: Infinity }}
                  style={{ marginLeft: 1, color: '#f59e0b' }}
                >
                  ▍
                </motion.span>
              </span>
            </div>

            {/* Correct flash */}
            {phase === 'correct' && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-3 rounded-lg px-2 py-1 flex items-center gap-2"
                style={{ background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.5)' }}
              >
                <span style={{ color: '#22c55e', fontSize: 12 }}>✓</span>
                <span className="intel-mono" style={{ color: '#86efac', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  Collected
                </span>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
