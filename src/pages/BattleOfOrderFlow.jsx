import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { playSound } from '../utils/sound'

// ── Order type display metadata ───────────────────────────────────────────
const ORDER_META = {
  speed:             { label: 'Speed: Slowest → Fastest',            desc: 'Rank from slowest to fastest top speed',             emoji: '💨', startLabel: 'SLOWEST',                   endLabel: 'FASTEST',                  showValue: true  },
  year_introduced:   { label: 'Year Introduced: Oldest → Latest',    desc: 'Rank from earliest to latest year of introduction',  emoji: '📅', startLabel: 'FIRST INTRODUCED',           endLabel: 'MOST RECENTLY INTRODUCED', showValue: false },
  year_retired:      { label: 'Year Retired: Oldest → Latest',       desc: 'Rank from earliest to most recently retired',        emoji: '🗓️', startLabel: 'EARLIEST RETIRED',           endLabel: 'MOST RECENTLY RETIRED',    showValue: false },
  rank_hierarchy:    { label: 'Rank Hierarchy',                       desc: 'Arrange in correct hierarchical rank order',         emoji: '🎖️', startLabel: 'MOST SENIOR (hierarchy #1)', endLabel: 'MOST JUNIOR',              showValue: false },
  training_week:     { label: 'Training: Which Happens First',         desc: 'Arrange training phases in pipeline order',          emoji: '📋', startLabel: 'FIRST IN PIPELINE',          endLabel: 'LAST IN PIPELINE',         showValue: false },
  training_duration: { label: 'Training Duration: Shortest → Longest', desc: 'Arrange training phases from shortest to longest',    emoji: '⏱️', startLabel: 'SHORTEST DURATION',          endLabel: 'LONGEST DURATION',         showValue: true  },
  start_year:        { label: 'Start Year: Oldest → Latest',         desc: 'Rank from earliest to latest start year',            emoji: '📅', startLabel: 'EARLIEST START',             endLabel: 'LATEST START',             showValue: false },
  end_year:          { label: 'End Year: Oldest → Latest',           desc: 'Rank from earliest to latest end/conclusion year',   emoji: '🏁', startLabel: 'EARLIEST END',               endLabel: 'LATEST / ONGOING',         showValue: false },
  aircraft_count_asc: { label: 'Aircraft Count: Fewest → Most',      desc: 'Rank from fewest to most aircraft assigned',         emoji: '✈️', startLabel: 'FEWEST AIRCRAFT',            endLabel: 'MOST AIRCRAFT',            showValue: true  },
}

// ── Roulette selection screen ─────────────────────────────────────────────
function RouletteScreen({ options, briefTitle, difficulty, onDone }) {
  const selectedIdxRef             = useRef(Math.floor(Math.random() * options.length))
  const soundPlayedRef             = useRef(false)
  const [displayIdx, setDisplayIdx] = useState(0)
  const [phase, setPhase]           = useState('spinning') // 'spinning' | 'done'

  useEffect(() => {
    if (options.length === 0) return
    if (!soundPlayedRef.current) {
      soundPlayedRef.current = true
      playSound('battle_of_order_selection')
    }

    // Land exactly on selectedIdx after 4 full rotations
    const totalTicks = options.length * 4 + selectedIdxRef.current
    let currentTick  = 0

    const getDelay = (tick) => {
      const progress = tick / totalTicks
      if (progress < 0.45) return 70
      if (progress < 0.70) return 130
      if (progress < 0.85) return 220
      if (progress < 0.95) return 350
      return 480
    }

    let timeoutId
    const step = () => {
      currentTick++
      setDisplayIdx(currentTick % options.length)
      if (currentTick >= totalTicks) {
        setPhase('done')
        timeoutId = setTimeout(() => onDone(options[selectedIdxRef.current].orderType), 900)
        return
      }
      timeoutId = setTimeout(step, getDelay(currentTick))
    }
    timeoutId = setTimeout(step, getDelay(0))

    return () => clearTimeout(timeoutId)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const meta = ORDER_META[options[displayIdx]?.orderType] ?? { label: '…', emoji: '📊' }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="text-center"
    >
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', damping: 12, delay: 0.1 }}
        className="text-5xl mb-3"
      >
        🗺️
      </motion.div>
      <h1 className="text-2xl font-extrabold text-slate-900 mb-1">Battle of Order</h1>
      <p className="text-sm text-slate-500 mb-3">{briefTitle}</p>
      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border mb-6 inline-block
        ${difficulty === 'medium'
          ? 'bg-orange-50 border-orange-200 text-orange-600'
          : 'bg-emerald-50 border-emerald-200 text-emerald-600'
        }`}
      >
        {difficulty === 'medium' ? '🔥 Advanced — 5 items' : '🌱 Standard — 3 items'}
      </span>

      {/* Slot machine card */}
      <div className="mx-auto max-w-xs mb-6">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">
          {phase === 'done' ? 'Challenge selected!' : 'Selecting challenge…'}
        </p>
        <motion.div
          key={displayIdx}
          initial={{ opacity: 0.6, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.06 }}
          className={`rounded-2xl border-2 p-5 transition-all
            ${phase === 'done'
              ? 'border-brand-500 bg-brand-50 shadow-lg shadow-brand-100'
              : 'border-slate-200 bg-slate-50'
            }`}
        >
          <div className="text-4xl mb-2">{meta.emoji}</div>
          <p className={`font-bold text-sm leading-snug
            ${phase === 'done' ? 'text-brand-800' : 'text-slate-700'}`}
          >
            {meta.label}
          </p>
          {phase === 'done' && (
            <p className="text-xs text-slate-500 mt-1">{meta.desc}</p>
          )}
        </motion.div>
      </div>

      {phase === 'spinning' && (
        <div className="flex gap-1 justify-center">
          {options.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-100
                ${i === displayIdx ? 'bg-brand-500 w-4' : 'bg-slate-200 w-1.5'}`}
            />
          ))}
        </div>
      )}

      {phase === 'done' && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-xs text-slate-400 mt-2"
        >
          Loading game…
        </motion.p>
      )}
    </motion.div>
  )
}

// ── Game screen ───────────────────────────────────────────────────────────
function GameScreen({ orderType, choices: initialChoices, difficulty, onSubmit, onQuit }) {
  const [items, setItems]     = useState(initialChoices)
  const [dragIdx, setDragIdx] = useState(null)
  const [overIdx, setOverIdx] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const startRef              = useRef(Date.now())
  const meta = ORDER_META[orderType] ?? { label: orderType, emoji: '📊', startLabel: 'FIRST', endLabel: 'LAST' }

  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000)
    return () => clearInterval(id)
  }, [])

  const formatTime = (s) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  const handleDragStart = (i) => setDragIdx(i)
  const handleDragOver  = (e, i) => { e.preventDefault(); setOverIdx(i) }
  const handleDrop      = (i) => {
    if (dragIdx === null || dragIdx === i) { setDragIdx(null); setOverIdx(null); return }
    const next = [...items]
    const [moved] = next.splice(dragIdx, 1)
    next.splice(i, 0, moved)
    setItems(next)
    setDragIdx(null)
    setOverIdx(null)
  }
  const handleDragEnd = () => { setDragIdx(null); setOverIdx(null) }

  const moveUp = (i) => {
    if (i === 0) return
    const next = [...items]
    ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
    setItems(next)
  }
  const moveDown = (i) => {
    if (i === items.length - 1) return
    const next = [...items]
    ;[next[i + 1], next[i]] = [next[i], next[i + 1]]
    setItems(next)
  }

  const handleSubmit = () => {
    const timeTaken   = Math.round((Date.now() - startRef.current) / 1000)
    const userChoices = items.map((item, idx) => ({
      choiceId:        item.choiceId,
      userOrderNumber: idx + 1,
    }))
    onSubmit(userChoices, timeTaken)
  }

  const badgeColor = (i) => {
    if (i === 0)              return 'bg-emerald-100 text-emerald-700'
    if (i === items.length - 1) return 'bg-amber-100 text-amber-700'
    return 'bg-slate-100 text-slate-600'
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={onQuit}
          className="text-sm text-slate-500 hover:text-slate-700 transition-colors"
        >
          ✕ Quit
        </button>
        <p className="text-xs font-bold text-slate-600 truncate mx-2">{meta.emoji} {meta.label}</p>
        <span className="text-xs font-bold font-mono text-slate-500 bg-slate-100 px-3 py-1 rounded-full shrink-0">
          {formatTime(elapsed)}
        </span>
      </div>

      {/* Difficulty badge */}
      <div className="flex justify-center mb-4">
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border
          ${difficulty === 'medium'
            ? 'bg-orange-50 border-orange-200 text-orange-600'
            : 'bg-emerald-50 border-emerald-200 text-emerald-600'
          }`}
        >
          {difficulty === 'medium' ? '🔥 Advanced' : '🌱 Standard'}
        </span>
      </div>

      {/* Ordering list with scale labels */}
      <div className="bg-surface rounded-2xl border border-slate-200 p-4 mb-4 card-shadow">
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
          Drag or use ▲▼ to arrange in the correct order
        </p>

        {/* Top scale label */}
        <div className="flex items-center gap-2 mb-2 px-1">
          <span className="w-5 h-5 rounded-full bg-emerald-500 text-white text-[10px] font-extrabold flex items-center justify-center shrink-0">1</span>
          <span className="text-[10px] font-extrabold text-emerald-700 uppercase tracking-wider">{meta.startLabel}</span>
        </div>

        <div className="space-y-2">
          {items.map((item, i) => (
            <div
              key={item.choiceId}
              draggable
              onDragStart={() => handleDragStart(i)}
              onDragOver={(e) => handleDragOver(e, i)}
              onDrop={() => handleDrop(i)}
              onDragEnd={handleDragEnd}
              data-testid={`choice-item-${i}`}
              className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all select-none
                ${dragIdx === i
                  ? 'opacity-40 border-brand-300 bg-brand-50 cursor-grabbing'
                  : overIdx === i
                  ? 'border-brand-400 bg-brand-50 scale-[1.01]'
                  : 'border-slate-200 bg-slate-50 hover:border-brand-400 hover:bg-brand-50 cursor-grab'
                }`}
            >
              <span className={`w-6 h-6 rounded-full text-xs font-extrabold flex items-center justify-center shrink-0 ${badgeColor(i)}`}>
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold text-slate-800">{item.briefTitle}</span>
              </div>
              <div className="flex flex-col gap-0.5 shrink-0">
                <button
                  onClick={() => moveUp(i)}
                  disabled={i === 0}
                  aria-label="Move up"
                  className="w-5 h-5 rounded flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-200 disabled:opacity-30 transition-colors text-[10px] leading-none"
                >
                  ▲
                </button>
                <button
                  onClick={() => moveDown(i)}
                  disabled={i === items.length - 1}
                  aria-label="Move down"
                  className="w-5 h-5 rounded flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-200 disabled:opacity-30 transition-colors text-[10px] leading-none"
                >
                  ▼
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Bottom scale label */}
        <div className="flex items-center gap-2 mt-2 px-1">
          <span className="w-5 h-5 rounded-full bg-amber-500 text-white text-[10px] font-extrabold flex items-center justify-center shrink-0">{items.length}</span>
          <span className="text-[10px] font-extrabold text-amber-700 uppercase tracking-wider">{meta.endLabel}</span>
        </div>
      </div>

      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={handleSubmit}
        className="w-full py-4 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-2xl text-base transition-colors shadow-lg shadow-brand-200"
      >
        Submit Order →
      </motion.button>
    </motion.div>
  )
}

// ── Results screen ────────────────────────────────────────────────────────
// ── Related briefs strip ─────────────────────────────────────────────────
function RelatedBriefs({ brief, navigate }) {
  if (!brief) return null
  const seen = new Set()
  const cards = [
    ...(brief.associatedBaseBriefIds     ?? []),
    ...(brief.associatedSquadronBriefIds ?? []),
    ...(brief.associatedAircraftBriefIds ?? []),
    ...(brief.associatedMissionBriefIds  ?? []),
    ...(brief.associatedTrainingBriefIds ?? []),
    ...(brief.relatedBriefIds            ?? []),
  ]
    .filter(b => b?._id && !seen.has(String(b._id)) && seen.add(String(b._id)))
    .sort((a, b) => (a.status === 'stub' ? 1 : 0) - (b.status === 'stub' ? 1 : 0))
    .slice(0, 5)

  if (cards.length === 0) return null

  return (
    <div className="mt-4 text-left">
      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">📡 Related Briefs</p>
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {cards.map(b => (
          <button
            key={b._id}
            onClick={() => b.status !== 'stub' && navigate(`/brief/${b._id}`)}
            className={`shrink-0 flex flex-col gap-1 p-3 rounded-xl border transition-all text-left w-36 ${b.status === 'stub' ? 'border-slate-100 opacity-60 cursor-default' : 'border-slate-200 hover:border-brand-300 hover:bg-brand-50 cursor-pointer'}`}
          >
            <span className="text-[10px] font-bold text-brand-600 uppercase tracking-wide">{b.category}</span>
            <span className={`text-xs font-semibold leading-tight ${b.status === 'stub' ? 'text-slate-400' : 'text-slate-700'}`}>
              {b.status === 'stub' ? `🔒 ${b.title}` : b.title}
            </span>
            {b.status === 'stub' && (
              <span className="text-[10px] text-slate-400 font-medium">Coming soon</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

function ResultsScreen({ won, aircoinsEarned, alreadyCompleted, correctReveal, userChoices, orderType, onRetry, onBack, brief, navigate }) {
  const meta = ORDER_META[orderType] ?? { label: orderType, emoji: '📊' }

  // Build a map from choiceId → correctOrder for quick lookup
  const correctOrderMap = {}
  correctReveal.forEach(item => { correctOrderMap[String(item.choiceId)] = item.correctOrder })

  // Build user's order: sorted by userOrderNumber, annotated with briefTitle + displayValue from correctReveal
  const userOrder = [...userChoices]
    .sort((a, b) => a.userOrderNumber - b.userOrderNumber)
    .map(uc => {
      const revealed = correctReveal.find(r => String(r.choiceId) === String(uc.choiceId))
      return {
        userPosition:   uc.userOrderNumber,
        correctPosition: revealed?.correctOrder ?? null,
        briefTitle:     revealed?.briefTitle ?? '?',
        displayValue:   revealed?.displayValue ?? null,
        correct:        revealed?.correctOrder === uc.userOrderNumber,
      }
    })

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="text-center"
    >
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', damping: 12, delay: 0.1 }}
        className="text-7xl mb-4"
      >
        {won ? '🏆' : '📚'}
      </motion.div>

      <h2 className="text-3xl font-extrabold text-slate-900 mb-1">
        {won ? 'Correct Order!' : 'Not Quite!'}
      </h2>
      <p className="text-slate-500 mb-5">
        {won ? 'You arranged them perfectly.' : 'Review the correct order below.'}
      </p>

      {aircoinsEarned > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="inline-flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 font-bold px-4 py-2 rounded-full mb-5 text-sm"
        >
          ⭐ +{aircoinsEarned} Aircoins earned!
        </motion.div>
      )}

      {won && alreadyCompleted && aircoinsEarned === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="inline-flex items-center gap-2 bg-slate-50 border border-slate-200 text-slate-500 font-semibold px-4 py-2 rounded-full mb-5 text-sm"
        >
          ✓ Already earned Aircoins for this order type
        </motion.div>
      )}

      {/* Order comparison */}
      <div className="space-y-3 mb-6 text-left">

        {/* Your order */}
        <div className="bg-surface rounded-2xl border border-slate-200 p-4 card-shadow">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Your Order</p>
          <div className="space-y-2">
            {userOrder.map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.05 + i * 0.06 }}
                className="flex items-center gap-3"
              >
                <span className={`w-6 h-6 rounded-full text-xs font-extrabold flex items-center justify-center shrink-0
                  ${item.correct ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}
                >
                  {item.userPosition}
                </span>
                <span className="flex-1 text-sm font-semibold text-slate-800 truncate">{item.briefTitle}</span>
                {item.displayValue && (
                  <span className="text-xs text-slate-400 font-medium shrink-0">{item.displayValue}</span>
                )}
                <span className={`text-xs font-bold shrink-0 ${item.correct ? 'text-emerald-600' : 'text-red-500'}`}>
                  {item.correct ? '✓' : `→ #${item.correctPosition}`}
                </span>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Correct order */}
        {!won && (
          <div className="bg-surface rounded-2xl border border-slate-200 p-4 card-shadow">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
              Correct Order — {meta.emoji} {meta.label}
            </p>
            <div className="space-y-2">
              {correctReveal.map((item, i) => (
                <motion.div
                  key={item.choiceId ?? i}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 + i * 0.06 }}
                  className="flex items-center gap-3"
                >
                  <span className={`w-6 h-6 rounded-full text-xs font-extrabold flex items-center justify-center shrink-0
                    ${i === 0
                      ? 'bg-emerald-100 text-emerald-700'
                      : i === correctReveal.length - 1
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {item.correctOrder}
                  </span>
                  <span className="flex-1 text-sm font-semibold text-slate-800 truncate">{item.briefTitle}</span>
                  {item.displayValue && (
                    <span className="text-xs text-slate-400 font-medium shrink-0">{item.displayValue}</span>
                  )}
                </motion.div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <button
          onClick={onRetry}
          className="w-full py-4 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-2xl text-base transition-colors"
        >
          🔄 Try Again
        </button>
        <button
          onClick={onBack}
          className="w-full py-3 border border-slate-200 text-slate-600 font-semibold rounded-2xl hover:bg-slate-50 transition-colors"
        >
          Back to Brief
        </button>
      </div>

      <RelatedBriefs brief={brief} navigate={navigate} />
    </motion.div>
  )
}

// ── Main component ────────────────────────────────────────────────────────
export default function BattleOfOrderFlow() {
  const { briefId }              = useParams()
  const navigate                 = useNavigate()
  const { API, apiFetch, awardAircoins }   = useAuth()

  // 'loading' | 'roulette' | 'generating' | 'game' | 'results' | 'unavailable'
  const [screen, setScreen]          = useState('loading')
  const [options, setOptions]        = useState([])
  const [difficulty, setDifficulty]  = useState('easy')
  const [briefTitle, setBriefTitle]  = useState('')
  const [brief, setBrief]            = useState(null)
  const [unavailableReason, setUnavailableReason] = useState(null)

  const [gameId, setGameId]          = useState(null)
  const [choices, setChoices]        = useState([])
  const [orderType, setOrderType]    = useState(null)

  const [won, setWon]                    = useState(false)
  const [aircoinsEarned, setAircoins]    = useState(0)
  const [alreadyCompleted, setAlreadyCompleted] = useState(false)
  const [correctReveal, setCorrectReveal]  = useState([])
  const [lastUserChoices, setLastUserChoices] = useState([])

  const abandonedRef     = useRef(false)
  const gameStartTimeRef = useRef(null)
  const gameIdRef        = useRef(null)
  const storedOptions    = useRef([])

  const generateGame = useCallback(async (selectedOrderType) => {
    setScreen('generating')
    const controller = new AbortController()
    const timeoutId  = setTimeout(() => controller.abort(), 12000)
    try {
      const res  = await apiFetch(`${API}/api/games/battle-of-order/generate`, {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ briefId, orderType: selectedOrderType }),
        signal:      controller.signal,
      })
      clearTimeout(timeoutId)
      const data = await res.json()
      if (!res.ok) {
        setUnavailableReason(data.message ?? 'error')
        setScreen('unavailable')
        return
      }
      setGameId(data.data.gameId)
      gameIdRef.current = data.data.gameId
      setChoices(data.data.choices)
      setOrderType(selectedOrderType)
      setDifficulty(data.data.difficulty ?? 'easy')
      abandonedRef.current     = false
      gameStartTimeRef.current = Date.now()
      setScreen('game')
    } catch (err) {
      clearTimeout(timeoutId)
      console.error('[BOO generate]', err)
      setUnavailableReason('error')
      setScreen('unavailable')
    }
  }, [API, briefId])

  // Load brief title + BOO options on mount
  useEffect(() => {
    async function init() {
      const controller = new AbortController()
      const timeoutId  = setTimeout(() => controller.abort(), 12000)
      try {
        const [briefRes, optRes] = await Promise.all([
          fetch(`${API}/api/briefs/${briefId}`, { credentials: 'include', signal: controller.signal }),
          fetch(`${API}/api/games/battle-of-order/options?briefId=${briefId}`, { credentials: 'include', signal: controller.signal }),
        ])
        clearTimeout(timeoutId)
        const briefData = await briefRes.json()
        const optData   = await optRes.json()

        setBriefTitle(briefData.data?.brief?.title ?? '')
        setBrief(briefData.data?.brief ?? null)

        if (!optData.data?.available) {
          setUnavailableReason(optData.data?.reason ?? 'unavailable')
          setScreen('unavailable')
          return
        }

        const opts = optData.data.options ?? []
        const diff = optData.data.difficulty ?? 'easy'
        setOptions(opts)
        setDifficulty(diff)
        storedOptions.current = opts

        setScreen('roulette')
      } catch (err) {
        clearTimeout(timeoutId)
        console.error('[BOO init]', err)
        setUnavailableReason('error')
        setScreen('unavailable')
      }
    }
    init()
  }, [briefId, API]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Abandon on unmount (covers back-navigation / navbar clicks) ──────────
  useEffect(() => {
    return () => {
      if (!gameIdRef.current || abandonedRef.current) return
      abandonedRef.current = true
      fetch(`${API}/api/games/battle-of-order/abandon`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          gameId: gameIdRef.current,
          timeTakenSeconds: gameStartTimeRef.current
            ? Math.round((Date.now() - gameStartTimeRef.current) / 1000)
            : null,
        }),
      }).catch(() => {})
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRouletteSelect = (selectedOrderType) => {
    generateGame(selectedOrderType)
  }

  const handleSubmit = async (userChoices, timeTakenSeconds) => {
    setLastUserChoices(userChoices)
    try {
      const res  = await apiFetch(`${API}/api/games/battle-of-order/submit`, {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ gameId, userChoices, timeTakenSeconds }),
      })
      const data = await res.json()
      abandonedRef.current = true

      const didWin  = data.data?.won            ?? false
      const earned  = data.data?.aircoinsEarned ?? 0
      const already = data.data?.alreadyCompleted ?? false

      setWon(didWin)
      setAircoins(earned)
      setAlreadyCompleted(already)
      setCorrectReveal(data.data?.correctReveal ?? [])

      playSound(didWin ? 'battle_of_order_won' : 'battle_of_order_lost')

      if (earned > 0 && awardAircoins) {
        awardAircoins(earned, 'Battle of Order', {
          cycleAfter:    data.data?.cycleAircoins  ?? null,
          totalAfter:    null,
          rankPromotion: data.data?.rankPromotion  ?? null,
        })
      }

      setScreen('results')
    } catch {}
  }

  const handleQuit = async () => {
    if (gameId && !abandonedRef.current) {
      abandonedRef.current = true
      await apiFetch(`${API}/api/games/battle-of-order/abandon`, {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({
          gameId,
          timeTakenSeconds: gameStartTimeRef.current
            ? Math.round((Date.now() - gameStartTimeRef.current) / 1000)
            : null,
        }),
      }).catch(() => {})
    }
    navigate(`/brief/${briefId}`)
  }

  const handleRetry = () => {
    abandonedRef.current = false
    // Re-run the roulette with the same pool of options
    setScreen('roulette')
  }

  // ── Loading / Generating ─────────────────────────────────────────────────
  if (screen === 'loading') {
    return (
      <div className="animate-pulse text-center">
        {/* Emoji placeholder */}
        <div className="w-16 h-16 rounded-full bg-slate-200 mx-auto mb-3" />
        {/* Title + subtitle */}
        <div className="h-6 w-48 bg-slate-200 rounded-full mx-auto mb-2" />
        <div className="h-4 w-32 bg-slate-100 rounded-full mx-auto mb-3" />
        {/* Difficulty badge */}
        <div className="h-4 w-36 bg-slate-100 rounded-full mx-auto mb-6" />
        {/* Slot machine card */}
        <div className="mx-auto max-w-xs bg-slate-50 border-2 border-slate-200 rounded-2xl p-5">
          <div className="w-10 h-10 bg-slate-200 rounded-xl mx-auto mb-3" />
          <div className="h-4 bg-slate-200 rounded w-3/4 mx-auto" />
        </div>
      </div>
    )
  }

  if (screen === 'generating') {
    return (
      <div className="animate-pulse">
        {/* Header row */}
        <div className="flex items-center justify-between mb-4">
          <div className="h-4 w-10 bg-slate-200 rounded-full" />
          <div className="h-4 w-32 bg-slate-200 rounded-full" />
          <div className="h-6 w-14 bg-slate-100 rounded-full" />
        </div>
        {/* Difficulty badge */}
        <div className="flex justify-center mb-4">
          <div className="h-4 w-24 bg-slate-100 rounded-full" />
        </div>
        {/* Ordering list card */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 mb-4">
          <div className="h-3 w-48 bg-slate-200 rounded-full mb-4" />
          {/* Scale label top */}
          <div className="flex items-center gap-2 mb-2 px-1">
            <div className="w-5 h-5 rounded-full bg-emerald-100 shrink-0" />
            <div className="h-2.5 w-24 bg-slate-200 rounded-full" />
          </div>
          {/* Draggable items */}
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl border-2 border-slate-200">
                <div className="w-6 h-6 rounded-full bg-slate-200 shrink-0" />
                <div className="h-4 bg-slate-200 rounded flex-1" />
                <div className="flex flex-col gap-0.5 shrink-0">
                  <div className="w-5 h-5 rounded bg-slate-100" />
                  <div className="w-5 h-5 rounded bg-slate-100" />
                </div>
              </div>
            ))}
          </div>
          {/* Scale label bottom */}
          <div className="flex items-center gap-2 mt-2 px-1">
            <div className="w-5 h-5 rounded-full bg-amber-100 shrink-0" />
            <div className="h-2.5 w-28 bg-slate-200 rounded-full" />
          </div>
        </div>
        {/* Submit button */}
        <div className="h-14 bg-slate-200 rounded-2xl" />
      </div>
    )
  }

  // ── Unavailable ──────────────────────────────────────────────────────────
  if (screen === 'unavailable') {
    return (
      <>
        <button
          onClick={() => navigate(`/brief/${briefId}`)}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-5 transition-colors"
        >
          ← Back to Brief
        </button>
        <div className="text-center py-16 text-slate-400">
          <div className="text-4xl mb-3">🗺️</div>
          <p className="font-semibold text-slate-600 mb-1">Battle of Order unavailable</p>
          <p className="text-sm">
            {unavailableReason === 'not_read'
              ? 'You need to read and complete this brief before playing.'
              : unavailableReason === 'needs-aircraft-reads'
              ? 'You need to read more Aircrafts briefs before Battle of Order unlocks.'
              : unavailableReason === 'quiz_not_passed'
              ? 'You need to pass the Intel Quiz for this brief first.'
              : unavailableReason === 'ineligible_category'
              ? "This brief's category doesn't support Battle of Order."
              : unavailableReason === 'insufficient_briefs'
              ? 'Not enough briefs in this category have game data yet.'
              : 'Something went wrong. Please try again later.'}
          </p>
          <button
            onClick={() => navigate(`/brief/${briefId}`)}
            className="mt-6 text-brand-600 font-semibold text-sm hover:text-brand-700"
          >
            ← Back to brief
          </button>
        </div>
      </>
    )
  }

  // ── Results ──────────────────────────────────────────────────────────────
  if (screen === 'results') {
    return (
      <ResultsScreen
        won={won}
        aircoinsEarned={aircoinsEarned}
        alreadyCompleted={alreadyCompleted}
        correctReveal={correctReveal}
        userChoices={lastUserChoices}
        orderType={orderType}
        onRetry={handleRetry}
        onBack={() => navigate(`/brief/${briefId}`)}
        brief={brief}
        navigate={navigate}
      />
    )
  }

  // ── Roulette selection ───────────────────────────────────────────────────
  if (screen === 'roulette') {
    return (
      <>
        <button
          onClick={() => navigate(`/brief/${briefId}`)}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-5 transition-colors"
        >
          ← Back to Brief
        </button>
        <RouletteScreen
          options={options}
          difficulty={difficulty}
          briefTitle={briefTitle}
          onDone={handleRouletteSelect}
        />
      </>
    )
  }

  // ── Game ─────────────────────────────────────────────────────────────────
  return (
    <GameScreen
      orderType={orderType}
      choices={choices}
      difficulty={difficulty}
      onSubmit={handleSubmit}
      onQuit={handleQuit}
    />
  )
}
