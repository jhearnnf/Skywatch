// The two instruments for Instruments Orientation: a full attitude indicator
// and a heading indicator, both taking degrees.
//
// The Reading game's dials (InstrumentPanel.jsx) take named states, animate
// into place and are tap-to-highlight; these take exact angles and show them
// at once, because here the instrument IS the question. The attitude
// indicator has the roll scale along its top edge that applicants say the
// real one has: bank is read there, or from which way the horizon tilts.

const FACE_TEXT = 'var(--color-game-text)'
const FACE_LINE = 'var(--color-game-line)'
const SYMBOL = '#ffc857'

function Face({ label, children, testId, ...data }) {
  return (
    <div className="bg-game-arena border border-game-line rounded-xl p-2 flex flex-col items-center w-full" data-testid={testId} {...data}>
      <p className="text-[9px] lg:text-[11px] uppercase tracking-wide mb-1 text-center w-full text-slate-500">{label}</p>
      <svg viewBox="0 0 100 100" className="w-full aspect-square pointer-events-none" aria-hidden="true">
        <circle cx="50" cy="50" r="48" fill="var(--color-game-panel)" stroke={FACE_LINE} strokeWidth="1" />
        {children}
      </svg>
    </div>
  )
}

// Roll scale marks, in degrees either side of wings-level. The long ones are
// the ones a pilot flies to.
const ROLL_MARKS = [
  { deg: 10, len: 3 }, { deg: 20, len: 3 }, { deg: 30, len: 6 }, { deg: 45, len: 4 }, { deg: 60, len: 6 },
]
const PX_PER_PITCH_DEG = 1.1

export function OrientationAttitude({ pitchDeg, bankDeg }) {
  // A right bank rolls the case clockwise with the aircraft, so the earth-
  // fixed horizon appears to turn anticlockwise. Nose up moves the horizon
  // down the face.
  const roll = -bankDeg
  const shift = pitchDeg * PX_PER_PITCH_DEG
  return (
    <Face label="Attitude" testId="orientation-attitude" data-pitch={pitchDeg} data-bank={bankDeg}>
      <defs>
        <clipPath id="orientAttClip">
          <circle cx="50" cy="50" r="42" />
        </clipPath>
      </defs>
      <g clipPath="url(#orientAttClip)">
        <g transform={`rotate(${roll} 50 50)`}>
          <g transform={`translate(0 ${shift})`}>
            <rect x="-100" y="-150" width="300" height="200" fill="#1d5fa8" />
            <rect x="-100" y="50" width="300" height="200" fill="#6b4a2a" />
            <line x1="-100" y1="50" x2="200" y2="50" stroke={FACE_TEXT} strokeWidth="1.2" />
            {/* Pitch ladder: 10° and 20° up and down */}
            {[10, 20].map(d => {
              const dy = d * PX_PER_PITCH_DEG
              const half = d === 20 ? 9 : 6
              return (
                <g key={d}>
                  <line x1={50 - half} y1={50 - dy} x2={50 + half} y2={50 - dy} stroke={FACE_TEXT} strokeWidth="0.7" />
                  <line x1={50 - half} y1={50 + dy} x2={50 + half} y2={50 + dy} stroke={FACE_TEXT} strokeWidth="0.7" />
                  <text x={50 + half + 2} y={50 - dy + 1.6} fill={FACE_TEXT} fontSize="4.5" fontFamily="monospace">{d}</text>
                  <text x={50 + half + 2} y={50 + dy + 1.6} fill={FACE_TEXT} fontSize="4.5" fontFamily="monospace">{d}</text>
                </g>
              )
            })}
          </g>
          {/* Sky pointer: rides with the horizon, read against the fixed scale */}
          <polygon points="50,10 47.2,15.5 52.8,15.5" fill={FACE_TEXT} />
        </g>
      </g>
      {/* Fixed roll scale along the top edge of the case */}
      <polygon points="50,4.5 47.4,9.5 52.6,9.5" fill={SYMBOL} />
      {ROLL_MARKS.flatMap(({ deg, len }) => [-deg, deg].map(d => {
        const theta = (-90 + d) * Math.PI / 180
        const r0 = 42, r1 = 42 - len
        return (
          <line
            key={d}
            x1={50 + r0 * Math.cos(theta)} y1={50 + r0 * Math.sin(theta)}
            x2={50 + r1 * Math.cos(theta)} y2={50 + r1 * Math.sin(theta)}
            stroke={FACE_TEXT} strokeWidth={len >= 6 ? 1.4 : 0.9}
          />
        )
      }))}
      {/* Fixed aircraft symbol */}
      <line x1="26" y1="50" x2="42" y2="50" stroke={SYMBOL} strokeWidth="2.5" strokeLinecap="round" />
      <line x1="58" y1="50" x2="74" y2="50" stroke={SYMBOL} strokeWidth="2.5" strokeLinecap="round" />
      <line x1="42" y1="50" x2="46" y2="54" stroke={SYMBOL} strokeWidth="2" strokeLinecap="round" />
      <line x1="58" y1="50" x2="54" y2="54" stroke={SYMBOL} strokeWidth="2" strokeLinecap="round" />
      <circle cx="50" cy="50" r="1.8" fill={SYMBOL} />
      <circle cx="50" cy="50" r="42" fill="none" stroke={FACE_LINE} strokeWidth="1.5" />
    </Face>
  )
}

// A heading indicator's card: letters at the cardinals, tens of degrees in
// between, so 045 reads as "between N and E, past the 3".
const CARD_LABELS = ['N', '3', '6', 'E', '12', '15', 'S', '21', '24', 'W', '30', '33']

export function OrientationCompass({ headingDeg }) {
  return (
    <Face label="Heading" testId="orientation-compass" data-heading={headingDeg}>
      <g transform={`rotate(${-headingDeg} 50 50)`}>
        {Array.from({ length: 36 }).map((_, i) => {
          const deg = i * 10
          const theta = (deg - 90) * Math.PI / 180
          const major = deg % 30 === 0
          const r1 = major ? 37 : 40
          return (
            <line
              key={deg}
              x1={50 + 43 * Math.cos(theta)} y1={50 + 43 * Math.sin(theta)}
              x2={50 + r1 * Math.cos(theta)} y2={50 + r1 * Math.sin(theta)}
              stroke={major ? FACE_TEXT : 'var(--color-game-faint)'} strokeWidth={major ? 1.2 : 0.7}
            />
          )
        })}
        {CARD_LABELS.map((label, i) => {
          const deg = i * 30
          const cardinal = label.length === 1
          return (
            <text
              key={label}
              x="50" y={cardinal ? 21 : 22}
              transform={`rotate(${deg} 50 50)`}
              fill={FACE_TEXT}
              fontSize={cardinal ? 9 : 6}
              fontWeight={cardinal ? 'bold' : 'normal'}
              fontFamily="monospace"
              textAnchor="middle"
            >
              {label}
            </text>
          )
        })}
      </g>
      {/* Lubber line and the fixed aircraft symbol */}
      <polygon points="50,3.5 47,9 53,9" fill={SYMBOL} />
      <polygon points="50,34 45,46 50,43 55,46" fill={SYMBOL} />
      <rect x="48" y="43" width="4" height="16" fill={SYMBOL} />
      <rect x="41" y="50" width="18" height="3" fill={SYMBOL} />
      <rect x="46" y="59" width="8" height="2" fill={SYMBOL} />
    </Face>
  )
}

export default function OrientationInstruments({ attitude }) {
  return (
    // Capped on a phone so the dials and the four pictures fit one screen
    // together; on anything wider the dials take the panel.
    <div className="grid grid-cols-2 gap-2 lg:gap-3 max-w-[17rem] mx-auto sm:max-w-none">
      <OrientationAttitude pitchDeg={attitude.pitch} bankDeg={attitude.bank} />
      <OrientationCompass headingDeg={attitude.heading} />
    </div>
  )
}
