import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

function CrosshairLogo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <circle cx="14" cy="14" r="10" stroke="#1a76e4" strokeWidth="1.8"/>
      <circle cx="14" cy="14" r="3.5" stroke="#1a76e4" strokeWidth="1.8"/>
      <line x1="14" y1="1" x2="14" y2="7"  stroke="#1a76e4" strokeWidth="1.8" strokeLinecap="round"/>
      <line x1="14" y1="21" x2="14" y2="27" stroke="#1a76e4" strokeWidth="1.8" strokeLinecap="round"/>
      <line x1="1"  y1="14" x2="7"  y2="14" stroke="#1a76e4" strokeWidth="1.8" strokeLinecap="round"/>
      <line x1="21" y1="14" x2="27" y2="14" stroke="#1a76e4" strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  )
}

export default function TopBar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  return (
    <header className="fixed top-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-sm border-b border-slate-200/80 h-14">
      <div className="max-w-6xl mx-auto px-4 h-full flex items-center justify-between gap-3">

        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <CrosshairLogo />
          <span className="font-bold text-lg tracking-widest text-slate-800 hidden sm:block">
            SKYWATCH
          </span>
        </Link>

        {/* Right side */}
        <div className="flex items-center gap-2">
          {user ? (
            <>
              {/* Streak */}
              <div className="flex items-center gap-1 bg-amber-50 rounded-full px-3 py-1 border border-amber-200">
                <span className="text-base">🔥</span>
                <span className="text-sm font-bold text-amber-700">{user.streak ?? 0}</span>
              </div>

              {/* Aircoins */}
              <div className="flex items-center gap-1 bg-sky-50 rounded-full px-3 py-1 border border-sky-200">
                <span className="text-base">⭐</span>
                <span className="text-sm font-bold text-sky-700">{user.totalAircoins ?? 0}</span>
              </div>

              {/* Avatar */}
              <button
                onClick={() => navigate('/profile')}
                className="w-8 h-8 rounded-full bg-brand-100 border-2 border-brand-200 flex items-center justify-center text-sm font-bold text-brand-700 hover:border-brand-400 transition-colors"
              >
                {(user.displayName || user.email || 'U')[0].toUpperCase()}
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
