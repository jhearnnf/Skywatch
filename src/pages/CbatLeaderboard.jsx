import { useState, useEffect } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import SEO from '../components/SEO'
import PlaneTurnModeToggle from '../components/PlaneTurnModeToggle'
import LeaderboardRow, { rowCols } from '../components/LeaderboardRow'
import { CBAT_LEADERBOARD_CONFIG } from '../data/cbatGames'

const TABS = [
  { key: 'weekly',   label: 'This Week' },
  { key: 'all-time', label: 'All Time' },
]

function fmtCountdown(resetsAt) {
  if (!resetsAt) return null
  const ms = new Date(resetsAt).getTime() - Date.now()
  if (!Number.isFinite(ms) || ms <= 0) return null
  const mins = Math.floor(ms / 60000)
  const d = Math.floor(mins / (60 * 24))
  const h = Math.floor((mins % (60 * 24)) / 60)
  return d > 0 ? `${d}d ${h}h` : `${h}h ${mins % 60}m`
}

export default function CbatLeaderboard() {
  const { gameKey } = useParams()
  const navigate = useNavigate()
  const { user, apiFetch, API } = useAuth()
  const reduce = useReducedMotion()

  const [tab, setTab] = useState('weekly')           // 'weekly' (default) | 'all-time'
  const [boards, setBoards] = useState({})           // { weekly: {...}, 'all-time': {...} }
  const [loading, setLoading] = useState({})         // per-period in-flight flag

  const cfg = CBAT_LEADERBOARD_CONFIG[gameKey]
  const planeTurnMode = cfg?.planeTurnMode ?? null

  // Reset cached boards whenever the game changes.
  useEffect(() => { setBoards({}); setLoading({}); setTab('weekly') }, [gameKey])

  // Lazily fetch the active tab's board (weekly on mount, all-time on first switch).
  useEffect(() => {
    if (!user || !cfg) return
    if (boards[tab] || loading[tab]) return
    setLoading(l => ({ ...l, [tab]: true }))
    apiFetch(`${API}/api/games/cbat/${gameKey}/leaderboard?period=${tab}`)
      .then(r => r.json())
      .then(d => setBoards(b => ({ ...b, [tab]: d.data || { leaderboard: [], myBest: null } })))
      .catch(() => setBoards(b => ({ ...b, [tab]: { leaderboard: [], myBest: null } })))
      .finally(() => setLoading(l => ({ ...l, [tab]: false })))
  }, [user, gameKey, tab])  // eslint-disable-line react-hooks/exhaustive-deps

  const handlePlaneTurnModeChange = (nextMode) => navigate(`/cbat/plane-turn-${nextMode}/leaderboard`)

  // Swipe between tabs on touch (segmented control remains the source of truth).
  const onDragEnd = (_e, info) => {
    if (info.offset.x < -60 && tab === 'weekly') setTab('all-time')
    else if (info.offset.x > 60 && tab === 'all-time') setTab('weekly')
  }

  if (!cfg) {
    return (
      <div className="text-center py-20">
        <p className="text-4xl mb-3">❓</p>
        <p className="font-bold text-slate-800">Unknown game</p>
        <Link to="/cbat" className="text-sm text-brand-300 hover:text-brand-200 mt-2 inline-block">Back to CBAT</Link>
      </div>
    )
  }

  const board = boards[tab]
  const isLoading = loading[tab] || !board
  const isWeekly = tab === 'weekly'
  const countdown = isWeekly ? fmtCountdown(board?.resetsAt) : null

  const cols = rowCols(tab, cfg)
  const mode3d = planeTurnMode === '3d'

  const myBest = board?.myBest
  const myBestOutsideTop = myBest && !(board?.leaderboard || []).find(e => e.userId === myBest.userId)

  return (
    <div className="cbat-leaderboard-page">
      <SEO title={`${cfg.title} Leaderboard — CBAT`} description={`Top scores for ${cfg.title}`} />

      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Link to={cfg.backPath} className="text-slate-500 hover:text-brand-400 transition-colors text-sm">&larr; Instructions</Link>
          <h1 className="text-sm font-extrabold text-slate-900">{cfg.emoji} {cfg.title} Leaderboard</h1>
        </div>
        {planeTurnMode && <PlaneTurnModeToggle value={planeTurnMode} onChange={handlePlaneTurnModeChange} />}
      </div>

      {/* Weekly / All-Time segmented control (source of truth; swipe is an accelerator) */}
      <div className="w-full max-w-lg mx-auto mb-3">
        <div className="flex bg-[#060e1a] border border-[#1a3a5c] rounded-lg p-0.5" role="tablist">
          {TABS.map(t => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${
                tab === t.key ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-[#ddeaf8]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-slate-500 mt-1.5 text-center">
          {isWeekly
            ? <>Points add up across every run this week{countdown ? ` · resets in ${countdown}` : ''}</>
            : planeTurnMode
              ? `All-time best ${planeTurnMode === '3d' ? '3D' : '2D'} scores · fewest rotations through 5 levels`
              : 'All-time best scores'}
        </p>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-brand-400 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-sm text-slate-400">Loading leaderboard...</p>
        </div>
      ) : (
        <motion.div
          key={tab}
          initial={reduce ? false : { opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          drag={reduce ? false : 'x'}
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.15}
          onDragEnd={onDragEnd}
          className="w-full max-w-lg mx-auto"
        >
          {(board.leaderboard || []).length === 0 ? (
            <div className="bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-8 text-center">
              <p className="text-4xl mb-3">🏆</p>
              <p className="font-bold text-white mb-1">{isWeekly ? 'No scores yet this week' : 'No scores yet'}</p>
              <p className="text-sm text-slate-400 mb-4">Be the first to set a score!</p>
              <Link to={cfg.backPath} className="inline-flex px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg text-sm transition-colors no-underline">
                Play Now
              </Link>
            </div>
          ) : (
            <div className="bg-[#0a1628] border border-[#1a3a5c] rounded-xl overflow-hidden">
              {/* Table header */}
              <div className={`grid ${cols} gap-2 px-4 py-2.5 bg-[#060e1a] border-b border-[#1a3a5c] text-[10px] text-slate-500 uppercase tracking-wide font-bold`}>
                <span>Rank</span>
                <span>Agent</span>
                {isWeekly ? (
                  <>
                    <span className="text-right">Points</span>
                    <span className="text-right">Plays</span>
                  </>
                ) : (
                  <>
                    <span className="text-right">{cfg.scoreLabel}</span>
                    {!cfg.hideTime && <span className="text-right">Time</span>}
                  </>
                )}
              </div>

              {/* Rows */}
              <div className="divide-y divide-[#1a3a5c]/50">
                {board.leaderboard.map(entry => (
                  <LeaderboardRow
                    key={entry._id}
                    entry={entry}
                    variant={tab}
                    cfg={cfg}
                    isMe={user && entry.userId === user._id}
                    mode3d={mode3d}
                  />
                ))}
              </div>

              {/* Current user outside the visible top 20 */}
              {myBestOutsideTop && (
                <>
                  <div className="px-4 py-1 text-center text-[10px] text-slate-500">···</div>
                  <LeaderboardRow entry={myBest} variant={tab} cfg={cfg} isMe divider mode3d={mode3d} />
                </>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-3 justify-center mt-5">
            <Link to={cfg.backPath} className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-lg transition-colors no-underline">
              Play {cfg.title}
            </Link>
          </div>
        </motion.div>
      )}
    </div>
  )
}
