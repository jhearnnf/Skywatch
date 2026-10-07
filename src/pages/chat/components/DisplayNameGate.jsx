import { useState } from 'react'
import { useAuth } from '../../../context/AuthContext'

const DAY_MS = 24 * 60 * 60 * 1000
// Mirrors COOLDOWN_DAYS in backend/utils/displayName.js.
const COOLDOWN_MS = 30 * DAY_MS

// Shown in place of the composer when a user has no display name yet.
//
// Channels and DMs are public between users, so posting needs a name people can
// recognise — an agent number reads as anonymous and makes a conversation hard
// to follow. The first-ever set is free of the 30-day change cooldown, but the
// cooldown starts from it, so the form says so plainly rather than letting
// someone burn it on a throwaway.
export default function DisplayNameGate({ onDone }) {
  const { API, apiFetch, user, setUser } = useAuth()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState('')
  // When the server refused a save on the cooldown, the end it reported. Covers
  // a user object that is out of date (an admin cleared the name in another
  // session), so the field is not offered again only to be refused again.
  const [lockedUntil, setLockedUntil] = useState(null)

  // Someone still inside their 30-day cooldown cannot save any name, so say so
  // up front instead of letting them type one and find out on Save. Happens
  // when a name is cleared (by them or an admin) without the cooldown reset.
  const changedAt = user?.displayNameChangedAt ? new Date(user.displayNameChangedAt).getTime() : 0
  const unlockAt  = Math.max(changedAt ? changedAt + COOLDOWN_MS : 0, lockedUntil ?? 0)
  const daysLeft  = Math.ceil(Math.max(0, unlockAt - Date.now()) / DAY_MS)

  const submit = async () => {
    const value = name.trim()
    if (!value || busy) return
    setBusy(true); setErr('')
    try {
      const r = await apiFetch(`${API}/api/users/me/display-name`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: value }),
      })
      const d = await r.json().catch(() => null)
      if (r.status === 429 && d?.retryAfterMs > 0) {
        setLockedUntil(Date.now() + d.retryAfterMs)
        return
      }
      if (!r.ok) throw new Error(d?.message || 'Could not set that name')
      setUser(u => (u ? { ...u, displayName: value } : u))
      onDone?.(value)
    } catch (e) {
      setErr(e.message || 'Could not set that name')
    } finally {
      setBusy(false)
    }
  }

  // Styled as a setup step, matching the lounge's "choose your test date" card,
  // so it cannot be mistaken for the message box it stands in for.
  return (
    <div className="relative overflow-hidden p-4">
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_85%_0%,rgba(59,130,246,.22),transparent_55%),radial-gradient(circle_at_0%_100%,rgba(99,102,241,.14),transparent_50%)]" />
      <div className="relative rounded-2xl border border-brand-400/60 bg-brand-500/10 p-4 shadow-[0_10px_30px_rgba(37,99,235,.18)]">
        <div className="flex items-start gap-3 mb-3">
          <div aria-hidden="true" className="w-10 h-10 shrink-0 rounded-xl grid place-items-center text-lg bg-brand-600 text-white shadow-[0_8px_20px_rgba(37,99,235,.35)]">✎</div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.2em] font-extrabold text-brand-500 mb-0.5">One step before you chat</p>
            <p className="text-base font-black text-slate-900 leading-tight">Choose a display name</p>
          </div>
        </div>
        {daysLeft > 0 ? (
          <>
            <p className="text-xs text-slate-600 mb-2">
              You need a name before you can post, but you changed your name recently. Names can only be changed once every 30 days.
            </p>
            <p role="status" className="text-sm font-bold text-amber-600">
              You can choose a new name in {daysLeft} {daysLeft === 1 ? 'day' : 'days'}.
            </p>
          </>
        ) : (<>
        <p className="text-xs text-slate-600 mb-3">
          You need a name before you can post. Other agents will see it on your messages. You can change it again after 30 days.
        </p>
        <label htmlFor="display-name-gate" className="block text-[11px] font-bold text-slate-600 mb-1">Your display name</label>
        <div className="flex items-end gap-2">
          <input
            id="display-name-gate"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
            maxLength={20}
            placeholder="3 to 20 characters"
            className="flex-1 min-w-0 px-3 py-2.5 rounded-xl bg-surface border border-brand-400/60 text-slate-900 focus:border-brand-400 focus:ring-4 focus:ring-brand-500/20 outline-none text-sm transition-all"
          />
          <button
            type="button"
            onClick={submit}
            disabled={busy || !name.trim()}
            className="px-4 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-bold rounded-xl text-sm transition-colors"
          >
            Save name
          </button>
        </div>
        {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
        </>)}
      </div>
    </div>
  )
}
