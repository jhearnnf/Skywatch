import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { MOCK_LEVELS } from '../../data/mockData'

function getLevelInfo(coins) {
  const levels = MOCK_LEVELS
  const idx    = [...levels].reverse().findIndex(l => coins >= l.cumulativeAircoins)
  const lvl    = idx >= 0 ? levels[levels.length - 1 - idx] : levels[0]
  const next   = levels[levels.indexOf(lvl) + 1]
  const base   = lvl.cumulativeAircoins
  const cap    = next ? next.cumulativeAircoins - base : 200
  const earned = Math.max(0, coins - base)
  return { level: lvl.levelNumber, progress: Math.min(100, Math.round((earned / cap) * 100)), current: earned, next: cap }
}

const NAV_ITEMS = [
  { to: '/home',     emoji: '🏠', label: 'Home'       },
  { to: '/learn',    emoji: '✈️',  label: 'Learn'      },
  { to: '/play',     emoji: '🎮', label: 'Play'       },
  { to: '/rankings', emoji: '🏆', label: 'Rankings'   },
  { to: '/profile',  emoji: '👤', label: 'Profile'    },
]

function CrosshairLogo() {
  return (
    <svg width="26" height="26" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <circle cx="14" cy="14" r="10" stroke="#5baaff" strokeWidth="1.8"/>
      <circle cx="14" cy="14" r="3.5" stroke="#5baaff" strokeWidth="1.8"/>
      <line x1="14" y1="1"  x2="14" y2="7"  stroke="#5baaff" strokeWidth="1.8" strokeLinecap="round"/>
      <line x1="14" y1="21" x2="14" y2="27" stroke="#5baaff" strokeWidth="1.8" strokeLinecap="round"/>
      <line x1="1"  y1="14" x2="7"  y2="14" stroke="#5baaff" strokeWidth="1.8" strokeLinecap="round"/>
      <line x1="21" y1="14" x2="27" y2="14" stroke="#5baaff" strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  )
}

export default function Sidebar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const levelInfo = user ? getLevelInfo(user.cycleAircoins ?? 0) : null

  return (
    <aside className="hidden md:flex flex-col fixed left-0 top-14 bottom-0 w-56 bg-slate-50 border-r border-slate-200 z-30">
      {/* Nav items */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map(({ to, emoji, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all
              ${isActive
                ? 'bg-brand-100 text-brand-600 border border-brand-200'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
              }`
            }
          >
            <span className="text-lg w-6 text-center">{emoji}</span>
            {label}
          </NavLink>
        ))}

        {user?.isAdmin && (
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all mt-2
              ${isActive
                ? 'bg-slate-200 text-slate-800'
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
              }`
            }
          >
            <span className="text-lg w-6 text-center">⚙️</span>
            Admin
          </NavLink>
        )}
      </nav>

      {/* User stats at bottom */}
      {user && levelInfo && (
        <div className="border-t border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-brand-200 border-2 border-brand-300 flex items-center justify-center text-sm font-bold text-brand-600">
              {(user.displayName || user.email || 'U')[0].toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800 truncate">
                {user.displayName || 'Agent'}
              </p>
              <p className="text-xs text-slate-500">Level {levelInfo.level}</p>
            </div>
          </div>

          {/* XP bar */}
          <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-600 rounded-full transition-all duration-500"
              style={{ width: `${levelInfo.progress}%` }}
            />
          </div>
          <p className="text-[10px] text-slate-400 mt-1 text-right">
            {levelInfo.current} / {levelInfo.next} Aircoins
          </p>

          <button
            onClick={logout}
            className="mt-2 w-full text-xs text-slate-400 hover:text-slate-600 transition-colors text-left py-1"
          >
            Sign out
          </button>
        </div>
      )}
    </aside>
  )
}
