import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import SEO from '../components/SEO'
import { useSlimMode } from '../hooks/useSlimMode'
import { usePhoneTight } from '../hooks/usePhoneTight'
import { getRouteTrail } from '../utils/routeTrail'
import { getClientInfo, peekClientInfo } from '../utils/appVersion'
import { collectReportEnvironment } from '../utils/reportEnvironment'

// ── What this page is ────────────────────────────────────────────────────────
// One form: describe the problem, and it opens a support ticket — a thread in
// Community where the team replies and you can answer. There used to be two
// cards here, "start a chat" or "send a written report", which were two doors
// into the same room; a report IS a ticket now, so the form is the one door.
// The form still earns its place over the chat composer because it captures
// what a chat cannot: the page you were on and what your device is.
//
// In slim mode (the native app, or the site with slim switched on) Community
// is not reachable, so the ticket cannot be opened on screen; the form still
// files it and the team replies by email.
//
// ── Fitting the phone viewport ───────────────────────────────────────────────
// This page is reached from a link in the last row of the CBAT grid, which is
// itself tuned to fit one screen — so arriving at a form that scrolls undoes
// the point of it. Everything except the textarea is fixed height, the page is
// pinned to the viewport, and the textarea takes whatever is left. That fits by
// construction on any screen, and a big phone gets a bigger box to type in
// rather than a screenful of dead space under the form.
//
// The floor is the escape hatch. Under about 23rem of usable height the textarea
// would be squeezed past usefulness to keep the rest whole, so the page stops
// shrinking and scrolls instead — the same trade `.cbat-flag-playing` makes.
const PHONE_FIT =
  'max-sm:flex max-sm:flex-col ' +
  'max-sm:h-[calc(100dvh-10rem-env(safe-area-inset-bottom))] max-sm:min-h-[23rem]'

// ── What counts as a report ──────────────────────────────────────────────────
// A real report came in reading, in full, "jameshearn1995@hotmail.co.uk". The
// box asks what happened and someone answered it with who they were, which is
// information we already have from the account they are signed in as, and which
// left nothing at all to act on.
//
// Both guards live on the client only. The point is to catch the person while
// they are still looking at the form and can fix it in one line; the server
// keeps accepting anything non-empty, because a stale cached bundle submitting
// a short report should still reach us rather than fail on a rule its copy of
// this file has never heard of.
const EMAIL_ONLY = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Short enough that a real terse report ("the sound never plays") clears it,
// long enough that a single word or a pasted address does not.
const MIN_DESCRIPTION = 15

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

  // Native reads its version over the Capacitor bridge, so it is asked for on
  // mount and read synchronously at submit time — the same order useHeartbeat
  // uses. Submitting must never wait on the bridge: a report that arrives
  // without a version is worth far more than one that hangs behind it.
  useEffect(() => { getClientInfo() }, [])

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
    const trimmed = description.trim()
    if (!trimmed) { setError('Please describe the problem.'); return }
    if (EMAIL_ONLY.test(trimmed)) {
      setError('That is just an email address. Tell us what went wrong instead. We can already see which account you are reporting from.')
      return
    }
    if (trimmed.length < MIN_DESCRIPTION) {
      setError('Please add a bit more detail. What happened, and what were you doing at the time?')
      return
    }
    setBusy(true); setError('')

    // Where they were, oldest first. The form's own page is dropped: it is the
    // one page we already know they were on, and it would otherwise be the last
    // entry of every report ever filed.
    const trail = getRouteTrail().filter(p => !/^\/report\/?$/.test(p))

    // OS, browser, screen, GPU and the rest — the questions a report cannot be
    // triaged without and the reporter has no reason to know to answer. Best
    // effort and time-capped inside the collector, so it never blocks the send.
    const environment = await collectReportEnvironment()

    try {
      const res = await apiFetch(`${API}/api/users/report-problem`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description,
          // The page they came from, not document.referrer. The referrer is
          // where the *browser* was before it loaded the site: it is empty on
          // every app launch and on every direct visit, which is why every
          // report from the Android app used to record "unknown".
          pageReported: briefId ? `/brief/${briefId}` : (trail[trail.length - 1] || 'unknown'),
          ...(trail.length ? { routeTrail: trail } : {}),
          // Optional and best-effort, exactly as on the heartbeat — null on a
          // native client whose bridge has not answered yet.
          ...(peekClientInfo() ? { client: peekClientInfo() } : {}),
          ...(environment ? { environment } : {}),
          ...(briefId ? { briefId } : {}),
        }),
      })
      if (!res.ok) throw new Error()
      // Straight into the ticket, where the reply will land. Slim mode has no
      // Community to land in, so it gets the confirmation instead.
      const d = await res.json().catch(() => null)
      const conversationId = d?.data?.conversationId
      if (!slim && conversationId) { navigate(`/chat/${conversationId}`, { replace: true }); return }
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
        <p className="text-slate-500 mb-6">Thank you. The SkyWatch team will look into it and reply by email.</p>
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
            ? 'Describe what went wrong and the team will reply by email.'
            : 'Describe what went wrong. It opens a support ticket where the team will reply.'}
        </p>
      </div>

      {/* The card that stretches. On a phone every box above is fixed height, so
          this one takes the remainder and passes it down the chain to the
          textarea — which is why each level below carries flex-1 and min-h-0. */}
      <div className="max-sm:flex-1 max-sm:min-h-0 max-sm:flex max-sm:flex-col bg-surface rounded-2xl border border-slate-200 p-3 sm:p-5 card-shadow">
        <div className="shrink-0 flex items-center gap-2.5 mb-1.5 sm:mb-2">
          <p className="text-[11px] sm:text-xs font-bold text-slate-600 uppercase tracking-wider">New support ticket</p>
        </div>
        {/* Phone drops this: the field label below says "Describe the problem"
            and the placeholder asks what happened, so the line is a third telling. */}
        <p className="hidden sm:block text-sm text-slate-500 mb-4">
          {slim
            ? 'Describe what went wrong and the team will look into it.'
            : 'Your report opens as a private thread with the SkyWatch team. You can add to it or reply there.'}
        </p>
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
            {busy ? 'Submitting…' : (slim ? 'Submit Report' : 'Open ticket')}
          </button>
        </form>
      </div>

      {/* The card above already promises the report is looked into, so on a
          phone this is a third restatement costing two lines of typing room. */}
      <p className="hidden sm:block text-xs text-slate-400 text-center mt-4">
        Tickets are reviewed by the SkyWatch team. We aim to reply within 48 hours.
      </p>
    </div>
  )
}
