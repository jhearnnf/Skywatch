import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import SEO from '../components/SEO'

export default function ReportProblem() {
  const { user, API, apiFetch } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const briefId = searchParams.get('briefId') || null

  const [description, setDescription] = useState('')
  const [submitted,   setSubmitted]   = useState(false)
  const [error,       setError]       = useState('')
  const [busy,        setBusy]        = useState(false)
  const [brief,       setBrief]       = useState(null)
  const [chatBusy,    setChatBusy]    = useState(false)

  const startChat = async () => {
    if (!user || chatBusy) return
    setChatBusy(true)
    try {
      const res = await apiFetch(`${API}/api/chat/conversations`, {
        method: 'POST', credentials: 'include',
      })
      if (!res.ok) throw new Error()
      navigate('/chat')
    } catch {
      setChatBusy(false)
    }
  }

  useEffect(() => {
    if (!briefId) { setBrief(null); return }
    let cancelled = false
    apiFetch(`${API}/api/briefs/${briefId}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d?.data?.brief) setBrief(d.data.brief) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [briefId, API, apiFetch])

  const clearBrief = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('briefId')
    setSearchParams(next, { replace: true })
    setBrief(null)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!description.trim()) { setError('Please describe the problem.'); return }
    setBusy(true); setError('')
    try {
      const res = await apiFetch(`${API}/api/users/report-problem`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description,
          pageReported: briefId ? `/brief/${briefId}` : (document.referrer || 'unknown'),
          ...(briefId ? { briefId } : {}),
        }),
      })
      if (!res.ok) throw new Error()
      setSubmitted(true)
    } catch {
      setError('Failed to submit. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!user) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <div className="text-4xl mb-4">🔒</div>
        <h1 className="text-2xl font-extrabold text-slate-900 mb-2">Sign in required</h1>
        <p className="text-slate-500 mb-6">You must be signed in to submit a problem report.</p>
        <Link to="/login" className="inline-flex px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors">
          Sign In
        </Link>
      </div>
    )
  }

  if (submitted) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-md mx-auto text-center py-12"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', damping: 14, delay: 0.1 }}
          className="text-6xl mb-4"
        >
          ✅
        </motion.div>
        <h1 className="text-2xl font-extrabold text-slate-900 mb-2">Report submitted</h1>
        <p className="text-slate-500 mb-6">Thank you — our team will review your report shortly.</p>
        <button
          onClick={() => navigate(-1)}
          className="px-6 py-2.5 border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-50 transition-colors text-sm"
        >
          ← Go back
        </button>
      </motion.div>
    )
  }

  return (
    <div className="max-w-md mx-auto">
      <SEO title="Report a Problem" description="Report an issue or bug on SkyWatch." />

      <div className="mb-6">
        <button onClick={() => navigate(-1)} className="text-sm text-slate-500 hover:text-slate-700 transition-colors mb-3 flex items-center gap-1">
          ← Back
        </button>
        <h1 className="text-2xl font-extrabold text-slate-900">Report a Problem</h1>
        <p className="text-sm text-slate-500 mt-1">Something not working? Let us know and we'll fix it.</p>
      </div>

      <div className="bg-surface rounded-2xl border border-slate-200 p-5 card-shadow mb-4">
        <p className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Talk to a real person</p>
        <p className="text-sm text-slate-500 mb-3">Get a fast reply from the Skywatch team — usually within a few hours.</p>
        <button
          type="button"
          onClick={startChat}
          disabled={chatBusy}
          className="w-full py-3 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-bold rounded-2xl text-sm transition-colors"
        >
          {chatBusy ? 'Opening…' : 'Start a chat'}
        </button>
      </div>

      <div className="bg-surface rounded-2xl border border-slate-200 p-5 card-shadow">
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {briefId && (
            <div className="flex items-start justify-between gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200">
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Reporting on brief</p>
                <p className="text-sm text-amber-800 truncate">{brief?.title ?? briefId}</p>
              </div>
              <button
                type="button"
                onClick={clearBrief}
                aria-label="Remove brief association"
                className="text-amber-500 hover:text-amber-700 text-lg leading-none shrink-0"
              >
                ×
              </button>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2" htmlFor="description">
              Describe the problem
            </label>
            <textarea
              id="description"
              rows={5}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none text-sm resize-none transition-all"
              placeholder="What happened? What were you doing when the problem occurred?"
              value={description}
              onChange={e => { setDescription(e.target.value); setError('') }}
            />
            <p className="text-xs text-slate-400 mt-1 text-right">{description.length} chars</p>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-xl">{error}</p>
          )}

          <button
            type="submit"
            disabled={busy || !description.trim()}
            className="w-full py-3.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-bold rounded-2xl text-sm transition-colors"
          >
            {busy ? 'Submitting…' : 'Submit Report'}
          </button>
        </form>
      </div>

      <p className="text-xs text-slate-400 text-center mt-4">
        Reports are reviewed by the SkyWatch team. We aim to respond within 48 hours.
      </p>
    </div>
  )
}
