import { useState } from 'react'

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

export default function Navbar({ page, navigate, isAdmin }) {
  const [open, setOpen] = useState(false)

  const handleNav = (id) => {
    navigate(id)
    setOpen(false)
  }

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <button className="navbar-brand" onClick={() => handleNav('dashboard')}>
          <CrosshairIcon />
          <span className="brand-name">Skywatch</span>
        </button>

        <button
          className={`menu-toggle ${open ? 'open' : ''}`}
          onClick={() => setOpen(!open)}
          aria-label="Toggle navigation"
          aria-expanded={open}
        >
          <span /><span /><span />
        </button>

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
          {isAdmin && (
            <li>
              <button
                className={`nav-link nav-link--admin ${page === 'admin' ? 'active' : ''}`}
                onClick={() => handleNav('admin')}
                aria-current={page === 'admin' ? 'page' : undefined}
              >
                Admin
              </button>
            </li>
          )}
        </ul>
      </div>
    </nav>
  )
}
