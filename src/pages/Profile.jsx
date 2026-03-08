import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { MOCK_LEVELS, MOCK_LEADERBOARD } from '../data/mockData'

const TIER_LABELS = { free: 'Free', trial: 'Trial', silver: 'Silver', gold: 'Gold' }

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

export default function Profile({ navigate }) {
  const { user, setUser, API } = useAuth()

  const [stats,          setStats]          = useState({ brifsRead: 0, gamesPlayed: 0, winPercent: 0 })
  const [levels,         setLevels]         = useState(MOCK_LEVELS)
  const [leaderboard,    setLeaderboard]    = useState(MOCK_LEADERBOARD)
  const [useLiveLeaderboard, setUseLive]    = useState(false)
  const [diffBusy,       setDiffBusy]      = useState(false)

  // Fetch public data — levels, settings, then conditionally leaderboard
  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/users/levels`).then(r => r.json()),
      fetch(`${API}/api/users/settings`).then(r => r.json()),
    ])
      .then(([lvlData, settingsData]) => {
        if (lvlData?.data?.levels?.length) setLevels(lvlData.data.levels)

        const useLive = settingsData?.data?.useLiveLeaderboard ?? false
        setUseLive(useLive)

        if (useLive) {
          return fetch(`${API}/api/users/leaderboard`)
            .then(r => r.json())
            .then(lbData => setLeaderboard(lbData?.data?.agents ?? []))
        } else {
          setLeaderboard(MOCK_LEADERBOARD)
        }
      })
      .catch(() => {})
  }, [API])

  // Fetch authenticated user stats
  useEffect(() => {
    if (!user) return
    fetch(`${API}/api/users/stats`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (data?.data) {
          setStats({
            brifsRead:   data.data.brifsRead   ?? 0,
            gamesPlayed: data.data.gamesPlayed ?? 0,
            winPercent:  data.data.winPercent  ?? 0,
          })
        }
      })
      .catch(() => {})
  }, [API, user])

  const changeDifficulty = async (d) => {
    if (diffBusy || d === user?.difficultySetting) return
    setDiffBusy(true)
    try {
      const res  = await fetch(`${API}/api/users/me/difficulty`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ difficulty: d }),
      })
      const data = await res.json()
      if (data?.data?.user) setUser(data.data.user)
    } catch { /* non-fatal */ }
    finally { setDiffBusy(false) }
  }

  const coins = user?.cycleAircoins ?? 0
  const { current: lvl, next: nextLvl, coinsInLevel, coinsNeeded, progress } = getLevelInfo(coins, levels)

  // Rank — populated via /api/users/stats, but user from context has rank as ObjectId
  const rankDisplay =
    user?.rank && typeof user.rank === 'object' && user.rank.rankName
      ? `${user.rank.rankName} · ${user.rank.rankAbbreviation}`
      : 'Unranked'

  return (
    <main className="page profile-page">

      {/* ── Header ───────────────────────────────────────── */}
      <div className="feed-header">
        <div className="section-inner">
          <div className="feed-header__eyebrow">
            <span className="feed-header__eyebrow-dot" aria-hidden="true" />
            <span>CLASSIFICATION: RESTRICTED</span>
            <span className="feed-header__eyebrow-divider" aria-hidden="true">|</span>
            <span>SKYWATCH AGENT DOSSIER</span>
          </div>
          <h1 className="feed-title">
            <span className="feed-title__bracket" aria-hidden="true">[</span>
            AGENT PROFILE
            <span className="feed-title__bracket" aria-hidden="true">]</span>
          </h1>
          <p className="feed-subtitle">
            <span className="feed-subtitle__tag" aria-hidden="true">// </span>
            Mission stats, rank progression &amp; agent leaderboard.
          </p>
        </div>
      </div>

      <div className="section-inner">
        <div className="profile-columns">

          {/* ── Left: user stats ──────────────────────────── */}
          <div className="profile-stats-section">
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
              <div className="profile-xp profile-xp--clickable" onClick={() => navigate('rankings')} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && navigate('rankings')} title="View level progression">
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

              {/* Difficulty setting */}
              {user && (
                <div className="profile-difficulty">
                  <span className="profile-difficulty__label">Quiz Difficulty</span>
                  <div className="profile-difficulty__toggle">
                    <button
                      className={`diff-btn diff-btn--easy ${(user.difficultySetting ?? 'easy') === 'easy' ? 'diff-btn--active' : ''}`}
                      onClick={() => changeDifficulty('easy')}
                      disabled={diffBusy}
                    >Easy</button>
                    <button
                      className={`diff-btn diff-btn--medium ${user.difficultySetting === 'medium' ? 'diff-btn--active' : ''}`}
                      onClick={() => changeDifficulty('medium')}
                      disabled={diffBusy}
                    >Medium</button>
                  </div>
                </div>
              )}

              {/* Daily login streak */}
              <div className="streak-display">
                <span className="streak-display__icon" aria-hidden="true">🔥</span>
                <span className="streak-display__label">Daily Login Streak</span>
                <span className="streak-display__value">{user?.loginStreak ?? 0}</span>
                <span className="streak-display__unit">day{(user?.loginStreak ?? 0) !== 1 ? 's' : ''}</span>
              </div>

              {/* Stats grid */}
              <div className="stats-grid">
                <StatCard label="Briefs Read"  value={stats.brifsRead}                          icon="📋" />
                <StatCard label="Games Played" value={stats.gamesPlayed}          icon="🎯" onClick={() => navigate('game-history')} />
                <StatCard label="Avg Score"    value={`${stats.winPercent}%`}  icon="✓" highlight />
                <StatCard label="Aircoins"     value={coins.toLocaleString()}                    icon="⬡" onClick={() => navigate('aircoin-history')} />
              </div>

            </div>

            {/* Report a problem link */}
            <div className="profile-report-row">
              <button className="footer-link--report profile-report-btn" onClick={() => navigate('report-problem')}>
                Report a Problem
              </button>
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
              {!useLiveLeaderboard && (
                <span className="mock-badge">Mock data</span>
              )}
            </div>
            <ol className="leaderboard-list">
              {leaderboard.map((agent, i) => {
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
              {leaderboard.length === 0 && (
                <li className="leaderboard-row"><span className="leaderboard-row__agent">No agents yet</span></li>
              )}
            </ol>
          </div>

        </div>
      </div>
    </main>
  )
}

function StatCard({ label, value, icon, highlight, mock, onClick }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      className={`stat-card ${highlight ? 'stat-card--highlight' : ''} ${mock ? 'stat-card--mock' : ''} ${onClick ? 'stat-card--clickable' : ''}`}
      onClick={onClick}
    >
      <span className="stat-card__icon" aria-hidden="true">{icon}</span>
      <span className="stat-card__value">{value}</span>
      <span className="stat-card__label">{label}</span>
    </Tag>
  )
}
