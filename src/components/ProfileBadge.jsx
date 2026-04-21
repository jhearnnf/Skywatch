import RankBadge from './RankBadge'

// Centralised badge renderer for the user avatar across Profile, Sidebar, and
// BottomNav. Precedence: selectedBadge cutout → RankBadge SVG → "AC" text.
// Caller owns the surrounding container (size/shape/background); this just
// fills it with the chosen badge content.
export default function ProfileBadge({ user, size = 32, color = '#5baaff', className = '' }) {
  const cutoutUrl = user?.selectedBadge?.cutoutUrl
  if (cutoutUrl) {
    return (
      <span className={`profile-badge-cutout-wrap ${className}`} style={{ width: size, height: size }}>
        <img
          src={cutoutUrl}
          alt={user.selectedBadge?.title ? `${user.selectedBadge.title} badge` : 'Aircraft badge'}
          className="profile-badge-cutout-img"
          draggable={false}
        />
      </span>
    )
  }

  const rankNumber = user?.rank?.rankNumber ?? 1
  if (rankNumber > 1) {
    return <RankBadge rankNumber={rankNumber} size={size} color={color} className={className} />
  }

  const abbreviation = user?.rank?.rankAbbreviation ?? 'AC'
  // Text size scales with the badge box — kept simple to match existing call sites.
  const textClass =
    size >= 36 ? 'text-xl' :
    size >= 24 ? 'text-base' : 'text-xs'
  return (
    <span className={`font-extrabold ${textClass} ${className}`} style={{ color }}>
      {abbreviation}
    </span>
  )
}
