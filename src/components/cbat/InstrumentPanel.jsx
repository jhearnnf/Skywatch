import { useEffect, useId, useState } from 'react'

// Spring-ish easing with slight overshoot — feels like a real needle settling.
const SPRING = 'cubic-bezier(0.34, 1.35, 0.64, 1)'

// Safari will not rotate these dials around the middle of the face.
//
// `transform-origin` on an SVG element is resolved against a reference box,
// and Safari does not reliably honour `transform-box: view-box` — it measures
// the element's OWN bounding box instead. A needle's bounding box is the
// needle, so `transform-origin: 50px 50px` resolved to a point roughly half a
// face away from the dial centre: needles swung out of the instrument
// entirely, settled with their tails off-centre, and the compass rose spun its
// cardinals out past the bezel.
//
// `fill-box` is the one reference box every browser agrees on, so pin the
// bounding box rather than argue about which box to use. Every transformed
// group carries this invisible square: centred on (50,50) and large enough to
// swallow the group whatever the animation is doing, so the bounding box stays
// symmetric about the face centre. `fill-box` + `50% 50%` then means the dial
// centre in every browser — including one that ignores transform-box
// altogether, since the bounding box IS its fallback behaviour.
const PIVOT = { transformBox: 'fill-box', transformOrigin: '50% 50%' }

// Render inside any group that uses PIVOT. `fill="none"` paints nothing but
// still counts as geometry, which is all a bounding box is made of.
function Pivot() {
  return <rect x="-50" y="-50" width="200" height="200" fill="none" />
}

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

// Live mode. The practice drill feeds the dials a reading every frame and
// passes durationMs={0}: the needles then sit exactly where the prop says,
// with no transition and none of the settling wobble the Reading game uses
// to hide the answer while it "calibrates".
const isLive = durationMs => durationMs === 0
const needleTransition = (durationMs) => (isLive(durationMs) ? 'none' : `transform ${durationMs}ms ${SPRING}`)

// The target reading the drill asks the player to fly to. Magenta, as target
// bugs are on real glass cockpits, so it never reads as one of the amber
// aircraft symbols already on the faces.
export const TARGET_COLOUR = '#ff4fd8'

// Linear interpolation — used for deflections that shouldn't wrap.
function useInterp(target, randomRange = 0) {
  const [v, setV] = useState(() => (Math.random() * 2 - 1) * randomRange)
  useEffect(() => { setV(target) }, [target])
  return v
}

// Six faces share one document, so a literal id="faceBg" would give every
// instrument the first face's gradient. Scope the id per instance instead.
function useLocalId(prefix) {
  return `${prefix}-${useId().replace(/:/g, '')}`
}

// `tone` is the practice drill's: 'dim' greys a face out, 'target' lights the
// one being asked about, 'match' turns it green once the reading is on.
const TONE_CLASS = {
  dim: 'border-game-line opacity-25 grayscale',
  target: 'border-amber-700 ring-2 ring-amber-700/40',
  match: 'border-green-500 ring-2 ring-green-500/50',
}

function InstrumentFace({ label, children, onClick, active, tone }) {
  const clickable = typeof onClick === 'function'
  const faceBg = useLocalId('faceBg')
  const wrapperClass = [
    'bg-game-arena border rounded-xl p-2 flex flex-col items-center transition-colors w-full',
    tone ? TONE_CLASS[tone] : active ? 'border-amber-700 ring-2 ring-amber-700/40' : 'border-game-line',
    clickable && !active ? 'hover:border-brand-500' : '',
    clickable ? 'cursor-pointer active:scale-[0.98] transition-transform' : '',
  ].filter(Boolean).join(' ')
  const labelClass = tone === 'match' ? 'text-green-400'
    : (active || tone === 'target') ? 'text-amber-700'
    : 'text-slate-500'
  const inner = (
    <>
      <p className={`text-[9px] uppercase tracking-wide mb-1 text-center w-full ${labelClass}`}>{label}</p>
      <svg viewBox="0 0 100 100" className="w-full max-w-[120px] aspect-square pointer-events-none">
        <defs>
          <radialGradient id={faceBg} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--color-game-panel)" />
            <stop offset="100%" stopColor="var(--color-game-arena)" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="48" fill={`url(#${faceBg})`} stroke="var(--color-game-line)" strokeWidth="1" />
        {children}
      </svg>
    </>
  )
  if (clickable) {
    return (
      <button type="button" onClick={onClick} aria-pressed={!!active} className={wrapperClass}>
        {inner}
      </button>
    )
  }
  return <div className={wrapperClass}>{inner}</div>
}

// ── Altimeter ────────────────────────────────────────────────────────────────
export function Altimeter({ altitude, durationMs = 2000, onClick, active, tone, target }) {
  const smallTarget = (altitude / 10000) * 360
  const bigTarget = ((altitude % 1000) / 1000) * 360
  const live = isLive(durationMs)
  const smallUnwrapped = useUnwrappedAngle(smallTarget)
  const bigUnwrapped = useUnwrappedAngle(bigTarget)
  const smallAngle = live ? smallTarget : smallUnwrapped
  const bigAngle = live ? bigTarget : bigUnwrapped
  const t = { transition: needleTransition(durationMs), ...PIVOT }
  return (
    <InstrumentFace label="Altimeter" onClick={onClick} active={active} tone={tone}>
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
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--color-game-faint)" strokeWidth="1" />
            <text x={tx} y={ty} fill="var(--color-game-text)" fontSize="8" textAnchor="middle"
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
      {/* Target hands, under the live ones */}
      {target != null && (
        <g data-target="altimeter">
          <g style={{ ...PIVOT, transform: `rotate(${((target % 1000) / 1000) * 360}deg)` }}>
            <Pivot />
            <line x1="50" y1="50" x2="50" y2="12" stroke={TARGET_COLOUR} strokeWidth="2.2" strokeLinecap="round" />
          </g>
          <g style={{ ...PIVOT, transform: `rotate(${(target / 10000) * 360}deg)` }}>
            <Pivot />
            <line x1="50" y1="50" x2="50" y2="26" stroke={TARGET_COLOUR} strokeWidth="5" strokeLinecap="round" opacity="0.8" />
          </g>
        </g>
      )}
      {/* Big hand — hundreds (longer, thinner) */}
      <g style={{ ...t, transform: `rotate(${bigAngle}deg)` }}>
        <Pivot />
        <line x1="50" y1="50" x2="50" y2="14" stroke="var(--color-game-text)" strokeWidth="2" strokeLinecap="round" />
        <polygon points="50,10 47,18 53,18" fill="var(--color-game-text)" />
      </g>
      {/* Small hand — thousands (shorter, thicker, brand colour) */}
      <g style={{ ...t, transform: `rotate(${smallAngle}deg)` }}>
        <Pivot />
        <line x1="50" y1="50" x2="50" y2="28" stroke="var(--color-game-accent)" strokeWidth="4" strokeLinecap="round" />
      </g>
      <circle cx="50" cy="50" r="3" fill="var(--color-game-accent)" />
    </InstrumentFace>
  )
}

// ── Attitude Indicator ───────────────────────────────────────────────────────
// Shows pitch (from `vs` — climb/descend) and roll (from `turn` — bank angle).
// In a real cockpit this is the primary instrument; clicking it highlights
// both the climb/descend phrase AND the turn phrase in the answers, because
// it reflects both pieces of flight state at once.
// Horizon travel per degree of pitch. The Reading game's climb shows as 12
// units, which reads as about 20° of pitch.
const PITCH_UNITS_PER_DEG = 0.6

// Live mode takes `pitchDeg` / `bankDeg` instead of the `vs` / `turn` words,
// and `target` = { pitch, bank } draws the horizon the drill wants.
export function AttitudeIndicator({ vs, turn, durationMs = 2000, onClick, active, tone, pitchDeg, bankDeg, target }) {
  // Pitch translates the horizon — positive moves it down (nose-up climb).
  const targetPitch = vs === 'Ascend' ? 12 : vs === 'Descend' ? -12 : 0
  // Roll rotates the horizon opposite the bank — right bank shows as horizon
  // rotating counter-clockwise (negative degrees).
  const targetRoll = turn === 'Standard' ? -15 : turn === 'Non-standard' ? -30 : 0
  const attClip = useLocalId('attClip')
  const [pitch, setPitch] = useState(() => -10 + Math.random() * 20)
  const [roll, setRoll] = useState(() => -18 + Math.random() * 36)
  useEffect(() => {
    // Two rAFs ensure the initial wobble paints before we transition.
    const id1 = requestAnimationFrame(() => {
      const id2 = requestAnimationFrame(() => {
        setPitch(targetPitch)
        setRoll(targetRoll)
      })
      return () => cancelAnimationFrame(id2)
    })
    return () => cancelAnimationFrame(id1)
  }, [durationMs, targetPitch, targetRoll])
  const t = needleTransition(durationMs)
  const live = isLive(durationMs) && pitchDeg != null
  const shownPitch = live ? pitchDeg * PITCH_UNITS_PER_DEG : pitch
  const shownRoll = live ? -(bankDeg ?? 0) : roll
  return (
    <InstrumentFace label="Attitude" onClick={onClick} active={active} tone={tone}>
      <defs>
        <clipPath id={attClip}>
          <circle cx="50" cy="50" r="40" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${attClip})`}>
        <g style={{ transition: t, ...PIVOT, transform: `rotate(${shownRoll}deg)` }}>
          <Pivot />
          {/* Pitch only translates, and a translation ignores the origin, so
              this inner group needs no pivot of its own. */}
          <g style={{ transition: t, transform: `translateY(${shownPitch}px)` }}>
            {/* Sky and ground overhang the face on every side. They are clipped
                to a circle spanning 10..90, and pitch slides them up to 12 away
                from centre while roll turns them, so a band that merely filled
                the viewBox left a sliver of page background showing inside the
                ball on any climb or descend question. */}
            {/* Sky */}
            <rect x="-40" y="-40" width="180" height="90" fill="#1d5fa8" />
            {/* Ground */}
            <rect x="-40" y="50" width="180" height="90" fill="#6b4a2a" />
            {/* Horizon line */}
            <line x1="-40" y1="50" x2="140" y2="50" stroke="var(--color-game-text)" strokeWidth="1.2" />
            {/* Pitch reference ladders */}
            <line x1="42" y1="40" x2="58" y2="40" stroke="var(--color-game-text)" strokeWidth="0.5" />
            <line x1="44" y1="45" x2="56" y2="45" stroke="var(--color-game-text)" strokeWidth="0.5" />
            <line x1="44" y1="55" x2="56" y2="55" stroke="var(--color-game-text)" strokeWidth="0.5" />
            <line x1="42" y1="60" x2="58" y2="60" stroke="var(--color-game-text)" strokeWidth="0.5" />
          </g>
        </g>
        {/* The horizon the drill wants, drawn where the real one would sit */}
        {target && (
          <g style={{ ...PIVOT, transform: `rotate(${-target.bank}deg)` }} data-target="attitude">
            <Pivot />
            <g style={{ transform: `translateY(${target.pitch * PITCH_UNITS_PER_DEG}px)` }}>
              <line x1="4" y1="50" x2="96" y2="50" stroke={TARGET_COLOUR} strokeWidth="2.2" strokeDasharray="5 3" />
            </g>
          </g>
        )}
      </g>
      {/* Fixed aircraft silhouette */}
      <line x1="30" y1="50" x2="42" y2="50" stroke="#ffc857" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="58" y1="50" x2="70" y2="50" stroke="#ffc857" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="50" cy="50" r="2" fill="#ffc857" />
      {/* Outer ring mask */}
      <circle cx="50" cy="50" r="40" fill="none" stroke="var(--color-game-line)" strokeWidth="1.5" />
    </InstrumentFace>
  )
}

// ── Airspeed Indicator ───────────────────────────────────────────────────────
export function Airspeed({ knots, durationMs = 2000, onClick, active, tone, target }) {
  const needle = (knots / 360) * 360  // 0–360 kt mapped 1:1 to degrees
  const settling = useInterp(needle, 180)
  const angle = isLive(durationMs) ? needle : settling
  const t = { transition: needleTransition(durationMs), ...PIVOT }
  return (
    <InstrumentFace label="Airspeed (kt)" onClick={onClick} active={active} tone={tone}>
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
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--color-game-faint)" strokeWidth="1" />
            <text x={tx} y={ty} fill="var(--color-game-text)" fontSize="7" textAnchor="middle"
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
      {target != null && (
        <g style={{ ...PIVOT, transform: `rotate(${target}deg)` }} data-target="airspeed">
          <Pivot />
          <polygon points="50,50 46,50 50,9 54,50" fill={TARGET_COLOUR} opacity="0.85" />
        </g>
      )}
      {/* Needle */}
      <g style={{ ...t, transform: `rotate(${angle}deg)` }}>
        <Pivot />
        <polygon points="50,50 47,50 50,12 53,50" fill="var(--color-game-accent)" />
      </g>
      <circle cx="50" cy="50" r="3" fill="var(--color-game-accent)" />
    </InstrumentFace>
  )
}

// ── Vertical Speed Indicator (Ascend/Descend) ────────────────────────────────
// Needle rests at 9 o'clock (pointing left). Up = climb, down = descend.
// Live mode takes `fpm`: each scale mark is 1,000 ft/min, so the Reading
// game's "Ascend" needle is a 1,000 ft/min climb.
const vsiAngle = fpm => -90 + Math.max(-2.5, Math.min(2.5, fpm / 1000)) * 30

export function VSI({ vs, durationMs = 2000, onClick, active, tone, fpm, target }) {
  const word = vs === 'Ascend' ? -60 : vs === 'Descend' ? -120 : -90
  const settling = useUnwrappedAngle(word)
  const live = isLive(durationMs) && fpm != null
  const angle = live ? vsiAngle(fpm) : settling
  const t = { transition: needleTransition(durationMs), ...PIVOT }
  return (
    <InstrumentFace label="V. Speed" onClick={onClick} active={active} tone={tone}>
      {/* Scale marks along the left arc */}
      {[-150, -120, -90, -60, -30].map(deg => {
        const theta = (deg * Math.PI) / 180 - Math.PI / 2
        const x1 = 50 + 42 * Math.cos(theta)
        const y1 = 50 + 42 * Math.sin(theta)
        const x2 = 50 + 46 * Math.cos(theta)
        const y2 = 50 + 46 * Math.sin(theta)
        return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--color-game-faint)" strokeWidth="1" />
      })}
      {/* UP / DN text */}
      <text x="22" y="26" fill="var(--color-game-faint)" fontSize="6" fontFamily="monospace" fontWeight="bold">UP</text>
      <text x="22" y="79" fill="var(--color-game-faint)" fontSize="6" fontFamily="monospace" fontWeight="bold">DN</text>
      <text x="8" y="54" fill="var(--color-game-text)" fontSize="7" fontFamily="monospace" fontWeight="bold">0</text>
      {/* Thousands of feet a minute, on the live dial only */}
      {live && [[-60, '1'], [-30, '2'], [-120, '1'], [-150, '2']].map(([deg, label]) => {
        const theta = (deg * Math.PI) / 180 - Math.PI / 2
        return (
          <text key={deg} x={50 + 35 * Math.cos(theta)} y={50 + 35 * Math.sin(theta) + 2.5}
                fill="var(--color-game-faint)" fontSize="6" textAnchor="middle" fontFamily="monospace" fontWeight="bold">{label}</text>
        )
      })}
      {target != null && (
        <g style={{ ...PIVOT, transform: `rotate(${vsiAngle(target)}deg)` }} data-target="vs">
          <Pivot />
          <line x1="50" y1="50" x2="50" y2="11" stroke={TARGET_COLOUR} strokeWidth="3.5" strokeLinecap="round" opacity="0.85" />
        </g>
      )}
      {/* Needle */}
      <g style={{ ...t, transform: `rotate(${angle}deg)` }}>
        <Pivot />
        <line x1="50" y1="50" x2="50" y2="14" stroke="var(--color-game-accent)" strokeWidth="2.5" strokeLinecap="round" />
      </g>
      <circle cx="50" cy="50" r="3" fill="var(--color-game-accent)" />
    </InstrumentFace>
  )
}

// ── Heading Indicator (Directional Gyro) ─────────────────────────────────────
// Compass rose rotates so the current heading sits at the top.
// Live mode takes `headingDeg` (0-360) instead of the N/E/S/W word; `target`
// is a heading bug on the card, which sits under the top index when the
// aircraft is on that heading.
export function HeadingDG({ heading, durationMs = 2000, onClick, active, tone, headingDeg: liveHeading, target }) {
  const live = isLive(durationMs) && liveHeading != null
  const headingDeg = live ? liveHeading : ({ N: 0, E: 90, S: 180, W: 270 }[heading] ?? 0)
  // Rotate rose so heading sits at top: rose rotation = -heading
  const settling = useUnwrappedAngle(-headingDeg)
  const roseAngle = live ? -headingDeg : settling
  const t = { transition: needleTransition(durationMs), ...PIVOT }
  const cardinals = [
    { label: 'N', deg: 0 },
    { label: 'E', deg: 90 },
    { label: 'S', deg: 180 },
    { label: 'W', deg: 270 },
  ]
  return (
    <InstrumentFace label="Heading" onClick={onClick} active={active} tone={tone}>
      <g style={{ ...t, transform: `rotate(${roseAngle}deg)` }}>
        <Pivot />
        {target != null && (
          <g style={{ ...PIVOT, transform: `rotate(${target}deg)` }} data-target="heading">
            <Pivot />
            <polygon points="44,4 56,4 56,11 52,11 50,15 48,11 44,11" fill={TARGET_COLOUR} />
          </g>
        )}
        {/* Tick marks every 30° */}
        {Array.from({ length: 12 }).map((_, i) => {
          const deg = i * 30
          const theta = (deg * Math.PI) / 180 - Math.PI / 2
          const x1 = 50 + 42 * Math.cos(theta)
          const y1 = 50 + 42 * Math.sin(theta)
          const x2 = 50 + 46 * Math.cos(theta)
          const y2 = 50 + 46 * Math.sin(theta)
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--color-game-faint)" strokeWidth="1" />
        })}
        {/* Cardinal letters */}
        {cardinals.map(({ label, deg }) => {
          const theta = (deg * Math.PI) / 180 - Math.PI / 2
          const x = 50 + 34 * Math.cos(theta)
          const y = 50 + 34 * Math.sin(theta) + 3
          return (
            <text key={label} x={x} y={y} fill="var(--color-game-text)" fontSize="10" textAnchor="middle"
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
// Live mode takes `needleDeg`, the aircraft symbol's deflection (20 is the
// standard-rate mark, negative is left); `target` is a symbol at the rate the
// drill wants. The drill flies coordinated turns, so the ball stays centred.
export function TurnCoordinator({ turn, durationMs = 2000, onClick, active, tone, needleDeg, target }) {
  const needleTarget = turn === 'Standard' ? 20 : turn === 'Non-standard' ? 40 : 0
  const ballTarget = turn === 'Standard' ? 8 : turn === 'Non-standard' ? 16 : 0
  const live = isLive(durationMs) && needleDeg != null
  const settlingNeedle = useUnwrappedAngle(needleTarget)
  const settlingBall = useInterp(ballTarget, 10)
  const needleAngle = live ? needleDeg : settlingNeedle
  const ballX = live ? 0 : settlingBall
  const t = needleTransition(durationMs)
  return (
    <InstrumentFace label="Turn" onClick={onClick} active={active} tone={tone}>
      {/* L / R labels */}
      <text x="18" y="38" fill="var(--color-game-faint)" fontSize="7" fontFamily="monospace" fontWeight="bold">L</text>
      <text x="78" y="38" fill="var(--color-game-faint)" fontSize="7" fontFamily="monospace" fontWeight="bold">R</text>
      {/* Wingtip reference marks */}
      <line x1="22" y1="50" x2="30" y2="50" stroke="var(--color-game-faint)" strokeWidth="1" />
      <line x1="70" y1="50" x2="78" y2="50" stroke="var(--color-game-faint)" strokeWidth="1" />
      {/* Standard-rate turn marks */}
      <line x1="25" y1="40" x2="29" y2="44" stroke="var(--color-game-faint)" strokeWidth="1" />
      <line x1="71" y1="44" x2="75" y2="40" stroke="var(--color-game-faint)" strokeWidth="1" />
      {target != null && (
        <g style={{ ...PIVOT, transform: `rotate(${target}deg)` }} data-target="turn" opacity="0.85">
          <Pivot />
          <rect x="28" y="47.5" width="44" height="4" fill={TARGET_COLOUR} rx="1" />
        </g>
      )}
      {/* Aircraft silhouette — rotates with the turn rate */}
      <g style={{ transition: t, ...PIVOT, transform: `rotate(${needleAngle}deg)` }}>
        <Pivot />
        <rect x="32" y="48" width="36" height="3" fill="var(--color-game-accent)" rx="1" />
        <rect x="46" y="42" width="8" height="12" fill="var(--color-game-accent)" rx="1" />
      </g>
      {/* Inclinometer — "Level" box */}
      <g>
        <rect x="32" y="72" width="36" height="10" rx="5" fill="var(--color-game-arena)" stroke="var(--color-game-line)" strokeWidth="1" />
        <line x1="46" y1="72" x2="46" y2="82" stroke="var(--color-game-line)" strokeWidth="0.5" />
        <line x1="54" y1="72" x2="54" y2="82" stroke="var(--color-game-line)" strokeWidth="0.5" />
        <circle cx="50" cy="77" r="3"
          fill="#ffffff"
          style={{ transition: t, transform: `translateX(${ballX}px)` }} />
      </g>
      <text x="50" y="66" fill="var(--color-game-faint)" fontSize="5" textAnchor="middle"
            fontFamily="monospace" fontWeight="bold">LEVEL</text>
    </InstrumentFace>
  )
}

// ── Combined panel ───────────────────────────────────────────────────────────
export default function InstrumentPanel({ altitude, airspeed, heading, vs, turn, durationMs, highlightedKey, onToggleHighlight, large = false }) {
  const interactive = typeof onToggleHighlight === 'function'
  const handler = (k) => interactive ? () => onToggleHighlight(k) : undefined
  // `large` lifts the 120px face cap on desktop so the dials fill whatever
  // column the game gives them. The landing-page preview keeps the cap.
  const sizing = large ? ' lg:gap-3 lg:[&_svg]:max-w-none lg:[&_p]:text-[11px]' : ''
  return (
    <div className={`grid grid-cols-3 gap-2${sizing}`}>
      <Altimeter altitude={altitude} durationMs={durationMs} onClick={handler('altitude')} active={highlightedKey === 'altitude'} />
      <AttitudeIndicator vs={vs} turn={turn} durationMs={durationMs} onClick={handler('attitude')} active={highlightedKey === 'attitude'} />
      <Airspeed knots={airspeed} durationMs={durationMs} onClick={handler('airspeed')} active={highlightedKey === 'airspeed'} />
      <VSI vs={vs} durationMs={durationMs} onClick={handler('vs')} active={highlightedKey === 'vs'} />
      <HeadingDG heading={heading} durationMs={durationMs} onClick={handler('heading')} active={highlightedKey === 'heading'} />
      <TurnCoordinator turn={turn} durationMs={durationMs} onClick={handler('turn')} active={highlightedKey === 'turn'} />
    </div>
  )
}
