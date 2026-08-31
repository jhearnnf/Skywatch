import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'

// Admin-only "message anyone" box, pinned above the DM list.
//
// Everyone else reaches a DM by tapping a name in a channel, which only works
// for people who have posted. An admin usually arrives from the other end — a
// support ticket, a problem report, an agent number in a log — and needs to
// open a thread with someone they have never seen speak. Hence a search rather
// than another entry point into the channels.
//
// Accounts with no display name are still listed, unlike the "@" picker: an
// agent number is exactly what an admin is likely to be searching by, so
// hiding those accounts would defeat the point.
const DEBOUNCE_MS = 200

export default function AdminDmSearch({ onOpenDm }) {
  const { API, apiFetch } = useAuth()
  const [query,   setQuery]   = useState('')
  const [users,   setUsers]   = useState([])
  const [busy,    setBusy]    = useState(false)
  const [opening, setOpening] = useState(null)
  const [err,     setErr]     = useState('')
  const seq = useRef(0)

  // A leading "@" is dropped before searching. Every other mention of a
  // person in chat is written "@Name", so that is what gets typed here too,
  // and searching for the "@" as if it were part of the name found nobody.
  const trimmed = query.trim().replace(/^@+/, '').trim()

  useEffect(() => {
    if (!trimmed) { setUsers([]); setBusy(false); return }

    // Responses can land out of order, so a slow request for "ja" must not
    // overwrite the results already shown for "jack".
    const mine = ++seq.current
    setBusy(true)
    const timer = setTimeout(() => {
      apiFetch(`${API}/api/chat/admin/users/search?q=${encodeURIComponent(trimmed)}`, {
        credentials: 'include',
      })
        .then(r => (r.ok ? r.json() : null))
        .then(d => {
          if (seq.current !== mine) return
          setUsers(d?.data?.users ?? [])
          setBusy(false)
        })
        .catch(() => { if (seq.current === mine) setBusy(false) })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [API, apiFetch, trimmed])

  const open = async (user) => {
    setOpening(user._id)
    setErr('')
    try {
      await onOpenDm(user._id)
      // Clearing on success collapses the results, so the rail goes straight
      // back to being a conversation list once the thread is open.
      setQuery('')
      setUsers([])
    } catch (e) {
      setErr(e.message || 'Could not open that conversation')
    } finally {
      setOpening(null)
    }
  }

  return (
    <div className="px-3 pb-2">
      <input
        type="search"
        value={query}
        onChange={e => { setQuery(e.target.value); setErr('') }}
        placeholder="Search agents to message…"
        aria-label="Search agents to message"
        className="w-full border border-slate-300 rounded-xl px-3 py-1.5 text-xs bg-surface text-text outline-none focus:ring-2 focus:ring-brand-600/40"
      />

      {err && <p className="text-[11px] text-red-600 mt-1">{err}</p>}

      {trimmed && (
        <div className="mt-1.5 rounded-xl border border-slate-200 bg-surface max-h-56 overflow-y-auto">
          {busy && users.length === 0 ? (
            <p className="text-[11px] text-slate-400 px-3 py-2">Searching…</p>
          ) : users.length === 0 ? (
            <p className="text-[11px] text-slate-400 px-3 py-2">No agents found</p>
          ) : users.map(u => (
            <button
              key={u._id}
              type="button"
              disabled={opening === u._id}
              onClick={() => open(u)}
              className="w-full text-left px-3 py-2 flex items-center gap-2 border-b border-slate-100 last:border-b-0
                hover:bg-slate-100 disabled:opacity-50 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-slate-700 truncate">
                  {u.displayName || `Agent #${u.agentNumber ?? '—'}`}
                </p>
                {u.displayName && u.agentNumber && (
                  <p className="text-[10px] text-slate-400 truncate">Agent #{u.agentNumber}</p>
                )}
              </div>
              {u.isAdmin && <span className="text-[9px] font-semibold text-brand-600 shrink-0">Staff</span>}
              {u.chatBanned && <span className="text-[9px] font-semibold text-red-600 shrink-0">Banned</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
