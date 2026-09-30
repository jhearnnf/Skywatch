import { useAppSettings } from '../../context/AppSettingsContext'
import { CBAT_GAME_ICONS, cbatIconKey } from '../../data/cbatGameIcons'

// A CBAT game's drawn icon (see data/cbatGameIcons.js). `gameKey` may be a hub
// key or a leaderboard key. Size comes from `className` (width/height), and
// `weight` picks the stroke: 'sm' for icons under ~24px so the lines stay
// solid, 'lg' for ~64px, 'tile' for the hub tile that is 21px on a phone and
// 36px from `sm` up.
//
// Shown only while the admin setting `cbatDrawnIconsEnabled` is on (Game
// Options, off by default). Otherwise, and for a key with no icon, it renders
// `fallback`, which every caller sets to the game's emoji.
export default function CbatGameIcon({ gameKey, className = '', weight, fallback = null }) {
  const enabled = useAppSettings()?.settings?.cbatDrawnIconsEnabled === true
  const key = enabled ? cbatIconKey(gameKey) : null
  if (!key) return fallback
  const weightClass = weight ? ` cbat-gi--${weight}` : ''
  return (
    <svg
      className={`cbat-gi${weightClass} ${className}`}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      data-game-icon={key}
      dangerouslySetInnerHTML={{ __html: CBAT_GAME_ICONS[key] }}
    />
  )
}
