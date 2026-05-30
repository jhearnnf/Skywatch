import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

function timeAgo(iso) {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60)        return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60)        return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24)        return `${h}h ago`
  const d = Math.round(h / 24)
  return `${d}d ago`
}

// Inline emoji lookup — avoids importing CBAT_GAMES from src/pages/Cbat.jsx
// (which itself imports this component) and keeps the side column self-contained.
const EMOJI_BY_KEY = {
  'target': '🎯', 'ant': '📡', 'symbols': '🔣', 'code-duplicates': '🧩',
  'angles': '📐', 'instruments': '🛫', 'plane-turn-2d': '🗺️', 'plane-turn-3d': '🗺️', 'flag': '🚩',
  'visualisation-2d': '🧮', 'dpt': '🛩️', 'act': '🎧', 'trace-1': '🛩️',
  'visualisation-3d': '🧊', 'dad': '🧭',
}

export default function RecentCbatScores() {
  const { apiFetch, API, user } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    function load() {
      apiFetch(`${API}/api/games/cbat/recent?limit=25`)
        .then(r => r.json())
        .then(d => {
          if (cancelled) return
          if (d.status === 'success') {
            setRows(d.data?.recent || [])
            setError(null)
          } else {
            setError(d.message || 'Failed to load')
          }
        })
        .catch(() => { if (!cancelled) setError('Failed to load') })
        .finally(() => { if (!cancelled) setLoading(false) })
    }
    load()
    const id = setInterval(load, 30000)
    return () => { cancelled = true; clearInterval(id) }
  }, [apiFetch, API])

  return (
    <div className="bg-[#0a1628] border border-[#1a3a5c] rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-[#1a3a5c] flex items-center justify-between">
        <p className="text-[11px] font-extrabold tracking-wider uppercase text-slate-500">Recent Scores</p>
        <span className="text-[10px] text-slate-500">Auto-refreshing</span>
      </div>

      {loading ? (
        <div className="px-4 py-10 text-center">
          <div className="w-6 h-6 mx-auto border-2 border-brand-400 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-xs text-slate-500">Loading recent activity…</p>
        </div>
      ) : error ? (
        <div className="px-4 py-8 text-center">
          <p className="text-xs text-slate-500">{error}</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <p className="text-xs text-slate-500">No scores yet.</p>
        </div>
      ) : (
        <div className="divide-y divide-[#1a3a5c]/50 max-h-[640px] overflow-y-auto">
          {rows.map((r) => {
            const emoji = EMOJI_BY_KEY[r.gameKey] || '🎯'
            const title = r.gameLabel || r.gameKey
            const leaderboardPath = `/cbat/${r.gameKey}/leaderboard`
            const rankBadge = r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : `#${r.rank}`
            const isMe = user && r.userId && r.userId === user._id
            return (
              <Link
                key={r._id}
                to={leaderboardPath}
                title={`${title} leaderboard`}
                className={`px-4 py-2.5 text-sm grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 items-center no-underline hover:bg-[#102040] transition-colors ${
                  isMe ? 'bg-brand-600/10 border-l-2 border-l-brand-400' : ''
                }`}
              >
                <span className={`truncate ${isMe ? 'text-brand-600 font-bold' : 'text-[#ddeaf8]'}`} title={r.email || ''}>
                  {r.displayName || r.email || `Agent ${r.agentNumber || '???'}`}{isMe ? ' (you)' : ''}
                </span>
                <span className="font-mono text-[11px] text-brand-600 shrink-0">
                  {rankBadge}
                </span>
                <span className="text-xs text-slate-400 truncate">
                  <span className="mr-1">{emoji}</span>{title}
                </span>
                <span className="text-[10px] text-slate-500 shrink-0" title={new Date(r.achievedAt).toLocaleString()}>
                  {timeAgo(r.achievedAt)}
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
