import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import Overlay from '../../../components/ui/Overlay'
import { agentLabel, formatRelative, formatStamp } from '../format'

// Who has read one of your own messages. Opened by resting the pointer on the
// message for a moment — see the hover-intent timer in MessageList.
//
// Overlay portals to document.body, so the chat panel's `overflow-hidden`
// cannot clip the list, and the list itself scrolls inside a fixed height
// rather than growing the card off the screen in a busy channel.
export default function SeenByDialog({ message, onClose }) {
  const { API, apiFetch } = useAuth()
  const [readers,   setReaders]   = useState([])
  const [truncated, setTruncated] = useState(false)
  const [total,     setTotal]     = useState(0)
  const [loading,   setLoading]   = useState(true)
  const [err,       setErr]       = useState('')

  // No setLoading(true) here — the dialog is keyed on the message, so a
  // different message mounts a fresh one that already starts in the loading
  // state. Setting it synchronously in the effect would only cost a render.
  useEffect(() => {
    let cancelled = false
    apiFetch(`${API}/api/chat/messages/${message._id}/seen-by`, { credentials: 'include' })
      .then(async (r) => {
        const d = await r.json().catch(() => null)
        if (!r.ok) throw new Error(d?.message || 'Could not load who has seen this')
        return d?.data ?? {}
      })
      .then(d => {
        if (cancelled) return
        setReaders(d.readers ?? [])
        setTruncated(Boolean(d.truncated))
        setTotal(d.total ?? 0)
        setLoading(false)
      })
      .catch(e => { if (!cancelled) { setErr(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [API, apiFetch, message._id])

  return (
    <Overlay onDismiss={onClose} className="flex items-center justify-center px-4">
      <div className="w-full max-w-xs bg-surface rounded-2xl border border-slate-200 card-shadow overflow-hidden">
        {/* The message is the subject of this dialog, so it reads as the title
            and the label goes down onto the list it actually labels. "Seen by"
            sitting up here put two lines of context between a heading and the
            names it introduced, which is a heading pointing at nothing. */}
        <div className="px-4 py-3 border-b border-slate-200">
          <p className="text-sm font-semibold text-slate-700 truncate">{message.body}</p>
          {/* When it was posted, in full. "Who has read this" is a question
              about a moment, and the answer is unreadable without one: three
              readers means something different an hour after posting than it
              does a week after. formatStamp rather than the list's relative
              time, for the same reason — this is a dated record, not a line of
              conversation, so it carries the year. */}
          {message.createdAt && (
            <p className="text-[11px] text-slate-400 mt-0.5" data-testid="seen-by-posted">
              Posted {formatStamp(message.createdAt)}
            </p>
          )}
        </div>

        {/* Outside the scrolling box below, so the label stays put while a long
            list of readers moves under it. The count goes here rather than only
            in the truncation note, because "how many" is most of what this
            dialog is opened to find out. */}
        <div className="flex items-baseline justify-between gap-3 px-4 pt-3 pb-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">Seen by</p>
          {!loading && !err && total > 0 && (
            <p className="text-[10px] text-slate-400" data-testid="seen-by-count">
              {total} {total === 1 ? 'agent' : 'agents'}
            </p>
          )}
        </div>

        <div className="max-h-64 overflow-y-auto px-4 pb-2">
          {loading ? (
            <p className="text-sm text-slate-400 py-4 text-center">Loading…</p>
          ) : err ? (
            <p className="text-sm text-red-600 py-4 text-center">{err}</p>
          ) : readers.length === 0 ? (
            <p className="text-sm text-slate-400 py-4 text-center">
              {/* Neutral wording: an admin can open this on anyone's message,
                  where "since you posted" would be wrong. */}
              Nobody has opened this conversation since it was sent.
            </p>
          ) : (
            <ul className="divide-y divide-slate-200">
              {readers.map(r => (
                <li key={r._id} className="flex items-baseline justify-between gap-3 py-2">
                  <span className="text-sm text-slate-700 truncate">
                    {agentLabel(r)}
                    {r.isAdmin && (
                      <span className="text-[10px] font-semibold text-brand-600 ml-1.5">Staff</span>
                    )}
                  </span>
                  <span className="text-[10px] text-slate-400 shrink-0">{formatRelative(r.seenAt)}</span>
                </li>
              ))}
            </ul>
          )}
          {truncated && (
            <p className="text-[10px] text-slate-400 py-2 text-center">
              Showing the first {readers.length} of {total} agents.
            </p>
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
