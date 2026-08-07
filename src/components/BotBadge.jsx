import SkywatchLogoMark from './briefReel/SkywatchLogoMark'

// The face a bot posts under.
//
// Every bot wears the SkyWatch crosshair — a bot speaks for the site, not for a
// person, so an aircraft badge or a rank abbreviation (which is what an account
// with no rank falls back to) would both read as "some agent called Guide Bot".
// The accent is what separates one bot from another, so a medals post is not
// mistaken for a guide answer at a glance.
//
// Keyed on the bot's stable `botKey`, never its display name: a bot renamed in
// the admin panel must keep the face it has been posting under. An unknown key
// still gets the plain mark, so a bot added later is never faceless.
const ACCENTS = {
  guide: { ring: '#5baaff', accent: '#82c4ff' }, // brand blue — the guide
  medal: { ring: '#f59e0b', accent: '#fbbf24' }, // amber — the medals feed
}
const DEFAULT_ACCENT = { ring: '#5baaff', accent: '#5baaff' }

export default function BotBadge({ botKey, size = 32, title, className = '' }) {
  const { ring, accent } = ACCENTS[botKey] ?? DEFAULT_ACCENT
  return (
    <span
      className={`block shrink-0 ${className}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={title || 'Bot'}
      title={title || undefined}
    >
      <SkywatchLogoMark ringColor={ring} accentColor={accent} />
    </span>
  )
}
