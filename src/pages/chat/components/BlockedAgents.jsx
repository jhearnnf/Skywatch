import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { agentLabel } from '../format'

// The undo for a block, and the only one there is.
//
// It lives in Profile rather than in Community for a practical reason: blocking
// someone removes their messages from every channel you read, so the message
// you blocked them from is exactly the place you can no longer reach them. A
// list somewhere stable is what stops a block being permanent by accident.
//
// The panel renders even when the list is empty. An empty state that says
// nobody is blocked is worth more than a panel that appears out of nowhere the
// first time you block someone — this is where people come to look for it.
export default function BlockedAgents() {
  const { API, apiFetch } = useAuth()
  const [blocked, setBlocked] = useState(null)   // null = still loading
  const [busyId,  setBusyId]  = useState(null)
  const [err,     setErr]     = useState('')

  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`${API}/api/chat/blocks`, { credentials: 'include' })
      const d = await r.json().catch(() => null)
      if (!r.ok) throw new Error(d?.message || 'Could not load your blocked agents')
      setBlocked(d?.data?.blocked ?? [])
    } catch (e) {
      setErr(e.message || 'Could not load your blocked agents')
      setBlocked([])
    }
  }, [API, apiFetch])

  useEffect(() => { load() }, [load])

  const unblock = async (id) => {
    setBusyId(id); setErr('')
    try {
      const r = await apiFetch(`${API}/api/chat/users/${id}/block`, {
        method: 'DELETE', credentials: 'include',
      })
      if (!r.ok) {
        const d = await r.json().catch(() => null)
        throw new Error(d?.message || 'Could not unblock that agent')
      }
      // Dropped locally rather than by refetching: the row is gone either way,
      // and a refetch would blank the whole list for a moment on a slow phone.
      setBlocked(prev => (prev ?? []).filter(u => String(u._id) !== String(id)))
    } catch (e) {
      setErr(e.message || 'Could not unblock that agent')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="bg-surface rounded-2xl border border-slate-200 p-4 card-shadow">
      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Blocked Agents</p>
      <p className="text-[11px] text-slate-400 mb-3">
        You do not see messages from a blocked agent, and neither of you can send the other a
        direct message. They are not told. Block someone by tapping their name in Community.
      </p>

      {err && <p className="text-xs text-red-600 mb-2">{err}</p>}

      {blocked === null ? (
        <p className="text-[11px] text-slate-400">Loading…</p>
      ) : blocked.length === 0 ? (
        <p className="text-[11px] text-slate-400">You have not blocked anyone.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {blocked.map(u => (
            <li key={u._id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-700 truncate">{agentLabel(u)}</p>
                {u.agentNumber && (
                  <p className="text-[11px] text-slate-400">Agent #{u.agentNumber}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => unblock(u._id)}
                disabled={busyId === u._id}
                className="shrink-0 px-3 py-1.5 text-brand-600 hover:text-brand-700 border border-slate-200 hover:bg-slate-100 disabled:opacity-50 font-bold rounded-xl text-xs transition-colors"
              >
                {busyId === u._id ? 'Unblocking…' : 'Unblock'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
