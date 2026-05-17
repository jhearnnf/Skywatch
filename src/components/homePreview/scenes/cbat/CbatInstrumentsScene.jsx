import { useEffect, useState } from 'react'
import CbatBg from './_cbatBg'
import InstrumentPanel from '../../../cbat/InstrumentPanel'

// Mirrors the real Instruments play by lifting the exact `InstrumentPanel`
// the real game renders (six round dials in a 3-col grid: altimeter, attitude,
// airspeed, VSI, heading, turn coordinator). Statement buttons below pick the
// flight state matching the dials. Keywords highlight in amber on inspection.

// Flight state the dials display — matches statement A.
const STATE = {
  altitude: 4500,
  airspeed: 240,
  heading: 'W',     // 270°
  vs:      'Ascend',
  turn:    'Level',
}

const STATEMENTS = [
  { letter: 'A', text: 'Climbing through 4500 ft, heading W, airspeed 240 kt.' },
  { letter: 'B', text: 'Level at 3000 ft, banking right, airspeed 180 kt.' },
  { letter: 'C', text: 'Descending at 4500 ft, heading E, airspeed 240 kt.' },
  { letter: 'D', text: 'Climbing through 4500 ft, heading W, airspeed 180 kt.' },
  { letter: 'E', text: 'Level at 4500 ft, heading N, airspeed 240 kt.' },
]
const CORRECT_LETTER = 'A'
// Tokens that should be highlighted in amber during the "inspect" step — these
// are the values the player would read off the dials.
const HIGHLIGHTS = ['4500', 'W', '240', 'Climbing']

export default function CbatInstrumentsScene({ runKey }) {
  // 0 = calibrating (needles settling), 1 = inspect, 2 = highlight, 3 = pick
  const [step, setStep] = useState(0)
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
      <div className="absolute inset-0 px-3 pt-16 sm:pt-24 pb-3 flex flex-col items-center">

        {/* HUD */}
        <div className="flex justify-between items-center w-full mb-1.5 intel-mono" style={{ fontSize: 8 }}>
          <span style={{ color: '#5baaff', letterSpacing: '0.15em', fontWeight: 700 }}>ROUND 2 · CALIBRATE</span>
          <span style={{ color: '#fbbf24', letterSpacing: '0.15em', fontWeight: 700 }}>00:18</span>
        </div>

        {/* Real cockpit dials, lifted directly from the game. `key` flips on
            replay so the panel's random initial-needle phase re-rolls and the
            dials spring towards their values again. */}
        <div className="w-full mb-2" style={{ maxWidth: 300 }}>
          <InstrumentPanel
            key={`panel-${runKey}`}
            altitude={STATE.altitude}
            airspeed={STATE.airspeed}
            heading={STATE.heading}
            vs={STATE.vs}
            turn={STATE.turn}
            durationMs={1400}
          />
        </div>

        {/* Statement buttons — bigger type than the previous build for
            legibility; matches the rest of the preview-window typography. */}
        <div className="flex flex-col gap-1 w-full">
          {STATEMENTS.map(s => {
            const isCorrect = s.letter === CORRECT_LETTER
            const isPicked = step >= 3 && isCorrect
            const renderText = step >= 2
              ? s.text.split(/(\s+)/).map((tok, idx) => {
                  const matched = HIGHLIGHTS.some(w => tok.includes(w))
                  return matched
                    ? <span key={idx} style={{ background: 'rgba(217,119,6,0.45)', color: '#fde68a', padding: '0 3px', borderRadius: 3 }}>{tok}</span>
                    : <span key={idx}>{tok}</span>
                })
              : s.text
            return (
              <div
                key={s.letter}
                className="rounded flex items-start gap-2"
                style={{
                  background: isPicked ? 'rgba(34,197,94,0.18)' : '#060e1a',
                  border: `1px solid ${isPicked ? '#22c55e' : '#1a3a5c'}`,
                  padding: '4px 8px',
                  opacity: step >= 3 && !isCorrect ? 0.4 : 1,
                  transition: 'all 0.3s',
                }}
              >
                <span className="intel-mono" style={{
                  fontSize: 11, color: isPicked ? '#86efac' : '#5baaff',
                  fontWeight: 800, lineHeight: 1.3,
                }}>{s.letter}</span>
                <p style={{ fontSize: 10, color: '#e2e8f0', lineHeight: 1.35 }}>
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
