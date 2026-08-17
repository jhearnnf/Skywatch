import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { CBAT_LEADERBOARD_CONFIG, CBAT_DIFFICULTY_BY_KEY } from '../data/cbatGames'
import { useCbatAdminView, withCbatView } from '../utils/cbatAdminView'

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

// Keyed by leaderboard gameKey, same as the rows the API returns. Derived from
// the shared config rather than hand-listed so a new game can't fall back to the
// generic emoji. Importing src/pages/Cbat.jsx here would cycle (it imports this
// component); src/data/cbatGames.js is pure data, so it doesn't.
const EMOJI_BY_KEY = Object.fromEntries(
  Object.entries(CBAT_LEADERBOARD_CONFIG).map(([key, cfg]) => [key, cfg.emoji])
)

// This feed shows the difficulty as its own chip rather than folded into the
// title, so it reads the shared gameKey → 'Easier' | 'Hard' table directly
// instead of going through cbatTitleWithDifficulty(). BOTH halves are chipped,
// not just Easier: a bare "FLAG" sitting next to a "FLAG · Easier" row reads as
// ambiguous rather than as Hard.

// `fill` swaps the card's own height cap for "take exactly the height my parent
// gives me". Used on the CBAT hub, where this card and the lounge chat below it
// split one viewport-tall column between them; everywhere else the card sizes
// itself and stops at 640px.
// "Top" means a score that landed inside the all-time top 20 for its game — the
// same cut the leaderboard page shows, so a row badged #14 here is a row you can
// go and find there.
const TOP_RANK_CUTOFF = 20

export default function RecentCbatScores({ fill = false }) {
  const { apiFetch, API, user } = useAuth()
  const navigate = useNavigate()
  // Agent view is the hub toggle asking for the board a player would get, so it
  // drops the admin affordances here too — emails, and the click-through into
  // that user's CBAT history.
  const adminView = useCbatAdminView()
  const isAdmin = !!user?.isAdmin && adminView
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // 'all' (everything from the last 24h) or 'top' (only runs that placed inside
  // the all-time top 20). Filtered client-side: the feed is already capped at 25
  // rows and every row carries its rank, so a second endpoint would buy nothing.
  const [view, setView] = useState('all')

  useEffect(() => {
    let cancelled = false
    function load() {
      apiFetch(withCbatView(`${API}/api/games/cbat/recent?limit=25`, adminView))
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
  }, [apiFetch, API, adminView])

  const visible = view === 'top' ? rows.filter(r => r.rank <= TOP_RANK_CUTOFF) : rows

  return (
    <div className={`bg-[#0a1628] border border-[#1a3a5c] rounded-xl overflow-hidden${
      fill ? ' h-full flex flex-col min-h-0' : ''
    }`}>
      <div className="shrink-0 px-4 py-3 border-b border-[#1a3a5c] flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2 min-w-0">
          <p className="text-[11px] font-extrabold tracking-wider uppercase text-slate-500">Recent Scores</p>
          <span className="text-[10px] text-slate-500 truncate">All-time rank</span>
        </div>
        <div className="flex shrink-0 rounded-lg border border-[#1a3a5c] overflow-hidden" role="group" aria-label="Filter recent scores">
          {[
            ['all', 'All', 'Every score from the last 24 hours'],
            ['top', 'Top', `Only scores that placed in the all-time top ${TOP_RANK_CUTOFF}`],
          ].map(([key, label, hint]) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              aria-pressed={view === key}
              title={hint}
              className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide transition-colors ${
                view === key
                  ? 'bg-brand-600/15 text-brand-600'
                  : 'text-slate-500 hover:text-slate-400 hover:bg-[#102040]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
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
      ) : visible.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <p className="text-xs text-slate-500">
            {view === 'top' && rows.length > 0
              ? `No top ${TOP_RANK_CUTOFF} scores in the last 24 hours.`
              : 'No scores yet.'}
          </p>
          {view === 'top' && rows.length > 0 && (
            <button
              type="button"
              onClick={() => setView('all')}
              className="mt-2 text-[11px] text-brand-600 hover:text-brand-700 underline underline-offset-2"
            >
              Show all recent scores
            </button>
          )}
        </div>
      ) : (
        <div className={`divide-y divide-[#1a3a5c]/50 overflow-y-auto ${
          fill ? 'flex-1 min-h-0' : 'max-h-[640px]'
        }`}>
          {visible.map((r) => {
            const emoji = EMOJI_BY_KEY[r.gameKey] || '🎯'
            const difficulty = CBAT_DIFFICULTY_BY_KEY[r.gameKey] || null
            // Split games take the base title from the shared config — the
            // backend label carries its own "(Easier)" suffix, which would read
            // twice beside the chip (and is what truncates away first).
            const title = difficulty
              ? (CBAT_LEADERBOARD_CONFIG[r.gameKey]?.title || r.gameLabel)
              : (r.gameLabel || r.gameKey)
            // Pin the All Time tab: the row is billed as the all-time board, and the
            // leaderboard page otherwise opens on This Week.
            const leaderboardPath = `/cbat/${r.gameKey}/leaderboard?period=all-time`
            const rankBadge = r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : `#${r.rank}`
            const isMe = user && r.userId && r.userId === user._id
            const agentLabel = r.displayName || r.email || `Agent ${r.agentNumber || '???'}`
            // Admins get a distinct username click target into that user's CBAT history
            // (the admin-only /cbat-game-history page, which reads the user off nav state).
            // The button sits above the stretched row link, so a normal click on the
            // name opens the history while a click anywhere else opens the leaderboard.
            const canOpenHistory = isAdmin && r.userId
            return (
              <div
                key={r._id}
                className={`relative px-4 py-2.5 text-sm grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 items-center hover:bg-[#102040] transition-colors ${
                  isMe ? 'bg-brand-600/10 border-l-2 border-l-brand-400' : ''
                }`}
              >
                {/* Whole-row target: that game's all-time leaderboard. Stretched over the
                    row so every cell but the admin username button routes here. */}
                <Link
                  to={leaderboardPath}
                  aria-label={`${title}${difficulty ? ` ${difficulty}` : ''} all-time leaderboard`}
                  className="absolute inset-0 z-0"
                />
                {canOpenHistory ? (
                  <button
                    type="button"
                    onClick={() => navigate('/cbat-game-history', {
                      state: { adminUserId: r.userId, adminUserName: agentLabel },
                    })}
                    title={`View ${agentLabel}'s CBAT history`}
                    className={`relative z-10 justify-self-start text-left truncate hover:underline ${isMe ? 'text-brand-600 font-bold' : 'text-[#ddeaf8]'}`}
                  >
                    {agentLabel}{isMe ? ' (you)' : ''}
                  </button>
                ) : (
                  <span className={`truncate ${isMe ? 'text-brand-600 font-bold' : 'text-[#ddeaf8]'}`} title={r.email || ''}>
                    {agentLabel}{isMe ? ' (you)' : ''}
                  </span>
                )}
                <span className="font-mono text-[11px] text-brand-600 shrink-0">
                  {rankBadge}
                </span>
                <span className="text-xs text-slate-400 min-w-0 flex items-center gap-1">
                  <span className="shrink-0">{emoji}</span>
                  <span className="truncate">{title}</span>
                  {difficulty && (
                    <span
                      data-difficulty={difficulty.toLowerCase()}
                      className={`shrink-0 px-1.5 py-px rounded text-[9px] font-extrabold uppercase tracking-wide ${
                        difficulty === 'Hard'
                          ? 'bg-brand-600/15 text-brand-600'
                          : 'bg-[#0c1829] border border-[#1a3a5c] text-slate-600'
                      }`}
                    >
                      {difficulty}
                    </span>
                  )}
                </span>
                <span className="text-[10px] text-slate-500 shrink-0" title={new Date(r.achievedAt).toLocaleString()}>
                  {timeAgo(r.achievedAt)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
