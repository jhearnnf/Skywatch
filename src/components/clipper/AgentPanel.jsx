import { useState, useEffect, useCallback, useRef } from 'react'

// The agent's control surface.
//
// Everything Clipper cannot do on the hosted server happens in a process on
// this machine, and until now the only things you could do to it were "start"
// and "read an error". That left three regular annoyances with no answer in the
// UI: an agent running code from before the last edit, a failed job whose error
// stays on screen long after the cause was fixed, and a queued job you no
// longer want.
//
// Stop is cooperative — the agent is told on its next heartbeat and finishes
// the job in hand, because a render is minutes of work that only writes its
// file at the end. Force is there for an agent that has stopped answering, and
// says plainly that it discards whatever was running.

const POLL_MS = 3000

const STATUS_STYLE = {
  queued:  'bg-slate-100 text-slate-600 border-slate-200',
  claimed: 'bg-brand-100 text-brand-700 border-brand-200',
  done:    'bg-emerald-100 text-emerald-700 border-emerald-200',
  failed:  'bg-rose-100 text-rose-700 border-rose-200',
}

function relativeTime(iso) {
  if (!iso) return 'never'
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`
  return `${Math.round(secs / 86400)}d ago`
}

function JobRow({ job, onDelete, onRetry, busy }) {
  const running = job.status === 'claimed'

  return (
    <div className="border border-slate-200 rounded-lg bg-slate-50 px-3 py-2 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wider ${STATUS_STYLE[job.status] || ''}`}>
          {job.status}
        </span>
        <span className="text-xs font-semibold text-slate-700">{job.type}</span>
        {job.scriptTitle && (
          <span className="text-xs text-slate-500 truncate max-w-[22rem]">{job.scriptTitle}</span>
        )}
        <span className="text-[11px] text-slate-500 font-mono ml-auto">
          {relativeTime(job.createdAt)}
        </span>

        {job.status === 'failed' && (
          <button
            type="button"
            onClick={() => onRetry(job._id)}
            disabled={busy}
            title="Queue it again, unchanged"
            className="text-xs text-brand-600 font-semibold hover:underline disabled:opacity-40"
          >
            Retry
          </button>
        )}

        <button
          type="button"
          onClick={() => onDelete(job._id)}
          disabled={busy || running}
          title={running ? 'Running right now - stop the agent first' : 'Remove from the queue'}
          className="text-xs text-slate-500 font-semibold hover:underline disabled:opacity-40 disabled:no-underline"
        >
          Remove
        </button>
      </div>

      {running && (
        <div className="space-y-1">
          <div className="h-1 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full bg-brand-600 transition-all duration-500" style={{ width: `${job.progress || 0}%` }} />
          </div>
          <p className="text-[11px] text-slate-500">{job.stepLabel || 'working'}</p>
        </div>
      )}

      {job.error && (
        <p className="text-[11px] text-rose-700 break-words">{job.error}</p>
      )}
    </div>
  )
}

export default function AgentPanel({ call }) {
  const [status, setStatus] = useState(null)
  const [jobs, setJobs] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [note, setNote] = useState(null)

  // Polling must not fight an in-flight action: a refresh landing between a
  // stop and its next heartbeat would flip the panel back to "online" and make
  // the button look like it did nothing.
  const busyRef = useRef(false)

  const refresh = useCallback(async () => {
    if (busyRef.current) return
    try {
      const [s, q] = await Promise.all([call('/agent/status'), call('/agent/queue')])
      setStatus(s)
      setJobs(q.jobs)
      setError(null)
    } catch (e) {
      setError(e.message)
    }
  }, [call])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, POLL_MS)
    return () => clearInterval(id)
  }, [refresh])

  const act = useCallback(async (fn, message) => {
    setBusy(true); busyRef.current = true; setError(null); setNote(null)
    try {
      const data = await fn()
      if (message) setNote(typeof message === 'function' ? message(data) : message)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false); busyRef.current = false
      await refresh()
    }
  }, [refresh])

  const online = Boolean(status?.online)
  const queue = status?.queue ?? {}

  return (
    <div className="space-y-4">
      {/* ── State ─────────────────────────────────────────────────────────── */}
      <div className="border border-slate-200 rounded-xl bg-slate-50 p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            <span className={`w-2 h-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-slate-400'}`} />
            Agent {online ? 'online' : 'offline'}
          </span>

          {status?.stopping && (
            <span className="text-xs text-amber-700 font-semibold">stopping after the current job…</span>
          )}

          <span className="text-xs text-slate-500 font-mono ml-auto">
            {status?.version ? `v${status.version}` : '—'}
            {status?.pid ? ` · pid ${status.pid}` : ''}
            {` · seen ${relativeTime(status?.lastSeenAt)}`}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => act(() => call('/agent/start', { method: 'POST' }), 'Agent starting…')}
            disabled={busy || online || status?.installed === false}
            className="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-xs font-semibold hover:bg-brand-500 transition-colors disabled:opacity-40"
          >
            Start
          </button>

          <button
            type="button"
            onClick={() => act(() => call('/agent/stop', { method: 'POST', body: JSON.stringify({}) }),
              'Stop requested - it will finish the job in hand first.')}
            disabled={busy || !online}
            className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-100 transition-colors disabled:opacity-40"
          >
            Stop
          </button>

          {/* The one that matters after editing agent code — node loads a
              module once, so an agent started before an edit keeps running the
              old copy. */}
          <button
            type="button"
            onClick={() => act(
              () => call('/agent/restart', { method: 'POST' }),
              (d) => d.interrupted
                ? `Restarted - ${d.interrupted} running job(s) were interrupted.`
                : 'Restarted. It is now running the current code.',
            )}
            disabled={busy || status?.installed === false}
            title="Stops and starts it. Needed after changing anything in clipper-agent/"
            className="px-3 py-1.5 rounded-lg border border-brand-200 text-brand-600 text-xs font-semibold hover:bg-brand-100 transition-colors disabled:opacity-40"
          >
            Restart
          </button>

          <button
            type="button"
            onClick={() => act(
              () => call('/agent/stop', { method: 'POST', body: JSON.stringify({ force: true }) }),
              'Force-stopped.',
            )}
            disabled={busy || !status?.pid}
            title="Kills the process immediately. Anything it was doing is lost."
            className="ml-auto px-3 py-1.5 rounded-lg border border-rose-200 text-rose-700 text-xs font-semibold hover:bg-rose-100 transition-colors disabled:opacity-40"
          >
            Force stop
          </button>
        </div>

        {status?.installed === false && (
          <p className="text-xs text-amber-700">
            The agent is not installed on this machine, so it cannot be started from here.
          </p>
        )}
        {status?.configured === false && (
          <p className="text-xs text-amber-700">
            CLIPPER_AGENT_TOKEN is not set, so the agent cannot authenticate.
          </p>
        )}
      </div>

      {note && (
        <p className="text-xs text-emerald-700 bg-emerald-100 border border-emerald-200 rounded-lg px-2.5 py-1.5">
          {note}
        </p>
      )}
      {error && (
        <p className="text-xs text-rose-700 bg-rose-100 border border-rose-200 rounded-lg px-2.5 py-1.5">
          {error}
        </p>
      )}

      {/* ── Queue ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Queue</p>
        <span className="text-xs text-slate-500">
          {queue.queued ?? 0} queued &middot; {queue.claimed ?? 0} running &middot;{' '}
          {queue.done ?? 0} done &middot; {queue.failed ?? 0} failed
        </span>

        <button
          type="button"
          onClick={() => act(
            () => call('/agent/jobs/clear', { method: 'POST', body: JSON.stringify({ status: 'failed' }) }),
            (d) => `Cleared ${d.deleted} failed job(s).`,
          )}
          disabled={busy || !queue.failed}
          className="ml-auto text-xs text-brand-600 font-semibold hover:underline disabled:opacity-40 disabled:no-underline"
        >
          Clear failed
        </button>
        <button
          type="button"
          onClick={() => act(
            () => call('/agent/jobs/clear', { method: 'POST', body: JSON.stringify({ status: 'done' }) }),
            (d) => `Cleared ${d.deleted} finished job(s).`,
          )}
          disabled={busy || !queue.done}
          className="text-xs text-slate-500 font-semibold hover:underline disabled:opacity-40 disabled:no-underline"
        >
          Clear finished
        </button>
      </div>

      {jobs.length === 0 ? (
        <p className="text-sm text-slate-500 py-6 text-center border border-dashed border-slate-200 rounded-xl">
          Nothing in the queue.
        </p>
      ) : (
        <div className="space-y-1.5">
          {jobs.map(job => (
            <JobRow
              key={job._id}
              job={job}
              busy={busy}
              onDelete={(id) => act(() => call(`/agent/jobs/${id}`, { method: 'DELETE' }), 'Removed.')}
              onRetry={(id) => act(() => call(`/agent/jobs/${id}/retry`, { method: 'POST' }), 'Queued again.')}
            />
          ))}
        </div>
      )}
    </div>
  )
}
