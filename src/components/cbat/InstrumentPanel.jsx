import { useEffect, useState } from 'react'

// Spring-ish easing with slight overshoot — feels like a real needle settling.
const SPRING = 'cubic-bezier(0.34, 1.35, 0.64, 1)'

// Maintain an "unwrapped" angle so a CSS transition always takes the shortest
// arc — otherwise a prop change from 350° to 10° would spin 340° backwards.
// Initial state is randomised so the first paint places the needle off-target,
// and the effect's setState triggers the CSS transition towards the real value.
function useUnwrappedAngle(targetDeg) {
  const [angle, setAngle] = useState(() => Math.random() * 360)
  useEffect(() => {
    setAngle(prev => {
      const diff = ((targetDeg - prev) % 360 + 540) % 360 - 180
      return prev + diff
    })
  }, [targetDeg])
  return angle
}

// Linear interpolation — used for deflections that shouldn't wrap.
function useInterp(target, randomRange = 0) {
  const [v, setV] = useState(() => (Math.random() * 2 - 1) * randomRange)
  useEffect(() => { setV(target) }, [target])
  return v
}

function InstrumentFace({ label, children }) {
  return (
    <div className="bg-[#060e1a] border border-[#1a3a5c] rounded-xl p-2 flex flex-col items-center">
      <p className="text-[9px] text-slate-500 uppercase tracking-wide mb-1 text-center w-full">{label}</p>
      <svg viewBox="0 0 100 100" className="w-full max-w-[120px] aspect-square">
        <defs>
          <radialGradient id="faceBg" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#0a1628" />
            <stop offset="100%" stopColor="#060e1a" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="48" fill="url(#faceBg)" stroke="#1a3a5c" strokeWidth="1" />
        {children}
      </svg>
    </div>
  )
}

// ── Altimeter ────────────────────────────────────────────────────────────────
export function Altimeter({ altitude, durationMs = 2000 }) {
  const smallTarget = (altitude / 10000) * 360
  const bigTarget = ((altitude % 1000) / 1000) * 360
  const smallAngle = useUnwrappedAngle(smallTarget)
  const bigAngle = useUnwrappedAngle(bigTarget)
  const t = { transition: `transform ${durationMs}ms ${SPRING}`, transformOrigin: '50px 50px', transformBox: 'view-box' }
  return (
    <InstrumentFace label="Altimeter">
      {/* Major ticks + numerals 0–9 */}
      {Array.from({ length: 10 }).map((_, i) => {
        const theta = (i / 10) * 2 * Math.PI - Math.PI / 2
        const tx = 50 + 34 * Math.cos(theta)
        const ty = 50 + 34 * Math.sin(theta) + 3
        const x1 = 50 + 42 * Math.cos(theta)
        const y1 = 50 + 42 * Math.sin(theta)
        const x2 = 50 + 46 * Math.cos(theta)
        const y2 = 50 + 46 * Math.sin(theta)
        return (
          <g key={i}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#5a6a80" strokeWidth="1" />
            <text x={tx} y={ty} fill="#ddeaf8" fontSize="8" textAnchor="middle"
                  fontFamily="monospace" fontWeight="bold">{i}</text>
          </g>
        )
      })}
      {/* Minor ticks */}
      {Array.from({ length: 50 }).map((_, i) => {
        if (i % 5 === 0) return null
        const theta = (i / 50) * 2 * Math.PI - Math.PI / 2
        const x1 = 50 + 44 * Math.cos(theta)
        const y1 = 50 + 44 * Math.sin(theta)
        const x2 = 50 + 46 * Math.cos(theta)
        const y2 = 50 + 46 * Math.sin(theta)
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#3a4a60" strokeWidth="0.5" />
      })}
      {/* Big hand — hundreds (longer, thinner) */}
      <g style={{ ...t, transform: `rotate(${bigAngle}deg)` }}>
        <line x1="50" y1="50" x2="50" y2="14" stroke="#ddeaf8" strokeWidth="2" strokeLinecap="round" />
        <polygon points="50,10 47,18 53,18" fill="#ddeaf8" />
      </g>
      {/* Small hand — thousands (shorter, thicker, brand colour) */}
      <g style={{ ...t, transform: `rotate(${smallAngle}deg)` }}>
        <line x1="50" y1="50" x2="50" y2="28" stroke="#5baaff" strokeWidth="4" strokeLinecap="round" />
      </g>
      <circle cx="50" cy="50" r="3" fill="#5baaff" />
    </InstrumentFace>
  )
}

// ── Attitude Indicator ───────────────────────────────────────────────────────
export function AttitudeIndicator({ durationMs = 2000 }) {
  // All rounds generate level flight per spec, but the calibration sweep
  // starts with a slight bank + pitch wobble before settling to level.
  const [pitch, setPitch] = useState(() => -10 + Math.random() * 20)
  const [roll, setRoll] = useState(() => -18 + Math.random() * 36)
  useEffect(() => {
    // Two rAFs ensure the initial wobble paints before we transition to level.
    const id1 = requestAnimationFrame(() => {
      const id2 = requestAnimationFrame(() => {
        setPitch(0)
        setRoll(0)
      })
      return () => cancelAnimationFrame(id2)
    })
    return () => cancelAnimationFrame(id1)
  }, [durationMs])
  const t = `transform ${durationMs}ms ${SPRING}`
  return (
    <InstrumentFace label="Attitude">
      <defs>
        <clipPath id="attClip">
          <circle cx="50" cy="50" r="40" />
        </clipPath>
      </defs>
      <g clipPath="url(#attClip)">
        <g style={{ transition: t, transformOrigin: '50px 50px', transformBox: 'view-box', transform: `rotate(${roll}deg)` }}>
          <g style={{ transition: t, transform: `translateY(${pitch}px)` }}>
            {/* Sky */}
            <rect x="0" y="0" width="100" height="50" fill="#1d5fa8" />
            {/* Ground */}
            <rect x="0" y="50" width="100" height="50" fill="#6b4a2a" />
            {/* Horizon line */}
            <line x1="0" y1="50" x2="100" y2="50" stroke="#ddeaf8" strokeWidth="1.2" />
            {/* Pitch reference ladders */}
            <line x1="42" y1="40" x2="58" y2="40" stroke="#ddeaf8" strokeWidth="0.5" />
            <line x1="44" y1="45" x2="56" y2="45" stroke="#ddeaf8" strokeWidth="0.5" />
            <line x1="44" y1="55" x2="56" y2="55" stroke="#ddeaf8" strokeWidth="0.5" />
            <line x1="42" y1="60" x2="58" y2="60" stroke="#ddeaf8" strokeWidth="0.5" />
          </g>
        </g>
      </g>
      {/* Fixed aircraft silhouette */}
      <line x1="30" y1="50" x2="42" y2="50" stroke="#ffc857" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="58" y1="50" x2="70" y2="50" stroke="#ffc857" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="50" cy="50" r="2" fill="#ffc857" />
      {/* Outer ring mask */}
      <circle cx="50" cy="50" r="40" fill="none" stroke="#1a3a5c" strokeWidth="1.5" />
    </InstrumentFace>
  )
}

// ── Airspeed Indicator ───────────────────────────────────────────────────────
export function Airspeed({ knots, durationMs = 2000 }) {
  const target = (knots / 360) * 360  // 0–360 kt mapped 1:1 to degrees
  const angle = useInterp(target, 180)
  const t = { transition: `transform ${durationMs}ms ${SPRING}`, transformOrigin: '50px 50px', transformBox: 'view-box' }
  return (
    <InstrumentFace label="Airspeed (kt)">
      {/* Major ticks at 0, 60, 120, ... 300 */}
      {[0, 60, 120, 180, 240, 300].map(v => {
        const theta = (v / 360) * 2 * Math.PI - Math.PI / 2
        const tx = 50 + 34 * Math.cos(theta)
        const ty = 50 + 34 * Math.sin(theta) + 3
        const x1 = 50 + 42 * Math.cos(theta)
        const y1 = 50 + 42 * Math.sin(theta)
        const x2 = 50 + 46 * Math.cos(theta)
        const y2 = 50 + 46 * Math.sin(theta)
        return (
          <g key={v}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#5a6a80" strokeWidth="1" />
            <text x={tx} y={ty} fill="#ddeaf8" fontSize="7" textAnchor="middle"
                  fontFamily="monospace" fontWeight="bold">{v}</text>
          </g>
        )
      })}
      {/* Minor ticks every 20 */}
      {Array.from({ length: 18 }).map((_, i) => {
        const v = i * 20
        if (v % 60 === 0) return null
        const theta = (v / 360) * 2 * Math.PI - Math.PI / 2
        const x1 = 50 + 44 * Math.cos(theta)
        const y1 = 50 + 44 * Math.sin(theta)
        const x2 = 50 + 46 * Math.cos(theta)
        const y2 = 50 + 46 * Math.sin(theta)
        return <line key={v} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#3a4a60" strokeWidth="0.5" />
      })}
      {/* Needle */}
      <g style={{ ...t, transform: `rotate(${angle}deg)` }}>
        <polygon points="50,50 47,50 50,12 53,50" fill="#5baaff" />
      </g>
      <circle cx="50" cy="50" r="3" fill="#5baaff" />
    </InstrumentFace>
  )
}

// ── Vertical Speed Indicator (Ascend/Descend) ────────────────────────────────
// Needle rests at 9 o'clock (pointing left). Up = climb, down = descend.
export function VSI({ vs, durationMs = 2000 }) {
  const target = vs === 'Ascend' ? -60 : vs === 'Descend' ? -120 : -90
  const angle = useUnwrappedAngle(target)
  const t = { transition: `transform ${durationMs}ms ${SPRING}`, transformOrigin: '50px 50px', transformBox: 'view-box' }
  return (
    <InstrumentFace label="V. Speed">
      {/* Scale marks along the left arc */}
      {[-150, -120, -90, -60, -30].map(deg => {
        const theta = (deg * Math.PI) / 180 - Math.PI / 2
        const x1 = 50 + 42 * Math.cos(theta)
        const y1 = 50 + 42 * Math.sin(theta)
        const x2 = 50 + 46 * Math.cos(theta)
        const y2 = 50 + 46 * Math.sin(theta)
        return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#5a6a80" strokeWidth="1" />
      })}
      {/* UP / DN text */}
      <text x="22" y="26" fill="#5a6a80" fontSize="6" fontFamily="monospace" fontWeight="bold">UP</text>
      <text x="22" y="79" fill="#5a6a80" fontSize="6" fontFamily="monospace" fontWeight="bold">DN</text>
      <text x="8" y="54" fill="#ddeaf8" fontSize="7" fontFamily="monospace" fontWeight="bold">0</text>
      {/* Needle */}
      <g style={{ ...t, transform: `rotate(${angle}deg)` }}>
        <line x1="50" y1="50" x2="50" y2="14" stroke="#5baaff" strokeWidth="2.5" strokeLinecap="round" />
      </g>
      <circle cx="50" cy="50" r="3" fill="#5baaff" />
    </InstrumentFace>
  )
}

// ── Heading Indicator (Directional Gyro) ─────────────────────────────────────
// Compass rose rotates so the current heading sits at the top.
export function HeadingDG({ heading, durationMs = 2000 }) {
  const headingDeg = { N: 0, E: 90, S: 180, W: 270 }[heading] ?? 0
  // Rotate rose so heading sits at top: rose rotation = -heading
  const roseAngle = useUnwrappedAngle(-headingDeg)
  const t = { transition: `transform ${durationMs}ms ${SPRING}`, transformOrigin: '50px 50px', transformBox: 'view-box' }
  const cardinals = [
    { label: 'N', deg: 0 },
    { label: 'E', deg: 90 },
    { label: 'S', deg: 180 },
    { label: 'W', deg: 270 },
  ]
  return (
    <InstrumentFace label="Heading">
      <g style={{ ...t, transform: `rotate(${roseAngle}deg)` }}>
        {/* Tick marks every 30° */}
        {Array.from({ length: 12 }).map((_, i) => {
          const deg = i * 30
          const theta = (deg * Math.PI) / 180 - Math.PI / 2
          const x1 = 50 + 42 * Math.cos(theta)
          const y1 = 50 + 42 * Math.sin(theta)
          const x2 = 50 + 46 * Math.cos(theta)
          const y2 = 50 + 46 * Math.sin(theta)
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#5a6a80" strokeWidth="1" />
        })}
        {/* Cardinal letters */}
        {cardinals.map(({ label, deg }) => {
          const theta = (deg * Math.PI) / 180 - Math.PI / 2
          const x = 50 + 34 * Math.cos(theta)
          const y = 50 + 34 * Math.sin(theta) + 3
          return (
            <text key={label} x={x} y={y} fill="#ddeaf8" fontSize="10" textAnchor="middle"
                  fontFamily="monospace" fontWeight="bold">{label}</text>
          )
        })}
      </g>
      {/* Fixed aircraft silhouette pointing up (the lubber line) */}
      <polygon points="50,30 45,44 50,41 55,44" fill="#ffc857" />
      <rect x="48" y="41" width="4" height="16" fill="#ffc857" />
      <rect x="41" y="48" width="18" height="3" fill="#ffc857" />
      <rect x="46" y="57" width="8" height="2" fill="#ffc857" />
      {/* Fixed top index triangle */}
      <polygon points="50,6 47,12 53,12" fill="#ffc857" />
    </InstrumentFace>
  )
}

// ── Turn Coordinator ─────────────────────────────────────────────────────────
// Needle deflects right for a turn. "Level" box below shows a white dot when
// no turn is applied; deflected when turning.
export function TurnCoordinator({ turn, durationMs = 2000 }) {
  const needleTarget = turn === 'Standard' ? 20 : turn === 'Non-standard' ? 40 : 0
  const ballTarget = turn === 'Standard' ? 8 : turn === 'Non-standard' ? 16 : 0
  const needleAngle = useUnwrappedAngle(needleTarget)
  const ballX = useInterp(ballTarget, 10)
  const t = `transform ${durationMs}ms ${SPRING}`
  return (
    <InstrumentFace label="Turn">
      {/* L / R labels */}
      <text x="18" y="38" fill="#5a6a80" fontSize="7" fontFamily="monospace" fontWeight="bold">L</text>
      <text x="78" y="38" fill="#5a6a80" fontSize="7" fontFamily="monospace" fontWeight="bold">R</text>
      {/* Wingtip reference marks */}
      <line x1="22" y1="50" x2="30" y2="50" stroke="#5a6a80" strokeWidth="1" />
      <line x1="70" y1="50" x2="78" y2="50" stroke="#5a6a80" strokeWidth="1" />
      {/* Standard-rate turn marks */}
      <line x1="25" y1="40" x2="29" y2="44" stroke="#5a6a80" strokeWidth="1" />
      <line x1="71" y1="44" x2="75" y2="40" stroke="#5a6a80" strokeWidth="1" />
      {/* Aircraft silhouette — rotates with the turn rate */}
      <g style={{ transition: t, transformOrigin: '50px 50px', transformBox: 'view-box', transform: `rotate(${needleAngle}deg)` }}>
        <rect x="32" y="48" width="36" height="3" fill="#5baaff" rx="1" />
        <rect x="46" y="42" width="8" height="12" fill="#5baaff" rx="1" />
      </g>
      {/* Inclinometer — "Level" box */}
      <g>
        <rect x="32" y="72" width="36" height="10" rx="5" fill="#060e1a" stroke="#1a3a5c" strokeWidth="1" />
        <line x1="46" y1="72" x2="46" y2="82" stroke="#1a3a5c" strokeWidth="0.5" />
        <line x1="54" y1="72" x2="54" y2="82" stroke="#1a3a5c" strokeWidth="0.5" />
        <circle cx="50" cy="77" r="3"
          fill="#ffffff"
          style={{ transition: t, transformOrigin: '50px 77px', transformBox: 'view-box', transform: `translateX(${ballX}px)` }} />
      </g>
      <text x="50" y="66" fill="#5a6a80" fontSize="5" textAnchor="middle"
            fontFamily="monospace" fontWeight="bold">LEVEL</text>
    </InstrumentFace>
  )
}

// ── Combined panel ───────────────────────────────────────────────────────────
export default function InstrumentPanel({ altitude, airspeed, heading, vs, turn, durationMs }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <Altimeter altitude={altitude} durationMs={durationMs} />
      <AttitudeIndicator durationMs={durationMs} />
      <Airspeed knots={airspeed} durationMs={durationMs} />
      <VSI vs={vs} durationMs={durationMs} />
      <HeadingDG heading={heading} durationMs={durationMs} />
      <TurnCoordinator turn={turn} durationMs={durationMs} />
    </div>
  )
}
