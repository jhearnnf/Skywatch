import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useNewGameUnlock } from '../../context/NewGameUnlockContext'
import { useUnsolvedReports } from '../../context/UnsolvedReportsContext'
import RankBadge from '../RankBadge'

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
  const { unsolvedCount } = useUnsolvedReports()

  const items = user?.isAdmin ? [...NAV_ITEMS, ADMIN_ITEM] : NAV_ITEMS
  const location = useLocation()

  // Hide on full-screen pages
  const hide = ['/', '/login', '/register'].includes(location.pathname)
  if (hide) return null

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 md:hidden bg-slate-50/95 backdrop-blur-md border-t border-slate-200 safe-area-bottom">
      <div className="flex items-stretch h-16">
        {items.map(({ to, emoji, label }) => {
          const active = location.pathname === to || location.pathname.startsWith(to + '/')
          const showBadge = to === '/play' && hasAnyNew && user
          const showReportBadge = to === '/admin' && unsolvedCount > 0
          const isProfileItem = to === '/profile'
          const rankNumber = user?.rank?.rankNumber ?? 1
          return (
            <NavLink
              key={to}
              data-nav={to === '/play' ? 'play' : undefined}
              to={user || to === '/home' || to === '/rankings' ? to : '/login'}
              className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors
                ${active
                  ? 'text-brand-600'
                  : 'text-slate-400 hover:text-slate-600'
                }`}
            >
              <span className={`relative text-xl leading-none transition-transform ${active ? 'scale-110' : ''}`}>
                {isProfileItem && user
                  ? (rankNumber > 1
                    ? <RankBadge rankNumber={rankNumber} size={20} color={active ? '#5baaff' : '#94a3b8'} />
                    : <span className="text-xs font-bold" style={{ color: active ? '#5baaff' : '#94a3b8' }}>{user.rank?.rankAbbreviation ?? 'AC'}</span>
                  )
                  : emoji
                }
                {showBadge && (
                  <span className="nav-new-badge" aria-label="New game unlocked" />
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
