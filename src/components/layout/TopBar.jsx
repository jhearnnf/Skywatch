import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import ProfileBadge from '../ProfileBadge'
import OfflineBadge from './OfflineBadge'
import ThemeSelector from './ThemeSelector'
import { useSlimMode, useLandingPageEnabled } from '../../hooks/useSlimMode'
import { GUEST_UI_THEME_EVENT, hasGuestUiThemeChoice } from '../../lib/uiTheme'

const PUBLIC_GAME_PATHS = new Set(['/cbat/target', '/cbat/ant', '/cbat/symbols', '/cbat/code-duplicates'])
const THEME_HINT_SEEN_KEY = 'skywatch.guestThemeHintSeen'
const THEME_HINT_DISMISSED_EVENT = 'skywatch:guest-theme-hint-dismissed'

function guestThemeHintSeen() {
  try { return localStorage.getItem(THEME_HINT_SEEN_KEY) === '1' } catch { return false }
}

function GuestThemeHint({ compact = false }) {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    setVisible(!user && PUBLIC_GAME_PATHS.has(pathname) && !hasGuestUiThemeChoice() && !guestThemeHintSeen())
  }, [pathname, user])

  useEffect(() => {
    const hide = () => setVisible(false)
    window.addEventListener(GUEST_UI_THEME_EVENT, hide)
    window.addEventListener(THEME_HINT_DISMISSED_EVENT, hide)
    return () => {
      window.removeEventListener(GUEST_UI_THEME_EVENT, hide)
      window.removeEventListener(THEME_HINT_DISMISSED_EVENT, hide)
    }
  }, [])

  if (!visible) return null
  const dismiss = () => {
    try { localStorage.setItem(THEME_HINT_SEEN_KEY, '1') } catch { /* storage unavailable */ }
    window.dispatchEvent(new Event(THEME_HINT_DISMISSED_EVENT))
  }
  return (
    <div
      role="status"
      className={`${compact ? 'md:hidden' : 'hidden md:flex'} absolute left-1/2 top-[calc(100%+9px)] -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-[#5baaff]/50 bg-[#071426] py-1.5 pl-3 pr-1.5 text-[11px] font-medium text-[#ddecff] shadow-[0_8px_24px_rgba(0,0,0,0.45),0_0_16px_rgba(91,170,255,0.12)]`}
      data-testid={compact ? 'guest-theme-hint-mobile' : 'guest-theme-hint-desktop'}
    >
      <span className="absolute left-1/2 top-0 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-l border-t border-[#5baaff]/50 bg-[#071426]" aria-hidden="true" />
      <span>Try the Real CBAT theme</span>
      <span className="text-[#5baaff]" aria-hidden="true">↑</span>
      <button type="button" onClick={dismiss} aria-label="Dismiss theme hint" className="relative z-10 flex h-5 w-5 items-center justify-center rounded-full text-sm leading-none text-[#7892ad] transition-colors hover:bg-white/10 hover:text-white">×</button>
    </div>
  )
}

function CrosshairLogo() {
  return (
    <svg width="28" height="28" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <circle cx="20" cy="20" r="17" stroke="#1d4ed8" strokeWidth="2.2"/>
      <line x1="20" y1="1"  x2="20" y2="12" stroke="#1d4ed8" strokeWidth="2.2" strokeLinecap="round"/>
      <line x1="20" y1="28" x2="20" y2="39" stroke="#1d4ed8" strokeWidth="2.2" strokeLinecap="round"/>
      <line x1="1"  y1="20" x2="12" y2="20" stroke="#1d4ed8" strokeWidth="2.2" strokeLinecap="round"/>
      <line x1="28" y1="20" x2="39" y2="20" stroke="#1d4ed8" strokeWidth="2.2" strokeLinecap="round"/>
      <circle cx="20" cy="20" r="7" stroke="#5baaff" strokeWidth="1.8"/>
      <circle cx="20" cy="20" r="2.5" fill="#5baaff"/>
    </svg>
  )
}

export default function TopBar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const slim = useSlimMode()
  const landingEnabled = useLandingPageEnabled()

  return (
    <header className="app-topbar fixed top-0 left-0 right-0 z-[1001] bg-slate-50/90 backdrop-blur-md border-b border-slate-200/60 h-14">
      <div className="max-w-6xl mx-auto px-4 h-full flex items-center justify-between gap-3">

        {/* Logo — routes to the landing page whenever there is one to reach.
            When there isn't (the native app, or web slim with the landing page
            turned off) it's inert rather than a link that bounces to /cbat and
            flashes a blank screen. Same hook as the route gate in App.jsx, so
            the link and the page can't disagree. */}
        <div className="flex items-center gap-2 shrink-0">
          {!landingEnabled ? (
            <div className="flex items-center gap-2 select-none">
              <CrosshairLogo />
              <span className="font-bold text-lg tracking-widest text-brand-600 hidden sm:block">
                SKYWATCH
              </span>
            </div>
          ) : (
            <Link to="/" className="flex items-center gap-2">
              <CrosshairLogo />
              <span className="font-bold text-lg tracking-widest text-brand-600 hidden sm:block">
                SKYWATCH
              </span>
            </Link>
          )}
          <OfflineBadge />
        </div>

        {/* Theme — the phone's faint "Switch theme" link, in the gap between
            the logo and the avatar. Desktop carries the full selector on the
            right instead. */}
        <div className="relative flex md:hidden items-center justify-center min-w-0">
          <ThemeSelector compact />
          <GuestThemeHint compact />
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2">
          <div className="relative hidden md:flex items-center mr-2">
            <ThemeSelector />
            <GuestThemeHint />
          </div>
          {user ? (
            <>
              {/* Theme — the full selector, desktop only (the phone has the
                  link above). An account setting, so it shows in slim mode
                  too: the look applies to the CBAT games as much as to the
                  rest of the site. */}
              {/* Streak — hidden in slim (native) mode */}
              {!slim && (
                <button
                  onClick={() => navigate('/profile')}
                  className="flex items-center gap-1 bg-brand-50 rounded-full px-3 py-1 border border-brand-200 hover:bg-brand-100 hover:border-brand-300 transition-colors outline-none focus:outline-none"
                  aria-label="View profile"
                >
                  <span className="text-base flame-blue">🔥</span>
                  <span className="text-sm font-bold text-brand-700">{user.loginStreak ?? 0}</span>
                </button>
              )}

              {/* Airstars — hidden in slim (native) mode */}
              {!slim && (
                <button
                  onClick={() => navigate('/rankings')}
                  className="flex items-center gap-1 bg-slate-200 rounded-full px-3 py-1 border border-slate-300 hover:bg-slate-300 hover:border-slate-400 transition-colors outline-none focus:outline-none"
                  aria-label="View agent levels"
                >
                  <span className="text-base star-silver">⭐</span>
                  <span className="text-sm font-bold text-white">{user.totalAirstars ?? 0}</span>
                </button>
              )}

              {/* Avatar — mobile only. On md+ the sidebar footer carries the
                  same badge with the same click targets (Sidebar.jsx), so a
                  second copy up here is pure duplication.
                  In slim mode it always routes to profile; otherwise the rank
                  badge routes to RAF ranks and an aircraft cutout to the badge picker. */}
              {(() => {
                const hasCutout = Boolean(user?.selectedBadge?.cutoutUrl)
                const onClick = slim
                  ? () => navigate(hasCutout ? '/profile/badge' : '/profile')
                  : () => navigate(hasCutout ? '/profile/badge' : '/rankings', hasCutout ? undefined : { state: { tab: 'ranks' } })
                return (
                  <button
                    onClick={onClick}
                    className="md:hidden w-8 h-8 rounded-full bg-brand-100 border-2 border-brand-200 flex items-center justify-center text-sm font-bold text-brand-700 hover:border-brand-400 transition-colors outline-none focus:outline-none"
                    aria-label={hasCutout ? 'Change profile badge' : slim ? 'View profile' : 'View RAF ranks'}
                  >
                    <ProfileBadge user={user} size={hasCutout ? 26 : 20} />
                  </button>
                )
              })()}
            </>
          ) : (
            <Link
              to="/login"
              className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-1.5 rounded-full transition-colors"
            >
              Sign In
            </Link>
          )}
        </div>
      </div>
    </header>
  )
}
