import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

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

  return (
    <header className="fixed top-0 left-0 right-0 z-[1001] bg-slate-50/90 backdrop-blur-md border-b border-slate-200/60 h-14">
      <div className="max-w-6xl mx-auto px-4 h-full flex items-center justify-between gap-3">

        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <CrosshairLogo />
          <span className="font-bold text-lg tracking-widest text-brand-600 hidden sm:block">
            SKYWATCH
          </span>
        </Link>

        {/* Right side */}
        <div className="flex items-center gap-2">
          {user ? (
            <>
              {/* Streak */}
              <button
                onClick={() => navigate('/profile')}
                className="flex items-center gap-1 bg-amber-50 rounded-full px-3 py-1 border border-amber-200 hover:bg-amber-100 hover:border-amber-300 transition-colors outline-none focus:outline-none"
                aria-label="View profile"
              >
                <span className="text-base">🔥</span>
                <span className="text-sm font-bold text-amber-700">{user.loginStreak ?? 0}</span>
              </button>

              {/* Aircoins */}
              <button
                onClick={() => navigate('/rankings')}
                className="flex items-center gap-1 bg-sky-50 rounded-full px-3 py-1 border border-sky-200 hover:bg-sky-100 hover:border-sky-300 transition-colors outline-none focus:outline-none"
                aria-label="View agent levels"
              >
                <span className="text-base">⭐</span>
                <span className="text-sm font-bold text-sky-700">{user.totalAircoins ?? 0}</span>
              </button>

              {/* Avatar / Rank */}
              <button
                onClick={() => navigate('/rankings', { state: { tab: 'ranks' } })}
                className="w-8 h-8 rounded-full bg-brand-100 border-2 border-brand-200 flex items-center justify-center text-sm font-bold text-brand-700 hover:border-brand-400 transition-colors outline-none focus:outline-none"
                aria-label="View RAF ranks"
              >
                {user.rank?.rankAbbreviation ?? user.rank?.abbreviation ?? (user.displayName || user.email || 'U')[0].toUpperCase()}
              </button>
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
