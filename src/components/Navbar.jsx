import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

const NAV_LINKS = [
  { id: 'dashboard',  label: 'Dashboard' },
  { id: 'intel-feed', label: 'Intel Feed' },
  { id: 'profile',    label: 'Profile' },
]

function CrosshairIcon() {
  return (
    <svg className="brand-icon" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="2.5" fill="currentColor" />
      <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 1v3M9 14v3M1 9h3M14 9h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function AircoinsDisplay({ coins }) {
  return (
    <div className="nav-aircoins" aria-label={`${coins} Aircoins`}>
      <span className="nav-aircoins__icon" aria-hidden="true">⬡</span>
      <span className="nav-aircoins__value">{coins.toLocaleString()}</span>
    </div>
  )
}

function RankDisplay({ rank, navigate }) {
  if (!rank) return null
  return (
    <button className="nav-rank" onClick={() => navigate('rankings')} aria-label="View rankings">
      <span className="nav-rank__abbr">{rank.rankAbbreviation ?? rank.abbreviation ?? '—'}</span>
      <span className="nav-rank__label">Rank</span>
    </button>
  )
}

export default function Navbar({ page, navigate }) {
  const { user, logout } = useAuth()
  const [open, setOpen]  = useState(false)

  const handleNav = (id) => { navigate(id); setOpen(false) }

  const handleLogout = async () => {
    await logout()
    navigate('dashboard')
    setOpen(false)
  }

  return (
    <nav className="navbar">
      <div className="navbar-inner">

        {/* Brand */}
        <button className="navbar-brand" onClick={() => handleNav('dashboard')}>
          <CrosshairIcon />
          <span className="brand-name">Skywatch</span>
        </button>

        {/* Hamburger */}
        <button
          className={`menu-toggle ${open ? 'open' : ''}`}
          onClick={() => setOpen(!open)}
          aria-label="Toggle navigation"
          aria-expanded={open}
        >
          <span /><span /><span />
        </button>

        {/* Nav links */}
        <ul className={`nav-links ${open ? 'open' : ''}`} role="list">
          {NAV_LINKS.map(({ id, label }) => (
            <li key={id}>
              <button
                className={`nav-link ${page === id ? 'active' : ''}`}
                onClick={() => handleNav(id)}
                aria-current={page === id ? 'page' : undefined}
              >
                {label}
              </button>
            </li>
          ))}
          {user?.isAdmin && (
            <li>
              <button
                className={`nav-link nav-link--admin ${page === 'admin' ? 'active' : ''}`}
                onClick={() => handleNav('admin')}
              >
                Admin
              </button>
            </li>
          )}
        </ul>

        {/* Right-side auth widgets */}
        <div className={`nav-auth ${open ? 'nav-auth--open' : ''}`}>
          {user ? (
            <>
              <AircoinsDisplay coins={user.totalAircoins ?? 0} />
              <RankDisplay rank={user.rank} navigate={navigate} />
              <button className="nav-btn nav-btn--ghost" onClick={handleLogout}>
                Logout
              </button>
            </>
          ) : (
            <button className="nav-btn nav-btn--primary" onClick={() => handleNav('login')}>
              Sign In
            </button>
          )}
        </div>

      </div>
    </nav>
  )
}
