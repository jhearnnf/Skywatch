import { useAuth } from '../context/AuthContext'
import { MOCK_LEVELS, MOCK_LEADERBOARD } from '../data/mockData'

const TIER_LABELS = { free: 'Free', trial: 'Trial', silver: 'Silver', gold: 'Gold' }

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

export default function Profile({ navigate }) {
  const { user } = useAuth()

  const coins = user?.totalAircoins ?? 0
  const { current: lvl, next: nextLvl, coinsInLevel, coinsNeeded, progress } = getLevelInfo(coins)

  // Rank display — rank may be an ObjectId (string) or a populated object
  const rankDisplay =
    user?.rank && typeof user.rank === 'object' && user.rank.rankName
      ? `${user.rank.rankName} · ${user.rank.rankAbbreviation}`
      : 'Unranked'

  return (
    <main className="page profile-page">
      <div className="section-inner">
        <div className="profile-columns">

          {/* ── Left: user stats ──────────────────────────── */}
          <div className="profile-stats-section">

            {/* Lock overlay when not logged in */}
            <div className={`profile-stats-content ${!user ? 'profile-stats-content--locked' : ''}`}>

              {/* Identity */}
              <div className="profile-hero">
                <div className="profile-avatar">
                  <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
                    <circle cx="18" cy="14" r="7" stroke="currentColor" strokeWidth="1.75"/>
                    <path d="M4 32c0-7.732 6.268-14 14-14s14 6.268 14 14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
                  </svg>
                </div>
                <div>
                  <p className="profile-agent">Agent {user?.agentNumber ?? '———'}</p>
                  <p className="profile-rank">{rankDisplay}</p>
                </div>
                <span className={`tier-badge tier-badge--${user?.subscriptionTier ?? 'free'}`}>
                  {TIER_LABELS[user?.subscriptionTier ?? 'free']}
                </span>
              </div>

              {/* Level / XP bar */}
              <div className="profile-xp">
                <div className="profile-xp__header">
                  <span className="profile-xp__level">Level {lvl.levelNumber}</span>
                  <span className="profile-xp__coins">
                    {coinsInLevel.toLocaleString()} / {coinsNeeded ? coinsNeeded.toLocaleString() : '—'} Aircoins
                  </span>
                </div>
                <div className="xp-bar">
                  <div className="xp-bar__fill" style={{ width: `${progress}%` }} />
                </div>
                {nextLvl
                  ? <p className="profile-xp__next">Next: Level {nextLvl.levelNumber}</p>
                  : <p className="profile-xp__next">Maximum level reached</p>
                }
              </div>

              {/* Daily login streak */}
              <div className="streak-display">
                <span className="streak-display__icon" aria-hidden="true">🔥</span>
                <span className="streak-display__label">Daily Login Streak</span>
                <span className="streak-display__value">{user?.loginStreak ?? 0}</span>
                <span className="streak-display__unit">day{(user?.loginStreak ?? 0) !== 1 ? 's' : ''}</span>
              </div>

              {/* Stats grid */}
              <div className="stats-grid">
                <StatCard label="Briefs Read"  value={user?.brifsRead  ?? 0}                       icon="📋" />
                <StatCard label="Games Played" value={user?.gamesPlayed ?? 0}                       icon="🎯" />
                <StatCard label="Win Rate"     value={`${user?.winPercent ?? 0}%`} icon="✓" highlight />
                <StatCard label="Aircoins"     value={coins.toLocaleString()}                        icon="⬡" />
              </div>

            </div>

            {/* Overlay shown when not logged in */}
            {!user && (
              <div className="profile-locked-overlay">
                <span className="profile-locked__icon" aria-hidden="true">🔒</span>
                <p className="profile-locked__text">Sign in to view your Agent Profile</p>
                <button className="btn-primary" onClick={() => navigate('login')}>Sign In</button>
              </div>
            )}

          </div>

          {/* ── Right: leaderboard ────────────────────────── */}
          <div className="leaderboard-panel">
            <div className="leaderboard-panel__header">
              <p className="leaderboard-panel__title">Top Agents — Aircoins</p>
            </div>
            <ol className="leaderboard-list">
              {MOCK_LEADERBOARD.map((agent, i) => {
                const pos       = i + 1
                const isCurrent = user?.agentNumber === agent.agentNumber
                return (
                  <li
                    key={agent.agentNumber}
                    className={`leaderboard-row ${isCurrent ? 'leaderboard-row--current' : ''}`}
                  >
                    <span className={`leaderboard-row__pos ${pos <= 3 ? 'leaderboard-row__pos--top' : ''}`}>
                      #{pos}
                    </span>
                    <span className="leaderboard-row__agent">Agent {agent.agentNumber}</span>
                    <span className="leaderboard-row__coins">⬡ {agent.totalAircoins.toLocaleString()}</span>
                  </li>
                )
              })}
            </ol>
          </div>

        </div>
      </div>
    </main>
  )
}

function StatCard({ label, value, icon, highlight }) {
  return (
    <div className={`stat-card ${highlight ? 'stat-card--highlight' : ''}`}>
      <span className="stat-card__icon" aria-hidden="true">{icon}</span>
      <span className="stat-card__value">{value}</span>
      <span className="stat-card__label">{label}</span>
    </div>
  )
}
