import { useState } from 'react'
import { useAuth } from '../../../context/AuthContext'

export default function CbatGroupSetup({ state, onJoined, onCancel }) {
  const { API } = useAuth()
  const [date, setDate] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const join = async () => {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${API}/api/chat/cbat-group`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }),
      })
      const json = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(json.message || 'Could not join your CBAT group.')
      onJoined?.(json.data)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex-1 min-h-0 bg-surface rounded-2xl border border-slate-200 card-shadow overflow-y-auto relative">
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_80%_10%,rgba(59,130,246,.12),transparent_42%),radial-gradient(circle_at_10%_90%,rgba(99,102,241,.08),transparent_38%)]" />
      <div className="relative min-h-full max-w-md mx-auto px-6 py-8 flex flex-col justify-center">
        {onCancel && <button type="button" onClick={onCancel} className="md:hidden self-start mb-5 text-xs font-bold text-slate-500 hover:text-brand-600">← Groups</button>}
        <div className="w-12 h-12 mb-4 rounded-2xl grid place-items-center text-xl bg-brand-600 text-white shadow-[0_12px_30px_rgba(37,99,235,.28)]">✈</div>
        {state?.applicable === false ? (
          <>
            <p className="text-[10px] uppercase tracking-[0.2em] font-extrabold text-emerald-600 mb-2">CBAT complete</p>
            <h2 className="text-xl font-black text-slate-800">You’ve already passed your CBAT</h2>
            <p className="text-sm text-slate-500 mt-2">Upcoming-date groups are for applicants preparing to attend. If a date was already recorded for you, your original group is added automatically.</p>
          </>
        ) : (
          <>
            <p className="text-[10px] uppercase tracking-[0.2em] font-extrabold text-brand-600 mb-2">Private CBAT group</p>
            <h2 className="text-xl font-black text-slate-800 leading-tight">Meet applicants attending with you.</h2>
            <p className="text-sm leading-relaxed text-slate-500 mt-2 mb-6">Enter your upcoming CBAT date to join applicants with the same date in your region. Your date is only visible to people in that private group.</p>
            {state?.regionAvailable === false ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-700">We could not determine your region yet. Refresh the app and try again.</p>
            ) : !confirming ? (
              <div className="space-y-3">
                <label className="block text-xs font-bold text-slate-600" htmlFor="community-cbat-date">Upcoming CBAT date</label>
                <input id="community-cbat-date" type="date" min={new Date().toISOString().slice(0, 10)} value={date} onChange={e => { setDate(e.target.value); setError('') }} className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 transition-all" />
                {date && (
                  <div key={date} role="alert" className="cbat-date-warning rounded-xl border border-amber-400/70 bg-gradient-to-r from-amber-50 via-amber-100/80 to-amber-50 px-3 py-2.5 shadow-[0_10px_30px_rgba(245,158,11,.16),inset_0_1px_0_rgba(255,255,255,.7)]">
                    <div className="relative z-10 flex items-center gap-2.5 text-left">
                      <span aria-hidden="true" className="cbat-date-warning-icon grid h-8 w-8 shrink-0 place-items-center rounded-full border border-amber-400/60 bg-amber-200/60 text-amber-700">!</span>
                      <div>
                        <p className="text-sm font-black text-amber-800">Choose carefully — you cannot change this date.</p>
                        <p className="mt-0.5 text-xs font-semibold text-amber-700">Check it before you click Continue.</p>
                      </div>
                    </div>
                  </div>
                )}
                <button type="button" disabled={!date} onClick={() => setConfirming(true)} className="w-full rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white text-sm font-extrabold py-2.5 shadow-[0_10px_24px_rgba(37,99,235,.2)] transition-all">Continue</button>
              </div>
            ) : (
              <div className="rounded-2xl border border-brand-200 bg-white/80 backdrop-blur px-4 py-4 shadow-lg">
                <p className="text-xs text-slate-500">Confirm your CBAT date</p>
                <p className="text-xl font-black text-slate-800 my-1">{new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))}</p>
                <p className="text-xs font-semibold text-amber-700 mb-4">This cannot be changed after you confirm.</p>
                <div className="flex gap-2">
                  <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="flex-1 rounded-xl border border-slate-200 py-2 text-sm font-bold text-slate-600">Back</button>
                  <button type="button" disabled={busy} onClick={join} className="flex-[1.5] rounded-xl bg-brand-600 py-2 text-sm font-extrabold text-white disabled:opacity-50">{busy ? 'Joining…' : 'Confirm & join'}</button>
                </div>
              </div>
            )}
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          </>
        )}
      </div>
    </div>
  )
}
