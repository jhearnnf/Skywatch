import { PATHWAY_COLORS, tierRankNum } from '../data/pathways'
import { CATEGORY_ICONS } from '../data/mockData'

const DIM = '#3d5a7a'
const SURFACE = '#0c1829'

function Badge({ u, userLevel, userRankNumber, userTier, onSubscriptionLocked }) {
  const color      = PATHWAY_COLORS[u.category] ?? '#475569'
  const icon       = CATEGORY_ICONS?.[u.category] ?? '📄'
  const tier       = u.tierRequired ?? 'free'
  const pathwayMet = userRankNumber > (u.rankRequired ?? 1) || (userRankNumber >= (u.rankRequired ?? 1) && userLevel >= (u.levelRequired ?? 1))
  const tierMet    = tierRankNum(userTier) >= tierRankNum(tier)
  const unlocked   = pathwayMet && tierMet
  const subLocked  = !tierMet
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full${subLocked ? ' cursor-pointer' : ''}`}
      style={{
        background: unlocked ? `${color}28` : SURFACE,
        color:      unlocked ? color        : DIM,
        border:    `1px solid ${unlocked ? `${color}55` : subLocked ? (tier === 'gold' ? '#92400e' : '#1a3a6b') : '#1a3060'}`,
      }}
      onClick={subLocked ? () => onSubscriptionLocked(u.category, tier) : undefined}
    >
      <span style={{ fontSize: 11, lineHeight: 1 }}>{icon}</span>
      {u.category}
      {tier === 'gold'   && <span style={{ color: unlocked ? '#fbbf24' : subLocked ? '#92400e' : DIM }}>★</span>}
      {tier === 'silver' && <span style={{ color: unlocked ? '#7eb8e8' : subLocked ? '#1a3a6b' : DIM }}>◆</span>}
      {unlocked  && <span style={{ opacity: 0.7 }}>🔓</span>}
      {!unlocked && <span style={{ opacity: subLocked ? 0.8 : 0.5 }}>🔒</span>}
    </span>
  )
}

export default function UnlockBadges({ unlocks, userLevel, userRankNumber, userTier, onSubscriptionLocked, bare }) {
  if (!unlocks.length) return null
  const badges = unlocks.map(u => (
    <Badge
      key={u.category}
      u={u}
      userLevel={userLevel}
      userRankNumber={userRankNumber}
      userTier={userTier}
      onSubscriptionLocked={onSubscriptionLocked}
    />
  ))
  if (bare) return badges
  return <div className="flex flex-wrap gap-1 mt-2">{badges}</div>
}
