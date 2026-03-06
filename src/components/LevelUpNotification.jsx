import { useState, useEffect } from 'react'

export default function LevelUpNotification({ level, onDone }) {
  const [phase, setPhase] = useState('in')

  useEffect(() => {
    const t = setTimeout(() => setPhase('out'), 3200)
    return () => clearTimeout(t)
  }, [])

  const handleAnimEnd = () => { if (phase === 'out') onDone() }

  return (
    <div
      className={`levelup-notif levelup-notif--${phase}`}
      onAnimationEnd={handleAnimEnd}
      aria-live="polite"
    >
      <svg className="levelup-notif__icon" width="34" height="34" viewBox="0 0 34 34" fill="none">
        <polygon points="17,3 21,13 32,13 23,20 26,31 17,24 8,31 11,20 2,13 13,13" fill="#f59e0b" stroke="#d97706" strokeWidth="1.2" strokeLinejoin="round"/>
      </svg>
      <div className="levelup-notif__text">
        <span className="levelup-notif__title">LEVEL UP</span>
        <span className="levelup-notif__sub">AGENT LEVEL {level} ACHIEVED</span>
      </div>
    </div>
  )
}
