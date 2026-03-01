import { useState } from 'react'
import './App.css'

const NAV_LINKS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'intel-feed', label: 'Intel Feed' },
  { id: 'profile', label: 'Profile' },
]

const FOOTER_LINKS = [
  { id: 'contact', label: 'Contact' },
  { id: 'about', label: 'About' },
  { id: 'report', label: 'Report a Problem' },
]

function CrosshairIcon() {
  return (
    <svg
      className="brand-icon"
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="9" cy="9" r="2.5" fill="currentColor" />
      <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M9 1v3M9 14v3M1 9h3M14 9h3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

function Navbar({ page, setPage }) {
  const [open, setOpen] = useState(false)

  const navigate = (id) => {
    setPage(id)
    setOpen(false)
  }

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <button className="navbar-brand" onClick={() => navigate('dashboard')}>
          <CrosshairIcon />
          <span className="brand-name">Skywatch</span>
        </button>

        <button
          className={`menu-toggle ${open ? 'open' : ''}`}
          onClick={() => setOpen(!open)}
          aria-label="Toggle navigation"
          aria-expanded={open}
        >
          <span />
          <span />
          <span />
        </button>

        <ul className={`nav-links ${open ? 'open' : ''}`} role="list">
          {NAV_LINKS.map(({ id, label }) => (
            <li key={id}>
              <button
                className={`nav-link ${page === id ? 'active' : ''}`}
                onClick={() => navigate(id)}
                aria-current={page === id ? 'page' : undefined}
              >
                {label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  )
}

function Dashboard() {
  return (
    <main className="page dashboard-page">
      <div className="mission-control">
        <span className="mc-eyebrow">Mission Control</span>
        <h1 className="mc-title">Welcome to Skywatch</h1>
        <p className="mc-subtitle">
          Stay informed on the latest RAF intelligence. Test your knowledge
          retention and climb the ranks of the Intelligence Corps.
        </p>
      </div>
    </main>
  )
}

function IntelFeed() {
  return (
    <main className="page intel-page">
      <div className="page-header">
        <h1>Intelligence Briefs</h1>
        <p>RAF news, aircraft, base, rank, and training briefs.</p>
      </div>
    </main>
  )
}

function Profile() {
  return (
    <main className="page profile-page">
      <div className="page-header">
        <h1>Agent Profile</h1>
      </div>
    </main>
  )
}

function Contact() {
  return (
    <main className="page">
      <div className="page-header">
        <h1>Contact</h1>
      </div>
    </main>
  )
}

function About() {
  return (
    <main className="page">
      <div className="page-header">
        <h1>About</h1>
      </div>
    </main>
  )
}

function ReportProblem() {
  return (
    <main className="page">
      <div className="page-header">
        <h1>Report a Problem</h1>
      </div>
    </main>
  )
}

function Footer({ setPage }) {
  return (
    <footer className="footer">
      <div className="footer-inner">
        {FOOTER_LINKS.map(({ id, label }, i) => (
          <>
            {i > 0 && <span key={`sep-${id}`} className="footer-sep" aria-hidden="true">·</span>}
            <button key={id} className="footer-link" onClick={() => setPage(id)}>
              {label}
            </button>
          </>
        ))}
      </div>
    </footer>
  )
}

export default function App() {
  const [page, setPage] = useState('dashboard')

  const renderPage = () => {
    if (page === 'intel-feed') return <IntelFeed />
    if (page === 'profile') return <Profile />
    if (page === 'contact') return <Contact />
    if (page === 'about') return <About />
    if (page === 'report') return <ReportProblem />
    return <Dashboard />
  }

  return (
    <div className="app">
      <Navbar page={page} setPage={setPage} />
      {renderPage()}
      <Footer setPage={setPage} />
    </div>
  )
}
