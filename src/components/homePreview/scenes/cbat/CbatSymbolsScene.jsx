import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import CbatBg from './_cbatBg'

// Mirrors the real Symbols play screen: target symbol shown in a large
// bordered box, then a grid of unicode symbol buttons. Tap the match.
// The real game uses Cyrillic / Arabic / Hiragana / CJK / Hangul characters.
const GRID = [
  'Ж', 'ﺽ', 'み', '漢', '한', 'Ψ',
  'ت', 'カ', '猫', '뮤', 'Ω', 'Я',
  'ك', 'ね', '行', '비', 'Δ', 'Ц',
]
const TARGET = '漢'
const TARGET_INDEX = 9

export default function CbatSymbolsScene({ runKey }) {
  const [found, setFound] = useState(false)
  useEffect(() => {
    setFound(false)
    const t = setTimeout(() => setFound(true), 1200)
    return () => clearTimeout(t)
  }, [runKey])

  return (
    <div className="absolute inset-0 overflow-hidden">
      <CbatBg amber />
      <div className="absolute inset-0 px-4 pt-14 pb-4 flex flex-col items-center">

        {/* HUD */}
        <div className="flex justify-between items-center w-full mb-2 intel-mono" style={{ fontSize: 7 }}>
          <span style={{ color: '#5baaff', letterSpacing: '0.15em', fontWeight: 700 }}>ROUND 3 / 5</span>
          <span style={{ color: '#fbbf24', letterSpacing: '0.15em', fontWeight: 700 }}>CORRECT 8</span>
          <span style={{ color: '#cbd5e1', letterSpacing: '0.15em', fontWeight: 700 }}>00:21</span>
        </div>

        {/* Progress bar */}
        <div className="h-1 rounded-full w-full mb-2" style={{ background: 'rgba(255,255,255,0.08)' }}>
          <motion.div
            key={runKey}
            initial={{ width: '40%' }}
            animate={{ width: '60%' }}
            transition={{ duration: 2.2 }}
            style={{ height: '100%', background: '#fbbf24', borderRadius: 999 }}
          />
        </div>

        {/* Target card */}
        <div
          className="rounded-lg flex items-center justify-center mb-3"
          style={{
            width: 64, height: 64,
            background: '#0a1628',
            border: '2px solid #5baaff',
            boxShadow: '0 0 16px rgba(91,170,255,0.25)',
          }}
        >
          <span style={{ fontSize: 32, color: '#fff', textShadow: '0 0 6px rgba(91,170,255,0.5)' }}>{TARGET}</span>
        </div>
        <p className="intel-mono mb-2" style={{ fontSize: 7, color: '#94a3b8', letterSpacing: '0.18em', fontWeight: 700, textTransform: 'uppercase' }}>
          Find this symbol
        </p>

        {/* Grid */}
        <div className="grid grid-cols-6 gap-1.5 mt-1">
          {GRID.map((s, i) => {
            const isCorrect = i === TARGET_INDEX
            const showState = found
            return (
              <motion.div
                key={i}
                animate={showState && isCorrect ? { scale: [1, 1.18, 1] } : {}}
                transition={{ duration: 0.5 }}
                className="flex items-center justify-center"
                style={{
                  width: 34, height: 34,
                  background: showState && isCorrect ? 'rgba(34,197,94,0.18)' : '#060e1a',
                  border: `1.5px solid ${showState && isCorrect ? '#22c55e' : '#1a3a5c'}`,
                  color: '#fff',
                  fontSize: 17,
                  borderRadius: 4,
                  boxShadow: showState && isCorrect ? '0 0 10px rgba(34,197,94,0.4)' : 'none',
                  opacity: showState && !isCorrect ? 0.35 : 1,
                  transition: 'opacity 0.3s',
                }}
              >
                {s}
              </motion.div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
