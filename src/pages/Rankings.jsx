import { useAuth } from '../context/AuthContext'
import { MOCK_RANKS, MOCK_LEVELS } from '../data/mockData'

// Given totalAircoins, return current level + progress info
function getLevelInfo(totalAircoins) {
  let current = MOCK_LEVELS[0]
  for (const lvl of MOCK_LEVELS) {
    if (totalAircoins >= lvl.cumulativeAircoins) current = lvl
    else break
  }
  const next         = MOCK_LEVELS.find(l => l.levelNumber === current.levelNumber + 1)
  const coinsInLevel = totalAircoins - current.cumulativeAircoins
  const coinsNeeded  = current.aircoinsToNextLevel
  const progress     = coinsNeeded
    ? Math.min(100, Math.round((coinsInLevel / coinsNeeded) * 100))
    : 100
  return { current, next, coinsInLevel, coinsNeeded, progress }
}

export default function Rankings() {
  const { user } = useAuth()

  // ── Levels ──────────────────────────────────────────────
  const coins = user?.totalAircoins ?? 0
  const { current: currentLvl, next: nextLvl, coinsInLevel, coinsNeeded, progress: lvlProgress } = getLevelInfo(coins)

  // ── Ranks ───────────────────────────────────────────────
  const ranks        = [...MOCK_RANKS].sort((a, b) => b.rankNumber - a.rankNumber)
  const userRankNumber = 3 // placeholder — replace with user?.rank?.rankNumber

  return (
    <main className="page rankings-page">
      <div className="section-inner">

        {/* ── Header ─────────────────────────────────────── */}
        <div className="rankings-header">
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
              : <p className="xp-panel__next">Maximum level reached</p>
            }
          </div>

          {/* Level list */}
          <ol className="level-list" reversed>
            {[...MOCK_LEVELS].sort((a, b) => b.levelNumber - a.levelNumber).map((lvl) => {
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
                    {lvl.cumulativeAircoins.toLocaleString()} Aircoins to reach
                  </span>
                  {isCurrent && <span className="level-row__you">← You</span>}
                </li>
              )
            })}
          </ol>
        </div>

        {/* ══════════════════════════════════════════════════
            SECTION 2 — RAF Rank (1–19)
        ══════════════════════════════════════════════════ */}
        <div className="rankings-section">
          <h2 className="rankings-section-title">RAF Rank</h2>

          {/* Rank XP bar */}
          <div className="xp-panel">
            <div className="xp-panel__labels">
              <span className="xp-panel__label">
                Current rank: <strong>{MOCK_RANKS.find(r => r.rankNumber === userRankNumber)?.rankName ?? '—'}</strong>
              </span>
            </div>
          </div>

          {/* Rank list */}
          <ol className="rank-list" reversed>
            {ranks.map((rank) => {
              const isUser  = rank.rankNumber === userRankNumber
              const isAbove = rank.rankNumber > userRankNumber
              return (
                <li
                  key={rank.rankNumber}
                  className={`rank-row ${isUser ? 'rank-row--current' : ''} ${isAbove ? 'rank-row--locked' : ''}`}
                >
                  <span className="rank-row__number">{rank.rankNumber}</span>
                  <div className="rank-row__info">
                    <span className="rank-row__abbr">{rank.abbreviation}</span>
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
