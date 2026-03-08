import { useState, useEffect, useRef } from 'react'
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


function AircoinsDisplay({ coins, navigate }) {
  return (
    <button className="nav-aircoins" onClick={() => navigate('aircoin-history')} aria-label={`${coins} Aircoins — view history`}>
      <span className="nav-aircoins__icon" aria-hidden="true">⬡</span>
      <span className="nav-aircoins__value">{coins.toLocaleString()}</span>
    </button>
  )
}

function LevelDisplay({ cycleAircoins, navigate }) {
  const level = getLevelNumber(cycleAircoins)
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
    <button className="nav-rank" onClick={() => navigate('rankings', { scrollTo: 'ranks' })} aria-label="View rank">
      <span className="nav-rank__abbr">{rank.rankAbbreviation ?? rank.abbreviation ?? '—'}</span>
      <span className="nav-rank__label">Rank</span>
    </button>
  )
}

function StatsCombo({ coins, cycleAircoins, rank, navigate }) {
  const [open, setOpen] = useState(false)
  const ref             = useRef(null)
  const level           = getLevelNumber(cycleAircoins)
  const abbr            = rank ? (rank.rankAbbreviation ?? rank.abbreviation ?? null) : null

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const select = (page) => { setOpen(false); navigate(page) }

  return (
    <div className="nav-stats-combo" ref={ref}>
      <button
        className={`nav-stats-combo__btn${open ? ' nav-stats-combo__btn--open' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Stats menu"
      >
        <span className="nav-stats-combo__icon" aria-hidden="true">⬡</span>
        <span className="nav-stats-combo__coins">{coins.toLocaleString()}</span>
        <span className="nav-stats-combo__sep" aria-hidden="true">·</span>
        <span className="nav-stats-combo__level">L{level}{abbr ? ` · ${abbr}` : ''}</span>
        <span className="nav-stats-combo__chevron" aria-hidden="true">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="nav-stats-combo__menu" role="menu">
          <button className="nav-stats-combo__item" role="menuitem" onClick={() => select('aircoin-history')}>
            <span className="nav-stats-combo__item-icon" aria-hidden="true">⬡</span>
            <span>{coins.toLocaleString()} Aircoins</span>
          </button>
          <button className="nav-stats-combo__item" role="menuitem" onClick={() => { setOpen(false); navigate('rankings') }}>
            <span className="nav-stats-combo__item-icon nav-stats-combo__item-icon--level" aria-hidden="true">◈</span>
            <span>Level {level}</span>
          </button>
          {abbr && (
            <button className="nav-stats-combo__item" role="menuitem" onClick={() => { setOpen(false); navigate('rankings', { scrollTo: 'ranks' }) }}>
              <span className="nav-stats-combo__item-icon" aria-hidden="true">◈</span>
              <span>{abbr} · Rank</span>
            </button>
          )}
        </div>
      )}
    </div>
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
          <img src="/images/skywatch-logo-dark.svg" className="brand-logo-svg" alt="SkyWatch" />
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
              <StatsCombo coins={user.totalAircoins ?? 0} cycleAircoins={user.cycleAircoins ?? 0} rank={user.rank} navigate={navigate} />
              <AircoinsDisplay coins={user.totalAircoins ?? 0} navigate={navigate} />
              <LevelDisplay cycleAircoins={user.cycleAircoins ?? 0} navigate={navigate} />
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
