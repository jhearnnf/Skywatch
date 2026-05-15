import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'

// Pathway preview — mirrors the real LearnPriority page's visual language
// (zigzag stones, category colour rings, glow burst on unlock). Stones light
// up in sequence to demonstrate the unlock progression. Colour palette is
// kept in sync with src/pages/LearnPriority.jsx PATHWAY_COLORS — if you
// change the canonical palette there, mirror the change here.
const COLORS = {
  News:        { stone: '#a16207', ring: '#eab308' },
  Bases:       { stone: '#2563eb', ring: '#3b82f6' },
  Aircrafts:   { stone: '#7c8ba2', ring: '#b4c0d1' },
  Ranks:       { stone: '#d97706', ring: '#f59e0b' },
  Squadrons:   { stone: '#7c3aed', ring: '#8b5cf6' },
  Training:    { stone: '#059669', ring: '#10b981' },
  Threats:     { stone: '#dc2626', ring: '#ef4444' },
}

const PATH = [
  { cat: 'News',      icon: '📰', priority: 1 },
  { cat: 'Bases',     icon: '🏔️', priority: 2 },
  { cat: 'Aircrafts', icon: '✈️', priority: 3 },
  { cat: 'Ranks',     icon: '🎖️', priority: 4 },
  { cat: 'Squadrons', icon: '⚡', priority: 5 },
  { cat: 'Training',  icon: '🎯', priority: 6 },
  { cat: 'Threats',   icon: '⚠️', priority: 7 },
]

// Tighter zigzag on mobile (matches narrower window width) — desktop keeps
// the wider spread for visual rhythm.
const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 600px)').matches
const ZIGZAG = isMobile ? [-28, -8, 16, -8] : [-44, -12, 20, -12]

export default function PriorityPathwayScene({ runKey }) {
  // Number of stones currently unlocked (starts at 1, grows over time)
  const [unlocked, setUnlocked] = useState(1)

  useEffect(() => {
    setUnlocked(1)
    const timers = []
    for (let i = 2; i <= PATH.length; i++) {
      timers.push(setTimeout(() => setUnlocked(i), (i - 1) * 480))
    }
    return () => timers.forEach(clearTimeout)
  }, [runKey])

  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* Backdrop — soft pathway gradient (matches LearnPriority page bg) */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at 50% 30%, rgba(91,170,255,0.12), transparent 70%), #06101e',
        }}
      />

      {/* Scrolling stones — translate up so newer stones come into view */}
      <motion.div
        initial={{ y: 80 }}
        animate={{ y: -(PATH.length - 4) * 80 + 60 }}
        transition={{ duration: 3.6, ease: 'easeInOut' }}
        className="absolute inset-x-0 top-20"
      >
        {PATH.map((node, i) => {
          const isUnlocked = i < unlocked
          const justUnlocked = i === unlocked - 1
          const colors = COLORS[node.cat] ?? { stone: '#334155', ring: '#475569' }
          const xOffset = ZIGZAG[i % ZIGZAG.length]
          return (
            <div
              key={node.cat}
              className="relative flex items-center justify-center"
              style={{ height: 80 }}
            >
              {/* Connector line to the next stone */}
              {i < PATH.length - 1 && (
                <div
                  aria-hidden="true"
                  className="absolute left-1/2 -translate-x-1/2"
                  style={{
                    top: 56,
                    width: 2,
                    height: 28,
                    background: isUnlocked
                      ? `linear-gradient(180deg, ${colors.ring}, ${COLORS[PATH[i+1].cat]?.ring ?? '#475569'})`
                      : 'rgba(255,255,255,0.12)',
                    opacity: isUnlocked ? 0.7 : 1,
                  }}
                />
              )}
              {/* Shared coordinate origin — stone, glow burst, and priority
                  badge all anchor to this so the xOffset shift applies once
                  rather than to each child separately. */}
              <div
                className="absolute"
                style={{
                  left: '50%',
                  top: '50%',
                  width: 58,
                  height: 58,
                  transform: `translate(calc(-50% + ${xOffset}px), -50%)`,
                  zIndex: 2,
                }}
              >
                <motion.div
                  animate={
                    justUnlocked
                      ? { scale: [1, 1.18, 1], rotate: [0, -3, 3, 0] }
                      : { scale: 1, rotate: 0 }
                  }
                  transition={{ duration: 0.55, ease: 'easeOut' }}
                  style={{
                    width: '100%',
                    height: '100%',
                    borderRadius: 14,
                    background: isUnlocked ? colors.stone : '#1e293b',
                    border: `2px solid ${isUnlocked ? colors.ring : 'rgba(255,255,255,0.12)'}`,
                    boxShadow: isUnlocked
                      ? `0 0 24px ${colors.ring}66, 0 4px 12px rgba(0,0,0,0.4)`
                      : '0 2px 6px rgba(0,0,0,0.5)',
                    opacity: isUnlocked ? 1 : 0.4,
                    filter: isUnlocked ? 'none' : 'grayscale(0.6)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 2,
                  }}
                >
                  <span style={{ fontSize: 22, lineHeight: 1, filter: isUnlocked ? 'none' : 'grayscale(1)' }}>{node.icon}</span>
                  <span
                    className="intel-mono"
                    style={{
                      fontSize: 8,
                      lineHeight: 1,
                      color: isUnlocked ? '#ffffff' : '#94a3b8',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      fontWeight: 700,
                    }}
                  >
                    {isUnlocked ? node.cat : '🔒'}
                  </span>
                </motion.div>

                {/* Glow burst — anchored to the stone, expands from its centre */}
                {justUnlocked && (
                  <motion.div
                    key={`burst-${i}-${runKey}`}
                    initial={{ scale: 0.4, opacity: 0.9 }}
                    animate={{ scale: 2.4, opacity: 0 }}
                    transition={{ duration: 0.75, ease: 'easeOut' }}
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      borderRadius: 14,
                      border: `2px solid ${colors.ring}`,
                      boxShadow: `0 0 30px ${colors.ring}`,
                      zIndex: -1,
                    }}
                  />
                )}

                {/* Priority badge — anchored to the stone's top-left corner */}
                {isUnlocked && (
                  <span
                    className="absolute intel-mono"
                    style={{
                      top: -6,
                      left: -10,
                      fontSize: 9,
                      lineHeight: 1,
                      fontWeight: 700,
                      color: '#fff',
                      background: colors.ring,
                      padding: '2px 6px',
                      borderRadius: 999,
                      boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
                      zIndex: 3,
                    }}
                  >
                    #{node.priority}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </motion.div>
    </div>
  )
}
