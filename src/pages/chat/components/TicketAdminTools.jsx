import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { AdminToolSection } from '../../../components/AdminToolPanel'

const fmtDuration = (sec) => {
  if (!Number.isFinite(sec)) return null
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`
}

const fmtWhen = (iso) => {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// The switch that lets the user side send photos and videos. Turning it on
// posts a message in the chat asking for anything that shows the issue.
export function MediaPermissionToggle({ conversationId, media, onChanged }) {
  const { API, apiFetch } = useAuth()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  if (!media?.canToggle) return null

  const flip = async () => {
    setBusy(true); setErr('')
    try {
      const r = await apiFetch(`${API}/api/chat/conversations/${conversationId}/media-permission`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowed: !media.allowed }),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok) throw new Error(d?.message || 'Could not change that.')
      onChanged?.(d.data.media)
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-testid="media-permission">
      <button
        type="button"
        onClick={flip}
        disabled={busy}
        aria-pressed={media.allowed}
        className={`w-full px-3 py-2 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 ${media.allowed
          ? 'border border-slate-200 text-slate-600 hover:bg-slate-100'
          : 'bg-brand-600 hover:bg-brand-700 text-white'}`}
      >
        {media.allowed ? 'Stop user uploaded content for this chat' : 'Allow user uploaded content for this chat'}
      </button>
      <p className="mt-1 text-[11px] text-slate-500">
        {media.allowed
          ? 'The user can send photos and videos here. Turning this off stops new uploads; files already sent stay.'
          : 'The user cannot send photos or videos yet. Turning this on asks them in the chat to send any that show the issue.'}
      </p>
      {err && <p className="mt-1 text-[11px] text-red-600">{err}</p>}
    </div>
  )
}

// The PostHog recording the user was in when they reported, and their
// earlier sessions. Admin-only: the server never sends `replay` to anyone
// else. Links open in PostHog itself.
export function ReplayLinks({ replay }) {
  const [showEarlier, setShowEarlier] = useState(true)
  if (!replay) return null
  const earlier = replay.earlier ?? { status: 'pending', sessions: [] }

  return (
    <div className="space-y-2" data-testid="replay-links">
      {replay.recording && replay.url ? (
        <a
          href={replay.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full text-center px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold transition-colors"
        >
          Watch session replay
        </a>
      ) : (
        <p className="text-[11px] text-slate-500">
          No recording for this report. PostHog was not recording, often because of an ad blocker.
        </p>
      )}
      {replay.recording && (
        <p className="text-[11px] text-slate-500">
          Starts about 30 seconds before they reported. If the end is missing, wait a minute and open it again.
        </p>
      )}

      <div>
        <button
          type="button"
          onClick={() => setShowEarlier(s => !s)}
          className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 hover:text-slate-700"
          aria-expanded={showEarlier}
        >
          Earlier sessions {showEarlier ? '▾' : '▸'}
        </button>
        {showEarlier && (
          earlier.status === 'pending' ? (
            <p className="mt-1 text-[11px] text-slate-500">Loading earlier sessions…</p>
          ) : earlier.status === 'unconfigured' ? (
            <p className="mt-1 text-[11px] text-slate-500">
              Earlier sessions need the PostHog API key on the server.
            </p>
          ) : earlier.status === 'failed' ? (
            <p className="mt-1 text-[11px] text-slate-500">Couldn't load earlier sessions.</p>
          ) : !earlier.sessions.length ? (
            <p className="mt-1 text-[11px] text-slate-500">No other sessions in the last 7 days.</p>
          ) : (
            <ul className="mt-1 space-y-1.5">
              {earlier.sessions.map(s => (
                <li key={s.sessionId} className="text-[11px]">
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-brand-600 hover:text-brand-700"
                  >
                    {fmtWhen(s.startedAt)}
                    {fmtDuration(s.durationSec) ? ` · ${fmtDuration(s.durationSec)}` : ''}
                  </a>
                  {s.matchesReport && (
                    <span className="ml-1.5 text-[9px] font-bold px-1.5 py-px rounded-full bg-amber-100 text-amber-800">
                      Visited reported page
                    </span>
                  )}
                  {s.pages?.length > 0 && (
                    <p className="text-slate-500 truncate" title={s.pages.join(', ')}>{s.pages.join(', ')}</p>
                  )}
                </li>
              ))}
            </ul>
          )
        )}
      </div>
    </div>
  )
}

// Both, as sections of the page's Admin tools panel.
export default function TicketAdminTools({ conversationId, conversation, onMediaChanged }) {
  const media = conversation?.media
  const hasReplay = conversation && 'replay' in conversation
  if (!media?.canToggle && !hasReplay) return null
  return (
    <>
      {media?.canToggle && (
        <AdminToolSection title="Photos and videos">
          <MediaPermissionToggle conversationId={conversationId} media={media} onChanged={onMediaChanged} />
        </AdminToolSection>
      )}
      {hasReplay && (
        <AdminToolSection title="Session replay">
          {conversation.replay
            ? <ReplayLinks replay={conversation.replay} />
            : <p className="text-[11px] text-slate-500">No session details were sent with this ticket.</p>}
        </AdminToolSection>
      )}
    </>
  )
}

// How much of the free Cloudinary plan is in use. Credits are the plan's one
// limit, shared by storage, bandwidth and transformations across the whole
// account (brief images included), so that is the number that matters.
export function MediaUsageReadout() {
  const { API, apiFetch } = useAuth()
  const [usage, setUsage] = useState(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    apiFetch(`${API}/api/chat/admin/media-usage`, { credentials: 'include', quiet: true })
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => { if (!cancelled) setUsage(d.data) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [API, apiFetch])

  if (failed) return <p className="text-[10px] text-slate-400" data-testid="media-usage">Cloudinary usage unavailable</p>
  if (!usage) return null
  const pct = Number.isFinite(usage.creditsPercent) ? Math.round(usage.creditsPercent) : null
  return (
    <p
      className={`text-[10px] ${pct !== null && pct >= 80 ? 'text-amber-700 font-semibold' : 'text-slate-400'}`}
      data-testid="media-usage"
      title="Cloudinary credits this month, shared by storage, bandwidth and transformations"
    >
      Cloudinary: {usage.creditsUsed ?? '?'} of {usage.creditsLimit ?? '?'} credits used
      {pct !== null ? ` (${pct}%)` : ''} · {usage.chatFiles ?? 0} chat files
    </p>
  )
}
