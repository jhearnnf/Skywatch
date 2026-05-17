import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import CbatBg from './_cbatBg'

// Mirrors the real FLAG play layout:
//   - Top:    timer + score HUD
//   - Middle: arena play-field with a 3D aircraft circling (its onboard symbol
//             is the Y/N question; aircraft drifts in an orbital arc), and
//             ~5 scattered coloured palette shapes (square, diamond, triangle)
//             that the player strikes by colour.
//   - Right column (panel): math-question display, 3×3 numpad in 7-9/4-6/1-3/0
//     order, palette strike row, Y/N aircraft answer row.
// The 3D playfield can't be rendered in 2.5s without a heavy WebGL boot, so
// we evoke it with a CSS perspective layer + a circling aircraft glyph and
// rotating shape rings (matches the real game's visual rhythm).
//
// Numpad digit order matches Numpad.jsx exactly so a player who has seen the
// preview recognises the keypad muscle-memory.

const PALETTE = [
  { color: '#22c55e', kind: 'square'   },
  { color: '#ef4444', kind: 'diamond'  },
  { color: '#5baaff', kind: 'triangle' },
]

// Static-position palette shapes scattered around the field.
const FIELD_SHAPES = [
  { kind: 'square',   color: '#22c55e', x: 14, y: 30, rot:  0 },
  { kind: 'diamond',  color: '#ef4444', x: 78, y: 22, rot: 12 },
  { kind: 'triangle', color: '#5baaff', x: 22, y: 78, rot:-10 },
  { kind: 'diamond',  color: '#ef4444', x: 60, y: 70, rot:  8 },
  { kind: 'square',   color: '#22c55e', x: 88, y: 60, rot:  4 },
]

const NUMPAD_DIGITS = ['7','8','9','4','5','6','1','2','3']
const MATH = { text: '17 + 8', answer: '25' }

// Multiple aircraft circling the playfield simultaneously — matches the real
// game's PlayField where 2–4 aircraft are on screen at once, each carrying a
// symbol badge. `targetSymbol` is the one whose AC question is currently
// active (matches what shows up in the Y/N row).
const AIRCRAFT = [
  { id: 'a1', cx: 32, cy: 36, radius: 14, durationS: 5.5,  size: 14, color: '#5baaff', symbol: '◈X4', isTarget: true  },
  { id: 'a2', cx: 70, cy: 30, radius: 11, durationS: 4.5,  size: 12, color: '#fbbf24', symbol: '▲L9', isTarget: false },
  { id: 'a3', cx: 55, cy: 70, radius: 12, durationS: 6.5,  size: 12, color: '#22c55e', symbol: '◆T2', isTarget: false },
  { id: 'a4', cx: 22, cy: 76, radius: 9,  durationS: 4.8,  size: 11, color: '#ef4444', symbol: '●K7', isTarget: false },
]
const AC_SYMBOL = AIRCRAFT.find(a => a.isTarget).symbol

function ShapeIcon({ kind, color, size = 12 }) {
  const half = size / 2
  if (kind === 'square') {
    return <rect x={-half} y={-half} width={size} height={size} fill={color} rx="1.5" />
  }
  if (kind === 'diamond') {
    return <polygon points={`0,${-half} ${half},0 0,${half} ${-half},0`} fill={color} />
  }
  // triangle
  return <polygon points={`0,${-half} ${half},${half} ${-half},${half}`} fill={color} />
}

export default function CbatFlagScene({ runKey }) {
  const [time, setTime]   = useState(54)
  const [typed, setTyped] = useState('')
  // 'math' → entering digits; 'ac' → answering Y/N (symbol shown on plane).
  const [mode, setMode]   = useState('math')

  useEffect(() => {
    setTime(54); setTyped(''); setMode('math')
    const tickT = setInterval(() => setTime(t => Math.max(0, t - 1)), 800)
    const t1 = setTimeout(() => setTyped('2'),  900)
    const t2 = setTimeout(() => setTyped('25'), 1350)
    const t3 = setTimeout(() => { setMode('ac'); setTyped('') }, 2050)
    return () => { clearInterval(tickT); clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [runKey])

  return (
    <div className="absolute inset-0 overflow-hidden">
      <CbatBg amber />
      <div className="absolute inset-0 px-3 pt-16 sm:pt-24 pb-3 flex flex-col gap-1.5">

        {/* HUD */}
        <div className="flex justify-between items-center intel-mono" style={{ fontSize: 8 }}>
          <span className="px-2 py-0.5 rounded" style={{
            background: time < 15 ? 'rgba(239,68,68,0.18)' : 'rgba(251,191,36,0.18)',
            border: `1px solid ${time < 15 ? '#ef4444' : '#fbbf24'}`,
            color: time < 15 ? '#fca5a5' : '#fde68a',
            fontWeight: 800, letterSpacing: '0.1em',
          }}>⏱ {String(time).padStart(2, '0')}s</span>
          <span style={{ color: '#5baaff', letterSpacing: '0.15em', fontWeight: 700 }}>SCORE 124</span>
        </div>

        {/* Two-column body: playfield (left, flex) + control panel (right). */}
        <div className="flex gap-1.5 flex-1 min-h-0">

          {/* Play field */}
          <div
            className="relative rounded-lg flex-1"
            style={{
              background: 'radial-gradient(ellipse at 50% 50%, #0e2440 0%, #051022 70%)',
              border: '1.5px solid #1a3a5c',
              overflow: 'hidden',
              minHeight: 100,
            }}
          >
            {/* Subtle floor grid for depth */}
            <div aria-hidden="true" className="absolute inset-0 opacity-30" style={{
              background:
                'linear-gradient(90deg, rgba(91,170,255,0.18) 1px, transparent 1px) 0 0/30px 30px,' +
                'linear-gradient(0deg, rgba(91,170,255,0.18) 1px, transparent 1px) 0 0/30px 30px',
            }} />

            {/* Scattered palette shapes — these are what the player strikes by colour */}
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
              {FIELD_SHAPES.map((s, i) => (
                <g
                  key={i}
                  transform={`translate(${s.x} ${s.y}) rotate(${s.rot})`}
                  style={{ filter: `drop-shadow(0 0 4px ${s.color})` }}
                >
                  <ShapeIcon kind={s.kind} color={s.color} size={9} />
                </g>
              ))}
            </svg>

            {/* Multiple aircraft circling — each one traces its own small
                orbit at different speeds/sizes. Mirrors the real PlayField
                where 2–4 contacts are on screen simultaneously. The "target"
                aircraft is the one whose symbol matches the active Y/N
                question; its badge gets the amber border, the rest are
                neutral so the player has to identify the right one. */}
            {AIRCRAFT.map(ac => {
              const orbit = ac.radius * 2
              return (
                <motion.div
                  key={`${ac.id}-${runKey}`}
                  className="absolute"
                  style={{
                    left: `${ac.cx}%`, top: `${ac.cy}%`,
                    width: orbit, height: orbit,
                    marginLeft: -orbit / 2, marginTop: -orbit / 2,
                  }}
                  animate={{ rotate: 360 }}
                  transition={{ duration: ac.durationS, repeat: Infinity, ease: 'linear' }}
                >
                  {/* Aircraft glyph at top of the orbit */}
                  <div
                    className="absolute"
                    style={{
                      left: '50%', top: 0, transform: 'translate(-50%, -50%)',
                      fontSize: ac.size, color: ac.color,
                      filter: `drop-shadow(0 0 5px ${ac.color})`,
                    }}
                  >
                    ✈
                  </div>
                  {/* Symbol badge — counter-rotates so it stays upright. */}
                  <motion.div
                    animate={{ rotate: -360 }}
                    transition={{ duration: ac.durationS, repeat: Infinity, ease: 'linear' }}
                    className="absolute intel-mono"
                    style={{
                      left: '50%', top: ac.size * 0.55, transform: 'translate(-50%, -50%)',
                      fontSize: 6, fontWeight: 800,
                      color: ac.isTarget ? '#fde68a' : '#cbd5e1',
                      background: 'rgba(6,16,30,0.88)',
                      border: `1px solid ${ac.isTarget ? '#fbbf24' : '#1a3a5c'}`,
                      borderRadius: 2,
                      padding: '1px 3px',
                      letterSpacing: '0.1em',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {ac.symbol}
                  </motion.div>
                </motion.div>
              )
            })}
          </div>

          {/* Control panel — Numpad on top, palette strikes, Y/N below. */}
          <div className="flex flex-col gap-1" style={{ width: 96 }}>

            {/* Math question + entered display */}
            <div
              className="rounded text-center intel-mono"
              style={{
                background: '#060e1a',
                border: '1px solid #1a3a5c',
                padding: '3px 4px',
                fontSize: 9, color: '#cbd5e1', fontWeight: 700,
              }}
            >
              {mode === 'math' ? (
                <>{MATH.text} = <span style={{ color: '#5baaff' }}>{typed || '_'}</span></>
              ) : (
                <span style={{ color: '#64748b', fontStyle: 'italic' }}>Standby…</span>
              )}
            </div>

            {/* Numpad — digit order matches real game (7-9, 4-6, 1-3) */}
            <div className="grid grid-cols-3 gap-0.5">
              {NUMPAD_DIGITS.map(n => {
                const isLit = mode === 'math' && typed.includes(n)
                return (
                  <div
                    key={n}
                    className="intel-mono text-center"
                    style={{
                      background: isLit ? 'rgba(91,170,255,0.28)' : '#0a1628',
                      border: `1px solid ${isLit ? '#5baaff' : '#1a3a5c'}`,
                      borderRadius: 3,
                      color: '#fff', fontSize: 9, fontWeight: 700,
                      padding: '3px 0',
                    }}
                  >
                    {n}
                  </div>
                )
              })}
              {/* '0' wider — bottom row */}
              <div
                className="intel-mono text-center"
                style={{
                  gridColumn: '1 / span 3',
                  background: '#0a1628',
                  border: '1px solid #1a3a5c',
                  borderRadius: 3,
                  color: '#fff', fontSize: 9, fontWeight: 700,
                  padding: '3px 0',
                }}
              >0</div>
            </div>

            {/* Palette strike row */}
            <div className="grid grid-cols-3 gap-0.5">
              {PALETTE.map(p => (
                <div
                  key={p.color}
                  className="flex items-center justify-center rounded"
                  style={{
                    background: p.color,
                    padding: '4px 0',
                    boxShadow: `inset 0 0 6px rgba(0,0,0,0.25)`,
                  }}
                >
                  <svg viewBox="-8 -8 16 16" width="14" height="14">
                    <ShapeIcon kind={p.kind} color="#06101e" size={10} />
                  </svg>
                </div>
              ))}
            </div>

            {/* Y/N row — aircraft on-screen question */}
            <div className="flex gap-0.5 items-center">
              <div
                className="rounded text-center intel-mono"
                style={{
                  flex: '0 0 22px',
                  background: mode === 'ac' ? '#1a3a5c' : 'rgba(26,58,92,0.4)',
                  color: '#ddeaf8',
                  fontSize: 8, fontWeight: 800, letterSpacing: '0.1em',
                  padding: '4px 0',
                }}
              >NO</div>
              <div
                className="flex-1 text-center intel-mono"
                style={{
                  fontSize: 9, color: mode === 'ac' ? '#ddeaf8' : '#475569',
                  fontWeight: 700, letterSpacing: '0.12em',
                }}
              >
                {mode === 'ac' ? AC_SYMBOL : '—'}
              </div>
              <div
                className="rounded text-center intel-mono"
                style={{
                  flex: '0 0 22px',
                  background: mode === 'ac' ? '#1d4ed8' : 'rgba(29,78,216,0.4)',
                  color: '#fff',
                  fontSize: 8, fontWeight: 800, letterSpacing: '0.1em',
                  padding: '4px 0',
                  boxShadow: mode === 'ac' ? '0 0 8px rgba(29,78,216,0.5)' : 'none',
                }}
              >YES</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
