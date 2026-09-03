import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import SEO from '../components/SEO'

/**
 * The one-click opt-out from the questionnaire email footer.
 *
 * THE OPT-OUT IS APPLIED ON ARRIVAL, before anything is rendered and before a
 * single question is asked. That ordering is deliberate and not negotiable: an
 * unsubscribe that depends on the recipient answering something, confirming
 * something, or clicking a second button is not an unsubscribe. The request
 * fires from the effect below, the page then reports that it is already done,
 * and everything underneath is optional.
 *
 * The questions come afterwards precisely because they are optional. Someone
 * who has already been let go answers more readily than someone who suspects
 * the answer is the price of leaving — so putting them second is both the
 * lawful order and the one that actually collects more.
 */

const REASONS = [
  { key: 'too_many_emails',       label: 'Too many emails' },
  { key: 'not_relevant',          label: 'Not relevant to me' },
  { key: 'finished_with_skywatch',label: 'I have finished with SkyWatch' },
  { key: 'never_signed_up',       label: 'I did not sign up for this' },
  { key: 'other',                 label: 'Something else' },
]

const PASSED = [
  { key: 'yes',     label: 'Yes, I passed' },
  { key: 'no',      label: 'No' },
  { key: 'waiting', label: 'Still waiting' },
]

// See Survey.jsx. `/survey/preview/opt-out` shows this page without actually
// unsubscribing anybody — which matters more here than on the questionnaire,
// because the whole point of this page is that it acts the instant it loads.
const PREVIEW_TOKEN = 'preview'

export default function SurveyOptOut() {
  const { token } = useParams()
  const { API } = useAuth()
  const isPreview = token === PREVIEW_TOKEN

  const [state, setState] = useState('working') // working | done | error
  const [name,  setName]  = useState(null)
  const [reason, setReason] = useState(null)
  const [passed, setPassed] = useState(null)
  const [sent, setSent] = useState(false)
  const fired = useRef(false)

  useEffect(() => {
    // Guard against React 18 StrictMode double-invoking the effect in dev. The
    // endpoint is idempotent anyway, but firing an unsubscribe twice in the log
    // would misrepresent what happened.
    if (fired.current) return
    fired.current = true
    if (isPreview) {
      setName('Agent 1234567')
      setState('done')
      return
    }
    ;(async () => {
      try {
        const res = await fetch(`${API}/api/survey/${token}/opt-out`, { method: 'POST' })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.message || 'This link is not valid.')
        setName(data.data?.name ?? null)
        setState('done')
      } catch {
        setState('error')
      }
    })()
  }, [API, token, isPreview])

  const submitExtras = async () => {
    setSent(true) // optimistic: nothing here is worth making them wait on
    if (isPreview) return
    try {
      await fetch(`${API}/api/survey/${token}/opt-out`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason,
          ...(passed ? { passedForRole: passed, satTest: true } : {}),
        }),
      })
    } catch {
      /* optional extras — a failure here changes nothing that matters */
    }
  }

  if (state === 'working') {
    return (
      <div className="max-w-md mx-auto py-16 text-center" data-testid="optout-working">
        <p className="text-sm text-slate-500">Unsubscribing…</p>
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="max-w-md mx-auto py-16 text-center" data-testid="optout-error">
        <SEO title="Unsubscribe" description="SkyWatch email preferences." noIndex />
        <div className="text-5xl mb-4">🔗</div>
        <h1 className="text-xl font-extrabold text-slate-900 mb-2">This link is not valid</h1>
        <p className="text-sm text-slate-500 mb-6">
          If you are still getting emails you did not ask for, reply to one and we will remove
          you by hand.
        </p>
        <Link to="/cbat" className="inline-flex px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm no-underline">
          Go to SkyWatch
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto pb-10" data-testid="optout-page">
      <SEO title="Unsubscribed" description="SkyWatch email preferences." noIndex />

      {isPreview && (
        <div
          data-testid="optout-preview-banner"
          className="mb-5 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2"
        >
          <p className="text-[11px] font-bold text-amber-800 uppercase tracking-widest">Preview</p>
          <p className="text-xs text-slate-600 leading-relaxed mt-0.5">
            This is the demo. Nobody has been unsubscribed and nothing is saved.
          </p>
        </div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center py-6"
      >
        <div className="text-5xl mb-3">✓</div>
        <h1 className="text-2xl font-extrabold text-slate-900 mb-2">
          Done{name ? `, ${name}` : ''}
        </h1>
        <p className="text-sm text-slate-500 leading-relaxed">
          You are unsubscribed. We will not email you about this again, and nothing else needs
          doing. Your account and your training are untouched.
        </p>
      </motion.div>

      {!sent && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-surface rounded-2xl border border-slate-200 p-4 sm:p-5"
          data-testid="optout-extras"
        >
          <p className="text-sm font-bold text-slate-800 mb-1">Before you go</p>
          <p className="text-xs text-slate-500 leading-relaxed mb-4">
            Both of these are optional and you are already unsubscribed either way.
          </p>

          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">
            Why are you leaving?
          </p>
          <div className="flex flex-wrap gap-2 mb-5">
            {REASONS.map(r => (
              <button
                key={r.key}
                type="button"
                onClick={() => setReason(reason === r.key ? null : r.key)}
                aria-pressed={reason === r.key}
                data-testid={`optout-reason-${r.key}`}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                  reason === r.key
                    ? 'bg-brand-600 border-brand-600 text-white'
                    : 'border-slate-200 text-slate-600 hover:border-brand-400'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">
            Did you pass your test?
          </p>
          <div className="flex flex-wrap gap-2 mb-5">
            {PASSED.map(p => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPassed(passed === p.key ? null : p.key)}
                aria-pressed={passed === p.key}
                data-testid={`optout-passed-${p.key}`}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                  passed === p.key
                    ? 'bg-brand-600 border-brand-600 text-white'
                    : 'border-slate-200 text-slate-600 hover:border-brand-400'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <button
            onClick={submitExtras}
            disabled={!reason && !passed}
            data-testid="optout-submit"
            className="w-full py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm transition-colors disabled:opacity-40"
          >
            Send and close
          </button>
        </motion.div>
      )}

      {sent && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center text-sm text-slate-500 py-4"
          data-testid="optout-thanks"
        >
          Thank you. All the best with it.
        </motion.p>
      )}

      <div className="text-center mt-6">
        <Link to="/cbat" className="text-xs font-semibold text-slate-500 hover:text-slate-700 no-underline">
          Back to SkyWatch
        </Link>
      </div>
    </div>
  )
}
