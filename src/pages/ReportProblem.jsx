import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import SEO from '../components/SEO'
import { useSlimMode } from '../hooks/useSlimMode'
import { usePhoneTight } from '../hooks/usePhoneTight'

// ── Fitting the phone viewport ───────────────────────────────────────────────
// This page is reached from a link in the last row of the CBAT grid, which is
// itself tuned to fit one screen — so arriving at a form that scrolls undoes
// the point of it. Laid out as measured, the desktop page is about 760px of
// content against roughly 370px of usable height on a small handset, so it does
// not tighten into place; it needs a different shape at phone width.
//
// The shape is: everything except the textarea is fixed height, the page is
// pinned to the viewport, and the textarea takes whatever is left. That fits by
// construction on any screen instead of by a set of numbers that happen to add
// up on the one phone it was checked against, and it means a big phone gets a
// bigger box to type in rather than a screenful of dead space under the form.
//
// What phone width drops, and why each is safe to drop:
//   - the step numbers 1 and 2, which contradict the "or" between the cards
//   - both cards' explanatory blurbs, replaced by one short line on the chat
//     card; the written report's is carried by its own field label and the
//     textarea's placeholder
//   - the closing "reviewed by the SkyWatch team" note, which repeats the
//     card's own promise
// Nothing that is an option, a control or a piece of state goes away: both ways
// to reach us are still cards, still equally weighted, still both one tap.
//
// The floor is the escape hatch. Under about 23rem of usable height the textarea
// would be squeezed past usefulness to keep the rest whole, so the page stops
// shrinking and scrolls instead — the same trade `.cbat-flag-playing` makes.
const PHONE_FIT =
  'max-sm:flex max-sm:flex-col ' +
  'max-sm:h-[calc(100dvh-10rem-env(safe-area-inset-bottom))] max-sm:min-h-[23rem]'

export default function ReportProblem() {
  const { user, API, apiFetch } = useAuth()
  const navigate = useNavigate()
  const slim = useSlimMode()
  usePhoneTight()
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
      // Straight into the thread that was just opened, rather than the chat
      // list — the user asked for help, not for a directory.
      const d = await res.json().catch(() => null)
      const id = d?.data?.conversation?._id
      navigate(id ? `/chat/${id}` : '/chat')
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
    <div data-testid="report-page" className={`max-w-md mx-auto ${PHONE_FIT}`}>
      <SEO title="Report a Problem" description="Report an issue or bug on SkyWatch." />

      <div className="shrink-0 mb-3 sm:mb-6">
        <button onClick={() => navigate(-1)} className="text-xs sm:text-sm text-slate-500 hover:text-slate-700 transition-colors mb-1 sm:mb-3 flex items-center gap-1">
          ← Back
        </button>
        <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900">Report a Problem</h1>
        <p className="text-[11px] sm:text-sm text-slate-500 mt-0.5 sm:mt-1">
          {slim
            ? 'Describe what went wrong and we\'ll look into it.'
            : 'Chat live with the team, or send a written report.'}
        </p>
      </div>

      {/* Live-chat option — hidden in slim (native) mode, where /chat is not
          reachable. Only the one-way written report is offered there. */}
      {!slim && (<>
        <div className="shrink-0 bg-surface rounded-2xl border border-slate-200 p-3 sm:p-5 card-shadow">
          <div className="flex items-center gap-2.5 mb-1.5 sm:mb-2">
            <span className="hidden sm:flex items-center justify-center w-6 h-6 rounded-full bg-brand-600 text-white text-xs font-extrabold shrink-0">1</span>
            <p className="text-[11px] sm:text-xs font-bold text-slate-600 uppercase tracking-wider">Talk to a real person</p>
          </div>
          {/* One line on a phone, the full pitch from `sm` up. Both say the same
              thing; the short one drops the framing, not the promise. */}
          <p className="sm:hidden text-[10px] leading-[1.3] text-slate-500 mb-2">Fast reply, usually within a few hours.</p>
          <p className="hidden sm:block text-sm text-slate-500 mb-3">Best for back-and-forth. Get a fast reply from the SkyWatch team — usually within a few hours.</p>
          <button
            type="button"
            onClick={startChat}
            disabled={chatBusy}
            className="w-full py-2 sm:py-3 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-bold rounded-xl sm:rounded-2xl text-xs sm:text-sm transition-colors"
          >
            {chatBusy ? 'Opening…' : 'Start a chat'}
          </button>
        </div>

        {/* Either/or divider — these two cards are alternatives, not steps */}
        <div className="shrink-0 flex items-center gap-3 my-2 sm:my-4">
          <div className="flex-1 h-px bg-slate-200" />
          <span className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-widest">or</span>
          <div className="flex-1 h-px bg-slate-200" />
        </div>
      </>)}

      {/* The card that stretches. On a phone every box above is fixed height, so
          this one takes the remainder and passes it down the chain to the
          textarea — which is why each level below carries flex-1 and min-h-0. */}
      <div className="max-sm:flex-1 max-sm:min-h-0 max-sm:flex max-sm:flex-col bg-surface rounded-2xl border border-slate-200 p-3 sm:p-5 card-shadow">
        <div className="shrink-0 flex items-center gap-2.5 mb-1.5 sm:mb-2">
          {!slim && <span className="hidden sm:flex items-center justify-center w-6 h-6 rounded-full bg-brand-600 text-white text-xs font-extrabold shrink-0">2</span>}
          <p className="text-[11px] sm:text-xs font-bold text-slate-600 uppercase tracking-wider">Send a written report</p>
        </div>
        {/* Phone drops this: the field label below says "Describe the problem"
            and the placeholder asks what happened, so the line is a third telling. */}
        <p className="hidden sm:block text-sm text-slate-500 mb-4">No reply needed — describe what went wrong and we'll look into it.</p>
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-2 sm:gap-4 max-sm:flex-1 max-sm:min-h-0">
          {briefId && (
            <div className="shrink-0 flex items-start justify-between gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200">
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Reporting on brief</p>
                <p className="text-xs sm:text-sm text-amber-800 truncate">{brief?.title ?? briefId}</p>
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

          <div className="max-sm:flex-1 max-sm:min-h-0 max-sm:flex max-sm:flex-col">
            <label className="shrink-0 block text-[10px] sm:text-xs font-bold text-slate-600 uppercase tracking-wider mb-1 sm:mb-2" htmlFor="description">
              Describe the problem
            </label>
            {/* `rows` still sets the desktop height, where the page is a normal
                block flow. On a phone flex-1 overrides it and the box grows or
                shrinks with the screen, down to a four-line floor. */}
            <textarea
              id="description"
              rows={5}
              className="w-full max-sm:flex-1 max-sm:min-h-[4.5rem] px-4 py-2.5 sm:py-3 rounded-xl border border-slate-200 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none text-sm resize-none transition-all"
              placeholder="What happened? What were you doing when the problem occurred?"
              value={description}
              onChange={e => { setDescription(e.target.value); setError('') }}
            />
            <p className="shrink-0 text-[10px] sm:text-xs text-slate-400 mt-0.5 sm:mt-1 text-right">{description.length} chars</p>
          </div>

          {error && (
            <p className="shrink-0 text-xs sm:text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-xl">{error}</p>
          )}

          <button
            type="submit"
            disabled={busy || !description.trim()}
            className="shrink-0 w-full py-2.5 sm:py-3.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-bold rounded-xl sm:rounded-2xl text-xs sm:text-sm transition-colors"
          >
            {busy ? 'Submitting…' : 'Submit Report'}
          </button>
        </form>
      </div>

      {/* The card above already promises the report is looked into, so on a
          phone this is a third restatement costing two lines of typing room. */}
      <p className="hidden sm:block text-xs text-slate-400 text-center mt-4">
        Reports are reviewed by the SkyWatch team. We aim to respond within 48 hours.
      </p>
    </div>
  )
}
