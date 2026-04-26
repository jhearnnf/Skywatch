import { useEffect, useRef } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useNewGameUnlock } from '../../context/NewGameUnlockContext'
import { useNewCategoryUnlock } from '../../context/NewCategoryUnlockContext'
import { useUnsolvedReports } from '../../context/UnsolvedReportsContext'
import { useGameChrome } from '../../context/GameChromeContext'
import ProfileBadge from '../ProfileBadge'

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

export default function BottomNav() {
  const { user } = useAuth()
  const { hasAnyNew } = useNewGameUnlock()
  const { hasAnyNew: hasAnyNewCategory, firstNewCategory } = useNewCategoryUnlock()
  const { unsolvedCount } = useUnsolvedReports()

  const items = user?.isAdmin ? [...NAV_ITEMS, ADMIN_ITEM] : NAV_ITEMS
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
          const active = location.pathname === to || location.pathname.startsWith(to + '/')
          const isLearn = to === '/learn-priority'
          const showBadge = to === '/play' && hasAnyNew && user
          const showCategoryBadge = isLearn && hasAnyNewCategory && user
          const showReportBadge = to === '/admin' && unsolvedCount > 0
          const isProfileItem = to === '/profile'
          const handleLearnClick = isLearn && hasAnyNewCategory && user
            ? (e) => {
                e.preventDefault()
                const target = firstNewCategory
                navigate('/learn-priority', target ? { state: { category: target } } : undefined)
              }
            : undefined
          return (
            <NavLink
              key={to}
              ref={to === '/play' ? playBtnRef : undefined}
              data-nav={to === '/play' ? 'play' : isLearn ? 'learn' : undefined}
              to={user || to === '/home' || to === '/rankings' ? to : '/login'}
              onClick={handleLearnClick}
              className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors
                ${active
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
