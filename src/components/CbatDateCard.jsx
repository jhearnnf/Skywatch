import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useAppSettings } from '../context/AppSettingsContext'
import { cohortCopy, formatCohortDate } from '../utils/cbat/cohortCopy'

// The "enter your test date" card at the top of the Profile page.
//
// The private same-date group already exists (CBAT lounge › My group, and the
// Groups row on the Community rail), but both sit behind a tab most people
// never open, so most accounts never record a date. This card puts the ask
// where every signed-in user lands, says plainly what they get for it, and
// then shrinks to a one-line "your date + open group" once it is done.
//
// Same endpoint and same one-shot rule as the other two surfaces: POST
// /api/chat/cbat-group locks the date server-side, so the confirm step here
// is a courtesy, not the boundary. Wording comes from cohortCopy() with the
// server's `testName`, so a Canadian is asked for a CFAST date, not a CBAT
// one. Renders nothing while loading, when chat is off, or for someone who
// has already passed: a card that nags a past sitter would be worse than no
// card.

export default function CbatDateCard() {
  const { user, API, apiFetch } = useAuth()
  const { settings } = useAppSettings()
  const enabled = Boolean(user) && settings?.chatEnabled !== false

  const [state, setState] = useState(null)
  const [date, setDate] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!enabled) return
    let alive = true
    apiFetch(`${API}/api/chat/cbat-group`)
      .then(r => (r.ok ? r.json() : null))
      .then(json => { if (alive && json?.data) setState(json.data) })
      .catch(() => { /* offline or chat down: the card simply stays away */ })
    return () => { alive = false }
  }, [enabled, API, apiFetch])

  const join = async () => {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${API}/api/chat/cbat-group`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }),
      })
      const json = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(json.message || cohortCopy(state?.testName).saveError)
      setState(json.data)
      setConfirming(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!enabled || !state || state.applicable === false) return null
  const copy = cohortCopy(state.testName)

  if (state.configured) {
    return (
      <section aria-label={copy.yourDate} className="bg-surface rounded-2xl border border-slate-200 p-4 mb-5 card-shadow flex items-center gap-3">
        <span aria-hidden="true" className="w-10 h-10 shrink-0 rounded-xl grid place-items-center bg-brand-600 text-white text-lg">✈</span>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{copy.yourDate}</p>
          <p className="text-base font-extrabold text-slate-800 leading-tight">{formatCohortDate(state.date)}</p>
          {Number.isFinite(state.memberCount) && (
            <p className="text-xs text-slate-500">{state.memberCount} {state.memberCount === 1 ? 'person' : 'people'} in your group</p>
          )}
        </div>
        {state.conversationId && (
          <Link to={`/chat/${state.conversationId}`} className="shrink-0 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-extrabold px-3 py-2 transition-colors">
            Open group
          </Link>
        )}
      </section>
    )
  }

  return (
    <section aria-label={copy.eyebrow} data-testid="cbat-date-card" className="bg-surface rounded-2xl border border-brand-300/40 p-5 mb-5 card-shadow relative overflow-hidden">
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_85%_0%,rgba(91,170,255,.14),transparent_45%)]" />
      <div className="relative">
        <div className="flex items-center gap-3 mb-3">
          <span aria-hidden="true" className="w-10 h-10 shrink-0 rounded-xl grid place-items-center bg-brand-600 text-white text-lg shadow-[0_10px_24px_rgba(37,99,235,.28)]">✈</span>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.2em] font-extrabold text-brand-600">{copy.eyebrow}</p>
            <h2 className="text-base font-black text-slate-800 leading-tight">{copy.heading}</h2>
          </div>
        </div>

        <ul className="space-y-1.5 mb-4">
          {copy.benefits.map(line => (
            <li key={line} className="flex items-start gap-2 text-xs text-slate-600 leading-relaxed">
              <span aria-hidden="true" className="mt-0.5 shrink-0 text-emerald-600 font-black">✓</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>

        {state.regionAvailable === false ? (
          <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-xs text-amber-700">{copy.noRegion}</p>
        ) : !confirming ? (
          <div className="space-y-3">
            <label className="block text-[11px] font-bold text-slate-600" htmlFor="profile-cbat-date">{copy.label}</label>
            <input
              id="profile-cbat-date"
              type="date"
              min={new Date().toISOString().slice(0, 10)}
              value={date}
              onChange={e => { setDate(e.target.value); setError('') }}
              className="w-full rounded-xl bg-surface border border-slate-200 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 transition-all"
            />
            {date && (
              <div key={date} role="alert" className="cbat-date-warning rounded-xl border border-amber-400/70 bg-gradient-to-r from-amber-500/8 via-amber-500/14 to-amber-500/8 px-3 py-2.5 shadow-[0_10px_30px_rgba(245,158,11,.14),inset_0_1px_0_rgba(251,191,36,.12)]">
                <div className="relative z-10 flex items-center gap-2.5 text-left">
                  <span aria-hidden="true" className="cbat-date-warning-icon grid h-7 w-7 shrink-0 place-items-center rounded-full border border-amber-400/60 bg-amber-500/15 text-xs font-black text-amber-600">!</span>
                  <div>
                    <p className="text-xs font-black text-amber-600">{copy.warning}</p>
                    <p className="mt-0.5 text-[10px] font-semibold text-amber-600/90">{copy.warningHint}</p>
                  </div>
                </div>
              </div>
            )}
            <button type="button" disabled={!date} onClick={() => setConfirming(true)} className="w-full rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white text-xs font-extrabold py-2.5 shadow-[0_10px_24px_rgba(37,99,235,.22)] transition-all">Continue</button>
          </div>
        ) : (
          <div className="rounded-2xl border border-brand-400/30 bg-surface/80 backdrop-blur px-4 py-4 shadow-xl">
            <p className="text-xs text-slate-500">{copy.confirmTitle}</p>
            <p className="text-xl font-black text-slate-800 my-1">{formatCohortDate(date)}</p>
            <p className="text-[11px] font-semibold text-amber-600 mb-4">{copy.confirmNote}</p>
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="flex-1 rounded-xl border border-slate-200 py-2 text-xs font-bold text-slate-600 hover:border-brand-400 transition-colors">Back</button>
              <button type="button" disabled={busy} onClick={join} className="flex-[1.5] rounded-xl bg-brand-600 hover:bg-brand-700 py-2 text-xs font-extrabold text-white disabled:opacity-50 transition-colors">{busy ? copy.joining : copy.joinButton}</button>
            </div>
          </div>
        )}
        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
      </div>
    </section>
  )
}
