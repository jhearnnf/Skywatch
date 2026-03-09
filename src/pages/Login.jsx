import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'

const VIEW = { CHOICE: 'choice', SIGNIN: 'signin', REGISTER: 'register', DIFFICULTY: 'difficulty' }

const DIFFICULTY_DEFAULTS = {
  title:         'Select Combat Readiness',
  subtitle:      'Choose your quiz difficulty. You can change this anytime from your profile.',
  easyLabel:     'Recruit',
  easyTag:       'EASY',
  easyFlavor:    'Three answer choices. Training wheels on. No shame in it, Airman.',
  easyStars:     '★★★☆☆',
  mediumLabel:   'Operative',
  mediumTag:     'MEDIUM',
  mediumFlavor:  'Five choices. The real RAF quiz. Separate the rookies from the veterans.',
  mediumStars:   '★★★★☆',
}

function ShieldLarge() {
  return (
    <svg className="login-brand-icon" width="52" height="60" viewBox="0 0 52 60" fill="none" aria-hidden="true">
      <path d="M26 2L3 11v18c0 14.5 10 27.5 23 30.5C39 56.5 49 43.5 49 29V11L26 2z" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M26 9L10 16.5v12.5c0 10.5 7 20 16 24 9-4 16-13.5 16-24V16.5L26 9z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" opacity="0.3" />
      <circle cx="26" cy="30" r="8" stroke="currentColor" strokeWidth="1.5"/>
      <circle cx="26" cy="30" r="2.5" fill="currentColor"/>
      <path d="M26 20v4M26 36v4M16 30h4M32 30h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.6"/>
    </svg>
  )
}

export default function Login({ navigate }) {
  const { setUser, API, awardAircoins } = useAuth()
  const [view,       setView]      = useState(VIEW.CHOICE)
  const [email,      setEmail]     = useState('')
  const [pass,       setPass]      = useState('')
  const [error,      setError]     = useState('')
  const [busy,       setBusy]      = useState(false)
  const [diffText,   setDiffText]  = useState(DIFFICULTY_DEFAULTS)
  const googleBtnRef = useRef(null)

  useEffect(() => {
    fetch(`${API}/api/users/settings`)
      .then(r => r.json())
      .then(d => {
        if (!d?.data) return
        const s = d.data
        setDiffText({
          title:        s.combatReadinessTitle        || DIFFICULTY_DEFAULTS.title,
          subtitle:     s.combatReadinessSubtitle     || DIFFICULTY_DEFAULTS.subtitle,
          easyLabel:    s.combatReadinessEasyLabel    || DIFFICULTY_DEFAULTS.easyLabel,
          easyTag:      s.combatReadinessEasyTag      || DIFFICULTY_DEFAULTS.easyTag,
          easyFlavor:   s.combatReadinessEasyFlavor   || DIFFICULTY_DEFAULTS.easyFlavor,
          easyStars:    s.combatReadinessEasyStars    || DIFFICULTY_DEFAULTS.easyStars,
          mediumLabel:  s.combatReadinessMediumLabel  || DIFFICULTY_DEFAULTS.mediumLabel,
          mediumTag:    s.combatReadinessMediumTag    || DIFFICULTY_DEFAULTS.mediumTag,
          mediumFlavor: s.combatReadinessMediumFlavor || DIFFICULTY_DEFAULTS.mediumFlavor,
          mediumStars:  s.combatReadinessMediumStars  || DIFFICULTY_DEFAULTS.mediumStars,
        })
      })
      .catch(() => {})
  }, [API])

  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
    if (!clientId || !window.google || view !== VIEW.CHOICE) return

    window.google.accounts.id.initialize({
      client_id: clientId,
      callback:  handleGoogleCredential,
    })

    if (googleBtnRef.current) {
      window.google.accounts.id.renderButton(googleBtnRef.current, {
        theme: 'outline', size: 'large', text: 'continue_with', width: 300, logo_alignment: 'center',
      })
    }
  }, [view])

  const handleGoogleCredential = async ({ credential }) => {
    setBusy(true); setError('')
    try {
      const res  = await fetch(`${API}/api/auth/google`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.message); return }
      setUser(data.data.user)
      if (data.data.loginAircoinsEarned > 0) {
        awardAircoins(data.data.loginAircoinsEarned, data.data.loginAircoinLabel, { rankPromotion: data.data.rankPromotion ?? null })
      }
      if (data.data.isNew) { setView(VIEW.DIFFICULTY); return }
      navigate('dashboard')
    } catch {
      setError('Google sign-in failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setBusy(true); setError('')
    const endpoint = view === VIEW.SIGNIN ? 'login' : 'register'
    try {
      const res  = await fetch(`${API}/api/auth/${endpoint}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: pass }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.message); return }
      setUser(data.data.user)
      if (data.data.loginAircoinsEarned > 0) {
        awardAircoins(data.data.loginAircoinsEarned, data.data.loginAircoinLabel, { rankPromotion: data.data.rankPromotion ?? null })
      }
      if (data.data.isNew) { setView(VIEW.DIFFICULTY); return }
      navigate('dashboard')
    } catch {
      setError('Connection failed. Is the server running?')
    } finally {
      setBusy(false)
    }
  }

  const handleDifficulty = async (difficulty) => {
    setBusy(true)
    try {
      const res  = await fetch(`${API}/api/users/me/difficulty`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ difficulty }),
      })
      const data = await res.json()
      if (data?.data?.user) setUser(data.data.user)
    } catch { /* non-fatal — user can change later */ }
    finally { setBusy(false) }
    navigate('dashboard')
  }

  const reset = (nextView) => { setError(''); setEmail(''); setPass(''); setView(nextView) }

  return (
    <div className="login-page">
      <div className="login-card">

        {/* Brand */}
        <div className="login-brand">
          <ShieldLarge />
          <h1 className="login-app-name">SKYWATCH</h1>
        </div>

        {/* Choice view */}
        {view === VIEW.CHOICE && (
          <>
            <div className="login-header">
              <p className="login-eyebrow">🛡 Agent Login</p>
              <h2 className="login-title">Identify Yourself</h2>
            </div>
            <div className="login-options">
              <button className="login-opt-btn" onClick={() => reset(VIEW.REGISTER)}>Create Account</button>
              <button className="login-opt-btn login-opt-btn--primary" onClick={() => reset(VIEW.SIGNIN)}>Sign In with Email</button>
              <div className="login-divider"><span>or</span></div>
              <div ref={googleBtnRef} className="login-google-btn-wrap" />
              {!import.meta.env.VITE_GOOGLE_CLIENT_ID && (
                <p className="login-google-note">Google sign-in requires VITE_GOOGLE_CLIENT_ID in .env</p>
              )}
            </div>
          </>
        )}

        {/* Sign in / Register */}
        {(view === VIEW.SIGNIN || view === VIEW.REGISTER) && (
          <>
            <div className="login-header">
              <p className="login-eyebrow">🛡 Agent Login</p>
              <h2 className="login-title">{view === VIEW.SIGNIN ? 'Sign In' : 'Create Account'}</h2>
            </div>
            <form className="login-form" onSubmit={handleSubmit} noValidate>
              <label className="form-label" htmlFor="email">Email</label>
              <input id="email" type="email" className="form-input" placeholder="agent@example.com" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" required />
              <label className="form-label" htmlFor="password">Password</label>
              <input id="password" type="password" className="form-input" placeholder={view === VIEW.REGISTER ? 'Min. 8 characters' : '••••••••'} value={pass} onChange={e => setPass(e.target.value)} autoComplete={view === VIEW.SIGNIN ? 'current-password' : 'new-password'} required />
              {error && <p className="form-error">{error}</p>}
              <button type="submit" className="btn-primary login-submit" disabled={busy}>
                {busy ? 'Please wait…' : view === VIEW.SIGNIN ? 'Sign In' : 'Create Account'}
              </button>
            </form>
            <p className="login-switch">
              {view === VIEW.SIGNIN
                ? <>Don&apos;t have an account?{' '}<button className="login-switch-btn" onClick={() => reset(VIEW.REGISTER)}>Register</button></>
                : <>Already have an account?{' '}<button className="login-switch-btn" onClick={() => reset(VIEW.SIGNIN)}>Sign in</button></>
              }
            </p>
            <button className="back-link login-back" onClick={() => reset(VIEW.CHOICE)}>← Back</button>
          </>
        )}

        {/* Difficulty selection — shown after new account creation */}
        {view === VIEW.DIFFICULTY && (
          <>
            <div className="login-header">
              <p className="login-eyebrow">Mission Briefing</p>
              <h2 className="login-title">{diffText.title}</h2>
              <p className="login-subtitle">{diffText.subtitle}</p>
            </div>
            <div className="difficulty-options">
              {[
                { value: 'easy',   label: diffText.easyLabel,   tag: diffText.easyTag,   stars: diffText.easyStars,   flavor: diffText.easyFlavor   },
                { value: 'medium', label: diffText.mediumLabel, tag: diffText.mediumTag, stars: diffText.mediumStars, flavor: diffText.mediumFlavor },
              ].map(opt => (
                <button
                  key={opt.value}
                  className={`difficulty-option difficulty-option--${opt.value}`}
                  onClick={() => handleDifficulty(opt.value)}
                  disabled={busy}
                >
                  <span className="difficulty-option__tag">{opt.tag}</span>
                  <span className="difficulty-option__label">{opt.label}</span>
                  <span className="difficulty-option__stars">{opt.stars}</span>
                  <span className="difficulty-option__flavor">{opt.flavor}</span>
                </button>
              ))}
            </div>
          </>
        )}

      </div>

      <button className="login-back-link" onClick={() => navigate('dashboard')}>
        ← Return to Dashboard
      </button>
    </div>
  )
}
