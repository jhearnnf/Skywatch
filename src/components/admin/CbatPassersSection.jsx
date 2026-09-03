import { useState, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import Overlay from '../ui/Overlay'

/**
 * Admin › Content › Potential CBAT Passers.
 *
 * The recipient list for the CBAT outcome questionnaire, and the only place in
 * the app that can send one.
 *
 * NOTHING SENDS WITHOUT A DELIBERATE CLICK, and the click is guarded by a
 * confirmation that names every recipient. There is no scheduler behind this
 * and no "send remaining" sweep: an admin picks a batch, sends it, and the
 * people in it are ticked off. Coming back a fortnight later shows the
 * newly-dormant accounts unticked and everyone already contacted marked, so the
 * list doubles as the record of who has been asked.
 *
 * The one thing that un-ticks itself is a deferral. Someone who answered "not
 * yet" and gave a date is held until it passes and then rejoins the pool, so
 * the list stays a live worklist rather than a ledger that only ever grows.
 */

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const fmtDay  = (ymd) => {
  const [y, m, dd] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  })
}

export default function CbatPassersSection({ API }) {
  const { apiFetch } = useAuth()
  const navigate = useNavigate()

  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [minCompletions, setMinCompletions] = useState(10)
  const [dormantDays,    setDormantDays]    = useState(21)
  const [selected, setSelected] = useState(() => new Set())
  const [preview,  setPreview]  = useState(null)
  const [confirm,  setConfirm]  = useState(false)
  const [sending,  setSending]  = useState(false)
  const [result,   setResult]   = useState(null)
  const [open, setOpen] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState('')

  // The FIRST load deliberately sends no thresholds, so the server answers from
  // the saved settings and the inputs below can adopt them. Sending the
  // hardcoded initial state instead would make the panel silently ignore
  // whatever was configured in the section above it.
  const load = useCallback(async (opts = {}) => {
    setLoading(true); setError('')
    try {
      const qs = new URLSearchParams(
        opts.useSaved
          ? {}
          : {
              minCompletions: String(opts.minCompletions ?? minCompletions),
              dormantDays:    String(opts.dormantDays ?? dormantDays),
            },
      )
      const res = await apiFetch(`${API}/api/admin/cbat-passers?${qs}`, { credentials: 'include' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.message || 'Could not load the list')
      setData(json.data)
      if (opts.useSaved && json.data.thresholds) {
        setMinCompletions(json.data.thresholds.minCompletions)
        setDormantDays(json.data.thresholds.dormantDays)
      }
      // Pre-select the batch the server would pick. The admin can then add a
      // warm-band name or drop someone before sending.
      setSelected(new Set((json.data.nextBatchIds ?? []).map(String)))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [API, apiFetch, minCompletions, dormantDays])

  useEffect(() => { if (open && !data) load({ useSaved: true }) }, [open, data, load])

  // The list starts at the warm band, except when the admin has typed a
  // threshold below it — then it follows them down, so every value the input
  // accepts actually changes what comes back.
  const warmBandDays   = data?.thresholds?.warmBandDays ?? 14
  const listedFromDays = Math.min(warmBandDays, dormantDays)

  const rows = useMemo(
    () => (data?.groups ?? []).flatMap(g => g.users),
    [data],
  )
  const rowById = useMemo(
    () => new Map(rows.map(r => [r._id.toString(), r])),
    [rows],
  )

  // The server's own rule, echoed: never invited, a failed send worth retrying,
  // or a deferral that has run out.
  const selectable = (u) => u.mailable

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const selectedRows = useMemo(
    () => [...selected].map(id => rowById.get(id)).filter(Boolean),
    [selected, rowById],
  )

  const openPreview = async () => {
    try {
      const first = selectedRows[0]
      const qs = new URLSearchParams(first ? { userId: first._id } : {})
      const res = await apiFetch(`${API}/api/admin/cbat-passers/preview?${qs}`, { credentials: 'include' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.message || 'Preview failed')
      setPreview(json.data)
    } catch (err) {
      setError(err.message)
    }
  }

  const send = async () => {
    setSending(true); setError('')
    try {
      const res = await apiFetch(`${API}/api/admin/cbat-passers/send`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: [...selected], minCompletions, dormantDays }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.message || 'Send failed')
      setResult(json.data)
      setConfirm(false)
      await load()
    } catch (err) {
      setError(err.message)
      setConfirm(false)
    } finally {
      setSending(false)
    }
  }

  // Mails the real email to the admin, under a test campaign that keeps it out
  // of every count. Repeatable: each press replaces the last dry run.
  const sendTest = async () => {
    setTesting(true); setError('')
    try {
      const res = await apiFetch(`${API}/api/admin/cbat-passers/test`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.message || 'Test send failed')
      setTestResult(json.data?.sentTo ?? '')
    } catch (err) {
      setError(err.message)
    } finally {
      setTesting(false)
    }
  }


  const totals = data?.totals

  return (
    <div className="bg-surface rounded-2xl border border-slate-300 overflow-hidden mb-4">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-5 py-4 border-b border-slate-100 flex items-center justify-between text-left"
      >
        <div>
          <h3 className="font-bold text-slate-800">Potential CBAT Passers</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Trained hard, then went quiet. Nothing sends without your click.
          </p>
        </div>
        <span className="text-slate-400 text-xs ml-2">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-5 py-4">
          {/* Thresholds */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">
                Min games finished
              </label>
              <input
                type="number" min={0}
                value={minCompletions}
                onChange={e => setMinCompletions(Number(e.target.value))}
                className="w-full border border-slate-400 rounded-xl px-3 py-2 text-sm bg-surface-raised text-text outline-none focus:ring-2 focus:ring-brand-600/40"
              />
              <p className="text-[10px] text-slate-400 mt-1">Completed runs, not games opened.</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">
                Days dormant
              </label>
              <input
                type="number" min={0}
                value={dormantDays}
                onChange={e => setDormantDays(Number(e.target.value))}
                className="w-full border border-slate-400 rounded-xl px-3 py-2 text-sm bg-surface-raised text-text outline-none focus:ring-2 focus:ring-brand-600/40"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                {listedFromDays < dormantDays
                  ? `Listed from ${listedFromDays} days; ${listedFromDays}-${dormantDays} is warm and left out of a bulk send.`
                  : `Listed from ${listedFromDays} days.`}
              </p>
            </div>
          </div>

          {/* Loading the list pre-ticks the batch the server would send, which
              is the right default but the wrong starting point when you only
              want one or two names out of fifty. Untick all clears the ticks
              without reloading, so the list underneath stays put. */}
          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={() => load()}
              disabled={loading}
              className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition-colors disabled:opacity-40"
            >
              {loading ? 'Loading…' : 'Refresh list'}
            </button>
            <button
              onClick={() => setSelected(new Set())}
              disabled={!selected.size}
              data-testid="cbat-passers-untick-all"
              className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition-colors disabled:opacity-40"
            >
              Untick all ({selected.size})
            </button>
          </div>

          {error && (
            <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 mb-3">
              {error}
            </p>
          )}

          {totals && (
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
              <Stat label="Candidates" value={totals.candidates} />
              <Stat label="Ready" value={totals.ready} />
              <Stat label="Warm" value={totals.warm} hint={`< ${dormantDays}d`} />
              <Stat label="Emailed" value={totals.emailed} />
              <Stat label="Answered" value={totals.responded} />
              <Stat label="Not sat yet" value={totals.deferred} hint="held" />
            </div>
          )}

          {result && (
            <div className="text-xs bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-3 py-2 mb-3">
              Sent {result.sentCount} email{result.sentCount === 1 ? '' : 's'}.
              {result.failedCount > 0 && ` ${result.failedCount} failed — those accounts stay in the list to retry.`}
            </div>
          )}

          {/* The list, grouped by the day of each candidate's last finished run */}
          <div className="border border-slate-200 rounded-xl overflow-hidden mb-4 max-h-[32rem] overflow-y-auto">
            {(data?.groups ?? []).length === 0 && !loading && (
              <p className="px-4 py-6 text-center text-xs text-slate-500">
                Nobody matches these thresholds yet.
              </p>
            )}
            {(data?.groups ?? []).map(group => (
              <div key={group.day}>
                <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-baseline justify-between sticky top-0">
                  <p className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                    {fmtDay(group.day)}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    {group.users.length} agent{group.users.length === 1 ? '' : 's'}
                  </p>
                </div>
                {group.users.map(u => (
                  <PasserRow
                    key={u._id}
                    user={u}
                    checked={selected.has(u._id.toString())}
                    selectable={selectable(u)}
                    onToggle={() => toggle(u._id.toString())}
                  />
                ))}
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={openPreview}
              className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors"
            >
              Preview email
            </button>
            <button
              onClick={() => setConfirm(true)}
              disabled={!selected.size}
              className="px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold transition-colors disabled:opacity-40"
            >
              Send bulk email ({selected.size})
            </button>
            <button
              onClick={sendTest}
              disabled={testing}
              data-testid="cbat-passers-test-send"
              className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors disabled:opacity-40"
            >
              {testing ? 'Sending…' : 'Email me a test'}
            </button>
            {/* The results live on their own page. They are read repeatedly and
                at a different time to this list, and the tables want more width
                than the Content column has. Linked from here because this is
                where you already are when you think to look. */}
            <button
              onClick={() => navigate('/admin/cbat-questionnaire')}
              data-testid="cbat-passers-results-link"
              className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors"
            >
              View results ↗
            </button>
          </div>

          {testResult && (
            <p className="text-xs bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-3 py-2 mt-2" data-testid="cbat-passers-test-result">
              Test sent to {testResult}. It is the real email, but nothing it does counts:
              answering will not set a PASSED badge and unsubscribing will not unsubscribe you.
            </p>
          )}
          <p className="text-[10px] text-slate-400 mt-2">
            Up to {data?.batchSize ?? 50} at a time. Already-emailed accounts cannot be selected.
          </p>

        </div>
      )}

      <AnimatePresence>
        {preview && <PreviewModal preview={preview} onClose={() => setPreview(null)} />}
        {confirm && (
          <ConfirmSendModal
            rows={selectedRows}
            sending={sending}
            onConfirm={send}
            onCancel={() => setConfirm(false)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-slate-200 px-3 py-2">
      <p className="text-lg font-extrabold text-slate-800 leading-none">{value}</p>
      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mt-1">{label}</p>
      {hint && <p className="text-[9px] text-slate-400">{hint}</p>}
    </div>
  )
}

function PasserRow({ user, checked, selectable, onToggle }) {
  const name = user.displayName?.trim() || `Agent ${user.agentNumber}`
  const inv  = user.invite
  const deferred = inv?.deferredUntil && new Date(inv.deferredUntil) > new Date()

  return (
    <div className={`px-4 py-2.5 border-b border-slate-100 last:border-0 flex items-center gap-3 ${inv ? 'bg-slate-50/40' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={!selectable}
        onChange={onToggle}
        aria-label={`Select ${name}`}
        className="shrink-0 w-4 h-4 accent-brand-600 disabled:opacity-30"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-semibold text-slate-800 truncate">{name}</span>
          {user.isTester && (
            <span className="text-[8px] font-bold px-1 py-px rounded bg-amber-200/60 text-amber-800 uppercase tracking-wide">Tester</span>
          )}
          {user.cbatPassed && (
            <span className="text-[8px] font-bold px-1 py-px rounded bg-emerald-200/60 text-emerald-800 uppercase tracking-wide">Passed</span>
          )}
          {user.band === 'warm' && (
            <span className="text-[8px] font-bold px-1 py-px rounded bg-sky-200/60 text-sky-800 uppercase tracking-wide">Too soon</span>
          )}
        </div>
        <p className="text-[10px] text-slate-500 truncate">{user.email}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[10px] font-semibold text-slate-600">{user.completions} games</p>
        <p className="text-[10px] text-slate-400">{user.daysDormant}d quiet</p>
      </div>
      <div className="shrink-0 w-24 text-right">
        {!inv && <span className="text-[10px] text-slate-400">Not emailed</span>}
        {inv?.sentAt && (
          <span className="text-[10px] font-semibold text-emerald-700" title={`Emailed ${fmtDate(inv.sentAt)}`}>
            ✓ {fmtDate(inv.sentAt)}
          </span>
        )}
        {inv && !inv.sentAt && (
          <span className="text-[10px] font-semibold text-rose-600" title={inv.sendError ?? 'Send failed'}>
            ⚠ Failed
          </span>
        )}
        {inv?.completedAt && <p className="text-[9px] text-brand-700 font-semibold">Answered</p>}
        {inv?.optedOutAt && <p className="text-[9px] text-slate-400">Opted out</p>}
        {/* A deferral is the most useful thing to show about an already-emailed
            row: it says the send was not wasted, and when to come back. */}
        {deferred && (
          <p className="text-[9px] text-sky-700 font-semibold" title="Told us they have not sat it yet">
            Sits {fmtDate(inv.deferredUntil)}
          </p>
        )}
        {inv?.deferredUntil && !deferred && (
          <p className="text-[9px] text-emerald-700 font-semibold">Due a follow-up</p>
        )}
        {inv?.openedAt && !inv.completedAt && !inv.optedOutAt && !inv.deferredUntil && (
          <p className="text-[9px] text-slate-400">Opened</p>
        )}
      </div>
    </div>
  )
}

// The email is a tall document — roughly a screen and a half of body copy — so
// the frame showing it has to be given a real height rather than being left to
// size itself.
//
// `max-h` alone does not do that. In a content-sized flex column, `flex-1` has
// nothing to divide up, so the frame collapsed to its minimum and the whole
// email had to be read through a letterbox. A fixed `h-[88vh]` on the panel
// gives the column a definite height; the header and footer opt out of shrinking
// and the frame takes everything else.
//
// 88vh rather than 90 leaves room for the overlay's own p-4 padding, so the
// panel cannot end up taller than the window it sits in.
function PreviewModal({ preview, onClose }) {
  return (
    <Overlay zIndex={50} backdrop="rgba(15,23,42,0.60)" onDismiss={onClose} className="flex items-end sm:items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-surface rounded-2xl w-full max-w-2xl h-[88vh] flex flex-col overflow-hidden shadow-2xl"
      >
        <div className="shrink-0 px-6 pt-5 pb-4 border-b border-slate-100">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-base font-bold text-slate-900">Email preview</h3>
              <p className="text-sm text-slate-500 mt-0.5 truncate">{preview.subject}</p>
            </div>
            {/* A full browser tab is the only way to see it at real size, and to
                click the link through to the questionnaire. */}
            <button
              onClick={() => {
                const w = window.open('', '_blank', 'noopener,noreferrer')
                if (w) { w.document.write(preview.html); w.document.close() }
              }}
              className="shrink-0 px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition-colors"
            >
              Open in a tab ↗
            </button>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            {preview.recipient
              ? <>Rendered for {preview.recipient.name} · {preview.recipient.email}</>
              : <>No candidates yet — rendered with placeholder details</>}
          </p>
          {preview.isPlaceholder && (
            <p className="text-[11px] text-amber-700 mt-1">
              The link in this preview is not a real invitation.
            </p>
          )}
        </div>
        <div className="flex-1 min-h-0 bg-[#f4f8ff]">
          <iframe
            title="Questionnaire email preview"
            aria-label="Questionnaire email preview"
            sandbox=""
            srcDoc={preview.html}
            className="w-full h-full border-0"
          />
        </div>
        <div className="shrink-0 px-6 py-4 border-t border-slate-100">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors"
          >
            Close
          </button>
        </div>
      </motion.div>
    </Overlay>
  )
}

// Names every recipient before anything leaves. A bulk send is not reversible,
// so the last thing between the admin and 50 strangers is a list they can read.
function ConfirmSendModal({ rows, onConfirm, onCancel, sending }) {
  return (
    <Overlay zIndex={50} backdrop="rgba(15,23,42,0.60)" onDismiss={sending ? undefined : onCancel} className="flex items-end sm:items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-surface rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden shadow-2xl"
      >
        <div className="px-6 pt-5 pb-4 border-b border-slate-100">
          <h3 className="text-base font-bold text-slate-900">
            Send to {rows.length} {rows.length === 1 ? 'person' : 'people'}?
          </h3>
          <p className="text-sm text-slate-500 mt-1">
            Each gets their own private link. This cannot be undone, and nobody here can be
            emailed for this questionnaire again.
          </p>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-3 divide-y divide-slate-100">
          {rows.map(r => (
            <div key={r._id} className="py-1.5">
              <p className="text-sm font-semibold text-slate-800">
                {r.displayName?.trim() || `Agent ${r.agentNumber}`}
                {r.band === 'warm' && (
                  <span className="ml-1.5 text-[8px] font-bold px-1 py-px rounded bg-sky-200/60 text-sky-800 uppercase tracking-wide">
                    Too soon
                  </span>
                )}
              </p>
              <p className="text-[11px] text-slate-500">{r.email}</p>
            </div>
          ))}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex gap-2">
          <button
            onClick={onCancel}
            disabled={sending}
            className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={sending}
            className="flex-1 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold transition-colors disabled:opacity-40"
          >
            {sending ? 'Sending…' : 'Send now'}
          </button>
        </div>
      </motion.div>
    </Overlay>
  )
}
