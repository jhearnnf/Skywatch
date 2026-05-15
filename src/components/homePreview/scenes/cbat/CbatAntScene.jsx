import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import CbatBg from './_cbatBg'

// Mirrors the real ANT play screen: left = SVG journey map (8 nodes connected
// by edges, active path lit up in brand-blue), right = data table + answer
// input. Player computes speed/distance/time and types the answer.

const NODES = [
  { id: 'A', x: 12, y: 18, kind: 'start' },
  { id: 'B', x: 36, y: 14 },
  { id: 'C', x: 60, y: 28 },
  { id: 'D', x: 86, y: 22 },
  { id: 'E', x: 24, y: 48 },
  { id: 'F', x: 50, y: 56, via: true },
  { id: 'G', x: 76, y: 60 },
  { id: 'H', x: 64, y: 84, kind: 'dest' },
]

// Active route: A → B → C → F → H
const ACTIVE_PATH = [['A','B'], ['B','C'], ['C','F'], ['F','H']]
const INACTIVE_PATH = [['A','E'], ['B','F'], ['D','G'], ['E','F'], ['G','H']]

const ANSWER = '0820'

function getNode(id) { return NODES.find(n => n.id === id) }

export default function CbatAntScene({ runKey }) {
  const [typed, setTyped] = useState('')
  useEffect(() => {
    setTyped('')
    const timers = []
    for (let i = 1; i <= ANSWER.length; i++) {
      timers.push(setTimeout(() => setTyped(ANSWER.slice(0, i)), 1100 + i * 130))
    }
    return () => timers.forEach(clearTimeout)
  }, [runKey])

  return (
    <div className="absolute inset-0 overflow-hidden">
      <CbatBg amber />
      <div className="absolute inset-0 px-4 pt-14 pb-4 flex gap-3">

        {/* Left: SVG journey map */}
        <div
          className="relative rounded-lg flex-1"
          style={{ background: '#0a1628', border: '1.5px solid #1a3a5c', padding: 8 }}
        >
          <span className="intel-mono absolute top-1 left-2" style={{ fontSize: 7, color: '#5baaff', letterSpacing: '0.15em', fontWeight: 700 }}>JOURNEY MAP</span>
          <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%' }}>
            {/* Inactive edges (dashed grey) */}
            {INACTIVE_PATH.map(([a, b], i) => {
              const na = getNode(a), nb = getNode(b)
              return <line key={`i-${i}`} x1={na.x} y1={na.y} x2={nb.x} y2={nb.y} stroke="#334155" strokeWidth="0.5" strokeDasharray="1.5 1.5" />
            })}
            {/* Active edges (bold blue, drawn in sequence) */}
            {ACTIVE_PATH.map(([a, b], i) => {
              const na = getNode(a), nb = getNode(b)
              return (
                <motion.line
                  key={`a-${i}-${runKey}`}
                  x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
                  stroke="#5baaff" strokeWidth="1.4" strokeLinecap="round"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.4, delay: i * 0.18 }}
                />
              )
            })}
            {/* Distance labels */}
            <g fontFamily="ui-monospace, monospace" fontSize="3" fontWeight="700" fill="#fde68a">
              <rect x="20" y="14" width="11" height="4" fill="#06101e" stroke="#5baaff" strokeWidth="0.3" rx="0.5" />
              <text x="25.5" y="17.2" textAnchor="middle">120</text>
              <rect x="45" y="20" width="11" height="4" fill="#06101e" stroke="#5baaff" strokeWidth="0.3" rx="0.5" />
              <text x="50.5" y="23.2" textAnchor="middle">180</text>
              <rect x="51" y="44" width="11" height="4" fill="#06101e" stroke="#5baaff" strokeWidth="0.3" rx="0.5" />
              <text x="56.5" y="47.2" textAnchor="middle">90</text>
              <rect x="51" y="68" width="11" height="4" fill="#06101e" stroke="#5baaff" strokeWidth="0.3" rx="0.5" />
              <text x="56.5" y="71.2" textAnchor="middle">150</text>
            </g>
            {/* Nodes */}
            {NODES.map(n => {
              const onPath = ['A','B','C','F','H'].includes(n.id)
              const stroke = n.kind === 'start' ? '#22c55e' : n.kind === 'dest' ? '#ef4444' : n.via ? '#fbbf24' : '#5baaff'
              return (
                <g key={n.id}>
                  <circle cx={n.x} cy={n.y} r="3.5" fill="#102040" stroke={stroke} strokeWidth="0.8"
                    opacity={onPath ? 1 : 0.55}
                    filter={onPath ? `drop-shadow(0 0 3px ${stroke})` : 'none'}
                  />
                  <text x={n.x} y={n.y + 1} textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="3.5" fontWeight="700" fill={onPath ? '#fff' : '#64748b'}>
                    {n.id}
                  </text>
                </g>
              )
            })}
          </svg>
        </div>

        {/* Right: question + answer input */}
        <div className="flex flex-col gap-2" style={{ width: 138 }}>
          <div
            className="rounded p-2"
            style={{ background: '#0a1628', border: '1px solid #1a3a5c' }}
          >
            <span className="intel-mono" style={{ fontSize: 6, color: '#5baaff', letterSpacing: '0.15em', fontWeight: 700 }}>JOURNEY</span>
            <p className="intel-mono mt-1" style={{ fontSize: 8, color: '#cbd5e1', lineHeight: 1.5 }}>
              A · B · C · F · H<br/>
              Depart 0700<br/>
              Speed 360 kt<br/>
              <span style={{ color: '#fbbf24' }}>Arrive ?</span>
            </p>
          </div>
          {/* Answer input + numpad */}
          <div
            className="rounded p-2"
            style={{ background: '#0a1628', border: '1.5px solid #fbbf24', boxShadow: '0 0 12px rgba(251,191,36,0.18)' }}
          >
            <div
              className="rounded text-center intel-mono"
              style={{
                background: '#020812', border: '1px solid #1a3a5c',
                padding: '4px 0', color: '#fbbf24', fontSize: 14, letterSpacing: '0.15em', fontWeight: 700,
              }}
            >
              {typed.padEnd(4, '·')}
              <motion.span animate={{ opacity: [0, 1, 0] }} transition={{ duration: 0.7, repeat: Infinity }} style={{ marginLeft: 1 }}>▍</motion.span>
            </div>
            <div className="grid grid-cols-3 gap-1 mt-1.5">
              {[1,2,3,4,5,6,7,8,9].map(n => (
                <div
                  key={n}
                  className="intel-mono"
                  style={{
                    background: typed.includes(String(n)) ? 'rgba(91,170,255,0.18)' : 'rgba(255,255,255,0.05)',
                    border: '1px solid #1a3a5c',
                    borderRadius: 3,
                    fontSize: 9, fontWeight: 700, color: '#fff',
                    padding: '2px 0', textAlign: 'center',
                  }}
                >
                  {n}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
