import { useState, useCallback, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { recordCbatStart } from '../utils/cbat/recordStart'
import { useGameChrome } from '../context/GameChromeContext'
import SEO from '../components/SEO'

// ── Constants ────────────────────────────────────────────────────────────────
const TOTAL_ROUNDS = 15
const DISPLAY_TIME = 5000 // ms to show the sequence
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

// ── Sequence generation ─────────────────────────────────────────────────────
function getSequenceLength(round) {
  if (round <= 5) return 7 + Math.floor(Math.random() * 4)       // 7–10
  if (round <= 10) return 8 + Math.floor(Math.random() * 5)      // 8–12
  return 12 + Math.floor(Math.random() * 4)                       // 12–15
}

function generateSequence(length) {
  return Array.from({ length }, () => DIGITS[Math.floor(Math.random() * DIGITS.length)])
}

function pickQueryDigit(sequence) {
  return sequence[Math.floor(Math.random() * sequence.length)]
}

function countOccurrences(sequence, digit) {
  return sequence.filter(d => d === digit).length
}

// ── Results screen ──────────────────────────────────────────────────────────
function ResultsScreen({ rounds, totalTime, onPlayAgain, scoreSaved }) {
  const correct = rounds.filter(r => r.correct).length
  const pct = Math.round((correct / TOTAL_ROUNDS) * 100)

  const grade = pct >= 90 ? { label: 'Outstanding', emoji: '🎖️', color: 'text-green-400' }
    : pct >= 70 ? { label: 'Good', emoji: '🧩', color: 'text-brand-300' }
    : pct >= 50 ? { label: 'Needs Work', emoji: '🔧', color: 'text-amber-400' }
    : { label: 'Failed', emoji: '💥', color: 'text-red-400' }

  const tierLabel = (i) => i < 5 ? 'Easy' : i < 10 ? 'Medium' : 'Hard'
  const tiers = ['Easy', 'Medium', 'Hard']
  const tierCorrect = tiers.map((t, ti) => {
    const start = ti * 5
    return rounds.slice(start, start + 5).filter(r => r.correct).length
  })

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="w-full max-w-md bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-8 text-center"
    >
      <p className="text-5xl mb-3">{grade.emoji}</p>
      <p className={`text-2xl font-extrabold mb-1 ${grade.color}`}>{grade.label}</p>
      <p className="text-sm text-slate-400 mb-6">Code Duplicates Assessment Complete</p>

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
      </div>

      <div className="grid grid-cols-3 gap-3 mb-6">
        {tiers.map((t, ti) => (
          <div key={t} className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">{t}</p>
            <p className="text-xl font-mono font-bold text-brand-300">{tierCorrect[ti]}/5</p>
          </div>
        ))}
      </div>

      {/* Answer review */}
      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 mb-6 max-h-48 overflow-y-auto">
        <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-2 sticky top-0 bg-[#060e1a]">Answer Review</p>
        <div className="space-y-1">
          {rounds.map((r, i) => (
            <div key={i} className={`flex items-center justify-between text-xs px-2 py-1 rounded ${r.correct ? 'text-green-400' : 'text-red-400'}`}>
              <span className="text-slate-500 w-6 text-left">#{i + 1}</span>
              <span>{r.correct ? '✓' : '✗'}</span>
              <span className="font-mono text-slate-400">{r.sequenceLength} digits</span>
              <span className="font-mono">"{r.queryDigit}" &times;{r.actualCount}</span>
              {!r.correct && <span className="text-slate-500">said {r.userAnswer}</span>}
              {r.correct && <span className="text-slate-500">—</span>}
            </div>
          ))}
        </div>
      </div>

      {scoreSaved && (
        <p className="text-xs text-green-400 mb-4">✓ Score saved</p>
      )}

      <div className="flex flex-wrap gap-3 justify-center">
        <button
          onClick={onPlayAgain}
          className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-lg transition-colors"
        >
          Play Again
        </button>
        <Link
          to="/cbat/code-duplicates/leaderboard"
          className="px-5 py-2.5 bg-[#1a3a5c] hover:bg-[#254a6e] text-[#ddeaf8] text-sm font-bold rounded-lg transition-colors no-underline"
        >
          🏆 Leaderboard
        </Link>
      </div>
    </motion.div>
  )
}

// ── Main Component ──────────────────────────────────────────────────────────
export default function CbatCodeDuplicates() {
  const { user, apiFetch, API } = useAuth()

  // phase: intro | displaying | answering | feedback | results
  const [phase, setPhase] = useState('intro')
  const { enterImmersive, exitImmersive } = useGameChrome()
  useEffect(() => {
    if (phase === 'displaying' || phase === 'answering' || phase === 'feedback') enterImmersive()
    else exitImmersive()
    return exitImmersive
  }, [phase, enterImmersive, exitImmersive])
  const [round, setRound] = useState(1)
  const [sequence, setSequence] = useState([])
  const [queryDigit, setQueryDigit] = useState(null)
  const [actualCount, setActualCount] = useState(0)
  const [userAnswer, setUserAnswer] = useState('')
  const [isCorrect, setIsCorrect] = useState(null)
  const [roundResults, setRoundResults] = useState([])
  const [elapsed, setElapsed] = useState(0)
  const [displayCountdown, setDisplayCountdown] = useState(5)

  const timerRef = useRef(null)
  const displayTimerRef = useRef(null)
  const countdownRef = useRef(null)
  const inputRef = useRef(null)
  const [personalBest, setPersonalBest] = useState(null)
  const [scoreSaved, setScoreSaved] = useState(false)

  const tierLabel = round <= 5 ? 'Easy' : round <= 10 ? 'Medium' : 'Hard'

  // Fetch personal best
  useEffect(() => {
    if (!user) return
    apiFetch(`${API}/api/games/cbat/code-duplicates/personal-best`)
      .then(r => r.json())
      .then(d => { if (d.data) setPersonalBest(d.data) })
      .catch(() => {})
  }, [user])

  // Submit score to backend
  const submitScore = useCallback((finalRounds, finalTime) => {
    const correct = finalRounds.filter(r => r.correct).length
    const pct = Math.round((correct / TOTAL_ROUNDS) * 100)
    const easyCorrect = finalRounds.slice(0, 5).filter(r => r.correct).length
    const mediumCorrect = finalRounds.slice(5, 10).filter(r => r.correct).length
    const hardCorrect = finalRounds.slice(10, 15).filter(r => r.correct).length
    const grade = pct >= 90 ? 'Outstanding' : pct >= 70 ? 'Good' : pct >= 50 ? 'Needs Work' : 'Failed'

    setScoreSaved(false)
    apiFetch(`${API}/api/games/cbat/code-duplicates/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        correctCount: correct,
        easyCorrect,
        mediumCorrect,
        hardCorrect,
        totalTime: finalTime,
        grade,
      }),
    })
      .then(r => r.json())
      .then(() => {
        setScoreSaved(true)
        apiFetch(`${API}/api/games/cbat/code-duplicates/personal-best`)
          .then(r => r.json())
          .then(d => { if (d.data) setPersonalBest(d.data) })
          .catch(() => {})
      })
      .catch(() => {})
  }, [apiFetch, API])

  // Timer — runs during displaying, answering, feedback phases
  useEffect(() => {
    if (phase === 'displaying' || phase === 'answering') {
      const offset = elapsed * 1000
      const t0 = Date.now() - offset
      timerRef.current = setInterval(() => {
        setElapsed((Date.now() - t0) / 1000)
      }, 100)
      return () => clearInterval(timerRef.current)
    } else {
      clearInterval(timerRef.current)
    }
  }, [phase])

  const startRound = useCallback((roundNum) => {
    const len = getSequenceLength(roundNum)
    const seq = generateSequence(len)
    const qDigit = pickQueryDigit(seq)
    const count = countOccurrences(seq, qDigit)

    setRound(roundNum)
    setSequence(seq)
    setQueryDigit(qDigit)
    setActualCount(count)
    setUserAnswer('')
    setIsCorrect(null)
    setDisplayCountdown(5)
    setPhase('displaying')

    // Countdown timer for display
    let remaining = 5
    clearInterval(countdownRef.current)
    countdownRef.current = setInterval(() => {
      remaining -= 1
      setDisplayCountdown(remaining)
      if (remaining <= 0) {
        clearInterval(countdownRef.current)
      }
    }, 1000)

    // After DISPLAY_TIME, move to answering phase
    clearTimeout(displayTimerRef.current)
    displayTimerRef.current = setTimeout(() => {
      clearInterval(countdownRef.current)
      setPhase('answering')
    }, DISPLAY_TIME)
  }, [])

  // Focus input when answering phase starts
  useEffect(() => {
    if (phase === 'answering' && inputRef.current) {
      inputRef.current.focus()
    }
  }, [phase])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimeout(displayTimerRef.current)
      clearInterval(timerRef.current)
      clearInterval(countdownRef.current)
    }
  }, [])

  const startGame = useCallback(() => {
    recordCbatStart('code-duplicates', apiFetch, API)
    setRoundResults([])
    setElapsed(0)
    startRound(1)
  }, [startRound, apiFetch, API])

  const goToIntro = useCallback(() => {
    clearTimeout(displayTimerRef.current)
    clearInterval(timerRef.current)
    clearInterval(countdownRef.current)
    setPhase('intro')
    setRound(1)
    setSequence([])
    setQueryDigit(null)
    setActualCount(0)
    setUserAnswer('')
    setIsCorrect(null)
    setRoundResults([])
    setElapsed(0)
    setScoreSaved(false)
  }, [])

  const handleSubmit = () => {
    if (phase !== 'answering' || userAnswer === '') return
    const answer = parseInt(userAnswer, 10)
    const correct = answer === actualCount

    setIsCorrect(correct)
    setRoundResults(prev => [...prev, {
      round,
      sequenceLength: sequence.length,
      queryDigit,
      actualCount,
      userAnswer: answer,
      correct,
    }])
    setPhase('feedback')
  }

  const handleNext = () => {
    const nextRound = round + 1
    if (nextRound > TOTAL_ROUNDS) {
      submitScore(roundResults, elapsed)
      setPhase('results')
      return
    }
    startRound(nextRound)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleSubmit()
    }
  }

  return (
    <div className="cbat-code-duplicates-page">
      <SEO title="Code Duplicates — CBAT" description="Count how many times a digit appeared in a sequence." />

      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        {phase === 'intro'
          ? <Link to="/cbat" className="text-slate-500 hover:text-brand-400 transition-colors text-sm">&larr; CBAT</Link>
          : <button onClick={goToIntro} className="text-slate-500 hover:text-brand-400 transition-colors text-sm bg-transparent border-0 p-0 cursor-pointer">&larr; Instructions</button>
        }
        <h1 className="text-sm font-extrabold text-slate-900">Code Duplicates</h1>
      </div>

      {/* Not logged in */}
      {!user && (
        <div className="bg-surface rounded-2xl border border-slate-200 p-6 text-center card-shadow">
          <div className="text-4xl mb-3">🔒</div>
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
              <p className="text-4xl mb-3">🧩</p>
              <p className="text-xl font-extrabold text-white mb-2">Code Duplicates</p>
              <p className="text-sm text-slate-400 mb-5">
                A sequence of digits will flash on screen for 5 seconds. Memorise them, then count how many times a specific digit appeared.
              </p>

              <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-4 mb-5 text-left space-y-2">
                <div className="flex items-start gap-2 text-sm text-[#ddeaf8]">
                  <span className="text-brand-300 font-bold shrink-0">1–5</span>
                  <span>Easy — 7 to 10 digits</span>
                </div>
                <div className="flex items-start gap-2 text-sm text-[#ddeaf8]">
                  <span className="text-brand-300 font-bold shrink-0">6–10</span>
                  <span>Medium — 8 to 12 digits</span>
                </div>
                <div className="flex items-start gap-2 text-sm text-[#ddeaf8]">
                  <span className="text-brand-300 font-bold shrink-0">11–15</span>
                  <span>Hard — 12 to 15 digits</span>
                </div>
                <div className="flex items-start gap-2 text-xs text-[#8a9bb5]">
                  <span className="shrink-0">⏱</span>
                  <span>Each sequence is shown for 5 seconds</span>
                </div>
              </div>

              {personalBest && (
                <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 mb-4 text-center">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Personal Best</p>
                  <p className="text-lg font-mono font-bold text-brand-300">
                    {personalBest.bestScore}/{TOTAL_ROUNDS} ({Math.round((personalBest.bestScore / TOTAL_ROUNDS) * 100)}%)
                    <span className="text-slate-500 mx-1">·</span>
                    {personalBest.bestTime.toFixed(1)}s
                  </p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{personalBest.attempts} attempt{personalBest.attempts !== 1 ? 's' : ''}</p>
                </div>
              )}

              <div className="text-center mb-4">
                <Link to="/cbat/code-duplicates/leaderboard" className="text-xs text-brand-300 hover:text-brand-200 transition-colors">
                  View Leaderboard →
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

          {/* Displaying / Answering / Feedback */}
          {(phase === 'displaying' || phase === 'answering' || phase === 'feedback') && (
            <div className="w-full max-w-md">
              {/* HUD */}
              <div className="flex items-center justify-between text-xs font-mono mb-2 px-1">
                <span className="text-slate-400">
                  Round <span className="text-brand-300">{round}</span>/{TOTAL_ROUNDS}
                </span>
                <span className="text-slate-400">
                  <span className="text-brand-300">{tierLabel}</span>
                </span>
                <span className="text-slate-400">
                  ✓ <span className="text-green-400">{roundResults.filter(r => r.correct).length}</span>
                </span>
                <span className="text-slate-400">
                  ⏱ <span className="text-brand-300">{elapsed.toFixed(1)}s</span>
                </span>
              </div>

              {/* Progress bar */}
              <div className="w-full h-1 bg-[#1a3a5c] rounded-full mb-3 overflow-hidden">
                <motion.div
                  className="h-full bg-brand-600 rounded-full"
                  initial={false}
                  animate={{ width: `${((round - 1 + (phase === 'feedback' ? 1 : 0)) / TOTAL_ROUNDS) * 100}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>

              {/* Main display area */}
              <motion.div
                key={round}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-6 mb-3 relative overflow-hidden min-h-[200px] flex flex-col items-center justify-center"
              >
                {/* Radar sweep */}
                <div className="absolute inset-0 pointer-events-none opacity-[0.03]"
                  style={{
                    background: 'conic-gradient(from 0deg, transparent 0deg, rgba(91,170,255,0.5) 30deg, transparent 60deg)',
                    animation: 'radar-sweep 4s linear infinite',
                  }}
                />

                {/* Displaying phase — show sequence */}
                {phase === 'displaying' && (
                  <div className="relative z-10 text-center">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-4">
                      Memorise this sequence — {displayCountdown}s
                    </p>
                    <div className="flex w-full gap-1.5">
                      {sequence.map((digit, i) => (
                        <motion.span
                          key={i}
                          initial={{ opacity: 0, scale: 0.5 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: i * 0.06 }}
                          className="inline-flex items-center justify-center flex-1 min-w-0 aspect-square rounded-lg bg-[#060e1a] border border-[#1a3a5c] text-2xl font-mono font-bold text-brand-300"
                        >
                          {digit}
                        </motion.span>
                      ))}
                    </div>
                    {/* Countdown bar */}
                    <div className="w-full h-1 bg-[#1a3a5c] rounded-full mt-4 overflow-hidden">
                      <motion.div
                        className="h-full bg-amber-500 rounded-full"
                        initial={{ width: '100%' }}
                        animate={{ width: '0%' }}
                        transition={{ duration: DISPLAY_TIME / 1000, ease: 'linear' }}
                      />
                    </div>
                  </div>
                )}

                {/* Answering phase — ask the question */}
                {phase === 'answering' && (
                  <div className="relative z-10 text-center w-full">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-3">
                      How many times did this digit appear?
                    </p>
                    <p className="text-5xl font-mono font-bold text-brand-300 mb-6">{queryDigit}</p>
                    <div className="flex items-center justify-center gap-3">
                      <input
                        ref={inputRef}
                        type="number"
                        min="0"
                        max="20"
                        value={userAnswer}
                        onChange={(e) => setUserAnswer(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="w-20 h-12 text-center text-2xl font-mono font-bold rounded-lg bg-[#060e1a] border-2 border-[#1a3a5c] text-[#ddeaf8] focus:border-brand-400 focus:outline-none transition-colors"
                        placeholder="?"
                      />
                      <button
                        onClick={handleSubmit}
                        disabled={userAnswer === ''}
                        className="px-5 h-12 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg transition-colors"
                      >
                        Submit
                      </button>
                    </div>
                  </div>
                )}

                {/* Feedback phase */}
                {phase === 'feedback' && (
                  <div className="relative z-10 text-center">
                    <motion.div
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                    >
                      <p className="text-4xl mb-3">{isCorrect ? '✓' : '✗'}</p>
                      <p className={`text-xl font-extrabold mb-2 ${isCorrect ? 'text-green-400' : 'text-red-400'}`}>
                        {isCorrect ? 'Correct!' : 'Wrong'}
                      </p>
                      <p className="text-sm text-slate-400 mb-1">
                        The digit <span className="font-mono font-bold text-brand-300">{queryDigit}</span> appeared <span className="font-mono font-bold text-brand-300">{actualCount}</span> time{actualCount !== 1 ? 's' : ''}.
                      </p>
                      {!isCorrect && (
                        <p className="text-sm text-slate-500">
                          You answered <span className="font-mono font-bold text-red-400">{userAnswer}</span>.
                        </p>
                      )}

                      {/* Show the sequence again for review */}
                      <div className="flex w-full gap-1 mt-4">
                        {sequence.map((digit, i) => (
                          <span
                            key={i}
                            className={`inline-flex items-center justify-center flex-1 min-w-0 aspect-square rounded-md text-lg font-mono font-bold border ${
                              digit === queryDigit
                                ? 'bg-brand-600/20 border-brand-400 text-brand-300'
                                : 'bg-[#060e1a] border-[#1a3a5c] text-slate-500'
                            }`}
                          >
                            {digit}
                          </span>
                        ))}
                      </div>
                    </motion.div>
                  </div>
                )}
              </motion.div>

              {/* Next button (feedback phase) */}
              <AnimatePresence>
                {phase === 'feedback' && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-center"
                  >
                    <button
                      onClick={handleNext}
                      className="px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-lg transition-colors"
                    >
                      {round >= TOTAL_ROUNDS ? 'View Results' : 'Next Round'}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Tier transition indicator */}
              <AnimatePresence>
                {phase === 'displaying' && (round === 6 || round === 11) && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-center mt-2"
                  >
                    <span className="text-xs text-brand-300 font-bold">
                      {round === 6 ? 'Medium — sequences are now longer' : 'Hard — maximum length sequences'}
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Results */}
          {phase === 'results' && (
            <ResultsScreen
              rounds={roundResults}
              totalTime={elapsed}
              onPlayAgain={() => { setScoreSaved(false); startGame() }}
              scoreSaved={scoreSaved}
            />
          )}
        </div>
      )}

      <style>{`
        @keyframes radar-sweep {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
