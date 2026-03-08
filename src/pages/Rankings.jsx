import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { MOCK_LEVELS, MOCK_RANKS } from '../data/mockData'

function getLevelInfo(totalAircoins, levels) {
  if (!levels?.length) return { current: { levelNumber: 1, aircoinsToNextLevel: 100 }, next: null, coinsInLevel: 0, coinsNeeded: 100, progress: 0 }
  let current = levels[0]
  for (const lvl of levels) {
    if (totalAircoins >= lvl.cumulativeAircoins) current = lvl
    else break
  }
  const next         = levels.find(l => l.levelNumber === current.levelNumber + 1)
  const coinsInLevel = totalAircoins - current.cumulativeAircoins
  const coinsNeeded  = current.aircoinsToNextLevel
  const progress     = coinsNeeded
    ? Math.min(100, Math.round((coinsInLevel / coinsNeeded) * 100))
    : 100
  return { current, next, coinsInLevel, coinsNeeded, progress }
}

export default function Rankings({ navigate, scrollTo }) {
  const { user, API } = useAuth()
  const ranksSectionRef = useRef(null)

  const [levels, setLevels] = useState(MOCK_LEVELS)
  const [ranks,  setRanks]  = useState(MOCK_RANKS.map(r => ({ ...r, rankAbbreviation: r.abbreviation })))

  // Scroll to ranks section when navigated from the rank badge
  useEffect(() => {
    if (scrollTo !== 'ranks' || !ranksSectionRef.current) return
    const t = setTimeout(() => {
      ranksSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 150)
    return () => clearTimeout(t)
  }, [scrollTo])

  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/users/levels`).then(r => r.json()),
      fetch(`${API}/api/users/ranks`).then(r => r.json()),
    ])
      .then(([lvlData, rankData]) => {
        if (lvlData?.data?.levels?.length)  setLevels(lvlData.data.levels)
        if (rankData?.data?.ranks?.length)  setRanks(rankData.data.ranks)
      })
      .catch(() => {})
  }, [API])

  // ── Levels ──────────────────────────────────────────────
  const coins = user?.cycleAircoins ?? 0
  const { current: currentLvl, next: nextLvl, coinsInLevel, coinsNeeded, progress: lvlProgress } = getLevelInfo(coins, levels)

  // ── Ranks ───────────────────────────────────────────────
  const sortedRanks = [...ranks].sort((a, b) => b.rankNumber - a.rankNumber)
  // user.rank may be a populated object or a raw ObjectId string
  const userRankId  = user?.rank?._id ?? user?.rank ?? null
  const userRank    = userRankId
    ? (user.rank?.rankNumber != null
        ? user.rank  // already a populated object in state
        : ranks.find(r => r._id?.toString() === userRankId?.toString()))
    : null
  const userRankNumber = userRank?.rankNumber ?? null

  return (
    <main className="page rankings-page">
      <div className="section-inner">

        {/* ── Header ─────────────────────────────────────── */}
        <div className="rankings-header">
          <button className="ach-back" onClick={() => navigate('profile')} aria-label="Back">← Back</button>
          <span className="static-eyebrow">Intelligence Corps</span>
          <h1 className="rankings-title">Progression</h1>
        </div>

        {/* ══════════════════════════════════════════════════
            SECTION 1 — Level (1–10)
        ══════════════════════════════════════════════════ */}
        <div className="rankings-section">
          <h2 className="rankings-section-title">Agent Level</h2>

          {/* Current level XP bar */}
          <div className="xp-panel">
            <div className="xp-panel__labels">
              <span className="xp-panel__label">
                Current level: <strong>Level {currentLvl.levelNumber}</strong>
              </span>
              <span className="xp-panel__coins">
                {coinsInLevel.toLocaleString()} / {coinsNeeded ? coinsNeeded.toLocaleString() : '—'} Aircoins
              </span>
            </div>
            <div className="xp-bar">
              <div className="xp-bar__fill" style={{ width: `${lvlProgress}%` }} />
            </div>
            {nextLvl
              ? <p className="xp-panel__next">Next level: Level {nextLvl.levelNumber} — {coinsNeeded ? (coinsNeeded - coinsInLevel).toLocaleString() : 0} Aircoins to go</p>
              : <p className="xp-panel__next">⭐ Maximum level reached — earn {Math.max(0, 14700 - coins).toLocaleString()} more Aircoins to trigger a Rank Promotion and reset to Level 1</p>
            }
          </div>

          {/* Level list */}
          <ol className="level-list" reversed>
            {[...levels].sort((a, b) => b.levelNumber - a.levelNumber).map((lvl) => {
              const isCurrent = lvl.levelNumber === currentLvl.levelNumber
              const isAbove   = lvl.levelNumber > currentLvl.levelNumber
              const isMax     = lvl.levelNumber === 10
              return (
                <li
                  key={lvl.levelNumber}
                  className={`level-row ${isCurrent ? 'level-row--current' : ''} ${isAbove ? 'level-row--locked' : ''} ${isMax ? 'level-row--max' : ''}`}
                >
                  <span className="level-row__num">{lvl.levelNumber}</span>
                  <span className="level-row__label">Level {lvl.levelNumber}</span>
                  <span className="level-row__coins">
                    {lvl.cumulativeAircoins.toLocaleString()} Total Aircoins
                  </span>
                  {isMax && <span className="level-row__promo">⭐ Rank Promotion</span>}
                  {isCurrent && <span className="level-row__you">← You</span>}
                </li>
              )
            })}
          </ol>
        </div>

        {/* ══════════════════════════════════════════════════
            SECTION 2 — RAF Rank (1–19)
        ══════════════════════════════════════════════════ */}
        <div className="rankings-section" ref={ranksSectionRef}>
          <h2 className="rankings-section-title">RAF Rank</h2>

          {/* Current rank display */}
          <div className="xp-panel">
            <div className="xp-panel__labels">
              <span className="xp-panel__label">
                Current rank: <strong>{userRank?.rankName ?? 'Unranked'}</strong>
              </span>
            </div>
          </div>

          {/* Rank list */}
          <ol className="rank-list" reversed>
            {sortedRanks.map((rank) => {
              const isUser  = userRankNumber !== null && rank.rankNumber === userRankNumber
              const isAbove = userRankNumber !== null && rank.rankNumber > userRankNumber
              return (
                <li
                  key={rank.rankNumber}
                  className={`rank-row ${isUser ? 'rank-row--current' : ''} ${isAbove ? 'rank-row--locked' : ''}`}
                >
                  <span className="rank-row__number">{rank.rankNumber}</span>
                  <div className="rank-row__info">
                    <span className="rank-row__abbr">{rank.rankAbbreviation}</span>
                    <span className="rank-row__name">{rank.rankName}</span>
                    <span className="rank-row__type">{rank.rankType.replace(/_/g, ' ')}</span>
                  </div>
                  {isUser && <span className="rank-row__you">← You</span>}
                </li>
              )
            })}
          </ol>
        </div>

      </div>
    </main>
  )
}
