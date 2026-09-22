import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import Overlay from '../../../components/ui/Overlay'
import { agentLabel, formatRelative, formatStamp } from '../format'

// Who has read one of your own messages, and — for an admin — what each of
// them reacted with. Opened by resting the pointer on the message for a
// moment; see the hover-intent timer in MessageList.
//
// One row per agent rather than a reader list and a reactor list side by side.
// Reacting is something a reader did, not a separate population, so splitting
// them printed the same names twice and left you matching them up by eye.
//
// Overlay portals to document.body, so the chat panel's `overflow-hidden`
// cannot clip the lists, and the body scrolls inside a fixed height rather
// than growing the card off the screen in a busy channel.
export default function SeenByDialog({ message, onClose }) {
  const { API, apiFetch, user } = useAuth()
  const [readers,   setReaders]   = useState([])
  const [truncated, setTruncated] = useState(false)
  const [total,     setTotal]     = useState(0)
  const [loading,   setLoading]   = useState(true)
  const [err,       setErr]       = useState('')

  // Reactor names are admin-only at the endpoint and stay admin-only here:
  // members see the emoji and the count on the pills and never the names, so
  // that reacting stays cheap enough that people keep doing it. And there is
  // nothing to ask the server about on a message with no pills, so a quiet
  // message spends no request and shows no empty section.
  const wantsReactions = Boolean(user?.isAdmin) && Boolean(message.reactions?.length)
  const [reactions,    setReactions]    = useState([])
  const [reactLoading, setReactLoading] = useState(wantsReactions)
  const [reactErr,     setReactErr]     = useState('')

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

  useEffect(() => {
    if (!wantsReactions) return undefined
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
        setReactLoading(false)
      })
      .catch(e => { if (!cancelled) { setReactErr(e.message); setReactLoading(false) } })
    return () => { cancelled = true }
  }, [API, apiFetch, message._id, wantsReactions])

  // The reader list and the reaction groups folded into one row per agent.
  //
  // Reactors come first and everyone else follows in most-recently-seen order
  // (the server already sorts the readers that way). Tapping an emoji is a
  // deliberate act and opening the channel is not, so the people who did
  // something are worth more than the people who were merely present.
  const rows = useMemo(() => {
    const byUser = new Map()
    reactions.forEach(r => (r.users ?? []).forEach(u => {
      const id = String(u._id)
      if (!byUser.has(id)) byUser.set(id, { user: u, emoji: [] })
      byUser.get(id).emoji.push(r.emoji)
    }))

    const out = readers.map(r => ({ ...r, emoji: byUser.get(String(r._id))?.emoji ?? [] }))

    // A reactor with no read marker: the sender reacting to their own message
    // (appendMessage marks it read for them, so seen-by leaves them out), or a
    // marker that never landed. They demonstrably saw it either way.
    const seen = new Set(readers.map(r => String(r._id)))
    byUser.forEach(({ user, emoji }, id) => {
      if (!seen.has(id)) out.push({ ...user, seenAt: null, emoji })
    })

    return out.sort((a, b) => {
      if (Boolean(a.emoji.length) !== Boolean(b.emoji.length)) return a.emoji.length ? -1 : 1
      // No marker sorts last within its group rather than reading as "just now".
      if (!a.seenAt !== !b.seenAt) return a.seenAt ? -1 : 1
      if (!a.seenAt) return 0
      return new Date(b.seenAt) - new Date(a.seenAt)
    })
  }, [readers, reactions])

  // Reactions whose reactor could not be named: a deleted account leaves its
  // id on the message, and a pile-on past the server's limit stops being
  // listed. The pill count on the message includes them, so the difference
  // needs saying rather than silently going missing.
  const unnamed = reactions.reduce((n, r) => n + ((r.count ?? 0) - (r.users?.length ?? 0)), 0)

  return (
    <Overlay onDismiss={onClose} className="flex items-center justify-center px-4">
      <div className="w-full max-w-xs bg-surface rounded-2xl border border-slate-200 card-shadow overflow-hidden">
        {/* The message is the subject of this dialog, so it reads as the title
            and the labels go down onto the lists they actually label. "Seen by"
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
            list of agents moves under it. The count goes here rather than only
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
          {/* The reactions load alongside the readers and only for an admin, so
              the list waits for both rather than rendering names and then
              shuffling them upwards as the emoji arrive. */}
          {loading || reactLoading ? (
            <p className="text-sm text-slate-400 py-4 text-center">Loading…</p>
          ) : err ? (
            <p className="text-sm text-red-600 py-4 text-center">{err}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-400 py-4 text-center">
              {/* Neutral wording: an admin can open this on anyone's message,
                  where "since you posted" would be wrong. */}
              Nobody has opened this conversation since it was sent.
            </p>
          ) : (
            <ul className="divide-y divide-slate-200">
              {rows.map(r => (
                <li key={r._id} className="flex items-baseline gap-2 py-2">
                  <span className="text-sm text-slate-700 truncate">
                    {agentLabel(r)}
                    {r.isAdmin && (
                      <span className="text-[10px] font-semibold text-brand-600 ml-1.5">Staff</span>
                    )}
                  </span>
                  {/* What this agent tapped, on their own row. Several emoji if
                      they tapped several; the order is the server's, which is
                      the order the pills render in on the message itself. */}
                  {r.emoji.length > 0 && (
                    <span className="text-[11px] leading-none shrink-0" data-testid="reacted-with">
                      {r.emoji.join(' ')}
                    </span>
                  )}
                  {/* Always rendered, so a row with no read marker behind it
                      still lines its name and emoji up with the rest. */}
                  <span className="text-[10px] text-slate-400 shrink-0 ml-auto">
                    {r.seenAt ? formatRelative(r.seenAt) : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {reactErr && (
            <p className="text-[10px] text-red-600 py-2 text-center">{reactErr}</p>
          )}
          {unnamed > 0 && (
            <p className="text-[10px] text-slate-400 py-2 text-center">
              Plus {unnamed} {unnamed === 1 ? 'reaction' : 'reactions'} we cannot put a name to.
            </p>
          )}
          {truncated && (
            <p className="text-[10px] text-slate-400 py-2 text-center">
              Showing the {readers.length} most recent of {total} agents.
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
