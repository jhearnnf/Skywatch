import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'
import { consumePendingBrief } from '../../utils/pendingBrief'
import { ONBOARDING_KEY } from '../../components/onboarding/WelcomeAgentFlow'

const VIEW = { CHOICE: 'choice', SIGNIN: 'signin', REGISTER: 'register', VERIFY: 'verify' }

function CrosshairLogo() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <circle cx="20" cy="20" r="17" stroke="#5baaff" strokeWidth="2.2"/>
      <line x1="20" y1="1"  x2="20" y2="12" stroke="#5baaff" strokeWidth="2.2" strokeLinecap="round"/>
      <line x1="20" y1="28" x2="20" y2="39" stroke="#5baaff" strokeWidth="2.2" strokeLinecap="round"/>
      <line x1="1"  y1="20" x2="12" y2="20" stroke="#5baaff" strokeWidth="2.2" strokeLinecap="round"/>
      <line x1="28" y1="20" x2="39" y2="20" stroke="#5baaff" strokeWidth="2.2" strokeLinecap="round"/>
      <circle cx="20" cy="20" r="7" stroke="#ffffff" strokeWidth="1.8"/>
      <circle cx="20" cy="20" r="2.5" fill="#ffffff"/>
    </svg>
  )
}

export default function LoginPage() {
  const { setUser, API, awardAircoins } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const params      = new URLSearchParams(location.search)
  const initTab     = params.get('tab')
  const initEmail   = params.get('email') ?? ''

  const [view,           setView]          = useState(
    initTab === 'register' ? VIEW.REGISTER :
    initTab === 'signin'   ? VIEW.SIGNIN   :
    VIEW.CHOICE
  )
  const [email,          setEmail]         = useState(initEmail)
  const [pass,           setPass]          = useState('')
  const [error,          setError]         = useState('')
  const [busy,           setBusy]          = useState(false)
  const [pendingEmail,   setPendingEmail]  = useState('')
  const [code,           setCode]          = useState('')
  const [resendCooldown, setResendCooldown] = useState(0)
  const googleBtnRef  = useRef(null)

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

  // New users always start on Standard difficulty — set it silently, no screen shown
  const finishNewUser = async (user) => {
    setUser(user)
    try {
      await fetch(`${API}/api/users/me/difficulty`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ difficulty: 'easy' }),
      })
    } catch { /* non-fatal — default is already easy on the backend */ }
    // If the user never went through the landing-page CRO flow, flag Home to show it
    if (!localStorage.getItem(ONBOARDING_KEY)) {
      sessionStorage.setItem('sw_pending_onboarding', '1')
    }
    const briefId = await consumePendingBrief({ API, setUser, navigate })
    navigate(briefId ? `/brief/${briefId}` : '/home')
  }

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
      if (data.data.isNew) { await finishNewUser(data.data.user); return }
      setUser(data.data.user)
      const briefId = await consumePendingBrief({ API, setUser, navigate })
      navigate(briefId ? `/brief/${briefId}` : '/home')
    } catch {
      setError('Google sign-in failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  // Cooldown ticker for resend button
  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setTimeout(() => setResendCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [resendCooldown])

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
      // Register now returns { status: 'pending', email } — show verify screen
      if (data.status === 'pending') {
        setPendingEmail(data.email)
        setCode('')
        setResendCooldown(60)
        setView(VIEW.VERIFY)
        return
      }
      if (data.data.isNew) { await finishNewUser(data.data.user); return }
      setUser(data.data.user)
      const briefId = await consumePendingBrief({ API, setUser, navigate })
      navigate(briefId ? `/brief/${briefId}` : '/home')
    } catch {
      setError('Connection failed. Is the server running?')
    } finally {
      setBusy(false)
    }
  }

  const handleVerify = async (e) => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const res  = await fetch(`${API}/api/auth/verify-email`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingEmail, code: code.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.message); return }
      await finishNewUser(data.data.user)
    } catch {
      setError('Connection failed. Is the server running?')
    } finally {
      setBusy(false)
    }
  }

  const handleResend = async () => {
    if (resendCooldown > 0) return
    setBusy(true); setError('')
    try {
      const res  = await fetch(`${API}/api/auth/resend-confirmation`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingEmail }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.message); return }
      setResendCooldown(60)
    } catch {
      setError('Failed to resend. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const reset = (nextView) => { setError(''); setEmail(''); setPass(''); setView(nextView) }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#06101e' }}>
      <div className="w-full max-w-sm">

        {/* Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-brand-100 border border-brand-300 shadow-sm mb-3" style={{ boxShadow: '0 0 20px rgba(91,170,255,0.15)' }}>
            <CrosshairLogo />
          </div>
          <h1 className="text-2xl font-extrabold text-brand-600 tracking-widest">SKYWATCH</h1>
          <p className="text-sm text-slate-500 mt-1 intel-mono">RAF intelligence training platform</p>
        </div>

        <AnimatePresence mode="wait">

          {/* Choice view */}
          {view === VIEW.CHOICE && (
            <motion.div
              key="choice"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="bg-surface rounded-3xl border border-slate-200 p-6 card-shadow space-y-3"
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
              className="bg-surface rounded-3xl border border-slate-200 p-6 card-shadow"
            >
              <h2 className="text-xl font-extrabold text-slate-900 mb-5">
                {view === VIEW.SIGNIN ? 'Welcome back' : 'Join SkyWatch'}
              </h2>

              <form onSubmit={handleSubmit} noValidate className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5" htmlFor="email">Email</label>
                  <input
                    id="email" type="email"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-surface-raised text-slate-800 placeholder:text-slate-500 focus:border-brand-400 focus:ring-2 focus:ring-brand-200 outline-none text-sm transition-all"
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
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-surface-raised text-slate-800 placeholder:text-slate-500 focus:border-brand-400 focus:ring-2 focus:ring-brand-200 outline-none text-sm transition-all"
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

          {/* Email verification */}
          {view === VIEW.VERIFY && (
            <motion.div
              key="verify"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="bg-surface rounded-3xl border border-slate-200 p-6 card-shadow"
            >
              <h2 className="text-xl font-extrabold text-slate-900 mb-1">Check your email</h2>
              <p className="text-sm text-slate-500 mb-5">
                We sent a 6-digit code to <strong>{pendingEmail}</strong>
              </p>

              <form onSubmit={handleVerify} noValidate className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5" htmlFor="code">Confirmation Code</label>
                  <input
                    id="code"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-surface-raised text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-200 outline-none text-xl tracking-[0.4em] text-center font-bold transition-all"
                    placeholder="000000"
                    value={code}
                    onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    autoComplete="one-time-code"
                    autoFocus
                    required
                  />
                </div>

                {error && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-xl">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={busy || code.length < 6}
                  className="w-full py-3.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-bold rounded-2xl transition-colors text-sm"
                >
                  {busy ? 'Verifying…' : 'Confirm Email'}
                </button>
              </form>

              <p className="text-sm text-center text-slate-500 mt-4">
                Didn&apos;t receive it?{' '}
                <button
                  onClick={handleResend}
                  disabled={resendCooldown > 0 || busy}
                  className="text-brand-600 font-semibold hover:text-brand-700 disabled:opacity-50 transition-colors"
                >
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
                </button>
              </p>

              <button
                className="mt-3 w-full text-sm text-slate-400 hover:text-slate-600 transition-colors"
                onClick={() => { setError(''); setCode(''); setView(VIEW.REGISTER) }}
              >
                ← Use a different email
              </button>
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
