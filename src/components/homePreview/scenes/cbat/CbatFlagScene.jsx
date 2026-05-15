import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import CbatBg from './_cbatBg'

// Mirrors the real FLAG play: 60-second multi-task with a play field of
// moving shapes + aircraft callouts, a 3×3 numpad for maths answers, Y/N
// buttons for aircraft-present questions, and 3 colour-strike buttons.

export default function CbatFlagScene({ runKey }) {
  const [time, setTime] = useState(54)
  const [question, setQuestion] = useState({ kind: 'math', text: '17 + 8', answer: '25' })
  const [typed, setTyped] = useState('')
  useEffect(() => {
    setTime(54); setTyped('')
    setQuestion({ kind: 'math', text: '17 + 8', answer: '25' })
    const tickT = setInterval(() => setTime(t => Math.max(0, t - 1)), 800)
    const t1 = setTimeout(() => setTyped('2'),  1100)
    const t2 = setTimeout(() => setTyped('25'), 1500)
    const t3 = setTimeout(() => {
      setQuestion({ kind: 'ac', text: 'Is the Typhoon on screen?' })
      setTyped('')
    }, 2400)
    return () => { clearInterval(tickT); clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [runKey])

  return (
    <div className="absolute inset-0 overflow-hidden">
      <CbatBg amber />
      <div className="absolute inset-0 px-3 pt-14 pb-3 flex flex-col gap-1.5">

        {/* HUD */}
        <div className="flex justify-between items-center intel-mono" style={{ fontSize: 7 }}>
          <span className="px-2 py-0.5 rounded" style={{
            background: time < 15 ? 'rgba(239,68,68,0.18)' : 'rgba(251,191,36,0.18)',
            border: `1px solid ${time < 15 ? '#ef4444' : '#fbbf24'}`,
            color: time < 15 ? '#fca5a5' : '#fde68a',
            fontWeight: 800, letterSpacing: '0.1em',
          }}>⏱ {String(time).padStart(2, '0')}s</span>
          <span style={{ color: '#5baaff', letterSpacing: '0.15em', fontWeight: 700 }}>SCORE 124</span>
        </div>

        {/* Play field */}
        <div
          className="relative rounded-lg flex-1"
          style={{ background: '#0a1628', border: '1.5px solid #1a3a5c', overflow: 'hidden', minHeight: 80 }}
        >
          {/* Faint grid */}
          <div aria-hidden="true" className="absolute inset-0 opacity-25" style={{
            background:
              'linear-gradient(90deg, rgba(91,170,255,0.25) 1px, transparent 1px) 0 0/30px 30px,' +
              'linear-gradient(0deg, rgba(91,170,255,0.25) 1px, transparent 1px) 0 0/30px 30px',
          }} />
          {/* Aircraft circle moving across */}
          <motion.div
            initial={{ x: -30, y: 12, opacity: 0 }}
            animate={{ x: 280, y: 38, opacity: [0, 1, 1, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
            className="absolute"
            style={{ fontSize: 16, filter: 'drop-shadow(0 0 6px rgba(91,170,255,0.6))' }}
          >
            ✈
          </motion.div>
          {/* Falling shapes */}
          {[
            { e: '◆', color: '#22c55e', x: 18 },
            { e: '●', color: '#ef4444', x: 50 },
            { e: '▲', color: '#5baaff', x: 80 },
          ].map((s, i) => (
            <motion.div
              key={i}
              initial={{ y: -10, opacity: 0 }}
              animate={{ y: 100, opacity: [0, 1, 1, 0] }}
              transition={{ duration: 2.5, delay: i * 0.6, repeat: Infinity, ease: 'linear' }}
              className="absolute"
              style={{ left: `${s.x}%`, color: s.color, fontSize: 13, filter: `drop-shadow(0 0 4px ${s.color})` }}
            >
              {s.e}
            </motion.div>
          ))}
          {/* Question overlay */}
          <motion.div
            key={`q-${question.text}-${runKey}`}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute top-1.5 left-1/2 -translate-x-1/2 rounded px-2 py-0.5 intel-mono"
            style={{
              background: 'rgba(6,16,30,0.92)',
              border: '1px solid #fbbf24',
              color: '#fde68a',
              fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
              whiteSpace: 'nowrap',
            }}
          >
            {question.text}
          </motion.div>
        </div>

        {/* Bottom: numpad + Y/N + strike buttons */}
        <div className="flex gap-1.5">
          {/* Numpad */}
          <div className="grid grid-cols-3 gap-0.5" style={{ width: 80 }}>
            {[1,2,3,4,5,6,7,8,9].map(n => {
              const isLit = question.kind === 'math' && typed.includes(String(n))
              return (
                <div
                  key={n}
                  className="intel-mono"
                  style={{
                    background: isLit ? 'rgba(91,170,255,0.25)' : 'rgba(91,170,255,0.06)',
                    border: `1px solid ${isLit ? '#5baaff' : '#1a3a5c'}`,
                    borderRadius: 3,
                    color: '#fff', fontSize: 9, fontWeight: 700,
                    padding: '4px 0', textAlign: 'center',
                  }}
                >
                  {n}
                </div>
              )
            })}
          </div>

          {/* Y/N */}
          <div className="flex flex-col gap-0.5 flex-1">
            <div className="intel-mono rounded" style={{
              background: question.kind === 'ac' ? 'rgba(34,197,94,0.18)' : 'rgba(34,197,94,0.06)',
              border: `1.5px solid ${question.kind === 'ac' ? '#22c55e' : '#1a3a5c'}`,
              color: '#86efac', fontSize: 10, fontWeight: 800, letterSpacing: '0.15em',
              padding: '4px 0', textAlign: 'center', flex: 1,
            }}>YES</div>
            <div className="intel-mono rounded" style={{
              background: 'rgba(239,68,68,0.06)',
              border: '1.5px solid #1a3a5c',
              color: '#fca5a5', fontSize: 10, fontWeight: 800, letterSpacing: '0.15em',
              padding: '4px 0', textAlign: 'center', flex: 1,
            }}>NO</div>
          </div>

          {/* Strike buttons (palette) */}
          <div className="flex flex-col gap-0.5" style={{ width: 26 }}>
            {['#22c55e', '#ef4444', '#5baaff'].map(c => (
              <div
                key={c}
                style={{
                  background: `${c}33`,
                  border: `1.5px solid ${c}`,
                  borderRadius: 3,
                  flex: 1,
                  boxShadow: `inset 0 0 6px ${c}55`,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
