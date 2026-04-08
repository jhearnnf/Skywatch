import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useNewGameUnlock } from '../../context/NewGameUnlockContext'
import { useUnsolvedReports } from '../../context/UnsolvedReportsContext'
import RankBadge from '../RankBadge'
import { useAppSettings } from '../../context/AppSettingsContext'
import { getLevelInfo } from '../../utils/levelUtils'

const NAV_ITEMS = [
  { to: '/home',          emoji: '🏠', label: 'Home'       },
  { to: '/learn-priority', emoji: '✈️', label: 'Learn'     },
  { to: '/play',          emoji: '🎮', label: 'Play'       },
  { to: '/rankings',      emoji: '🏆', label: 'Progression' },
  { to: '/profile',       emoji: '👤', label: 'Profile'    },
]

function CrosshairLogo() {
  return (
    <svg width="26" height="26" viewBox="0 0 40 40" fill="none" aria-hidden="true">
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

export default function Sidebar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { hasAnyNew } = useNewGameUnlock()
  const { unsolvedCount } = useUnsolvedReports()
  const { levels: liveLevels } = useAppSettings()
  const levelInfo = user ? getLevelInfo(user.cycleAircoins ?? 0, liveLevels) : null

  return (
    <aside className="hidden md:flex flex-col fixed left-0 top-14 bottom-0 w-56 bg-slate-50 border-r border-slate-200 z-30">
      {/* Nav items */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map(({ to, emoji, label }) => {
          const isPlay     = to === '/play'
          const showBadge  = isPlay && hasAnyNew && user
          return (
            <NavLink
              key={to}
              data-nav={isPlay ? 'play' : undefined}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors outline-none focus:outline-none border
                ${isActive
                  ? 'bg-brand-100 text-brand-600 border-brand-200'
                  : 'border-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-800'
                }`
              }
            >
              <span className="relative text-lg w-6 text-center shrink-0">
                {emoji}
                {showBadge && (
                  <span className="nav-new-badge" aria-label="New game unlocked" />
                )}
              </span>
              {label}
            </NavLink>
          )
        })}

        {user?.isAdmin && (
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all mt-2 outline-none focus:outline-none
              ${isActive
                ? 'bg-slate-200 text-slate-800'
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
              }`
            }
          >
            <span className="relative text-lg w-6 text-center shrink-0">
              ⚙️
              {unsolvedCount > 0 && (
                <span className="nav-new-badge" aria-label={`${unsolvedCount} unsolved report${unsolvedCount !== 1 ? 's' : ''}`} />
              )}
            </span>
            Admin
          </NavLink>
        )}
      </nav>

      {/* User stats at bottom */}
      {user && levelInfo && (
        <div className="border-t border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-brand-200 border-2 border-brand-300 flex items-center justify-center shrink-0">
              {(user.rank?.rankNumber ?? 1) > 1
                ? <RankBadge rankNumber={user.rank.rankNumber} size={18} />
                : <span className="text-xs font-bold text-brand-600">{user.rank?.rankAbbreviation ?? 'AC'}</span>
              }
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
            {levelInfo.coinsInLevel} / {levelInfo.coinsNeeded} Aircoins
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
