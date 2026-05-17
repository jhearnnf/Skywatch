import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import CbatBg from './_cbatBg'

// Mirrors the real DPT play: SQUARE arena scope (not circular — that's the
// signature DPT visual), bearing labels at every 45° in 3-digit format,
// minor ticks every 10°, gate markers (two dots + connecting line + letter
// or number label), aircraft tracks crossing the scope, and a numpad below
// suggesting bearing entry.

// Square arena placement — values are in scope-space (0..100). All bearing
// labels are pulled in from the edge by LABEL_INSET so they sit just inside
// the border, mirroring the real game's BEARING_LABELS render.
const LABEL_INSET = 9
const BEARINGS = [
  { deg: 360, x: 50,                  y: LABEL_INSET     }, // N
  { deg:  45, x: 100 - LABEL_INSET,   y: LABEL_INSET     }, // NE
  { deg:  90, x: 100 - LABEL_INSET,   y: 50              }, // E
  { deg: 135, x: 100 - LABEL_INSET,   y: 100 - LABEL_INSET }, // SE
  { deg: 180, x: 50,                  y: 100 - LABEL_INSET }, // S
  { deg: 225, x: LABEL_INSET,         y: 100 - LABEL_INSET }, // SW
  { deg: 270, x: LABEL_INSET,         y: 50              }, // W
  { deg: 315, x: LABEL_INSET,         y: LABEL_INSET     }, // NW
]
const MINOR_TICKS = Array.from({ length: 36 }).map((_, i) => i * 10).filter(b => b % 45 !== 0)

// Gates as 2-dot pairs with a letter/number ID — matches LETTER_GATE_COLOR
// (#5baaff) and NUMBER_GATE_COLOR (#9ed5ff) from the real game.
const GATES = [
  { id: 'A', kind: 'letter', p1: { x: 28, y: 28 }, p2: { x: 38, y: 35 } },
  { id: 'B', kind: 'letter', p1: { x: 62, y: 30 }, p2: { x: 72, y: 24 } },
  { id: '1', kind: 'number', p1: { x: 30, y: 72 }, p2: { x: 38, y: 78 } },
  { id: '2', kind: 'number', p1: { x: 64, y: 70 }, p2: { x: 74, y: 72 } },
]

const AIRCRAFT = [
  { id: 'AC1', from: { x: 14, y: 14 }, to: { x: 60, y: 52 }, color: '#5baaff', cs: 'HW01' },
  { id: 'AC2', from: { x: 88, y: 16 }, to: { x: 52, y: 58 }, color: '#9ed5ff', cs: 'EG02' },
  { id: 'AC3', from: { x: 84, y: 86 }, to: { x: 40, y: 50 }, color: '#5baaff', cs: 'RV03' },
]

// Numpad layout — same 3×3 + 0/Clr/Enter row pattern the real game uses.
const NUMPAD = [
  ['1','2','3'],
  ['4','5','6'],
  ['7','8','9'],
  ['CLR','0','SET'],
]

export default function CbatDptScene({ runKey }) {
  const [commandActive, setCommandActive] = useState(false)
  const [typed,         setTyped]         = useState('')
  useEffect(() => {
    setCommandActive(false); setTyped('')
    const t1 = setTimeout(() => setTyped('0'),   650)
    const t2 = setTimeout(() => setTyped('04'),  900)
    const t3 = setTimeout(() => setTyped('045'), 1150)
    const t4 = setTimeout(() => setCommandActive(true), 1450)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4) }
  }, [runKey])

  return (
    <div className="absolute inset-0 overflow-hidden">
      <CbatBg amber />
      <div className="absolute inset-0 px-3 pt-16 sm:pt-24 pb-3 flex flex-col gap-1.5">

        {/* HUD strip */}
        <div className="flex justify-between items-center intel-mono" style={{ fontSize: 8 }}>
          <span style={{ color: '#5baaff', letterSpacing: '0.15em', fontWeight: 700 }}>SCOPE · 3 TRACKS</span>
          <span style={{ color: '#fbbf24', letterSpacing: '0.15em', fontWeight: 700 }}>NEXT: A → 1</span>
        </div>

        {/* Scope — square (mirrors real DPT), takes the rest of the column. */}
        <div className="relative flex-1 flex items-center justify-center">
          <div
            className="relative"
            style={{
              width: '100%',
              maxWidth: 320,
              aspectRatio: '1 / 1',
              background: 'radial-gradient(circle at 50% 50%, #061425, #03070f)',
              border: '2px solid #1a3a5c',
              boxShadow: 'inset 0 0 28px rgba(91,170,255,0.18)',
              overflow: 'hidden',
            }}
          >
            <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
              {/* Concentric range rings centred on the scope */}
              {[10, 20, 30, 40].map(r => (
                <circle key={r} cx="50" cy="50" r={r} fill="none" stroke="#5baaff" strokeOpacity="0.10" strokeWidth="0.35" />
              ))}
              {/* Square arena boundary — dashed, matches real ArenaChrome */}
              <rect x="2" y="2" width="96" height="96" fill="none" stroke="#5baaff" strokeOpacity="0.18" strokeWidth="0.4" strokeDasharray="2 2" />

              {/* Minor ticks every 10° */}
              {MINOR_TICKS.map(b => {
                const rad = (b * Math.PI) / 180
                const dx = Math.sin(rad), dy = -Math.cos(rad)
                // Find boundary t for this bearing on a half-extent 48 square
                const tEnd = 48 / Math.max(Math.abs(dx), Math.abs(dy))
                const x2 = 50 + dx * tEnd, y2 = 50 + dy * tEnd
                const x1 = 50 + dx * (tEnd - 3.5), y1 = 50 + dy * (tEnd - 3.5)
                return <line key={`mt-${b}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#5baaff" strokeOpacity="0.35" strokeWidth="0.3" />
              })}
              {/* Major tick lines for the 8 bearing labels */}
              {BEARINGS.map(b => {
                const rad = (b.deg * Math.PI) / 180
                const dx = Math.sin(rad), dy = -Math.cos(rad)
                const tEnd = 48 / Math.max(Math.abs(dx), Math.abs(dy))
                const x2 = 50 + dx * tEnd, y2 = 50 + dy * tEnd
                const x1 = 50 + dx * (tEnd - 6), y1 = 50 + dy * (tEnd - 6)
                return <line key={`mj-${b.deg}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#5baaff" strokeOpacity="0.55" strokeWidth="0.55" />
              })}

              {/* Bearing labels — every 45°, 3-digit, just inside the boundary */}
              {BEARINGS.map(b => (
                <text
                  key={`lbl-${b.deg}`}
                  x={b.x} y={b.y}
                  fill="#5baaff" fontSize="4.2"
                  fontFamily="ui-monospace, monospace" fontWeight="800"
                  textAnchor="middle" dominantBaseline="middle"
                  opacity={0.85}
                >
                  {String(b.deg).padStart(3, '0')}
                </text>
              ))}

              {/* Crosshair */}
              <g stroke="#5baaff" strokeWidth="0.6" strokeOpacity="0.45" strokeLinecap="round">
                <line x1="48" y1="50" x2="52" y2="50" />
                <line x1="50" y1="48" x2="50" y2="52" />
              </g>

              {/* Gates */}
              {GATES.map(g => {
                const color = g.kind === 'letter' ? '#5baaff' : '#9ed5ff'
                const cx = (g.p1.x + g.p2.x) / 2
                const cy = (g.p1.y + g.p2.y) / 2 - 4
                return (
                  <g key={g.id}>
                    <line x1={g.p1.x} y1={g.p1.y} x2={g.p2.x} y2={g.p2.y} stroke={color} strokeWidth="0.7" strokeLinecap="round" opacity="0.75" />
                    <circle cx={g.p1.x} cy={g.p1.y} r="1.5" fill={color} />
                    <circle cx={g.p2.x} cy={g.p2.y} r="1.5" fill={color} />
                    <text x={cx} y={cy} fill={color} fontSize="5" fontWeight="800" fontFamily="ui-monospace, monospace" textAnchor="middle">{g.id}</text>
                  </g>
                )
              })}

              {/* Bearing-command path (appears once the player SETs 045°) */}
              {commandActive && (
                <motion.path
                  key={`cmd-${runKey}`}
                  d="M 14 14 Q 30 30, 60 52"
                  fill="none"
                  stroke="#5baaff"
                  strokeWidth="0.55"
                  strokeDasharray="2 1.5"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: [0, 0.85, 0.5] }}
                  transition={{ duration: 1.3 }}
                />
              )}

              {/* Aircraft trails + moving triangles */}
              {AIRCRAFT.map((ac, i) => (
                <g key={ac.id}>
                  <motion.line
                    key={`t-${i}-${runKey}`}
                    x1={ac.from.x} y1={ac.from.y}
                    x2={ac.to.x}   y2={ac.to.y}
                    stroke={ac.color} strokeWidth="0.4"
                    strokeDasharray="1 1.5" opacity="0.35"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 2.2, delay: i * 0.15, ease: 'linear' }}
                  />
                  <motion.g
                    key={`a-${i}-${runKey}`}
                    initial={{ offsetDistance: '0%' }}
                    animate={{ offsetDistance: '100%' }}
                    transition={{ duration: 2.2, delay: i * 0.15, ease: 'linear' }}
                    style={{ offsetPath: `path("M ${ac.from.x} ${ac.from.y} L ${ac.to.x} ${ac.to.y}")` }}
                  >
                    <polygon points="0,-2.4 1.8,1.6 -1.8,1.6" fill={ac.color} stroke="#06101e" strokeWidth="0.3" />
                  </motion.g>
                  <text
                    x={(ac.from.x + ac.to.x) / 2 + 3}
                    y={(ac.from.y + ac.to.y) / 2}
                    fill={ac.color} fontSize="3"
                    fontFamily="ui-monospace, monospace" fontWeight="700" opacity="0.85"
                  >{ac.cs}</text>
                </g>
              ))}
            </svg>

            {/* Bearing entry strip — overlays bottom of the scope */}
            <div
              className="absolute left-1/2 -translate-x-1/2 intel-mono rounded px-2 py-0.5"
              style={{
                bottom: 6,
                background: 'rgba(6,16,30,0.92)',
                border: '1px solid #5baaff',
                color: '#fde68a',
                fontSize: 9, fontWeight: 800, letterSpacing: '0.18em',
                minWidth: 60, textAlign: 'center',
              }}
            >
              {typed.padStart(3, '_')}°
            </div>
          </div>
        </div>

        {/* Numpad — bottom row, 4×3 small grid suggesting bearing entry */}
        <div className="grid grid-cols-3 gap-0.5 mx-auto" style={{ maxWidth: 180, width: '60%' }}>
          {NUMPAD.flat().map((k, i) => {
            const isDigit = /^\d$/.test(k)
            const isLit   = isDigit && typed.includes(k)
            const isSet   = k === 'SET' && commandActive
            return (
              <div
                key={i}
                className="intel-mono text-center"
                style={{
                  background: isLit ? 'rgba(91,170,255,0.28)'
                                    : isSet ? 'rgba(251,191,36,0.25)'
                                            : 'rgba(91,170,255,0.06)',
                  border: `1px solid ${isLit ? '#5baaff'
                                              : isSet ? '#fbbf24'
                                                      : '#1a3a5c'}`,
                  borderRadius: 3,
                  color: isSet ? '#fde68a' : '#fff',
                  fontSize: k.length > 1 ? 7 : 10,
                  fontWeight: 700,
                  padding: '4px 0',
                }}
              >
                {k}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
