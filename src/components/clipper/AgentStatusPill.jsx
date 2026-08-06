import { useState, useEffect } from 'react'

// Whether the local agent is running, and what the job queue looks like.
//
// The media stages cannot start without it, so this has to be visible before
// you click rather than after — a "Generate voice" button that queues a job
// nothing will ever pick up is worse than one that is plainly disabled.

const POLL_MS = 10000

function relativeTime(iso) {
  if (!iso) return 'never'
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`
  return `${Math.round(secs / 3600)}h ago`
}

export default function AgentStatusPill({ call }) {
  const [status, setStatus] = useState(null)
  const [failed, setFailed] = useState(false)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState(null)

  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const data = await call('/agent/status')
        if (alive) { setStatus(data); setFailed(false) }
      } catch {
        if (alive) setFailed(true)
      }
    }
    tick()
    const id = setInterval(tick, POLL_MS)
    return () => { alive = false; clearInterval(id) }
  }, [call])

  if (failed) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-500">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
        Agent status unavailable
      </span>
    )
  }

  if (!status) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-500">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-pulse" />
        Checking agent…
      </span>
    )
  }

  // No token configured is a different problem from "not running", and needs a
  // different fix, so it gets its own message rather than showing as offline.
  if (!status.configured) {
    return (
      <span
        title="Set CLIPPER_AGENT_TOKEN in backend/.env"
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-100 border border-amber-200 text-xs font-semibold text-amber-700"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
        Agent not configured
      </span>
    )
  }

  const { online, queue } = status
  const pending = (queue?.queued ?? 0) + (queue?.claimed ?? 0)

  const startAgent = async () => {
    setStarting(true)
    setStartError(null)
    try {
      await call('/agent/start', { method: 'POST' })
      // The agent takes a moment to boot and send its first heartbeat, so hold
      // the "starting" state rather than flicking back to offline in between.
      setTimeout(() => setStarting(false), 12000)
    } catch (e) {
      setStartError(e.message)
      setStarting(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span
        title={online
          ? `${status.agentId || 'agent'}${status.version ? ` v${status.version}` : ''} · last seen ${relativeTime(status.lastSeenAt)}`
          : `Last seen ${relativeTime(status.lastSeenAt)}. Start it with: npm start in clipper-agent/`}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold ${
          online
            ? 'bg-emerald-100 border-emerald-200 text-emerald-700'
            : 'bg-slate-100 border-slate-200 text-slate-500'
        }`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-emerald-500' : 'bg-slate-400'}`} />
        Agent {online ? 'online' : 'offline'}
      </span>

      {!online && (
        <button
          type="button"
          onClick={startAgent}
          disabled={starting}
          title="Launch the agent on this machine"
          className="px-2.5 py-1 rounded-lg bg-brand-600 text-white text-xs font-semibold hover:bg-brand-500 transition-colors disabled:opacity-50"
        >
          {starting ? 'Starting…' : 'Start agent'}
        </button>
      )}

      {startError && (
        <span className="text-xs text-rose-700 font-semibold" title={startError}>
          could not start
        </span>
      )}

      {pending > 0 && (
        <span className="text-xs text-slate-500">
          {pending} job{pending === 1 ? '' : 's'} pending
        </span>
      )}
      {queue?.failed > 0 && (
        <span className="text-xs text-rose-700 font-semibold">
          {queue.failed} failed
        </span>
      )}
    </span>
  )
}
