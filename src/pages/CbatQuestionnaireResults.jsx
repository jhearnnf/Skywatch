import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import SEO from '../components/SEO'
import { roleLabel } from '../data/surveyRoles'

/**
 * Admin ▸ CBAT Questionnaire Results.
 *
 * A page of its own rather than another panel inside Admin ▸ Content, because
 * the two are read at different times and for different reasons. The recipient
 * list is a worklist you open when you are about to send; this is what you come
 * back to afterwards, repeatedly, and it wants room for tables the narrow
 * Content column cannot give.
 *
 * Three tabs, one per kind of outcome. Only the first is an "answer":
 *
 *   Answers      — what people told us
 *   Not sat yet  — held until their test, and the date it is booked for
 *   Unsubscribed — who asked us to stop, and anything they said on the way
 *
 * That last tab is the one that could not exist before. Opted-out accounts are
 * excluded from the recipient list at the query level, so an unsubscribe used
 * to be a number in a summary and nothing else. It is feedback about the
 * campaign, and knowing who is how you notice you have mailed the wrong people.
 */

const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')

const OPT_OUT_REASON_LABELS = {
  too_many_emails:        'Too many emails',
  not_relevant:           'Not relevant to them',
  finished_with_skywatch: 'Finished with SkyWatch',
  never_signed_up:        'Did not sign up for this',
  other:                  'Something else',
}

const PASS_LABELS = { yes: 'Passed', no: 'Did not pass', waiting: 'Waiting' }

// Who wrote a piece of free text. The blocks above the tables are the only
// place the text itself appears, so they have to carry enough to find the
// person in the rows below: their name if they gave one, their agent number
// either way.
const writer = (x) => [
  x.displayName?.trim() || (x.agentNumber ? `Agent ${x.agentNumber}` : null),
  roleLabel(x.role) || 'Role not given',
  x.displayName?.trim() && x.agentNumber ? `Agent ${x.agentNumber}` : null,
].filter(Boolean).join(' · ')

const TABS = [
  { id: 'answers', label: 'Answers' },
  { id: 'deferred', label: 'Not sat yet' },
  { id: 'optouts', label: 'Unsubscribed' },
]

export default function CbatQuestionnaireResults() {
  const { API, apiFetch } = useAuth()
  const navigate = useNavigate()

  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [tab, setTab]         = useState('answers')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res  = await apiFetch(`${API}/api/admin/cbat-passers/responses`, { credentials: 'include' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.message || 'Could not load the results')
      setData(json.data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [API, apiFetch])

  useEffect(() => { load() }, [load])

  const s = data?.summary
  const counts = {
    answers:  data?.responses?.length ?? 0,
    deferred: data?.deferred?.length ?? 0,
    optouts:  data?.optedOut?.length ?? 0,
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-3xl mx-auto pb-12"
      data-testid="questionnaire-results"
    >
      <SEO title="CBAT Questionnaire Results" description="Admin — questionnaire results." noIndex />

      {/* Back to where this page is reached from: Admin ▸ Content with the
          Potential CBAT Passers panel expanded, whether the admin came in from
          that panel's "View results" or from the Questionnaires stat card. */}
      <button
        onClick={() => navigate('/admin', { state: { openPassers: true } })}
        className="text-xs text-slate-500 hover:text-slate-700 transition-colors mb-3"
      >
        ← Admin
      </button>
      <h1 className="text-2xl font-extrabold text-slate-900">CBAT Questionnaire</h1>
      <p className="text-sm text-slate-500 mt-1 mb-6">
        What people told us after they sat the real test.
      </p>

      {error && (
        <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 mb-4">
          {error}
        </p>
      )}
      {loading && <p className="text-sm text-slate-500">Loading…</p>}

      {s && (
        <>
          {/* The funnel, in the order it actually happens. */}
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-4">
            <Stat label="Emailed"  value={s.invitesSent} />
            <Stat label="Opened"   value={s.opened}    hint={pct(s.opened, s.invitesSent)} />
            <Stat label="Started"  value={s.started}   hint={pct(s.started, s.invitesSent)} />
            <Stat label="Finished" value={s.completed} hint={pct(s.completed, s.invitesSent)} />
            <Stat label="Unsubscribed" value={s.optOuts} />
          </div>

          {/* Answers that came in through the signed-in /survey link, which had
              no email behind them. Called out because they are counted in
              Started and Finished but not in Emailed, so without this line the
              percentages look wrong rather than explained. */}
          {s.selfServe > 0 && (
            <p className="text-[11px] text-slate-400 -mt-2 mb-4" data-testid="survey-self-serve-note">
              {s.selfServe === 1
                ? '1 of these opened the questionnaire from the signed-in link rather than an email, so it is not counted under Emailed.'
                : `${s.selfServe} of these opened the questionnaire from the signed-in link rather than an email, so they are not counted under Emailed.`}
            </p>
          )}

          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-6">
            <Stat label="Passed"      value={s.passed} />
            <Stat label="Did not"     value={s.failed} />
            <Stat label="Waiting"     value={s.waiting} />
            <Stat label="Realism"     value={avg(s.avgRealism)} hint="of 5" />
            <Stat label="Helped"      value={avg(s.avgHelped)}  hint="of 5" />
          </div>

          {/* The free text is the point of the exercise, so it sits above the
              tables rather than inside a tab someone has to think to open.

              It is printed HERE AND NOWHERE ELSE. The answer rows used to
              repeat the same paragraphs underneath, which on a page with one
              respondent showed the identical wall of text twice; the rows keep
              the facts you scan for (role, ratings, pass, donate) and these
              blocks keep the prose, each named so you can still tell who wrote
              what. */}
          {s.gaps?.length > 0 && (
            <div className="mb-6">
              <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2">
                What we did not prepare them for
              </h2>
              <div className="space-y-2">
                {s.gaps.map((g, i) => (
                  <div key={i} className="rounded-xl border border-amber-200 bg-amber-50/40 px-3 py-2">
                    <p className="text-sm text-slate-700 whitespace-pre-wrap">{g.gaps}</p>
                    <p className="text-[10px] text-slate-500 mt-1">{writer(g)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Kept apart from the gaps above because they answer different
              questions: one is a defect report about the training, the other is
              whatever the person wanted to say. */}
          {s.comments?.length > 0 && (
            <div className="mb-6">
              <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2">
                What they said
              </h2>
              <div className="space-y-2">
                {s.comments.map((c, i) => (
                  <div key={i} className="rounded-xl border border-slate-200 bg-surface px-3 py-2">
                    <p className="text-sm text-slate-700 whitespace-pre-wrap">{c.comment}</p>
                    <p className="text-[10px] text-slate-500 mt-1">
                      {writer(c)}{c.passedForRole === 'yes' ? ' · Passed' : ''}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2 mb-3">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                data-testid={`results-tab-${t.id}`}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  tab === t.id
                    ? 'bg-brand-600 border-brand-600 text-white'
                    : 'border-slate-200 text-slate-600 hover:border-brand-400'
                }`}
              >
                {t.label} · {counts[t.id]}
              </button>
            ))}
          </div>

          {tab === 'answers'  && <AnswersTable rows={data.responses} />}
          {tab === 'deferred' && <DeferredTable rows={data.deferred} />}
          {tab === 'optouts'  && <OptOutTable rows={data.optedOut} />}
        </>
      )}
    </motion.div>
  )
}

const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '—')
const avg = (v) => (v == null ? '—' : v.toFixed(1))

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-slate-200 px-3 py-2 bg-surface">
      <p className="text-lg font-extrabold text-slate-800 leading-none">{value}</p>
      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mt-1">{label}</p>
      {hint && <p className="text-[9px] text-slate-400">{hint}</p>}
    </div>
  )
}

function Who({ row }) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-semibold text-slate-800 truncate">
        {row.displayName?.trim() || (row.agentNumber ? `Agent ${row.agentNumber}` : 'Unknown')}
      </p>
      {row.email && <p className="text-[10px] text-slate-500 truncate">{row.email}</p>}
    </div>
  )
}

function Empty({ children }) {
  return (
    <div className="rounded-xl border border-slate-200 px-4 py-8 text-center">
      <p className="text-xs text-slate-500">{children}</p>
    </div>
  )
}

// One row per respondent, including the ones who stopped halfway — a partial
// answer is the normal case, not an error, and usually carries the pass answer.
function AnswersTable({ rows }) {
  if (!rows?.length) return <Empty>Nobody has answered yet.</Empty>
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100" data-testid="results-answers">
      {rows.map(r => (
        <div key={r._id} className="px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <Who row={{ ...r.userId, email: r.userId?.email }} />
            <div className="shrink-0 text-right">
              {r.satTest === false
                ? <span className="text-[10px] font-semibold text-sky-700">Not sat yet</span>
                : r.passedForRole
                  ? <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      r.passedForRole === 'yes' ? 'bg-emerald-200/60 text-emerald-800'
                      : r.passedForRole === 'no' ? 'bg-rose-200/60 text-rose-800'
                      : 'bg-slate-200/60 text-slate-700'}`}>
                      {PASS_LABELS[r.passedForRole]}
                    </span>
                  : <span className="text-[10px] text-slate-400">No answer yet</span>}
              <p className="text-[10px] text-slate-400 mt-0.5">
                {r.completedAt ? `Finished ${fmt(r.completedAt)}` : 'Stopped partway'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-[11px] text-slate-600">
            {r.role && <span>{roleLabel(r.role, r.roleOther)}</span>}
            {r.passedAnyRole === 'yes' && <span className="text-emerald-700">Passed for another role</span>}
            {r.realismRating != null && <span>Realism {r.realismRating}/5</span>}
            {r.helpedRating  != null && <span>Helped {r.helpedRating}/5</span>}
            {r.donationClicked && <span className="text-brand-700 font-semibold">Clicked donate</span>}
            {r.playReviewClicked && <span className="text-brand-700 font-semibold">Opened Play Store</span>}
          </div>

          {/* What they wrote is printed in full above, under "What we did not
              prepare them for" and "What they said". The row only says that
              there is something up there with this person's name on it. */}
          {(r.gaps || r.comment) && (
            <p className="mt-1.5 text-[10px] text-slate-500">
              {r.gaps && r.comment ? 'Wrote about the gaps, and left a comment'
                : r.gaps ? 'Wrote about the gaps'
                : 'Left a comment'} — above
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

// Sorted soonest first by the server, so the top of this list is who to expect
// back in the recipient list next.
function DeferredTable({ rows }) {
  if (!rows?.length) return <Empty>Nobody has told us they are still waiting to sit it.</Empty>
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100" data-testid="results-deferred">
      {rows.map((r, i) => (
        <div key={i} className="px-4 py-3 flex items-center justify-between gap-3">
          <Who row={r} />
          <div className="shrink-0 text-right">
            {r.due
              ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-200/60 text-emerald-800">Due a follow-up</span>
              : <span className="text-[10px] font-semibold text-sky-700">Back on {fmt(r.deferredUntil)}</span>}
            <p className="text-[10px] text-slate-400 mt-0.5">
              {r.testBookedFor
                ? `Test booked ${fmt(r.testBookedFor)}`
                : r.testBookedUnknown ? 'Not booked yet' : 'No date given'}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

function OptOutTable({ rows }) {
  if (!rows?.length) return <Empty>Nobody has unsubscribed.</Empty>
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100" data-testid="results-optouts">
      {rows.map((r, i) => (
        <div key={i} className="px-4 py-3 flex items-center justify-between gap-3">
          <Who row={r} />
          <div className="shrink-0 text-right">
            <p className="text-[10px] font-semibold text-slate-600">
              {r.reason ? OPT_OUT_REASON_LABELS[r.reason] ?? r.reason : 'No reason given'}
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">
              Left {fmt(r.optedOutAt)}
              {r.passedForRole ? ` · ${PASS_LABELS[r.passedForRole]}` : ''}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}
