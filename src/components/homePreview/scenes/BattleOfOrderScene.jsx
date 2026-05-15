import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// Battle of Order preview — roulette spin → cards snap into the correct order.
// Mirrors the visual language of src/pages/BattleOfOrderFlow.jsx (violet
// accent, slot-machine card, ordering rows).
const SPIN_OPTIONS = [
  { label: 'Speed: Slowest → Fastest',  emoji: '💨' },
  { label: 'Year Introduced',           emoji: '📅' },
  { label: 'Rank Hierarchy',            emoji: '🎖️' },
  { label: 'Training Pipeline',         emoji: '📋' },
]
const FINAL_OPTION_IDX = 0 // lands on Speed

// Final ordered list (shuffled briefly, then snaps to order)
const ORDERED = [
  { id: 'o1', name: 'Lancaster',  meta: '454 mph' },
  { id: 'o2', name: 'Tornado',    meta: '1,490 mph' },
  { id: 'o3', name: 'Typhoon',    meta: '1,535 mph' },
  { id: 'o4', name: 'F-35B',      meta: '1,200 mph' },
]
// Initial shuffle (display indices when "wrong")
const SHUFFLE_ORDER = [2, 0, 3, 1]

export default function BattleOfOrderScene({ runKey }) {
  const [phase, setPhase]   = useState('spin') // 'spin' → 'pick' → 'order' → 'win'
  const [spinIdx, setSpinIdx] = useState(0)

  useEffect(() => {
    setPhase('spin'); setSpinIdx(0)
    let tickT
    let i = 0
    // 8 quick ticks then land on FINAL_OPTION_IDX
    function tick() {
      i++
      setSpinIdx(prev => (prev + 1) % SPIN_OPTIONS.length)
      if (i < 9) {
        const delay = i < 5 ? 90 : i < 7 ? 160 : 260
        tickT = setTimeout(tick, delay)
      } else {
        setSpinIdx(FINAL_OPTION_IDX)
        setTimeout(() => setPhase('pick'), 350)
      }
    }
    tickT = setTimeout(tick, 100)
    const t1 = setTimeout(() => setPhase('order'), 1700)
    const t2 = setTimeout(() => setPhase('win'),   3500)
    return () => { clearTimeout(tickT); clearTimeout(t1); clearTimeout(t2) }
  }, [runKey])

  return (
    <div className="absolute inset-0 overflow-hidden flex items-center justify-center">
      {/* Violet radial backdrop */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at 50% 55%, rgba(167,139,250,0.18), transparent 70%), #06101e',
        }}
      />

      <AnimatePresence mode="wait">
        {(phase === 'spin' || phase === 'pick') && (
          <motion.div
            key="spin"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="relative z-10 text-center px-6 pt-16"
          >
            <p className="intel-mono mb-3" style={{ fontSize: 9, color: '#a78bfa', letterSpacing: '0.18em', fontWeight: 700, textTransform: 'uppercase' }}>
              {phase === 'pick' ? 'Challenge Selected' : 'Selecting Challenge'}
            </p>
            <motion.div
              key={`tick-${spinIdx}-${runKey}`}
              initial={{ y: -8, opacity: 0.7 }}
              animate={{ y: 0,  opacity: 1 }}
              transition={{ duration: 0.08 }}
              className="rounded-2xl px-6 py-5 mx-auto"
              style={{
                width: 240,
                background: phase === 'pick' ? 'rgba(167,139,250,0.15)' : 'rgba(255,255,255,0.05)',
                border: `2px solid ${phase === 'pick' ? '#a78bfa' : 'rgba(255,255,255,0.12)'}`,
                boxShadow: phase === 'pick' ? '0 0 28px rgba(167,139,250,0.45)' : 'none',
                transition: 'all 0.3s',
              }}
            >
              <div style={{ fontSize: 28, marginBottom: 6 }}>{SPIN_OPTIONS[spinIdx].emoji}</div>
              <p style={{ fontSize: 12, color: '#fff', fontWeight: 700 }}>{SPIN_OPTIONS[spinIdx].label}</p>
            </motion.div>
          </motion.div>
        )}

        {(phase === 'order' || phase === 'win') && (
          <motion.div
            key="order"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.35 }}
            className="relative z-10 px-6 pt-16 w-full max-w-md"
          >
            <p className="intel-mono mb-3 text-center" style={{ fontSize: 9, color: '#a78bfa', letterSpacing: '0.18em', fontWeight: 700, textTransform: 'uppercase' }}>
              Slowest → Fastest
            </p>
            <div className="flex flex-col gap-2">
              {ORDERED.map((item, finalIdx) => {
                // While phase=order, items are in SHUFFLE_ORDER; while phase=win, they're in correct order
                const startIdx = SHUFFLE_ORDER.indexOf(finalIdx)
                const targetY = phase === 'win' ? finalIdx * 44 : startIdx * 44
                return (
                  <motion.div
                    key={item.id}
                    initial={{ y: SHUFFLE_ORDER.indexOf(finalIdx) * 44, opacity: 0 }}
                    animate={{ y: targetY, opacity: 1 }}
                    transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1], delay: phase === 'win' ? finalIdx * 0.08 : 0 }}
                    className="absolute left-6 right-6 rounded-xl px-3 py-2 flex items-center gap-3"
                    style={{
                      top: 0,
                      background: phase === 'win' ? 'rgba(167,139,250,0.18)' : 'rgba(255,255,255,0.05)',
                      border: `1.5px solid ${phase === 'win' ? '#a78bfa' : 'rgba(255,255,255,0.12)'}`,
                      boxShadow: phase === 'win' ? '0 0 14px rgba(167,139,250,0.35)' : 'none',
                    }}
                  >
                    <span
                      className="intel-mono"
                      style={{
                        width: 22, height: 22, borderRadius: 999,
                        background: phase === 'win' ? '#a78bfa' : 'rgba(255,255,255,0.12)',
                        color: phase === 'win' ? '#0f172a' : '#fff',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 10, fontWeight: 800,
                      }}
                    >
                      {finalIdx + 1}
                    </span>
                    <span style={{ flex: 1, fontSize: 12, color: '#fff', fontWeight: 700 }}>{item.name}</span>
                    <span className="intel-mono" style={{ fontSize: 9, color: '#cbd5e1' }}>{item.meta}</span>
                  </motion.div>
                )
              })}
            </div>
            {phase === 'win' && (
              <motion.p
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.55 }}
                className="intel-mono text-center mt-3"
                style={{ position: 'absolute', bottom: 28, left: 0, right: 0, fontSize: 10, color: '#c4b5fd', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' }}
              >
                ✓ Correct order
              </motion.p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
