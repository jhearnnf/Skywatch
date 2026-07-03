import { useState, useEffect, useRef } from 'react'
import { Link, useParams, useNavigate, useLocation } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import SEO from '../components/SEO'
import PlaneTurnModeToggle from '../components/PlaneTurnModeToggle'
import LeaderboardRow, { rowCols } from '../components/LeaderboardRow'
import { CBAT_LEADERBOARD_CONFIG } from '../data/cbatGames'
import LeaderboardIntro, { INTRO_PILL_LAYOUT_ID } from '../components/LeaderboardIntro'
import { cbatLastRankKey } from '../utils/storageKeys'

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

  // Arrival animation: the "This Week" card floats up into this tab on every
  // mount, then (only when arriving straight from a game) the user's row slides
  // to its new position.
  const location = useLocation()
  const fromGame = !!location.state?.fromGame
  const [introDone, setIntroDone] = useState(reduce)   // reduced motion → skip the flourish
  const [slideRows, setSlideRows] = useState(null)      // reordered weekly entries during the FLIP, or null
  const [slideDelta, setSlideDelta] = useState(null)    // +climbed / −dropped, shown on the user's row
  const slideFiredRef = useRef(false)
  const slideTimersRef = useRef({ raf: null, clear: null })

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

  // Once the intro has docked and the weekly board is loaded, decide whether to
  // play the "your rank moved" slide. Fires at most once per mount, and always
  // remembers the user's current rank so the next visit has a "before" to
  // compare against.
  useEffect(() => {
    if (tab !== 'weekly' || slideFiredRef.current) return
    const b = boards.weekly
    const newRank = b?.myBest?.rank
    if (!b?.leaderboard || newRank == null) return
    if (!introDone) return   // wait for the intro to dock before moving rows

    slideFiredRef.current = true
    const key = cbatLastRankKey(gameKey)
    let prevRank = null
    try {
      const raw = localStorage.getItem(key)
      if (raw != null && raw !== '') prevRank = Number(raw)
    } catch { /* storage unavailable */ }
    try { localStorage.setItem(key, String(newRank)) } catch { /* storage unavailable */ }

    const trueOrder = b.leaderboard
    const meIdx = trueOrder.findIndex(e => e.userId === b.myBest.userId)
    const eligible = fromGame && !reduce && meIdx >= 0 &&
      prevRank != null && Number.isFinite(prevRank) && prevRank !== newRank
    if (!eligible) return

    // Rebuild the pre-play order — pull the user's row out and reinsert it at its
    // old slot. framer's layout FLIP then slides every affected row to the true
    // order on the next frame.
    const me = trueOrder[meIdx]
    const rest = trueOrder.filter((_, i) => i !== meIdx)
    const oldIdx = Math.max(0, Math.min(rest.length, prevRank - 1))
    const oldOrder = [...rest.slice(0, oldIdx), me, ...rest.slice(oldIdx)]

    setSlideDelta(prevRank - newRank)   // positive = climbed
    setSlideRows(oldOrder)
    slideTimersRef.current.raf = requestAnimationFrame(() => {
      slideTimersRef.current.raf = requestAnimationFrame(() => setSlideRows(trueOrder))
    })
    slideTimersRef.current.clear = setTimeout(() => {
      setSlideRows(null)
      setSlideDelta(null)
    }, 2400)
  }, [boards.weekly, tab, introDone, fromGame, gameKey, reduce])  // eslint-disable-line react-hooks/exhaustive-deps

  // Cancel any in-flight slide timers on unmount.
  useEffect(() => () => {
    if (slideTimersRef.current.raf) cancelAnimationFrame(slideTimersRef.current.raf)
    if (slideTimersRef.current.clear) clearTimeout(slideTimersRef.current.clear)
  }, [])

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

  // During the post-game slide the weekly rows render in a controlled order.
  const sliding = isWeekly && slideRows !== null
  const rowsToRender = sliding ? slideRows : (board?.leaderboard || [])

  return (
    <div className="cbat-leaderboard-page">
      <SEO title={`${cfg.title} Leaderboard — CBAT`} description={`Top scores for ${cfg.title}`} />

      {!introDone && <LeaderboardIntro onDone={() => setIntroDone(true)} />}

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
          {TABS.map(t => {
            const active = tab === t.key
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.key)}
                className={`relative flex-1 px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${
                  active ? 'text-white' : 'text-slate-400 hover:text-[#ddeaf8]'
                }`}
              >
                {/* Active-pill background. Shares INTRO_PILL_LAYOUT_ID with the
                    intro card, so on first arrival the card morphs into it; once
                    docked it also slides between tabs on switch. Held back until
                    the intro finishes so only one element owns the layoutId. */}
                {active && introDone && (
                  <motion.div
                    layoutId={INTRO_PILL_LAYOUT_ID}
                    className="absolute inset-0 bg-brand-600"
                    style={{ borderRadius: 6 }}
                    transition={{ layout: { duration: 0.55, ease: [0.4, 0, 0.2, 1] } }}
                  />
                )}
                <span className="relative z-10">{t.label}</span>
              </button>
            )
          })}
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
                {rowsToRender.map(entry => {
                  const isMe = !!(user && entry.userId === user._id)
                  return (
                    <LeaderboardRow
                      key={entry._id}
                      entry={entry}
                      variant={tab}
                      cfg={cfg}
                      isMe={isMe}
                      mode3d={mode3d}
                      layout={sliding}
                      delta={isMe && sliding ? slideDelta : null}
                    />
                  )
                })}
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
