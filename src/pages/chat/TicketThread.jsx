import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { formatStamp, SUPPORT_LABEL } from './format'

// One problem report, read like a conversation: what you sent, then each reply
// the team chose to show you, in order. There is no composer — a ticket is a
// one-way report by design (the form says so), and the way to talk back is the
// support chat, which the footer links to.
//
// Opening it stamps the report seen, which is what takes its replies off the
// Community badge and, once the ticket is resolved, drops it from the rail.

function Bubble({ mine, author, time, children }) {
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap
        ${mine ? 'bg-brand-100 border border-brand-200 text-slate-800' : 'bg-surface-raised border border-slate-200 text-slate-800'}`}>
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
          {author} · <span className="normal-case tracking-normal font-semibold">{formatStamp(time)}</span>
        </p>
        {children}
      </div>
    </div>
  )
}

export default function TicketThread({ ticket, loading = false, onSeen, onStartSupport }) {
  const { API, apiFetch } = useAuth()
  const navigate = useNavigate()

  // Stamp it once per open, and only when there is something new to stamp:
  // the 30s rail poll re-renders this with the same ticket, and re-posting on
  // every poll would be a write for nothing.
  const stampedFor = useRef(null)
  useEffect(() => {
    if (!ticket?._id || !ticket.unread || stampedFor.current === ticket._id) return
    stampedFor.current = ticket._id
    apiFetch(`${API}/api/users/me/reports/${ticket._id}/seen`, { method: 'POST', credentials: 'include' })
      .then(() => onSeen?.())
      .catch(() => {})
  }, [ticket?._id, ticket?.unread, API, apiFetch, onSeen])

  const backButton = (
    <button
      type="button"
      onClick={() => navigate('/chat')}
      className="md:hidden shrink-0 text-slate-500 hover:text-slate-700 px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 transition-colors text-xs font-semibold"
      aria-label="Back to chat list"
    >
      ← Back
    </button>
  )

  if (!ticket) {
    return (
      <div className="flex-1 min-h-0 flex flex-col bg-surface rounded-2xl border border-slate-200 card-shadow overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
          {backButton}
          <p className="text-sm font-bold text-slate-700">Support ticket</p>
        </div>
        <div className="flex-1 flex items-center justify-center px-6 text-center">
          <p className="text-xs text-slate-400">
            {loading ? 'Loading…' : 'This ticket is no longer listed. Resolved tickets leave the rail once their last reply has been read.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div data-testid="ticket-thread" className="flex-1 min-h-0 flex flex-col bg-surface rounded-2xl border border-slate-200 card-shadow overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
        <div className="min-w-0 flex items-center gap-2">
          {backButton}
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-700 truncate">{ticket.title}</p>
            <p className="text-[11px] text-slate-400 truncate">
              Your report from {ticket.pageReported} · {ticket.solved ? 'Resolved by the SkyWatch team' : 'Open. The team will reply here.'}
            </p>
          </div>
        </div>
        <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full
          ${ticket.solved ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
          {ticket.solved ? 'Resolved' : 'Open'}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
        <Bubble mine author="You" time={ticket.time}>{ticket.description}</Bubble>
        {ticket.updates.map(u => (
          <Bubble key={u._id ?? u.time} author={SUPPORT_LABEL} time={u.time}>{u.description}</Bubble>
        ))}
        {ticket.updates.length === 0 && (
          <p className="text-center text-[11px] text-slate-400 pt-2">
            No reply yet. Reports are reviewed by the SkyWatch team, usually within 48 hours.
          </p>
        )}
      </div>

      <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between gap-3">
        <p className="text-[11px] text-slate-400">Need to add something, or reply?</p>
        <button
          type="button"
          onClick={onStartSupport}
          className="shrink-0 text-xs font-bold text-brand-600 hover:text-brand-700 underline underline-offset-2 transition-colors"
        >
          Message the team
        </button>
      </div>
    </div>
  )
}
