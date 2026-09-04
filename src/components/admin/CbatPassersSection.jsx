import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import Overlay from '../ui/Overlay'
import SURVEY_COPY from '../../../backend/constants/surveyEmailDefaults.json'
import SURVEY_APOLOGY_COPY from '../../../backend/constants/surveyApologyEmailDefaults.json'

/**
 * Admin › Content › Potential CBAT Passers.
 *
 * The recipient list for the CBAT outcome questionnaire, and the only place in
 * the app that can send one.
 *
 * It also owns the questionnaire's settings, which used to sit in a separate
 * "CBAT Questionnaire Email" section further up Content. Splitting them was a
 * mistake in practice: the copy was edited in one place, the recipients chosen
 * in another, and the two variants of the email could not be compared against
 * the list of people about to receive them. The pencil beside each option here
 * opens the same fields that section held.
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

// The settings keys behind each variant, and the strings an untouched field
// falls back to. Same JSON the sender reads, so a blank box is not a guess.
const TEMPLATES = {
  standard: {
    label: 'Normal invitation',
    hint: 'The normal first invitation. For anyone who has not been emailed yet.',
    prefix: 'cbatSurveyEmail',
    defaults: SURVEY_COPY,
  },
  apology: {
    label: 'Apology and working link',
    hint: 'The normal invitation with one line at the top saying the first link was broken. For the people marked Broken link.',
    prefix: 'cbatSurveyApologyEmail',
    defaults: SURVEY_APOLOGY_COPY,
  },
}

const TEMPLATE_FIELDS = [
  { key: 'Subject',  label: 'Subject',     from: 'subject'  },
  { key: 'Heading',  label: 'Heading',     from: 'heading'  },
  { key: 'Subtitle', label: 'Subtitle',    from: 'subtitle' },
  { key: 'Body',     label: 'Body',        from: 'body', rows: 12 },
  { key: 'Cta',      label: 'Button text', from: 'cta'      },
  { key: 'Footer',   label: 'Footer',      from: 'footer', rows: 2 },
]

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const fmtDay  = (ymd) => {
  const [y, m, dd] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  })
}

export default function CbatPassersSection({ API, openOnMount = false, onOpenConsumed }) {
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
  // Opened for us when the admin came here from the Questionnaires stat card
  // (Stats ▸ Questionnaires → results page → ← Admin): the panel they were
  // being sent to should be expanded and in view, not collapsed like every
  // other section.
  const [open, setOpen] = useState(openOnMount)
  const rootRef = useRef(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState('')
  const [query,     setQuery]     = useState('')
  const [hits,      setHits]      = useState(null)
  const [searching, setSearching] = useState(false)
  // Rows the admin ticked in the search results, kept by id. The search results
  // themselves come and go as the box is retyped or cleared, and a recipient
  // must not vanish from the send with them — this is what the confirmation
  // modal and the send body read for anyone who is not in the list above.
  const [picked, setPicked] = useState(() => new Map())
  // Which of the two pieces of copy this send goes out with. Chosen per batch,
  // never per campaign: the people whose first invitation carried a dead link
  // need the apology, and everyone else must not be told about a mistake they
  // never saw. Defaults to the apology while anyone is still owed one, because
  // that is the batch the list will be pre-ticking.
  const [variant, setVariant] = useState('standard')
  // Which variant's wording is open for editing, or null. Separate from the
  // selected variant: an admin may want to read the apology copy while still
  // intending to send the normal one.
  const [editing, setEditing] = useState(null)
  // The questionnaire's open/closed switch and the saved threshold defaults,
  // both of which used to live in a Content section of their own.
  const [surveyEnabled, setSurveyEnabled] = useState(true)
  const [savingDefaults, setSavingDefaults] = useState(false)
  const [notice, setNotice] = useState('')

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
      // The picker always opens on the normal invitation. It used to preselect
      // the apology whenever anyone was owed one, which quietly made the
      // exceptional email the default and put the decision one un-read radio
      // button away from going out to the wrong half of the list.
      setVariant('standard')
      if (typeof json.data.surveyEnabled === 'boolean') setSurveyEnabled(json.data.surveyEnabled)
      // The ticks are being replaced wholesale, so the search picks they were
      // partly made of go with them rather than surviving as orphans.
      setPicked(new Map())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [API, apiFetch, minCompletions, dormantDays])

  useEffect(() => { if (open && !data) load({ useSaved: true }) }, [open, data, load])

  // Scroll the panel into view once, on the arrival that opened it. The flag is
  // consumed straight away so a later collapse is not undone by a re-render.
  useEffect(() => {
    if (!openOnMount) return
    rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    onOpenConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The list starts at the warm band, except when the admin has typed a
  // threshold below it — then it follows them down, so every value the input
  // accepts actually changes what comes back.
  const warmBandDays   = data?.thresholds?.warmBandDays ?? 14
  const listedFromDays = Math.min(warmBandDays, dormantDays)

  const rows = useMemo(
    () => (data?.groups ?? []).flatMap(g => g.users),
    [data],
  )
  // The list first, then anyone picked out of the search. A person who is in
  // both is the same person, and the list's copy is the one whose numbers the
  // admin has been reading.
  const rowById = useMemo(() => {
    const map = new Map(picked)
    for (const r of rows) map.set(r._id.toString(), r)
    return map
  }, [rows, picked])

  // The server's own rule, echoed: never invited, a failed send worth retrying,
  // or a deferral that has run out.
  const selectable = (u) => u.mailable

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  // Ticking a search hit also keeps a copy of the row, because clearing the box
  // throws the results away and the recipient has to survive that.
  const toggleHit = (row) => {
    const id = row._id.toString()
    toggle(id)
    setPicked(prev => {
      const next = new Map(prev)
      if (next.has(id)) next.delete(id); else next.set(id, row)
      return next
    })
  }

  const search = useCallback(async (term) => {
    const q = term.trim()
    if (q.length < 2) { setHits(null); return }
    setSearching(true); setError('')
    try {
      const qs = new URLSearchParams({
        q,
        minCompletions: String(minCompletions),
        dormantDays:    String(dormantDays),
      })
      const res = await apiFetch(`${API}/api/admin/cbat-passers/search?${qs}`, { credentials: 'include' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.message || 'Search failed')
      setHits(json.data.users ?? [])
    } catch (err) {
      setError(err.message)
    } finally {
      setSearching(false)
    }
  }, [API, apiFetch, minCompletions, dormantDays])

  // Typed searches settle before they are sent. 300ms is long enough that an
  // address is not searched a character at a time and short enough not to feel
  // like a button press.
  useEffect(() => {
    if (!open) return
    if (query.trim().length < 2) { setHits(null); return }
    const t = setTimeout(() => search(query), 300)
    return () => clearTimeout(t)
  }, [query, open, search])

  // The thresholds above are a scratch pad by default: type a different cut,
  // see who it catches, and nothing is written down. This is the button that
  // commits them, together with the open/closed switch, so the panel opens on
  // them next time. Both used to be fields in a separate Content section.
  const saveSettings = async (fields, label) => {
    setSavingDefaults(true); setError(''); setNotice('')
    try {
      const res = await apiFetch(`${API}/api/admin/settings`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...fields, reason: label }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.message || 'Could not save')
      }
      setNotice(`${label} saved.`)
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingDefaults(false)
    }
  }

  const selectedRows = useMemo(
    () => [...selected].map(id => rowById.get(id)).filter(Boolean),
    [selected, rowById],
  )

  const openPreview = async () => {
    try {
      const first = selectedRows[0]
      const qs = new URLSearchParams({ variant, ...(first ? { userId: first._id } : {}) })
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
        body: JSON.stringify({ userIds: [...selected], minCompletions, dormantDays, variant }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.message || 'Send failed')
      setResult(json.data)
      setConfirm(false)
      await load()
      // Re-run the open search so a name that has just been mailed shows its
      // tick there too, rather than still offering to send to them.
      if (query.trim().length >= 2) await search(query)
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
        body: JSON.stringify({ variant }),
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
    <div ref={rootRef} data-testid="cbat-passers-section" className="bg-surface rounded-2xl border border-slate-300 overflow-hidden mb-4">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-5 py-4 border-b border-slate-100 flex items-center justify-between text-left"
      >
        <div>
          <h3 className="font-bold text-slate-800">Potential CBAT Passers Survey</h3>
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

          {/* The questionnaire's own switch. Off does not stop sending; it makes
              links that are already out show a "this has closed" page. It sits
              with the send list because it is read while looking at who has
              been asked, not while editing copy. */}
          <label className="flex items-start gap-2 mb-4 cursor-pointer">
            <input
              type="checkbox"
              checked={surveyEnabled}
              onChange={e => setSurveyEnabled(e.target.checked)}
              data-testid="cbat-passers-survey-enabled"
              className="mt-0.5 shrink-0 w-4 h-4 accent-brand-600"
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-800">Questionnaire is open</span>
              <span className="block text-[10px] text-slate-500">
                When off, links already sent show a polite &ldquo;this has closed&rdquo; page instead of
                the form. Does not affect sending.
              </span>
            </span>
          </label>

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
              onClick={() => { setSelected(new Set()); setPicked(new Map()) }}
              disabled={!selected.size}
              data-testid="cbat-passers-untick-all"
              className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition-colors disabled:opacity-40"
            >
              Untick all ({selected.size})
            </button>
            <button
              onClick={() => saveSettings({
                cbatSurveyMinCompletions: minCompletions,
                cbatSurveyDormantDays:    dormantDays,
                cbatSurveyEnabled:        surveyEnabled,
              }, 'Questionnaire settings')}
              disabled={savingDefaults}
              data-testid="cbat-passers-save-defaults"
              className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition-colors disabled:opacity-40"
            >
              {savingDefaults ? 'Saving…' : 'Save as defaults'}
            </button>
          </div>

          {error && (
            <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 mb-3">
              {error}
            </p>
          )}

          {notice && (
            <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 mb-3" data-testid="cbat-passers-notice">
              {notice}
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

          {/* A dead base URL has to be visible BEFORE the send, not discovered
              afterwards in fifty other inboxes. The server refuses the send too;
              this is so nobody has to find that out by pressing it. */}
          {data?.linkProblem && (
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 mb-3" data-testid="cbat-passers-link-problem">
              <strong>Sending is blocked.</strong> {data.linkProblem}, so every link in the email
              would be dead in the recipient&rsquo;s inbox. Send from the live admin at
              skywatch.academy rather than a local server.
            </p>
          )}

          {totals?.needsResend > 0 && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-3" data-testid="cbat-passers-needs-resend">
              <strong>{totals.needsResend}</strong>{' '}
              {totals.needsResend === 1 ? 'person was' : 'people were'} emailed a link that did not
              work. They are marked <em>Broken link</em> below, listed whatever the thresholds say,
              and go to the front of the next batch. Send them the apology copy.
            </p>
          )}

          {result && (
            <div className="text-xs bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-3 py-2 mb-3">
              Sent {result.sentCount} email{result.sentCount === 1 ? '' : 's'}.
              {result.failedCount > 0 && ` ${result.failedCount} failed — those accounts stay in the list to retry.`}
            </div>
          )}

          {/* Find one person, whatever the thresholds say.
              The list below is a bulk worklist and its rules are averages: they
              are right about a population and wrong about individuals. This
              reaches past them, including past the do-not-contact list, because
              those names are held back from a bulk send for being known to us
              rather than for having nothing to tell us. It does not reach past
              an unsubscribe, a ban or a bot. */}
          <div className="mb-4">
            <label htmlFor="cbat-passer-search" className="block text-xs font-semibold text-slate-500 mb-1">
              Search for someone to send to
            </label>
            <div className="flex gap-2">
              <input
                id="cbat-passer-search"
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Name, email or agent number"
                data-testid="cbat-passers-search"
                className="flex-1 min-w-0 border border-slate-400 rounded-xl px-3 py-2 text-sm bg-surface-raised text-text outline-none focus:ring-2 focus:ring-brand-600/40"
              />
              {query && (
                <button
                  onClick={() => { setQuery(''); setHits(null) }}
                  className="px-3 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
            <p className="text-[10px] text-slate-400 mt-1">
              Finds anyone, including people left out of the list below. Ticking one here adds
              them to the send.
            </p>

            {searching && <p className="text-[11px] text-slate-500 mt-2">Searching…</p>}

            {hits && !searching && (
              <div data-testid="cbat-passers-search-results" className="border border-slate-200 rounded-xl overflow-hidden mt-2 max-h-80 overflow-y-auto">
                {hits.length === 0 && (
                  <p className="px-4 py-4 text-center text-xs text-slate-500">
                    Nobody matches “{query.trim()}”.
                  </p>
                )}
                {hits.map(u => (
                  <SearchHitRow
                    key={u._id}
                    user={u}
                    minCompletions={minCompletions}
                    checked={selected.has(u._id.toString())}
                    onToggle={() => toggleHit(u)}
                  />
                ))}
              </div>
            )}
          </div>

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

          {/* Which email this batch goes out with. Two radios rather than a
              select, because the choice changes what fifty people read and is
              worth being able to see both options without opening anything. */}
          <fieldset className="mb-4 border border-slate-200 rounded-xl px-4 py-3">
            <legend className="px-1 text-xs font-semibold text-slate-500">Which email to send</legend>
            <div className="flex flex-col gap-2">
              {(data?.variants ?? [
                { key: 'standard', label: 'Normal invitation' },
                { key: 'apology',  label: 'Apology and working link' },
              ]).map(v => (
                <div key={v.key} className="flex items-start gap-2">
                  <label className="flex items-start gap-2 cursor-pointer min-w-0 flex-1">
                    <input
                      type="radio"
                      name="cbat-survey-variant"
                      value={v.key}
                      checked={variant === v.key}
                      onChange={() => setVariant(v.key)}
                      data-testid={`cbat-passers-variant-${v.key}`}
                      className="mt-0.5 shrink-0 w-4 h-4 accent-brand-600"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-800">{v.label}</span>
                      <span className="block text-[10px] text-slate-500">
                        {TEMPLATES[v.key]?.hint}
                      </span>
                    </span>
                  </label>
                  {/* Editing the wording is a different act to choosing it, so it
                      is a separate control rather than something that happens on
                      selection. Opening the apology copy to read it must not
                      arm the apology send. */}
                  <button
                    type="button"
                    onClick={() => setEditing(v.key)}
                    aria-label={`Edit the ${TEMPLATES[v.key]?.label ?? v.key} wording`}
                    title="Edit this email"
                    data-testid={`cbat-passers-edit-${v.key}`}
                    className="shrink-0 px-2 py-1 rounded-lg border border-slate-200 text-slate-500 text-xs hover:bg-slate-50 transition-colors"
                  >
                    ✎
                  </button>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 mt-2">
              Preview and &ldquo;Email me a test&rdquo; both use whichever is selected. Edit the wording
              of either one in Admin &rsaquo; Content.
            </p>
          </fieldset>

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
              disabled={!selected.size || !!data?.linkProblem}
              className="px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold transition-colors disabled:opacity-40"
            >
              Send bulk email ({selected.size})
            </button>
            <button
              onClick={sendTest}
              disabled={testing || !!data?.linkProblem}
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
            {/* Walk-through copies of the two pages the email leads to. They run
                on a stub, so the flow can be checked without spending a real
                invitation on it. */}
            <a
              href="/survey/preview"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors no-underline"
            >
              Try the questionnaire ↗
            </a>
            <a
              href="/survey/preview/opt-out"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors no-underline"
            >
              Try the unsubscribe page ↗
            </a>
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
        {editing && (
          <TemplateEditorModal
            API={API}
            apiFetch={apiFetch}
            variant={editing}
            onClose={() => setEditing(null)}
            onSaved={(label) => { setEditing(null); setNotice(`${label} saved.`) }}
          />
        )}
        {preview && <PreviewModal preview={preview} onClose={() => setPreview(null)} />}
        {confirm && (
          <ConfirmSendModal
            rows={selectedRows}
            variantLabel={(data?.variants ?? []).find(v => v.key === variant)?.label
              ?? (variant === 'apology' ? 'Apology and working link' : 'Normal invitation')}
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

// Why a search hit is not in the list above. Every one of these is a real
// answer to "so where is he?", which is the question an admin has the moment
// they search for someone and find them here instead of up there.
function hitReason(user, minCompletions) {
  switch (user.excludedReason) {
    case null:
    case undefined:              return null
    case 'bot':                  return 'Bot account, cannot be emailed.'
    case 'banned':               return 'Banned account, cannot be emailed.'
    case 'no-email':             return 'No email address on the account.'
    case 'opted-out':            return 'Unsubscribed from research email. Cannot be emailed.'
    case 'admin':                return 'Admin account, so never in the list.'
    case 'named':                return 'On the do-not-contact list. You can still send to them from here.'
    case 'below-min-games':      return `Under the ${minCompletions}-game threshold (${user.completions} finished).`
    case 'never-finished-a-game': return 'Has never finished a CBAT game.'
    case 'still-active':         return 'Still active, so probably has not sat their test yet.'
    default:                     return 'Not in the list above.'
  }
}

function SearchHitRow({ user, minCompletions, checked, onToggle }) {
  const reason  = hitReason(user, minCompletions)
  const emailed = !!user.invite?.sentAt

  return (
    <div className="border-b border-slate-100 last:border-0">
      <PasserRow
        user={user}
        checked={checked}
        selectable={user.mailable}
        onToggle={onToggle}
      />
      {reason && (
        <p className={`px-4 pb-2 text-[10px] ${user.mailable ? 'text-slate-500' : 'text-rose-600'}`}>
          {reason}
        </p>
      )}
      {!reason && emailed && (
        <p className="px-4 pb-2 text-[10px] text-slate-500">Already emailed for this questionnaire.</p>
      )}
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
          {user.band === 'warm' && !user.needsResend && (
            <span className="text-[8px] font-bold px-1 py-px rounded bg-sky-200/60 text-sky-800 uppercase tracking-wide">Too soon</span>
          )}
          {user.needsResend && (
            <span
              className="text-[8px] font-bold px-1 py-px rounded bg-rose-200/60 text-rose-800 uppercase tracking-wide"
              title={`Emailed ${fmtDate(user.invite?.brokenLinkAt)} with a link that did not work`}
              data-testid="cbat-passers-broken-badge"
            >
              Broken link
            </span>
          )}
        </div>
        <p className="text-[10px] text-slate-500 truncate">{user.email}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[10px] font-semibold text-slate-600">{user.completions} games</p>
        {/* A search hit may have no activity at all, and "nulld quiet" is not
            a thing to put on a screen. */}
        <p className="text-[10px] text-slate-400">
          {user.daysDormant == null ? 'never seen' : `${user.daysDormant}d quiet`}
        </p>
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
        {user.needsResend && (
          <p className="text-[9px] text-rose-600 font-semibold">Link was dead</p>
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
function ConfirmSendModal({ rows, variantLabel, onConfirm, onCancel, sending }) {
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
          {/* Which of the two emails is about to go out. The list of names below
              answers "to whom"; without this the modal never answers "saying
              what", which is the half that was wrong last time. */}
          {variantLabel && (
            <p className="text-xs font-semibold text-slate-700 mt-2" data-testid="cbat-passers-confirm-variant">
              Sending: {variantLabel}
            </p>
          )}
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
                {/* Someone added through the search box, who the list itself
                    would never have offered. Worth saying out loud on the one
                    screen that exists to be read before anything sends. */}
                {r.excludedReason && (
                  <span className="ml-1.5 text-[8px] font-bold px-1 py-px rounded bg-amber-200/60 text-amber-800 uppercase tracking-wide">
                    Off list
                  </span>
                )}
                {r.needsResend && (
                  <span className="ml-1.5 text-[8px] font-bold px-1 py-px rounded bg-rose-200/60 text-rose-800 uppercase tracking-wide">
                    Broken link
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

// The wording of one of the two emails, edited where it is chosen.
//
// This used to be a dozen fields in a "CBAT Questionnaire Email" section
// further up Content, a long way from the list of people about to receive
// them. Two variants made that arrangement worse rather than better: twelve
// near-identical boxes under one heading, with nothing on screen saying which
// half went to whom.
//
// Values are fetched fresh on open rather than passed down, because the panel
// never needed them before and holding a copy of every setting just to edit six
// of them would mean deciding what to do when the two drift apart.
function TemplateEditorModal({ API, apiFetch, variant, onClose, onSaved }) {
  const tpl = TEMPLATES[variant]
  const [draft,  setDraft]  = useState(null)
  const [reason, setReason] = useState('Edit questionnaire email copy')
  const [busy,   setBusy]   = useState(false)
  const [error,  setError]  = useState('')

  useEffect(() => {
    let live = true
    apiFetch(`${API}/api/admin/settings`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (!live) return
        const saved = d.data?.settings ?? {}
        setDraft(Object.fromEntries(
          TEMPLATE_FIELDS.map(f => [f.key, saved[`${tpl.prefix}${f.key}`] ?? '']),
        ))
      })
      .catch(() => live && setError('Could not load the current wording.'))
    return () => { live = false }
  }, [API, apiFetch, tpl.prefix])

  const save = async () => {
    if (!reason.trim()) return
    setBusy(true); setError('')
    try {
      const updates = Object.fromEntries(
        TEMPLATE_FIELDS.map(f => [`${tpl.prefix}${f.key}`, draft[f.key] ?? '']),
      )
      const res = await apiFetch(`${API}/api/admin/settings`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...updates, reason: reason.trim() }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.message || 'Could not save')
      }
      onSaved(tpl.label)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Overlay zIndex={50} backdrop="rgba(15,23,42,0.60)" onDismiss={busy ? undefined : onClose} className="flex items-end sm:items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-surface rounded-2xl w-full max-w-2xl h-[88vh] flex flex-col overflow-hidden shadow-2xl"
        data-testid="cbat-passers-template-editor"
      >
        <div className="shrink-0 px-6 pt-5 pb-4 border-b border-slate-100">
          <h3 className="text-base font-bold text-slate-900">{tpl.label}</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Leave a box empty to use the built-in wording shown in it.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-2">
          {!draft && !error && <p className="py-6 text-center text-xs text-slate-500">Loading…</p>}
          {draft && TEMPLATE_FIELDS.map(f => (
            <div key={f.key} className="py-2.5 border-b border-slate-100 last:border-0">
              <label className="block text-xs font-semibold text-slate-500 mb-1" htmlFor={`tpl-${f.key}`}>
                {f.label}
              </label>
              {f.rows ? (
                <textarea
                  id={`tpl-${f.key}`}
                  rows={f.rows}
                  placeholder={tpl.defaults[f.from]}
                  value={draft[f.key]}
                  onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
                  className="w-full border border-slate-400 rounded-xl px-3 py-2 text-sm resize-none outline-none focus:ring-2 focus:ring-brand-600/40 bg-surface-raised text-text"
                />
              ) : (
                <input
                  id={`tpl-${f.key}`}
                  type="text"
                  placeholder={tpl.defaults[f.from]}
                  value={draft[f.key]}
                  onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
                  className="w-full border border-slate-400 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-600/40 bg-surface-raised text-text"
                />
              )}
            </div>
          ))}

          <p className="text-[11px] text-slate-400 py-3">
            <code className="font-mono">{'{{name}}'}</code> becomes their display name,{' '}
            <code className="font-mono">{'{{button}}'}</code> places the button, and{' '}
            <code className="font-mono">{'{{link}}'}</code> drops the raw link in. The unsubscribe
            line is added to the footer automatically and cannot be removed.
          </p>
        </div>

        <div className="shrink-0 px-6 py-4 border-t border-slate-100">
          {error && <p className="text-xs text-rose-600 mb-2">{error}</p>}
          <label className="block text-xs font-semibold text-slate-500 mb-1" htmlFor="tpl-reason">
            Reason (required)
          </label>
          <input
            id="tpl-reason"
            type="text"
            value={reason}
            onChange={e => setReason(e.target.value)}
            className="w-full border border-slate-400 rounded-xl px-3 py-2 text-sm mb-3 outline-none focus:ring-2 focus:ring-brand-600/40 bg-surface-raised text-text"
          />
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={busy}
              className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={busy || !draft || !reason.trim()}
              data-testid="cbat-passers-template-save"
              className="flex-1 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold transition-colors disabled:opacity-40"
            >
              {busy ? 'Saving…' : 'Save wording'}
            </button>
          </div>
        </div>
      </motion.div>
    </Overlay>
  )
}
