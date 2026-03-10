import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

const NAV_ITEMS = [
  { to: '/home',     emoji: '🏠', label: 'Home'    },
  { to: '/learn',    emoji: '✈️',  label: 'Learn'   },
  { to: '/play',     emoji: '🎮', label: 'Play'    },
  { to: '/rankings', emoji: '🏆', label: 'Ranks'   },
  { to: '/profile',  emoji: '👤', label: 'Me'      },
]

export default function BottomNav() {
  const { user } = useAuth()
  const location = useLocation()

  // Hide on full-screen pages
  const hide = ['/', '/login', '/register'].includes(location.pathname)
  if (hide) return null

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 md:hidden bg-white border-t border-slate-200 safe-area-bottom">
      <div className="flex items-stretch h-16">
        {NAV_ITEMS.map(({ to, emoji, label }) => {
          const active = location.pathname === to || location.pathname.startsWith(to + '/')
          return (
            <NavLink
              key={to}
              to={user || to === '/home' || to === '/rankings' ? to : '/login'}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors
                ${active
                  ? 'text-brand-600'
                  : 'text-slate-400 hover:text-slate-600'
                }`}
            >
              <span className={`text-xl leading-none transition-transform ${active ? 'scale-110' : ''}`}>
                {emoji}
              </span>
              <span className={`text-[10px] font-semibold tracking-wide ${active ? 'text-brand-600' : ''}`}>
                {label}
              </span>
              {active && (
                <span className="absolute bottom-0 w-8 h-0.5 bg-brand-600 rounded-full" />
              )}
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}
