const MOCK_USER = {
  agentNumber: '4471823',
  subscriptionTier: 'gold',
  rank: { rankName: 'Corporal', rankAbbreviation: 'Cpl' },
  brifsRead: 14,
  gamesPlayed: 22,
  winPercent: 68,
  totalAircoins: 310,
}

const TIER_LABELS = {
  free: 'Free',
  trial: 'Trial',
  silver: 'Silver',
  gold: 'Gold',
}

export default function Profile() {
  const user = MOCK_USER

  return (
    <main className="page profile-page">
      <div className="section-inner">

        {/* ── Identity ─────────────────────────────────── */}
        <div className="profile-hero">
          <div className="profile-avatar">
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
              <circle cx="18" cy="14" r="7" stroke="currentColor" strokeWidth="1.75"/>
              <path d="M4 32c0-7.732 6.268-14 14-14s14 6.268 14 14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
            </svg>
          </div>
          <div>
            <p className="profile-agent">Agent {user.agentNumber}</p>
            <p className="profile-rank">
              {user.rank ? `${user.rank.rankName} · ${user.rank.rankAbbreviation}` : 'Unranked'}
            </p>
          </div>
          <span className={`tier-badge tier-badge--${user.subscriptionTier}`}>
            {TIER_LABELS[user.subscriptionTier]}
          </span>
        </div>

        {/* ── Stats grid ───────────────────────────────── */}
        <div className="stats-grid">
          <StatCard label="Briefs Read"  value={user.brifsRead}    icon="📋" />
          <StatCard label="Games Played" value={user.gamesPlayed}  icon="🎯" />
          <StatCard label="Win Rate"     value={`${user.winPercent}%`} icon="✓" highlight />
          <StatCard label="Aircoins"     value={user.totalAircoins} icon="⬡" />
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
