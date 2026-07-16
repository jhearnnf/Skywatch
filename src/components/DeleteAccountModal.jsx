import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'

// Typing the word is the only gate between a stray tap and an irreversible
// wipe — there is no undo and no soft-delete behind this.
const CONFIRM_WORD = 'DELETE'

const WIPED = [
  'Your account and sign-in details',
  'Every CBAT score, game result and leaderboard entry',
  'Your airstars, rank and level progress',
  'Your reading history and tutorial progress',
  'Any support conversations and problem reports',
]

export default function DeleteAccountModal({ onClose }) {
  const { API, apiFetch, setUser } = useAuth()
  const [typed,   setTyped]   = useState('')
  const [busy,    setBusy]    = useState(false)
  const [error,   setError]   = useState('')

  const armed = typed.trim().toUpperCase() === CONFIRM_WORD

  async function handleDelete() {
    if (!armed || busy) return
    setBusy(true)
    setError('')
    try {
      const res  = await apiFetch(`${API}/api/users/me`, { method: 'DELETE' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body?.message || 'Could not delete your account. Please try again.')
        setBusy(false)
        return
      }
      // The account is gone server-side and the jwt cookie is already expired,
      // so drop straight to a signed-out landing rather than calling logout()
      // (which would POST /auth/logout as a user that no longer exists).
      setUser(null)
      window.location.replace('/')
    } catch {
      setError('Could not reach the server. Please check your connection and try again.')
      setBusy(false)
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="safe-area-inset flex items-end sm:items-center justify-center"
        style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(15,23,42,0.70)', backdropFilter: 'blur(4px)' }}
        onClick={busy ? undefined : onClose}
      >
        <motion.div
          key="sheet"
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '100%', opacity: 0 }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-account-title"
          className="w-full sm:max-w-sm bg-surface border border-slate-200 rounded-t-3xl sm:rounded-3xl p-6 pb-8 sm:pb-6 card-shadow"
        >
          <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-5 sm:hidden" />

          <div className="flex items-center gap-3 mb-4">
            <span className="text-4xl">⚠️</span>
            <div>
              <p id="delete-account-title" className="font-extrabold text-slate-900 text-lg leading-tight">
                Delete account
              </p>
              <span className="inline-block text-xs font-bold px-2 py-0.5 rounded-full border mt-1 bg-red-100 border-red-200 text-red-700">
                This cannot be undone
              </span>
            </div>
          </div>

          <p className="text-sm text-slate-600 mb-3">
            Deleting your account permanently removes:
          </p>
          <ul className="bg-red-100 border border-red-200 rounded-xl p-3 mb-4 space-y-1.5">
            {WIPED.map((item) => (
              <li key={item} className="text-xs text-slate-700 flex gap-2">
                <span className="text-red-700">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <label htmlFor="delete-confirm" className="block text-xs font-semibold text-slate-600 mb-1.5">
            Type <span className="font-extrabold text-slate-900">{CONFIRM_WORD}</span> to confirm
          </label>
          <input
            id="delete-confirm"
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            disabled={busy}
            autoComplete="off"
            autoCapitalize="characters"
            className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-sm font-bold tracking-widest focus:outline-none focus:border-brand-300 disabled:opacity-50"
          />

          {error && <p className="text-xs text-red-700 mt-2">{error}</p>}

          <div className="flex gap-2 mt-5">
            <button
              onClick={onClose}
              disabled={busy}
              className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-slate-50 border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={!armed || busy}
              className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: armed && !busy ? 'var(--color-danger)' : '#4a1018' }}
            >
              {busy ? 'Deleting…' : 'Delete forever'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
