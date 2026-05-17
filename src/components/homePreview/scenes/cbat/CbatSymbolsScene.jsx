import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import CbatBg from './_cbatBg'

// Mirrors the real Symbols play screen: grid of unicode symbol buttons on
// top, target symbol shown in a large bordered box BELOW the grid (the real
// game's order — grid is the primary play area). 4 columns / 16 symbols
// match the real game's mid-tier layout. Characters are mixed Cyrillic /
// Arabic / Hiragana / CJK / Hangul.
const GRID = [
  'Ж', 'ﺽ', 'み', '漢',
  '한', 'Ψ', 'ت', 'カ',
  '猫', '뮤', 'Ω', 'Я',
  'ك', 'ね', '行', '비',
]
const TARGET = '漢'
const TARGET_INDEX = 3

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
      <div className="absolute inset-0 px-4 pt-16 sm:pt-24 pb-4 flex flex-col items-center">

        {/* HUD */}
        <div className="flex justify-between items-center w-full mb-2 intel-mono" style={{ fontSize: 7 }}>
          <span style={{ color: '#5baaff', letterSpacing: '0.15em', fontWeight: 700 }}>ROUND 3 / 5</span>
          <span style={{ color: '#fbbf24', letterSpacing: '0.15em', fontWeight: 700 }}>CORRECT 8</span>
          <span style={{ color: '#cbd5e1', letterSpacing: '0.15em', fontWeight: 700 }}>00:21</span>
        </div>

        {/* Grid — top of the play area (the dominant element in the real game) */}
        <div className="grid grid-cols-4 gap-1.5 mb-3 w-full" style={{ maxWidth: 220 }}>
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
                  aspectRatio: '1 / 1',
                  background: showState && isCorrect ? 'rgba(34,197,94,0.18)' : '#060e1a',
                  border: `1.5px solid ${showState && isCorrect ? '#22c55e' : '#1a3a5c'}`,
                  color: '#fff',
                  fontSize: 22,
                  borderRadius: 6,
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

        {/* Target card — below the grid, larger to match the real game's text-6xl. */}
        <p className="intel-mono mb-1.5" style={{ fontSize: 7, color: '#94a3b8', letterSpacing: '0.18em', fontWeight: 700, textTransform: 'uppercase' }}>
          Find this symbol
        </p>
        <div
          className="rounded-lg flex items-center justify-center"
          style={{
            width: 84, height: 84,
            background: '#0a1628',
            border: '2px solid #5baaff',
            boxShadow: '0 0 18px rgba(91,170,255,0.3)',
          }}
        >
          <span style={{ fontSize: 48, color: '#fff', textShadow: '0 0 8px rgba(91,170,255,0.55)' }}>{TARGET}</span>
        </div>
      </div>
    </div>
  )
}
