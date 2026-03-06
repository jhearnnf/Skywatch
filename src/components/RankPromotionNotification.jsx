import { useState, useEffect } from 'react'

export default function RankPromotionNotification({ rank, onDone }) {
  const [phase, setPhase] = useState('in')

  useEffect(() => {
    const t = setTimeout(() => setPhase('out'), 4000)
    return () => clearTimeout(t)
  }, [])

  const handleAnimEnd = () => { if (phase === 'out') onDone() }

  return (
    <div
      className={`rankpromo-notif rankpromo-notif--${phase}`}
      onAnimationEnd={handleAnimEnd}
      aria-live="polite"
    >
      <svg className="rankpromo-notif__icon" width="36" height="36" viewBox="0 0 36 36" fill="none">
        <polygon points="18,2 22,14 34,14 25,21 28,33 18,26 8,33 11,21 2,14 14,14" fill="#1d4ed8" stroke="#93c5fd" strokeWidth="1.2" strokeLinejoin="round"/>
        <polygon points="18,8 21,16 29,16 23,20 25,28 18,23 11,28 13,20 7,16 15,16" fill="#60a5fa" stroke="none"/>
      </svg>
      <div className="rankpromo-notif__text">
        <span className="rankpromo-notif__title">RANK PROMOTION</span>
        <span className="rankpromo-notif__rank">
          {rank?.rankAbbreviation && <span className="rankpromo-notif__abbr">{rank.rankAbbreviation}</span>}
          {rank?.rankName ?? 'New Rank'}
        </span>
      </div>
    </div>
  )
}
