import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'
import { playSound } from '../../utils/sound'

// ── Order type display metadata ───────────────────────────────────────────
const ORDER_META = {
  speed:           { label: 'Speed: Slowest → Fastest',         desc: 'Rank from slowest to fastest top speed',             emoji: '💨', startLabel: 'SLOWEST',                   endLabel: 'FASTEST'                   },
  year_introduced: { label: 'Year Introduced: Oldest → Latest', desc: 'Rank from earliest to latest year of introduction',  emoji: '📅', startLabel: 'FIRST INTRODUCED',           endLabel: 'MOST RECENTLY INTRODUCED'  },
  year_retired:    { label: 'Year Retired: Oldest → Latest',    desc: 'Rank from earliest to most recently retired',        emoji: '🗓️', startLabel: 'EARLIEST RETIRED',           endLabel: 'MOST RECENTLY RETIRED'    },
  rank_hierarchy:  { label: 'Rank Hierarchy',                   desc: 'Arrange in correct hierarchical rank order',         emoji: '🎖️', startLabel: 'MOST SENIOR (hierarchy #1)', endLabel: 'MOST JUNIOR'              },
  training_week:   { label: 'Training Week Order',              desc: 'Arrange in order of training schedule',              emoji: '📋', startLabel: 'FIRST WEEK / PHASE',         endLabel: 'LAST WEEK / PHASE'        },
  start_year:      { label: 'Start Year: Oldest → Latest',      desc: 'Rank from earliest to latest start year',           emoji: '📅', startLabel: 'EARLIEST START',             endLabel: 'LATEST START'             },
  end_year:        { label: 'End Year: Oldest → Latest',        desc: 'Rank from earliest to latest end/conclusion year',  emoji: '🏁', startLabel: 'EARLIEST END',               endLabel: 'LATEST / ONGOING'         },
}

// ── Roulette selection screen ─────────────────────────────────────────────
function RouletteScreen({ options, briefTitle, difficulty, onDone }) {
  const selectedIdxRef             = useRef(Math.floor(Math.random() * options.length))
  const [displayIdx, setDisplayIdx] = useState(0)
  const [phase, setPhase]           = useState('spinning') // 'spinning' | 'done'

  useEffect(() => {
    if (options.length === 0) return

    playSound('battle_of_order_selection')

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
    playSound('battle_of_order_selection')
  }
  const handleDragEnd = () => { setDragIdx(null); setOverIdx(null) }

  const moveUp = (i) => {
    if (i === 0) return
    const next = [...items]
    ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
    setItems(next)
    playSound('battle_of_order_selection')
  }
  const moveDown = (i) => {
    if (i === items.length - 1) return
    const next = [...items]
    ;[next[i + 1], next[i]] = [next[i], next[i + 1]]
    setItems(next)
    playSound('battle_of_order_selection')
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
    if (i === 0)              return 'bg-emerald-500 text-white'
    if (i === items.length - 1) return 'bg-amber-500 text-white'
    return 'bg-brand-100 text-brand-700'
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
                  : 'border-slate-200 bg-slate-50 hover:border-slate-300 cursor-grab'
                }`}
            >
              <span className={`w-6 h-6 rounded-full text-xs font-extrabold flex items-center justify-center shrink-0 ${badgeColor(i)}`}>
                {i + 1}
              </span>
              <span className="flex-1 text-sm font-semibold text-slate-800">{item.briefTitle}</span>
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
function ResultsScreen({ won, aircoinsEarned, alreadyCompleted, correctReveal, orderType, onRetry, onBack }) {
  const meta = ORDER_META[orderType] ?? { label: orderType, emoji: '📊' }

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

      {/* Correct order reveal */}
      <div className="bg-surface rounded-2xl border border-slate-200 p-4 mb-6 text-left card-shadow">
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
          Correct Order — {meta.emoji} {meta.label}
        </p>
        <div className="space-y-2">
          {correctReveal.map((item, i) => (
            <motion.div
              key={item.choiceId ?? i}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 + i * 0.08 }}
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
              <span className="flex-1 text-sm font-semibold text-slate-800">{item.briefTitle}</span>
              {item.displayValue && (
                <span className="text-xs text-slate-400 font-medium shrink-0">{item.displayValue}</span>
              )}
            </motion.div>
          ))}
        </div>
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
    </motion.div>
  )
}

// ── Main component ────────────────────────────────────────────────────────
export default function BattleOfOrderFlow() {
  const { briefId }              = useParams()
  const navigate                 = useNavigate()
  const { API, awardAircoins }   = useAuth()

  // 'loading' | 'roulette' | 'generating' | 'game' | 'results' | 'unavailable'
  const [screen, setScreen]          = useState('loading')
  const [options, setOptions]        = useState([])
  const [difficulty, setDifficulty]  = useState('easy')
  const [briefTitle, setBriefTitle]  = useState('')
  const [unavailableReason, setUnavailableReason] = useState(null)

  const [gameId, setGameId]          = useState(null)
  const [choices, setChoices]        = useState([])
  const [orderType, setOrderType]    = useState(null)

  const [won, setWon]                    = useState(false)
  const [aircoinsEarned, setAircoins]    = useState(0)
  const [alreadyCompleted, setAlreadyCompleted] = useState(false)
  const [correctReveal, setCorrectReveal]  = useState([])

  const abandonedRef  = useRef(false)
  const storedOptions = useRef([])

  const generateGame = useCallback(async (selectedOrderType) => {
    setScreen('generating')
    try {
      const res  = await fetch(`${API}/api/games/battle-of-order/generate`, {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ briefId, orderType: selectedOrderType }),
      })
      const data = await res.json()
      if (!res.ok) {
        setUnavailableReason(data.message ?? 'error')
        setScreen('unavailable')
        return
      }
      setGameId(data.data.gameId)
      setChoices(data.data.choices)
      setOrderType(selectedOrderType)
      setDifficulty(data.data.difficulty ?? 'easy')
      abandonedRef.current = false
      setScreen('game')
    } catch {
      setUnavailableReason('error')
      setScreen('unavailable')
    }
  }, [API, briefId])

  // Load brief title + BOO options on mount
  useEffect(() => {
    async function init() {
      try {
        const [briefRes, optRes] = await Promise.all([
          fetch(`${API}/api/briefs/${briefId}`, { credentials: 'include' }),
          fetch(`${API}/api/games/battle-of-order/options?briefId=${briefId}`, { credentials: 'include' }),
        ])
        const briefData = await briefRes.json()
        const optData   = await optRes.json()

        setBriefTitle(briefData.data?.brief?.title ?? '')

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
      } catch {
        setUnavailableReason('error')
        setScreen('unavailable')
      }
    }
    init()
  }, [briefId, API]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRouletteSelect = (selectedOrderType) => {
    generateGame(selectedOrderType)
  }

  const handleSubmit = async (userChoices, timeTakenSeconds) => {
    try {
      const res  = await fetch(`${API}/api/games/battle-of-order/submit`, {
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
      await fetch(`${API}/api/games/battle-of-order/abandon`, {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ gameId }),
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
  if (screen === 'loading' || screen === 'generating') {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 bg-slate-200 rounded-xl w-2/3 mx-auto" />
        <div className="h-4 bg-slate-100 rounded w-1/2 mx-auto" />
        {[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-slate-100 rounded-2xl" />)}
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
            {unavailableReason === 'ineligible_category'
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
        orderType={orderType}
        onRetry={handleRetry}
        onBack={() => navigate(`/brief/${briefId}`)}
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
