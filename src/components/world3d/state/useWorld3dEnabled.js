import { useAppSettings } from '../../../context/AppSettingsContext'
import { useAuth } from '../../../context/AuthContext'

// Whether the Hangar (3D world at /immerse) is reachable for the current user.
//
// Governed by the AppSettings.hangarGameEnabled toggle in Admin → Settings →
// Game Options → Hangar Game. Off by default.
//
// Admins are exempt: with the toggle off the game has no nav entry for anyone,
// but an admin who types /immerse still gets in, so the environment stays
// previewable before launch. Signing in is required either way — the world
// loads per-user state.
export function useWorld3dEnabled() {
  const { settings } = useAppSettings() ?? {}
  const { user } = useAuth() ?? {}
  if (!user) return false
  return Boolean(settings?.hangarGameEnabled) || Boolean(user.isAdmin)
}

// Whether the Hangar gets a navbar entry. Deliberately NOT the same as access
// above: the admin URL escape hatch must not put a nav item on screen while the
// game is still switched off, or every admin page gains a link to something
// users can't see. Purely the toggle, plus being signed in.
export function useWorld3dNavVisible() {
  const { settings } = useAppSettings() ?? {}
  const { user } = useAuth() ?? {}
  return Boolean(user) && Boolean(settings?.hangarGameEnabled)
}
