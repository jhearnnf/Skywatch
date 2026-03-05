import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { MOCK_LEVELS } from '../data/mockData'

function getLevelNumber(totalAircoins = 0) {
  let level = 1
  for (const l of MOCK_LEVELS) {
    if (totalAircoins >= l.cumulativeAircoins) level = l.levelNumber
    else break
  }
  return level
}

const NAV_LINKS = [
  { id: 'dashboard',  label: 'Dashboard' },
  { id: 'intel-feed', label: 'Intel Feed' },
  { id: 'profile',    label: 'Profile' },
]


function AircoinsDisplay({ coins }) {
  return (
    <div className="nav-aircoins" aria-label={`${coins} Aircoins`}>
      <span className="nav-aircoins__icon" aria-hidden="true">⬡</span>
      <span className="nav-aircoins__value">{coins.toLocaleString()}</span>
    </div>
  )
}

function LevelDisplay({ aircoins, navigate }) {
  const level = getLevelNumber(aircoins)
  return (
    <button className="nav-level" onClick={() => navigate('rankings')} aria-label="View level">
      <span className="nav-level__num">L{level}</span>
      <span className="nav-level__label">Level</span>
    </button>
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
          <img src="/images/logo.png" className="brand-logo" alt="" aria-hidden="true" />
          <img src="/images/logo_text.png" className="brand-logo-text" alt="Skywatch" />
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
              <LevelDisplay aircoins={user.totalAircoins ?? 0} navigate={navigate} />
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
