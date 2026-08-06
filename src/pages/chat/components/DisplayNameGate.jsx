import { useState } from 'react'
import { useAuth } from '../../../context/AuthContext'

// Shown in place of the composer when a user has no display name yet.
//
// Channels and DMs are public between users, so posting needs a name people can
// recognise — an agent number reads as anonymous and makes a conversation hard
// to follow. The first-ever set is free of the 30-day change cooldown, but the
// cooldown starts from it, so the form says so plainly rather than letting
// someone burn it on a throwaway.
export default function DisplayNameGate({ onDone }) {
  const { API, apiFetch, setUser } = useAuth()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState('')

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
      if (!r.ok) throw new Error(d?.message || 'Could not set that name')
      setUser(u => (u ? { ...u, displayName: value } : u))
      onDone?.(value)
    } catch (e) {
      setErr(e.message || 'Could not set that name')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-t border-slate-200 p-4">
      <p className="text-sm font-bold text-slate-700 mb-1">Choose a display name</p>
      <p className="text-xs text-slate-500 mb-3">
        Other agents will see this name on your messages. You can change it again after 30 days.
      </p>
      <div className="flex items-end gap-2">
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
          maxLength={20}
          placeholder="3–20 characters"
          className="flex-1 px-3 py-2 rounded-xl border border-slate-200 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none text-sm"
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy || !name.trim()}
          className="px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-bold rounded-xl text-sm transition-colors"
        >
          Save
        </button>
      </div>
      {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
    </div>
  )
}
