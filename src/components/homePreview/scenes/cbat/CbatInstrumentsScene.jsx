import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import CbatBg from './_cbatBg'

// Mirrors the real Instruments play: a 2×3 grid of six round cockpit dials
// (altimeter, airspeed, heading, vertical speed, turn coordinator, attitude),
// then 5 statement buttons A–E below. Tapping a dial highlights matching
// keywords in amber across the statements. Final click locks the answer.

const DIALS = [
  { id: 'alt',  label: 'ALT',  needle: 70 },
  { id: 'asi',  label: 'ASI',  needle: 130 },
  { id: 'hdg',  label: 'HDG',  needle: 270 },
  { id: 'vs',   label: 'V/S',  needle: 200 },
  { id: 'tc',   label: 'TC',   needle: 90 },
  { id: 'att',  label: 'ATT',  needle: 0 },
]

const STATEMENTS = [
  { letter: 'A', text: 'Climbing through 4500 ft, heading 270°, airspeed 240 kt.' },
  { letter: 'B', text: 'Level at 3000 ft, banking right, airspeed 180 kt.' },
  { letter: 'C', text: 'Descending at 4500 ft, heading 090°, airspeed 240 kt.' },
  { letter: 'D', text: 'Climbing through 4500 ft, heading 270°, airspeed 180 kt.' },
  { letter: 'E', text: 'Level at 4500 ft, heading 360°, airspeed 240 kt.' },
]
const CORRECT_LETTER = 'A'

export default function CbatInstrumentsScene({ runKey }) {
  const [step, setStep] = useState(0) // 0 = calibrating, 1 = inspect dial, 2 = highlight, 3 = pick
  useEffect(() => {
    setStep(0)
    const t1 = setTimeout(() => setStep(1), 1200)
    const t2 = setTimeout(() => setStep(2), 2000)
    const t3 = setTimeout(() => setStep(3), 3000)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [runKey])

  return (
    <div className="absolute inset-0 overflow-hidden">
      <CbatBg amber />
      <div className="absolute inset-0 px-3 pt-14 pb-3 flex flex-col items-center">

        {/* HUD */}
        <div className="flex justify-between items-center w-full mb-1.5 intel-mono" style={{ fontSize: 7 }}>
          <span style={{ color: '#5baaff', letterSpacing: '0.15em', fontWeight: 700 }}>ROUND 2 · CALIBRATE</span>
          <span style={{ color: '#fbbf24', letterSpacing: '0.15em', fontWeight: 700 }}>00:18</span>
        </div>

        {/* Dial grid 3×2 */}
        <div className="grid grid-cols-3 gap-1.5 mb-2">
          {DIALS.map((d, i) => (
            <div
              key={d.id}
              className="relative rounded-full"
              style={{
                width: 50, height: 50,
                background: 'radial-gradient(circle at 30% 30%, #1a2a40, #06101e)',
                border: '1.5px solid #1a3a5c',
                boxShadow: 'inset 0 0 8px rgba(91,170,255,0.15)',
              }}
            >
              {/* Tick marks */}
              {Array.from({ length: 12 }).map((_, t) => (
                <div key={t} className="absolute"
                  style={{
                    top: '50%', left: '50%',
                    width: 1, height: 4,
                    background: '#5baaff',
                    transformOrigin: '50% 22px',
                    transform: `translate(-50%, -100%) rotate(${t * 30}deg) translateY(-18px)`,
                    opacity: 0.7,
                  }}
                />
              ))}
              {/* Needle */}
              <motion.div
                animate={{ rotate: step === 0 ? d.needle - 60 + (i * 25) : d.needle }}
                transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }}
                className="absolute"
                style={{
                  top: '50%', left: '50%',
                  width: 1.5, height: 18,
                  background: 'linear-gradient(to top, #ef4444, #fca5a5)',
                  transformOrigin: '50% 100%',
                  transform: 'translate(-50%, -100%)',
                  borderRadius: 1,
                }}
              />
              {/* Hub */}
              <div className="absolute" style={{
                top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                width: 5, height: 5, borderRadius: 999,
                background: '#5baaff', boxShadow: '0 0 4px #5baaff',
              }} />
              {/* Label */}
              <span className="intel-mono absolute" style={{
                bottom: 2, left: '50%', transform: 'translateX(-50%)',
                fontSize: 6, color: '#5baaff', fontWeight: 700, letterSpacing: '0.1em',
              }}>{d.label}</span>
            </div>
          ))}
        </div>

        {/* Statement buttons */}
        <div className="flex flex-col gap-0.5 w-full">
          {STATEMENTS.map(s => {
            const isCorrect = s.letter === CORRECT_LETTER
            const isPicked = step >= 3 && isCorrect
            // Highlight keywords (numbers) when step >= 2
            const highlightWords = ['4500', '270°', '240']
            const renderText = step >= 2
              ? s.text.split(/(\s+)/).map((tok, idx) => {
                  const matched = highlightWords.some(w => tok.includes(w))
                  return matched
                    ? <span key={idx} style={{ background: 'rgba(217,119,6,0.4)', color: '#fde68a', padding: '0 2px', borderRadius: 2 }}>{tok}</span>
                    : <span key={idx}>{tok}</span>
                })
              : s.text
            return (
              <div
                key={s.letter}
                className="rounded flex items-start gap-1.5"
                style={{
                  background: isPicked ? 'rgba(34,197,94,0.15)' : '#060e1a',
                  border: `1px solid ${isPicked ? '#22c55e' : '#1a3a5c'}`,
                  padding: '3px 6px',
                  opacity: step >= 3 && !isCorrect ? 0.4 : 1,
                  transition: 'all 0.3s',
                }}
              >
                <span className="intel-mono" style={{
                  fontSize: 7, color: isPicked ? '#86efac' : '#5baaff',
                  fontWeight: 800, lineHeight: 1.4,
                }}>{s.letter}</span>
                <p style={{ fontSize: 7, color: '#cbd5e1', lineHeight: 1.35 }}>
                  {renderText}
                </p>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
