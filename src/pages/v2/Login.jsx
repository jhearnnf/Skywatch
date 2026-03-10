import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'

const VIEW = { CHOICE: 'choice', SIGNIN: 'signin', REGISTER: 'register', DIFFICULTY: 'difficulty' }

const DIFFICULTY_DEFAULTS = {
  title:         'Select Your Starting Level',
  subtitle:      'Choose your quiz difficulty. You can change this anytime from your profile.',
  easyLabel:     'Standard',
  easyTag:       'STANDARD',
  easyFlavor:    'Direct recall questions. Perfect for your first attempt.',
  mediumLabel:   'Advanced',
  mediumTag:     'ADVANCED',
  mediumFlavor:  'Contextual questions requiring deeper understanding.',
}

function CrosshairLogo() {
  return (
    <svg width="40" height="40" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <circle cx="14" cy="14" r="10" stroke="#1a76e4" strokeWidth="1.8"/>
      <circle cx="14" cy="14" r="3.5" stroke="#1a76e4" strokeWidth="1.8"/>
      <line x1="14" y1="1"  x2="14" y2="7"  stroke="#1a76e4" strokeWidth="1.8" strokeLinecap="round"/>
      <line x1="14" y1="21" x2="14" y2="27" stroke="#1a76e4" strokeWidth="1.8" strokeLinecap="round"/>
      <line x1="1"  y1="14" x2="7"  y2="14" stroke="#1a76e4" strokeWidth="1.8" strokeLinecap="round"/>
      <line x1="21" y1="14" x2="27" y2="14" stroke="#1a76e4" strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  )
}

export default function LoginPage() {
  const { setUser, API, awardAircoins } = useAuth()
  const navigate = useNavigate()

  const [view,      setView]     = useState(VIEW.CHOICE)
  const [email,     setEmail]    = useState('')
  const [pass,      setPass]     = useState('')
  const [error,     setError]    = useState('')
  const [busy,      setBusy]     = useState(false)
  const [diffText,  setDiffText] = useState(DIFFICULTY_DEFAULTS)
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
          mediumLabel:  s.combatReadinessMediumLabel  || DIFFICULTY_DEFAULTS.mediumLabel,
          mediumTag:    s.combatReadinessMediumTag    || DIFFICULTY_DEFAULTS.mediumTag,
          mediumFlavor: s.combatReadinessMediumFlavor || DIFFICULTY_DEFAULTS.mediumFlavor,
        })
      })
      .catch(() => {})
  }, [API])

  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
    if (!clientId || !window.google || view !== VIEW.CHOICE) return
    window.google.accounts.id.initialize({ client_id: clientId, callback: handleGoogleCredential })
    if (googleBtnRef.current) {
      window.google.accounts.id.renderButton(googleBtnRef.current, {
        theme: 'outline', size: 'large', text: 'continue_with', width: 300, logo_alignment: 'center',
      })
    }
  }, [view]) // eslint-disable-line react-hooks/exhaustive-deps

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
      navigate('/home')
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
      navigate('/home')
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
    } catch { /* non-fatal */ }
    finally { setBusy(false) }
    navigate('/home')
  }

  const reset = (nextView) => { setError(''); setEmail(''); setPass(''); setView(nextView) }

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 via-white to-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white border border-brand-100 shadow-sm mb-3">
            <CrosshairLogo />
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">SKYWATCH</h1>
          <p className="text-sm text-slate-500 mt-1">RAF intelligence training platform</p>
        </div>

        <AnimatePresence mode="wait">

          {/* Choice view */}
          {view === VIEW.CHOICE && (
            <motion.div
              key="choice"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="bg-white rounded-3xl border border-slate-200 p-6 card-shadow space-y-3"
            >
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider text-center mb-4">Sign in or create an account</p>

              <button
                onClick={() => reset(VIEW.REGISTER)}
                className="w-full py-3.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-2xl transition-colors text-sm"
              >
                Create Account
              </button>
              <button
                onClick={() => reset(VIEW.SIGNIN)}
                className="w-full py-3.5 border-2 border-slate-200 hover:border-brand-300 hover:bg-brand-50 text-slate-700 font-bold rounded-2xl transition-all text-sm"
              >
                Sign In with Email
              </button>

              <div className="flex items-center gap-3 my-2">
                <div className="flex-1 h-px bg-slate-100" />
                <span className="text-xs text-slate-400">or</span>
                <div className="flex-1 h-px bg-slate-100" />
              </div>

              <div ref={googleBtnRef} className="flex justify-center" />
              {!import.meta.env.VITE_GOOGLE_CLIENT_ID && (
                <p className="text-xs text-slate-400 text-center">Google sign-in requires VITE_GOOGLE_CLIENT_ID</p>
              )}
            </motion.div>
          )}

          {/* Sign in / Register */}
          {(view === VIEW.SIGNIN || view === VIEW.REGISTER) && (
            <motion.div
              key="form"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="bg-white rounded-3xl border border-slate-200 p-6 card-shadow"
            >
              <h2 className="text-xl font-extrabold text-slate-900 mb-5">
                {view === VIEW.SIGNIN ? 'Welcome back' : 'Join Skywatch'}
              </h2>

              <form onSubmit={handleSubmit} noValidate className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5" htmlFor="email">Email</label>
                  <input
                    id="email" type="email"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none text-sm transition-all"
                    placeholder="agent@example.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    autoComplete="email"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5" htmlFor="password">Password</label>
                  <input
                    id="password" type="password"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none text-sm transition-all"
                    placeholder={view === VIEW.REGISTER ? 'Min. 8 characters' : '••••••••'}
                    value={pass}
                    onChange={e => setPass(e.target.value)}
                    autoComplete={view === VIEW.SIGNIN ? 'current-password' : 'new-password'}
                    required
                  />
                </div>

                {error && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-xl">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full py-3.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-bold rounded-2xl transition-colors text-sm"
                >
                  {busy ? 'Please wait…' : view === VIEW.SIGNIN ? 'Sign In' : 'Create Account'}
                </button>
              </form>

              <p className="text-sm text-center text-slate-500 mt-4">
                {view === VIEW.SIGNIN
                  ? <>Don&apos;t have an account?{' '}<button className="text-brand-600 font-semibold hover:text-brand-700" onClick={() => reset(VIEW.REGISTER)}>Register</button></>
                  : <>Have an account?{' '}<button className="text-brand-600 font-semibold hover:text-brand-700" onClick={() => reset(VIEW.SIGNIN)}>Sign in</button></>
                }
              </p>

              <button className="mt-3 w-full text-sm text-slate-400 hover:text-slate-600 transition-colors" onClick={() => reset(VIEW.CHOICE)}>
                ← Back
              </button>
            </motion.div>
          )}

          {/* Difficulty chooser — shown after new account */}
          {view === VIEW.DIFFICULTY && (
            <motion.div
              key="difficulty"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="bg-white rounded-3xl border border-slate-200 p-6 card-shadow"
            >
              <div className="text-center mb-6">
                <span className="text-4xl">🎯</span>
                <h2 className="text-xl font-extrabold text-slate-900 mt-2">{diffText.title}</h2>
                <p className="text-sm text-slate-500 mt-1">{diffText.subtitle}</p>
              </div>

              <div className="space-y-3">
                {[
                  { value: 'easy',   emoji: '🌱', label: diffText.easyLabel,   tag: diffText.easyTag,   flavor: diffText.easyFlavor   },
                  { value: 'medium', emoji: '🔥', label: diffText.mediumLabel, tag: diffText.mediumTag, flavor: diffText.mediumFlavor },
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => handleDifficulty(opt.value)}
                    disabled={busy}
                    className="w-full text-left p-4 bg-white rounded-2xl border-2 border-slate-200 hover:border-brand-400 hover:bg-brand-50 transition-all card-shadow disabled:opacity-50"
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">{opt.emoji}</span>
                      <div>
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className="font-bold text-slate-800 text-sm">{opt.label}</p>
                          <span className="text-[10px] font-bold bg-brand-100 text-brand-700 px-1.5 py-0.5 rounded-full">{opt.tag}</span>
                        </div>
                        <p className="text-xs text-slate-500">{opt.flavor}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

        </AnimatePresence>

        {/* Back to home */}
        <div className="text-center mt-6">
          <Link to="/home" className="text-sm text-slate-400 hover:text-slate-600 transition-colors">
            ← Continue without signing in
          </Link>
        </div>

      </div>
    </div>
  )
}
