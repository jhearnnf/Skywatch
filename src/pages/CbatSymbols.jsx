import { useState, useCallback, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { recordCbatStart } from '../utils/cbat/recordStart'
import { useGameChrome } from '../context/GameChromeContext'
import SEO from '../components/SEO'

// ── Constants ────────────────────────────────────────────────────────────────
const TOTAL_ROUNDS = 15
const FEEDBACK_MS = 1000

// Tier ranges: inclusive min/max grid sizes per tier
const TIERS = [
  { min: 12, max: 15 }, // rounds 1-5
  { min: 15, max: 20 }, // rounds 6-10
  { min: 18, max: 25 }, // rounds 11-15
]

// Get 0-indexed tier for a given round index (0-14)
function tierFor(roundIdx) {
  if (roundIdx < 5) return 0
  if (roundIdx < 10) return 1
  return 2
}

// ── Symbol pool — Arabic, Cyrillic, Japanese, CJK, Hangul ────────────────────
// Each entry is a Unicode code point.  We pick ranges that render reliably
// as standalone characters (no contextual shaping required).
function buildSymbolPool() {
  const pool = []
  const push = (start, end) => { for (let c = start; c <= end; c++) pool.push(c) }
  // Cyrillic uppercase (А–Я) and lowercase (а–я)
  push(0x0410, 0x042F)
  push(0x0430, 0x044F)
  // Arabic letters — isolated forms render fine as standalones
  push(0x0621, 0x063A)
  push(0x0641, 0x064A)
  // Hiragana
  push(0x3041, 0x3096)
  // Katakana
  push(0x30A1, 0x30FA)
  // CJK Unified Ideographs — a small slice (common characters)
  push(0x4E00, 0x4EFF)
  // Hangul syllables — a small slice
  push(0xAC00, 0xAC7F)
  return pool
}

const SYMBOL_POOL = buildSymbolPool()

function pickUniqueSymbols(count) {
  // Fisher-Yates partial shuffle to pick `count` unique code points
  const arr = [...SYMBOL_POOL]
  const out = []
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(Math.random() * (arr.length - i))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
    out.push(String.fromCodePoint(arr[i]))
  }
  return out
}

function buildRounds() {
  const rounds = []
  for (let i = 0; i < TOTAL_ROUNDS; i++) {
    const tier = tierFor(i)
    const { min, max } = TIERS[tier]
    const size = min + Math.floor(Math.random() * (max - min + 1))
    const symbols = pickUniqueSymbols(size)
    const targetIdx = Math.floor(Math.random() * size)
    rounds.push({ symbols, target: symbols[targetIdx], tier })
  }
  return rounds
}

// ── Results screen ───────────────────────────────────────────────────────────
function ResultsScreen({ answers, totalTime, onPlayAgain, scoreSaved }) {
  const correct = answers.filter(a => a.correct).length
  const pct = Math.round((correct / TOTAL_ROUNDS) * 100)
  const tierCorrect = [0, 1, 2].map(t => ({
    total: answers.filter(a => a.tier === t).length,
    correct: answers.filter(a => a.tier === t && a.correct).length,
  }))
  const correctTimes = answers.filter(a => a.correct).map(a => a.roundTime)
  const avgTime = correctTimes.length
    ? correctTimes.reduce((s, v) => s + v, 0) / correctTimes.length
    : 0

  const grade = pct >= 90 ? { label: 'Outstanding', emoji: '\u{1F396}\uFE0F', color: 'text-green-400' }
    : pct >= 70 ? { label: 'Good', emoji: '\u2708\uFE0F', color: 'text-brand-300' }
    : pct >= 50 ? { label: 'Needs Work', emoji: '\u{1F527}', color: 'text-amber-400' }
    : { label: 'Failed', emoji: '\u{1F4A5}', color: 'text-red-400' }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="w-full max-w-md bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-8 text-center"
    >
      <p className="text-5xl mb-3">{grade.emoji}</p>
      <p className={`text-2xl font-extrabold mb-1 ${grade.color}`}>{grade.label}</p>
      <p className="text-sm text-slate-400 mb-6">Symbol Recognition Complete</p>

      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-5 mb-4">
        <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">Overall Score</p>
        <div className="flex justify-center gap-8 items-end">
          <div>
            <p className="text-4xl font-mono font-bold text-brand-300 mb-1">{pct}%</p>
            <p className="text-sm text-slate-400">{correct} / {TOTAL_ROUNDS} correct</p>
          </div>
          <div className="w-px h-12 bg-[#1a3a5c]" />
          <div>
            <p className="text-4xl font-mono font-bold text-brand-300 mb-1">{totalTime.toFixed(1)}s</p>
            <p className="text-sm text-slate-400">total time</p>
          </div>
        </div>
        {correctTimes.length > 0 && (
          <p className="text-xs text-slate-500 mt-3">
            Avg find time: <span className="text-brand-300 font-mono">{avgTime.toFixed(2)}s</span>
          </p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 mb-6">
        {['Tier 1', 'Tier 2', 'Tier 3'].map((label, i) => (
          <div key={i} className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">{label}</p>
            <p className="text-xl font-mono font-bold text-brand-300">
              {tierCorrect[i].correct}/{tierCorrect[i].total}
            </p>
          </div>
        ))}
      </div>

      {/* Answer review — scrollable */}
      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 mb-6 max-h-48 overflow-y-auto">
        <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-2 sticky top-0 bg-[#060e1a]">Round Review</p>
        <div className="space-y-1">
          {answers.map((a, i) => (
            <div key={i} className={`flex items-center justify-between text-xs px-2 py-1 rounded ${a.correct ? 'text-green-400' : 'text-red-400'}`}>
              <span className="text-slate-500 w-6 text-left">#{i + 1}</span>
              <span className="text-lg">{a.target}</span>
              <span>{a.correct ? '\u2713' : '\u2717'}</span>
              <span className="font-mono text-slate-500">
                {a.correct ? `${a.roundTime.toFixed(2)}s` : 'missed'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {scoreSaved && (
        <p className="text-xs text-green-400 mb-4">{'\u2713'} Score saved</p>
      )}

      <div className="flex flex-wrap gap-3 justify-center">
        <button
          onClick={onPlayAgain}
          className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-lg transition-colors"
        >
          Play Again
        </button>
        <Link
          to="/cbat/symbols/leaderboard"
          className="px-5 py-2.5 bg-[#1a3a5c] hover:bg-[#254a6e] text-[#ddeaf8] text-sm font-bold rounded-lg transition-colors no-underline"
        >
          {'\u{1F3C6}'} Leaderboard
        </Link>
      </div>
    </motion.div>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function CbatSymbols() {
  const { user, apiFetch, API } = useAuth()

  const [phase, setPhase] = useState('intro') // intro | playing | feedback | results
  const { enterImmersive, exitImmersive } = useGameChrome()
  useEffect(() => {
    if (phase === 'playing' || phase === 'feedback') enterImmersive()
    else exitImmersive()
    return exitImmersive
  }, [phase, enterImmersive, exitImmersive])
  const [rounds, setRounds] = useState([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [answers, setAnswers] = useState([])
  const [pickedSymbol, setPickedSymbol] = useState(null)
  const [wasCorrect, setWasCorrect] = useState(null)
  const [lastRoundTime, setLastRoundTime] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef(null)
  const startTimeRef = useRef(null)
  const roundStartRef = useRef(0)
  const advanceTimeoutRef = useRef(null)
  const [personalBest, setPersonalBest] = useState(null)
  const [scoreSaved, setScoreSaved] = useState(false)

  // Fetch personal best
  useEffect(() => {
    if (!user) return
    apiFetch(`${API}/api/games/cbat/symbols/personal-best`)
      .then(r => r.json())
      .then(d => { if (d.data) setPersonalBest(d.data) })
      .catch(() => {})
  }, [user])

  // Submit score to backend
  const submitScore = useCallback((finalAnswers, finalTime) => {
    const correct = finalAnswers.filter(a => a.correct).length
    const pct = Math.round((correct / TOTAL_ROUNDS) * 100)
    const tier1 = finalAnswers.filter(a => a.tier === 0 && a.correct).length
    const tier2 = finalAnswers.filter(a => a.tier === 1 && a.correct).length
    const tier3 = finalAnswers.filter(a => a.tier === 2 && a.correct).length
    const grade = pct >= 90 ? 'Outstanding' : pct >= 70 ? 'Good' : pct >= 50 ? 'Needs Work' : 'Failed'

    setScoreSaved(false)
    apiFetch(`${API}/api/games/cbat/symbols/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        correctCount: correct,
        tier1Correct: tier1,
        tier2Correct: tier2,
        tier3Correct: tier3,
        totalTime: finalTime,
        grade,
      }),
    })
      .then(r => r.json())
      .then(() => {
        setScoreSaved(true)
        apiFetch(`${API}/api/games/cbat/symbols/personal-best`)
          .then(r => r.json())
          .then(d => { if (d.data) setPersonalBest(d.data) })
          .catch(() => {})
      })
      .catch(() => {})
  }, [apiFetch, API])

  const currentRound = rounds[currentIdx] || null

  // Timer — runs during 'playing' and 'feedback' phases (feedback is part of total time)
  useEffect(() => {
    if (phase === 'playing' || phase === 'feedback') {
      const offset = elapsed * 1000
      const t0 = Date.now() - offset
      startTimeRef.current = t0
      timerRef.current = setInterval(() => {
        setElapsed((Date.now() - t0) / 1000)
      }, 100)
      return () => clearInterval(timerRef.current)
    } else {
      clearInterval(timerRef.current)
    }
  }, [phase])

  // Cleanup pending advance timeout on unmount
  useEffect(() => {
    return () => {
      if (advanceTimeoutRef.current) clearTimeout(advanceTimeoutRef.current)
    }
  }, [])

  const startGame = useCallback(() => {
    recordCbatStart('symbols', apiFetch, API)
    setRounds(buildRounds())
    setCurrentIdx(0)
    setAnswers([])
    setPickedSymbol(null)
    setWasCorrect(null)
    setLastRoundTime(0)
    setElapsed(0)
    roundStartRef.current = 0
    setPhase('playing')
  }, [apiFetch, API])

  // Reset round-start timestamp when a new round begins
  useEffect(() => {
    if (phase === 'playing') {
      roundStartRef.current = elapsed
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx, phase])

  const handlePick = (symbol) => {
    if (phase !== 'playing' || !currentRound) return
    const correct = symbol === currentRound.target
    const roundTime = elapsed - roundStartRef.current
    const newAnswers = [
      ...answers,
      { target: currentRound.target, picked: symbol, correct, roundTime, tier: currentRound.tier },
    ]
    setAnswers(newAnswers)
    setPickedSymbol(symbol)
    setWasCorrect(correct)
    setLastRoundTime(roundTime)
    setPhase('feedback')

    advanceTimeoutRef.current = setTimeout(() => {
      const nextIdx = currentIdx + 1
      if (nextIdx >= TOTAL_ROUNDS) {
        submitScore(newAnswers, elapsed + FEEDBACK_MS / 1000)
        setPhase('results')
        return
      }
      setCurrentIdx(nextIdx)
      setPickedSymbol(null)
      setWasCorrect(null)
      setPhase('playing')
    }, FEEDBACK_MS)
  }

  // Choose grid column count based on grid size — mobile-friendly
  const gridCols = currentRound
    ? (currentRound.symbols.length <= 15 ? 'grid-cols-4 sm:grid-cols-5'
      : currentRound.symbols.length <= 20 ? 'grid-cols-4 sm:grid-cols-5'
      : 'grid-cols-5 sm:grid-cols-5')
    : 'grid-cols-5'

  return (
    <div className="cbat-symbols-page">
      <SEO title="Symbols — CBAT" description="Spot the matching symbol in a grid as fast as you can." />

      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <Link to="/cbat" className="text-slate-500 hover:text-brand-400 transition-colors text-sm">&larr; CBAT</Link>
        <h1 className="text-sm font-extrabold text-slate-900">Symbols</h1>
      </div>

      {/* Not logged in */}
      {!user && (
        <div className="bg-surface rounded-2xl border border-slate-200 p-6 text-center card-shadow">
          <div className="text-4xl mb-3">{'\u{1F512}'}</div>
          <p className="font-bold text-slate-800 mb-1">Sign in to play</p>
          <p className="text-sm text-slate-500 mb-4">Create a free account to access CBAT games.</p>
          <Link to="/login" className="inline-flex px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors">
            Sign In
          </Link>
        </div>
      )}

      {/* Logged in — game */}
      {user && (
        <div className="flex flex-col items-center">

          {/* Intro screen */}
          {phase === 'intro' && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full max-w-md bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-6 text-center"
            >
              <p className="text-4xl mb-3">{'\u{1F523}'}</p>
              <p className="text-xl font-extrabold text-white mb-2">Symbol Recognition</p>
              <p className="text-sm text-slate-400 mb-5">
                Spot the target symbol in the grid as fast as you can. 15 rounds of
                increasing difficulty.
              </p>

              <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-4 mb-5 text-left space-y-2">
                <div className="flex items-start gap-2 text-sm text-[#ddeaf8]">
                  <span className="text-brand-300 font-bold shrink-0">T1</span>
                  <span>{'Rounds 1\u20135 \u00b7 grid of 12\u201315 symbols'}</span>
                </div>
                <div className="flex items-start gap-2 text-sm text-[#ddeaf8]">
                  <span className="text-brand-300 font-bold shrink-0">T2</span>
                  <span>{'Rounds 6\u201310 \u00b7 grid of 15\u201320 symbols'}</span>
                </div>
                <div className="flex items-start gap-2 text-sm text-[#ddeaf8]">
                  <span className="text-brand-300 font-bold shrink-0">T3</span>
                  <span>{'Rounds 11\u201315 \u00b7 grid of 18\u201325 symbols'}</span>
                </div>
                <div className="flex items-start gap-2 text-xs text-[#8a9bb5]">
                  <span className="shrink-0">{'\u26A0\uFE0F'}</span>
                  <span>{'A wrong click counts as missed \u2014 round skips automatically'}</span>
                </div>
              </div>

              {personalBest && (
                <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 mb-4 text-center">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Personal Best</p>
                  <p className="text-lg font-mono font-bold text-brand-300">
                    {personalBest.bestScore}/{TOTAL_ROUNDS} ({Math.round((personalBest.bestScore / TOTAL_ROUNDS) * 100)}%)
                    <span className="text-slate-500 mx-1">{'\u00b7'}</span>
                    {personalBest.bestTime.toFixed(1)}s
                  </p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{personalBest.attempts} attempt{personalBest.attempts !== 1 ? 's' : ''}</p>
                </div>
              )}

              <div className="text-center mb-4">
                <Link to="/cbat/symbols/leaderboard" className="text-xs text-brand-300 hover:text-brand-200 transition-colors">
                  {'View Leaderboard \u2192'}
                </Link>
              </div>

              <button
                onClick={startGame}
                className="px-8 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg transition-colors text-sm"
              >
                Start
              </button>
            </motion.div>
          )}

          {/* Playing / Feedback */}
          {(phase === 'playing' || phase === 'feedback') && currentRound && (
            <div className="w-full max-w-md">
              {/* HUD */}
              <div className="flex items-center justify-between text-xs font-mono mb-2 px-1">
                <span className="text-slate-400">
                  Round <span className="text-brand-300">{currentIdx + 1}</span>/{TOTAL_ROUNDS}
                </span>
                <span className="text-slate-400">
                  Tier <span className="text-brand-300">{currentRound.tier + 1}</span>
                </span>
                <span className="text-slate-400">
                  {'\u2713'} <span className="text-green-400">{answers.filter(a => a.correct).length}</span>
                </span>
                <span className="text-slate-400">
                  {'\u23F1'} <span className="text-brand-300">{elapsed.toFixed(1)}s</span>
                </span>
              </div>

              {/* Progress bar */}
              <div className="w-full h-1 bg-[#1a3a5c] rounded-full mb-3 overflow-hidden">
                <motion.div
                  className="h-full bg-brand-600 rounded-full"
                  initial={false}
                  animate={{ width: `${((currentIdx + (phase === 'feedback' ? 1 : 0)) / TOTAL_ROUNDS) * 100}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>

              {/* Symbol grid */}
              <motion.div
                key={currentIdx}
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-3 mb-3"
              >
                <p className="text-[10px] text-slate-500 uppercase tracking-wide text-center mb-3">
                  Find the target symbol
                </p>
                <div className={`grid ${gridCols} gap-1.5`}>
                  {currentRound.symbols.map((sym, i) => {
                    let btnClass = 'bg-[#060e1a] border-[#1a3a5c] text-[#ddeaf8] hover:border-brand-400 hover:bg-[#0f2240]'
                    if (phase === 'feedback') {
                      if (sym === currentRound.target) {
                        btnClass = 'bg-green-500/20 border-green-500/50 text-green-300'
                      } else if (sym === pickedSymbol && !wasCorrect) {
                        btnClass = 'bg-red-500/20 border-red-500/50 text-red-300'
                      } else {
                        btnClass = 'bg-[#060e1a] border-[#1a3a5c] text-[#5a6a80] opacity-50'
                      }
                    }
                    return (
                      <button
                        key={i}
                        onClick={() => handlePick(sym)}
                        disabled={phase === 'feedback'}
                        className={`aspect-square flex items-center justify-center rounded-lg border-2 text-2xl sm:text-3xl transition-all ${btnClass} ${
                          phase === 'feedback' ? 'cursor-default' : 'cursor-pointer'
                        }`}
                      >
                        {sym}
                      </button>
                    )
                  })}
                </div>
              </motion.div>

              {/* Target card */}
              <div className="bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-4 relative overflow-hidden">
                <p className="text-[10px] text-slate-500 uppercase tracking-wide text-center mb-2">
                  Target
                </p>
                <div className="flex items-center justify-center">
                  <div className="w-24 h-24 rounded-xl border-2 border-brand-400 bg-[#060e1a] flex items-center justify-center text-6xl">
                    {currentRound.target}
                  </div>
                </div>

                {/* Feedback overlay */}
                <AnimatePresence>
                  {phase === 'feedback' && (
                    <motion.div
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className={`absolute top-2 right-2 px-3 py-1.5 rounded-lg text-xs font-bold ${
                        wasCorrect
                          ? 'bg-green-500/20 border border-green-500/40 text-green-400'
                          : 'bg-red-500/20 border border-red-500/40 text-red-400'
                      }`}
                    >
                      {wasCorrect ? `\u2713 Found in ${lastRoundTime.toFixed(2)}s` : '\u2717 Missed'}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Tier transition indicator */}
              <AnimatePresence>
                {phase === 'playing' && (currentIdx === 5 || currentIdx === 10) && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-center mt-2"
                  >
                    <span className="text-xs text-brand-300 font-bold">
                      Tier {tierFor(currentIdx) + 1} {'\u2014 grid grows larger'}
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Results */}
          {phase === 'results' && (
            <ResultsScreen
              answers={answers}
              totalTime={elapsed}
              onPlayAgain={() => { setScoreSaved(false); startGame() }}
              scoreSaved={scoreSaved}
            />
          )}
        </div>
      )}
    </div>
  )
}
