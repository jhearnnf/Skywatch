import { useEffect, useRef } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useNewGameUnlock } from '../../context/NewGameUnlockContext'
import { useNewCategoryUnlock } from '../../context/NewCategoryUnlockContext'
import { useUnsolvedReports } from '../../context/UnsolvedReportsContext'
import { useChatUnread } from '../../context/ChatUnreadContext'
import { useAppSettings } from '../../context/AppSettingsContext'
import { useGameChrome } from '../../context/GameChromeContext'
import ProfileBadge from '../ProfileBadge'
import { getActiveNavTo } from '../../utils/navSections'
import { prefetchOverview } from '../../utils/chatCache'
import { SLIM_NAV_ITEMS, HANGAR_NAV_ITEM, NATIVE_APP, insertBeforeProfile, slimNavActiveTo } from '../../utils/appMode'
import { useSlimMode } from '../../hooks/useSlimMode'
import { useWorld3dNavVisible } from '../world3d/state/useWorld3dEnabled'

// Slightly longer than the 300ms slide-in transition in main.css so the flash
// starts after the BottomNav is on-screen.
const FLASH_SLIDE_DELAY_MS = 320
const FLASH_DURATION_MS    = 1200

const NAV_ITEMS = [
  { to: '/home',     emoji: '🏠', label: 'Home'    },
  { to: '/learn-priority', emoji: '✈️', label: 'Learn' },
  { to: '/play',     emoji: '🎮', label: 'Play'    },
  { to: '/rankings', emoji: '🏆', label: 'Progress' },
  { to: '/profile',  emoji: '👤', label: 'Me'      },
]

const ADMIN_ITEM = { to: '/admin', emoji: '⚙️', label: 'Admin' }
// Labelled "Community" rather than "Chat": the destination is channels and
// DMs between agents, not just a line to the support team. The route stays
// /chat.
const CHAT_ITEM  = { to: '/chat',  emoji: '💬', label: 'Community' }

export default function BottomNav() {
  const { user, API, apiFetch } = useAuth()
  const slim = useSlimMode()
  const { hasAnyNew } = useNewGameUnlock()
  const { hasAnyNew: hasAnyNewCategory, firstNewCategory } = useNewCategoryUnlock()
  const { unsolvedCount } = useUnsolvedReports()
  const { hasUnread: chatUnread } = useChatUnread() ?? {}
  const { settings } = useAppSettings() ?? {}
  // Permanent entry off-native for every signed-in user, slim mode included.
  // See the matching note in Sidebar.jsx and NATIVE_APP in utils/appMode.js.
  const showChatNav = !NATIVE_APP && user && settings?.chatEnabled !== false
  // Hangar shows in slim mode too — it is the one non-CBAT game slim keeps.
  const showHangarNav = useWorld3dNavVisible()

  let items = slim ? [...SLIM_NAV_ITEMS] : [...NAV_ITEMS]
  if (showHangarNav) items = [...items, HANGAR_NAV_ITEM]
  if (showChatNav) items = insertBeforeProfile(items, CHAT_ITEM)
  if (user?.isAdmin) items = [...items, ADMIN_ITEM]
  const location = useLocation()
  const navigate = useNavigate()

  const { immersive, pendingPlayNavFlash, consumePlayNavFlash } = useGameChrome()
  const playBtnRef = useRef(null)

  // Consume a deferred play-nav flash queued while BottomNav was off-screen
  // (immersive gameplay). Wait for the slide-in transition before flashing.
  useEffect(() => {
    if (immersive || !pendingPlayNavFlash) return
    const slideTimer = setTimeout(() => {
      const el = playBtnRef.current
      if (el) {
        el.classList.add('play-nav-flash')
        setTimeout(() => el.classList.remove('play-nav-flash'), FLASH_DURATION_MS)
      }
      consumePlayNavFlash()
    }, FLASH_SLIDE_DELAY_MS)
    return () => clearTimeout(slideTimer)
  }, [immersive, pendingPlayNavFlash, consumePlayNavFlash])

  // Hide on full-screen pages
  const hide = ['/', '/login', '/register'].includes(location.pathname)
  if (hide) return null

  return (
    <nav className="app-bottomnav fixed bottom-0 left-0 right-0 z-40 md:hidden bg-slate-50/95 backdrop-blur-md border-t border-slate-200 safe-area-bottom">
      <div className="flex items-stretch h-16">
        {items.map(({ to, emoji, label }) => {
          const active = (slim ? slimNavActiveTo(location.pathname) : getActiveNavTo(location.pathname)) === to
          const isLearn = to === '/learn-priority'
          const showBadge = to === '/play' && hasAnyNew && user
          const showCategoryBadge = isLearn && hasAnyNewCategory && user
          const showReportBadge = to === '/admin' && unsolvedCount > 0
          // Admin gets the same translucent dark-red treatment as the sidebar,
          // so the entry reads as "staff only" wherever it appears.
          const isAdminItem = to === '/admin'
          const showChatBadge   = to === '/chat'  && chatUnread
          const isProfileItem = to === '/profile'
          const handleLearnClick = isLearn && hasAnyNewCategory && user
            ? (e) => {
                e.preventDefault()
                const target = firstNewCategory
                navigate('/learn-priority', target ? { state: { category: target } } : undefined)
              }
            : undefined
          // Warmed on first touch rather than on tap, which on mobile is the
          // ~100ms between finger down and finger up — small, but it is the
          // whole of the gap the rail used to spend blank. See Sidebar.
          const warmChat = to === '/chat' && user
            ? () => prefetchOverview(API, apiFetch, user._id)
            : undefined
          return (
            <NavLink
              key={to}
              ref={to === '/play' ? playBtnRef : undefined}
              data-nav={to === '/play' ? 'play' : isLearn ? 'learn' : undefined}
              to={slim || user || to === '/home' || to === '/rankings' ? to : '/login'}
              onTouchStart={warmChat}
              onMouseEnter={warmChat}
              onClick={handleLearnClick}
              className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors
                ${isAdminItem
                  ? (active
                      ? 'bg-red-200/80 text-slate-900'
                      : 'bg-red-100/50 text-slate-600 hover:bg-red-200/60 hover:text-slate-900')
                  : active
                    ? 'text-brand-600'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
            >
              <span className={`relative text-xl leading-none transition-transform ${active ? 'scale-110' : ''}`}>
                {isProfileItem && user
                  ? <ProfileBadge user={user} size={user?.selectedBadge?.cutoutUrl ? 26 : 20} color={active ? '#5baaff' : '#94a3b8'} />
                  : emoji
                }
                {showBadge && (
                  <span className="nav-new-badge" aria-label="New game unlocked" />
                )}
                {showCategoryBadge && (
                  <span className="nav-new-badge" aria-label="New category unlocked" />
                )}
                {showReportBadge && (
                  <span className="nav-new-badge" aria-label={`${unsolvedCount} unsolved report${unsolvedCount !== 1 ? 's' : ''}`} />
                )}
                {showChatBadge && (
                  <span className="nav-new-badge" aria-label="New message" />
                )}
              </span>
              <span className={`text-[10px] font-semibold tracking-wide ${active ? 'text-brand-600' : ''}`}>
                {label}
              </span>

              {active && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-brand-600 rounded-full" />
              )}
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}
