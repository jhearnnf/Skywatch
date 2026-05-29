import { useState, useEffect } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import SEO from '../components/SEO'
import PlaneTurnModeToggle from '../components/PlaneTurnModeToggle'

// ── Game config — add new CBAT games here ────────────────────────────────────
const GAME_CONFIG = {
  'plane-turn-2d': {
    title: 'Trace Practise 2D',
    emoji: '\u{1F5FA}\uFE0F',
    scoreLabel: 'Rotations',
    lowerIsBetter: true,
    formatScore: (s) => `${s}`,
    backPath: '/cbat/trace',
    planeTurnMode: '2d',
  },
  'plane-turn-3d': {
    title: 'Trace Practise 3D',
    emoji: '\u{1F5FA}\uFE0F',
    scoreLabel: 'Rotations',
    lowerIsBetter: true,
    formatScore: (s) => `${s}`,
    backPath: '/cbat/trace',
    planeTurnMode: '3d',
  },
  'trace-1': {
    title: 'Trace 1',
    emoji: '\u{1F6E9}\uFE0F',
    scoreLabel: 'Correct',
    lowerIsBetter: false,
    formatScore: (s) => `${s}/40`,
    backPath: '/cbat/trace',
    hideTime: true,
  },
  'angles': {
    title: 'Angles',
    emoji: '\u{1F4D0}',
    scoreLabel: 'Correct',
    lowerIsBetter: false,
    formatScore: (s) => `${s}/20`,
    backPath: '/cbat/angles',
  },
  'code-duplicates': {
    title: 'Code Duplicates',
    emoji: '\u{1F9E9}',
    scoreLabel: 'Correct',
    lowerIsBetter: false,
    formatScore: (s) => `${s}/15`,
    backPath: '/cbat/code-duplicates',
  },
  'symbols': {
    title: 'Symbols',
    emoji: '\u{1F523}',
    scoreLabel: 'Correct',
    lowerIsBetter: false,
    formatScore: (s) => `${s}/15`,
    backPath: '/cbat/symbols',
  },
  'target': {
    title: 'Target',
    emoji: '\u{1F3AF}',
    scoreLabel: 'Score',
    lowerIsBetter: false,
    formatScore: (s) => `${s}`,
    backPath: '/cbat/target',
    hideTime: true,
  },
  'instruments': {
    title: 'Instruments',
    emoji: '\u{1F6EB}',
    scoreLabel: 'Correct',
    lowerIsBetter: false,
    formatScore: (s) => `${s}`,
    backPath: '/cbat/instruments',
    hideTime: true,
  },
  'ant': {
    title: 'ANT',
    emoji: '\u{1F4E1}',
    scoreLabel: 'Points',
    lowerIsBetter: false,
    formatScore: (s) => `${s}`,
    backPath: '/cbat/ant',
  },
  'flag': {
    title: 'FLAG',
    emoji: '\u{1F6A9}',
    scoreLabel: 'Score',
    lowerIsBetter: false,
    formatScore: (s) => `${s}`,
    backPath: '/cbat/flag',
    hideTime: true,
  },
  'visualisation-2d': {
    title: 'Visualisation 2D',
    emoji: '\u{1F9EE}',
    scoreLabel: 'Correct',
    lowerIsBetter: false,
    formatScore: (s) => `${s}/8`,
    backPath: '/cbat/visualisation',
  },
  'visualisation-3d': {
    title: 'Visualisation 3D',
    emoji: '\u{1F9CA}',
    scoreLabel: 'Correct',
    lowerIsBetter: false,
    formatScore: (s) => `${s}/8`,
    backPath: '/cbat/visualisation',
  },
  'dpt': {
    title: 'DPT',
    emoji: '\u{1F6E9}️',
    scoreLabel: 'Score',
    lowerIsBetter: false,
    formatScore: (s) => `${s}`,
    backPath: '/cbat/dpt',
  },
  'act': {
    title: 'ACT',
    emoji: '\u{1F3A7}',
    scoreLabel: 'Score',
    lowerIsBetter: false,
    formatScore: (s) => `${s}`,
    backPath: '/cbat/act',
    hideTime: true,
  },
  'numerical-ops': {
    title: 'Numerical Operations',
    emoji: '\u{1F9EE}',
    scoreLabel: 'Correct %',
    lowerIsBetter: false,
    formatScore: (s) => `${s}%`,
    backPath: '/cbat/numerical-ops',
  },
}

export default function CbatLeaderboard() {
  const { gameKey } = useParams()
  const navigate = useNavigate()
  const { user, apiFetch, API } = useAuth()
  const [leaderboard, setLeaderboard] = useState([])
  const [myBest, setMyBest] = useState(null)
  const [loading, setLoading] = useState(true)

  const cfg = GAME_CONFIG[gameKey]
  const planeTurnMode = cfg?.planeTurnMode ?? null

  useEffect(() => {
    if (!user || !cfg) return
    setLoading(true)
    apiFetch(`${API}/api/games/cbat/${gameKey}/leaderboard`)
      .then(r => r.json())
      .then(d => {
        setLeaderboard(d.data?.leaderboard || [])
        setMyBest(d.data?.myBest || null)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [user, gameKey])

  // Plane Turn 2D and 3D are separate leaderboard URLs; the inline toggle
  // navigates between them so users can flip without going back to the hub.
  const handlePlaneTurnModeChange = (nextMode) => {
    navigate(`/cbat/plane-turn-${nextMode}/leaderboard`)
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

  const myBestOutsideTop = myBest && !leaderboard.find(e => e.userId === myBest.userId)

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

      {planeTurnMode && (
        <p className="text-[11px] text-slate-500 mb-2">Showing {planeTurnMode === '3d' ? '3D' : '2D'} scores · best rotations through 5 levels</p>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-brand-400 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-sm text-slate-400">Loading leaderboard...</p>
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-lg mx-auto"
        >
          {leaderboard.length === 0 ? (
            <div className="bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-8 text-center">
              <p className="text-4xl mb-3">🏆</p>
              <p className="font-bold text-white mb-1">No scores yet</p>
              <p className="text-sm text-slate-400 mb-4">Be the first to set a score!</p>
              <Link
                to={cfg.backPath}
                className="inline-flex px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg text-sm transition-colors no-underline"
              >
                Play Now
              </Link>
            </div>
          ) : (
            <div className="bg-[#0a1628] border border-[#1a3a5c] rounded-xl overflow-hidden">
              {/* Table header */}
              <div className={`grid ${cfg.hideTime ? 'grid-cols-[3rem_1fr_5rem]' : 'grid-cols-[3rem_1fr_5rem_4.5rem]'} gap-2 px-4 py-2.5 bg-[#060e1a] border-b border-[#1a3a5c] text-[10px] text-slate-500 uppercase tracking-wide font-bold`}>
                <span>Rank</span>
                <span>Agent</span>
                <span className="text-right">{cfg.scoreLabel}</span>
                {!cfg.hideTime && <span className="text-right">Time</span>}
              </div>

              {/* Rows */}
              <div className="divide-y divide-[#1a3a5c]/50">
                {leaderboard.map((entry) => {
                  const isMe = user && entry.userId === user._id
                  const achievedAtTitle = entry.achievedAt
                    ? new Date(entry.achievedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
                    : null
                  return (
                    <div
                      key={entry._id}
                      className={`grid ${cfg.hideTime ? 'grid-cols-[3rem_1fr_5rem]' : 'grid-cols-[3rem_1fr_5rem_4.5rem]'} gap-2 px-4 py-2.5 text-sm ${
                        isMe ? 'bg-brand-600/10 border-l-2 border-l-brand-400' : ''
                      }`}
                    >
                      <span className="font-mono font-bold text-slate-400">
                        {entry.rank <= 3 ? ['🥇', '🥈', '🥉'][entry.rank - 1] : `#${entry.rank}`}
                      </span>
                      <span
                        className={`truncate ${achievedAtTitle ? 'cursor-help' : ''} ${isMe ? 'text-brand-600 font-bold' : 'text-[#ddeaf8]'}`}
                        {...(achievedAtTitle ? { title: achievedAtTitle } : {})}
                      >
                        {entry.displayName || (entry.email ? entry.email : `Agent ${entry.agentNumber || '???'}`)}{isMe ? ' (you)' : ''}
                      </span>
                      <span className="text-right font-mono font-bold text-brand-600">
                        {cfg.formatScore(entry.bestScore)}
                        {planeTurnMode === '3d' && (
                          <span className="ml-1 text-[8px] font-bold px-1 py-0.5 rounded bg-brand-600/80 text-white leading-none align-middle">3D</span>
                        )}
                      </span>
                      {!cfg.hideTime && (
                        <span className="text-right font-mono text-slate-400">
                          {entry.bestTime.toFixed(1)}s
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Current user outside top 20 */}
              {myBestOutsideTop && (
                <>
                  <div className="px-4 py-1 text-center text-[10px] text-slate-500">···</div>
                  <div className={`grid ${cfg.hideTime ? 'grid-cols-[3rem_1fr_5rem]' : 'grid-cols-[3rem_1fr_5rem_4.5rem]'} gap-2 px-4 py-2.5 text-sm bg-brand-600/10 border-l-2 border-l-brand-400 border-t border-[#1a3a5c]`}>
                    <span className="font-mono font-bold text-slate-400">#{myBest.rank}</span>
                    <span
                      className={`truncate text-brand-600 font-bold ${myBest.achievedAt ? 'cursor-help' : ''}`}
                      {...(myBest.achievedAt ? { title: new Date(myBest.achievedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) } : {})}
                    >{myBest.displayName || (myBest.email ? myBest.email : `Agent ${myBest.agentNumber || '???'}`)} (you)</span>
                    <span className="text-right font-mono font-bold text-brand-600">
                      {cfg.formatScore(myBest.bestScore)}
                      {planeTurnMode === '3d' && (
                        <span className="ml-1 text-[8px] font-bold px-1 py-0.5 rounded bg-brand-600/80 text-white leading-none align-middle">3D</span>
                      )}
                    </span>
                    {!cfg.hideTime && (
                      <span className="text-right font-mono text-slate-400">
                        {myBest.bestTime.toFixed(1)}s
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-3 justify-center mt-5">
            <Link
              to={cfg.backPath}
              className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-lg transition-colors no-underline"
            >
              Play {cfg.title}
            </Link>
          </div>
        </motion.div>
      )}
    </div>
  )
}
