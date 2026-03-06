import { useState, useEffect } from 'react'

export default function AircoinNotification({ amount, label = 'BRIEF READ REWARD', onDone }) {
  const [phase, setPhase] = useState('in') // 'in' | 'hold' | 'out'

  useEffect(() => {
    const holdTimer = setTimeout(() => setPhase('out'), 2400)
    return () => clearTimeout(holdTimer)
  }, [])

  const handleAnimEnd = () => {
    if (phase === 'out') onDone()
  }

  return (
    <div
      className={`aircoin-notif aircoin-notif--${phase}`}
      onAnimationEnd={handleAnimEnd}
      aria-live="polite"
    >
      <svg className="aircoin-notif__coin" width="32" height="32" viewBox="0 0 32 32" fill="none">
        <circle cx="16" cy="16" r="14" fill="#f59e0b" stroke="#d97706" strokeWidth="1.5"/>
        <circle cx="16" cy="16" r="10" fill="none" stroke="#fbbf24" strokeWidth="1"/>
        <text x="16" y="21" textAnchor="middle" fontSize="10" fontWeight="bold" fill="#7c2d12" fontFamily="monospace">AC</text>
      </svg>
      <div className="aircoin-notif__text">
        <span className="aircoin-notif__amount">+{amount} AIRCOINS</span>
        <span className="aircoin-notif__label">{label}</span>
      </div>
    </div>
  )
}
