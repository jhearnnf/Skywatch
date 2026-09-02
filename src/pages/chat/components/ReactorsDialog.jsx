import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import Overlay from '../../../components/ui/Overlay'
import { agentLabel } from '../format'

// Who reacted to a message, grouped by emoji. Admin-only, and the button that
// opens it is only rendered for admins — members see the counts on the pills
// and nothing else, so that reacting stays cheap enough that people keep doing
// it. The names exist for moderation, not for the room.
//
// Overlay portals to document.body, so the chat panel's `overflow-hidden`
// cannot clip the list, and the list scrolls inside a fixed height rather than
// growing the card off the screen under a busy message.
export default function ReactorsDialog({ message, onClose }) {
  const { API, apiFetch } = useAuth()
  const [reactions, setReactions] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [err,       setErr]       = useState('')

  // No setLoading(true) here — the dialog is keyed on the message, so opening
  // a different one mounts a fresh dialog already in the loading state.
  useEffect(() => {
    let cancelled = false
    apiFetch(`${API}/api/chat/messages/${message._id}/reactions`, { credentials: 'include' })
      .then(async (r) => {
        const d = await r.json().catch(() => null)
        if (!r.ok) throw new Error(d?.message || 'Could not load who reacted')
        return d?.data ?? {}
      })
      .then(d => {
        if (cancelled) return
        setReactions(d.reactions ?? [])
        setLoading(false)
      })
      .catch(e => { if (!cancelled) { setErr(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [API, apiFetch, message._id])

  return (
    <Overlay onDismiss={onClose} className="flex items-center justify-center px-4">
      <div className="w-full max-w-xs bg-surface rounded-2xl border border-slate-200 card-shadow overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200">
          <p className="text-sm font-bold text-slate-700">Who reacted</p>
          <p className="text-[11px] text-slate-400 truncate">{message.body}</p>
        </div>

        <div className="max-h-64 overflow-y-auto px-4 py-2">
          {loading ? (
            <p className="text-sm text-slate-400 py-4 text-center">Loading…</p>
          ) : err ? (
            <p className="text-sm text-red-600 py-4 text-center">{err}</p>
          ) : reactions.length === 0 ? (
            <p className="text-sm text-slate-400 py-4 text-center">Nobody has reacted to this.</p>
          ) : (
            reactions.map(r => (
              <div key={r.emoji} className="py-2">
                <p className="text-[11px] font-semibold text-slate-500">
                  <span className="mr-1.5">{r.emoji}</span>{r.count}
                </p>
                <ul className="divide-y divide-slate-200">
                  {r.users.map(u => (
                    <li key={u._id} className="py-1.5 text-sm text-slate-700 truncate">
                      {agentLabel(u)}
                      {u.isAdmin && (
                        <span className="text-[10px] font-semibold text-brand-600 ml-1.5">Staff</span>
                      )}
                    </li>
                  ))}
                </ul>
                {/* A deleted account leaves its id on the message with nobody
                    to name, and a pile-on past the limit stops being listed. */}
                {r.count > r.users.length && (
                  <p className="text-[10px] text-slate-400 pt-1">
                    Naming {r.users.length} of {r.count}.
                  </p>
                )}
              </div>
            ))
          )}
        </div>

        <div className="px-4 py-3 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="w-full px-4 py-2 text-slate-600 hover:text-slate-700 border border-slate-200 hover:bg-slate-100 font-bold rounded-xl text-sm transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </Overlay>
  )
}
