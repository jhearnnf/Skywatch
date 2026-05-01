import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { useAppSettings } from '../context/AppSettingsContext'
import { CATEGORY_ICONS, CATEGORY_DESCRIPTIONS } from '../data/mockData'
import { consumePendingBrief } from '../utils/pendingBrief'
import { PENDING_BRIEF_KEY } from '../utils/storageKeys'

const TIER_CONFIG = {
  silver: {
    label:    'Silver',
    badge:    '🥈 Silver Required',
    badgeCls: 'bg-brand-100 border-brand-300 text-brand-700',
    perksCls: 'bg-brand-100 border-brand-300',
    labelCls: 'text-brand-700',
    btnCls:   'bg-brand-600 hover:bg-brand-500 text-slate-50',
    perks: [
      'Access to all Silver subject areas',
      'Advanced recall difficulty',
      'Large intel brief library',
    ],
  },
  gold: {
    label:    'Gold',
    badge:    '🥇 Gold Required',
    badgeCls: 'bg-amber-100 border-amber-200 text-amber-700',
    perksCls: 'bg-amber-100 border-amber-200',
    labelCls: 'text-amber-700',
    btnCls:   'bg-amber-600 hover:bg-amber-700 text-slate-50',
    perks: [
      'Access to ALL subject areas',
      'Every intel brief and recall',
      'Advanced recall difficulty',
    ],
  },
}

export default function LockedCategoryModal({ category, tier = 'silver', user, pendingBriefId = null, onClose }) {
  const navigate           = useNavigate()
  const { API, apiFetch, setUser }   = useAuth()
  const { settings }       = useAppSettings()
  const cfg                = TIER_CONFIG[tier] ?? TIER_CONFIG.silver
  const icon               = CATEGORY_ICONS[category] ?? '📄'
  const description        = CATEGORY_DESCRIPTIONS[category] ?? ''
  const isGuest            = !user

  const [email, setEmail]  = useState('')
  const googleBtnRef       = useRef(null)

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  // Google GIS button — guests only
  useEffect(() => {
    if (!isGuest) return
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
    if (!clientId || !window.google || !googleBtnRef.current) return
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: async (response) => {
        try {
          const res = await apiFetch(`${API}/api/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ credential: response.credential }),
          })
          const data = await res.json()
          if (data?.data?.user) {
            setUser(data.data.user)
            onClose()
            const briefId = await consumePendingBrief({ API, setUser, navigate })
            if (briefId) navigate(`/brief/${briefId}`)
          }
        } catch { /* ignore */ }
      },
    })
    window.google.accounts.id.renderButton(googleBtnRef.current, {
      theme: 'outline', size: 'large', text: 'signup_with', width: 280, logo_alignment: 'center',
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleEmailContinue() {
    if (pendingBriefId) localStorage.setItem(PENDING_BRIEF_KEY, pendingBriefId)
    onClose()
    navigate(`/login?tab=register${pendingBriefId ? `&pendingBrief=${pendingBriefId}` : ''}${email ? `&email=${encodeURIComponent(email)}` : ''}`)
  }

  // Show up to 3 free categories as a sample
  const freeCategories = settings?.freeCategories ?? []
  const freeSample     = freeCategories.length > 0
    ? freeCategories.slice(0, 3).join(', ') + (freeCategories.length > 3 ? ' & more' : '')
    : null

  return (
    <AnimatePresence>
      {/* Backdrop */}
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/70 backdrop-blur-sm"
        onClick={onClose}
      >
        {/* Sheet */}
        <motion.div
          key="sheet"
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '100%', opacity: 0 }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full sm:max-w-sm bg-surface border border-slate-200 rounded-t-3xl sm:rounded-3xl p-6 pb-8 sm:pb-6 card-shadow"
        >
          {/* Drag handle (mobile) */}
          <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-5 sm:hidden" />

          {/* Category icon + name */}
          <div className="flex items-center gap-3 mb-4">
            <span className="text-4xl">{icon}</span>
            <div>
              <p className="font-extrabold text-slate-900 text-lg leading-tight">{category}</p>
              {isGuest ? (
                <span className="inline-block text-xs font-bold px-2 py-0.5 rounded-full border mt-1 bg-emerald-50 border-emerald-200 text-emerald-700">
                  🆓 Free account required
                </span>
              ) : (
                <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded-full border mt-1 ${cfg.badgeCls}`}>
                  {cfg.badge}
                </span>
              )}
            </div>
          </div>

          {isGuest ? (
            /* ── Sign-up variant ── */
            <>
              {tier === 'silver' ? (
                <p className="text-sm text-slate-600 mb-4 leading-relaxed">
                  Sign up for a free account — your included{' '}
                  <span className="font-semibold text-slate-800">5-day Silver trial</span>{' '}
                  gives you immediate access to {description || `${category} briefs and quizzes`}.
                </p>
              ) : (
                <p className="text-sm text-slate-600 mb-4 leading-relaxed">
                  <span className="font-semibold text-slate-800">{category}</span> requires a Gold subscription.
                  Create a free account to explore hundreds of free and Silver-tier briefs.
                </p>
              )}

              {/* Free perks */}
              <div className="rounded-2xl border bg-emerald-50 border-emerald-200 p-3 mb-4">
                <p className="intel-mono text-slate-500 mb-2">Free account includes</p>
                <ul className="space-y-1.5">
                  {freeSample && (
                    <li className="flex items-center gap-2 text-sm text-slate-800">
                      <span className="text-emerald-600 font-bold shrink-0">✓</span>
                      {freeSample} subject areas — free forever
                    </li>
                  )}
                  <li className="flex items-center gap-2 text-sm text-slate-800">
                    <span className="text-emerald-600 font-bold shrink-0">✓</span>
                    5-day Silver trial included on sign-up
                  </li>
                  <li className="flex items-center gap-2 text-sm text-slate-800">
                    <span className="text-emerald-600 font-bold shrink-0">✓</span>
                    Easy difficulty quizzes &amp; Airstar rewards
                  </li>
                </ul>
              </div>

              {/* Streak FOMO */}
              <p className="text-xs text-slate-500 italic text-center mb-4">
                "Agents who train daily advance much faster. Start your streak today."
              </p>

              {/* Google button */}
              <div ref={googleBtnRef} className="flex justify-center mb-3" />
              {!import.meta.env.VITE_GOOGLE_CLIENT_ID && (
                <p className="text-xs text-slate-400 text-center mb-3">Google sign-in unavailable</p>
              )}

              {/* Divider */}
              <div className="flex items-center gap-2 mb-3">
                <div className="flex-1 h-px bg-slate-100" />
                <span className="text-xs text-slate-400">or continue with email</span>
                <div className="flex-1 h-px bg-slate-100" />
              </div>

              {/* Email + Continue */}
              <div className="flex gap-2 mb-3">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleEmailContinue() }}
                  placeholder="your@email.com"
                  className="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none text-sm"
                />
                <button
                  onClick={handleEmailContinue}
                  className="px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors"
                >
                  Continue →
                </button>
              </div>

              <p className="text-center text-xs text-slate-400 mb-1">
                Already have an account?{' '}
                <button
                  onClick={() => { onClose(); navigate('/login') }}
                  className="text-brand-600 font-semibold hover:underline"
                >
                  Sign in
                </button>
              </p>

              <button
                onClick={onClose}
                className="w-full py-2.5 rounded-2xl text-sm font-semibold text-slate-500 hover:text-slate-700 transition-colors"
              >
                Maybe Later
              </button>
            </>
          ) : (
            /* ── Upgrade variant (unchanged) ── */
            <>
              <p className="text-sm text-slate-600 mb-4 leading-relaxed">
                <span className="font-semibold text-slate-800">{category}</span> briefs and quizzes
                require a{' '}
                <span className={`font-bold ${cfg.labelCls}`}>{cfg.label}</span> subscription or higher.
              </p>

              <div className={`rounded-2xl border p-3 mb-5 ${cfg.perksCls}`}>
                <p className="intel-mono text-slate-500 mb-2">{cfg.label} includes</p>
                <ul className="space-y-1.5">
                  {cfg.perks.map((perk) => (
                    <li key={perk} className="flex items-center gap-2 text-sm text-slate-800">
                      <span className="text-emerald-600 font-bold shrink-0">✓</span>
                      {perk}
                    </li>
                  ))}
                </ul>
              </div>

              <button
                onClick={() => { onClose(); navigate('/subscribe') }}
                className={`w-full py-3 rounded-2xl font-bold text-sm transition-colors mb-2 ${cfg.btnCls}`}
              >
                View {cfg.label} Plans
              </button>

              <button
                onClick={onClose}
                className="w-full py-2.5 rounded-2xl text-sm font-semibold text-slate-500 hover:text-slate-700 transition-colors"
              >
                Maybe Later
              </button>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
