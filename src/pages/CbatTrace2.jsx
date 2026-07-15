import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { submitCbatResult } from '../lib/cbatOutbox'
import { useCbatTracking } from '../utils/cbat/useCbatTracking'
import { useGameChrome } from '../context/GameChromeContext'
import CbatGameOver from '../components/CbatGameOver'
import SkywatchLogoIntro from '../components/SkywatchLogoIntro'
import { getModelUrl } from '../data/aircraftModels'
import { generateTrace2Game, TRACE2_ROUNDS, TRACE2_COLORS, replayStatKind } from '../utils/cbat/trace2Generator'

const Trace2Scene = lazy(() => import('../components/Trace2Scene'))
const MODEL_URL = getModelUrl(null, 'Hawk T2')
const HEX = Object.fromEntries(TRACE2_COLORS.map(c => [c.key, c.hex]))

// Sky gradient shared with Trace 1's smooth-flight arena.
const SKY_BG = 'linear-gradient(180deg, #cfe8ff 0%, #8fc4ee 45%, #5398d3 80%, #3a7bbf 100%)'

// Colour dot(s) for an option label.
function Dots({ colors }) {
  return (
    <span className="flex items-center gap-1">
      {colors.map((c, i) => (
        <span key={i} className="inline-block w-3 h-3 rounded-full ring-1 ring-black/30" style={{ background: HEX[c] }} />
      ))}
    </span>
  )
}

// ── Trace 2 HUD ──────────────────────────────────────────────────────────────
function Trace2HUD({ round, score, phase }) {
  return (
    <div className="flex items-center justify-between text-xs font-mono mb-2 px-1">
      <span className="text-slate-400">ROUND <span className="text-brand-300">{Math.min(round + 1, TRACE2_ROUNDS)}</span>/{TRACE2_ROUNDS}</span>
      <span className="text-slate-400">{phase === 'watch' ? '👀 WATCH' : phase === 'question' ? '❓ RECALL' : ''}</span>
      <span className="text-slate-400">SCORE <span className="text-brand-300">{score}</span></span>
    </div>
  )
}

// ── Start / menu screen ──────────────────────────────────────────────────────
function StartScreen({ onStart, personalBest, traceModeSelector }) {
  return (
    <div>
      {traceModeSelector && <div className="mb-4 flex justify-center">{traceModeSelector}</div>}

      <h2 className="text-lg font-bold text-slate-800 text-center mb-1">Trace 2</h2>
      <p className="text-xs text-slate-400 text-center mb-3">Watch four aircraft manoeuvre — then recall what they did.</p>

      <div className="max-w-md mx-auto mb-3 rounded-lg border-2 border-emerald-700 bg-emerald-100 p-3 text-sm">
        <span className="font-extrabold uppercase tracking-wide text-emerald-800">Trace 2 — Memory.</span>{' '}
        <span className="text-slate-800">Four coloured jets fly the sky. After each round the picture clears and you answer one question about their movements. 8 rounds — questions get harder.</span>
      </div>

      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-4 max-w-md mx-auto mb-4 text-sm text-[#ddeaf8] space-y-1.5">
        <div className="flex items-start gap-2">
          <span className="text-brand-300 shrink-0">👀</span>
          <span>Watch <span className="font-bold text-red-300">Red</span>, <span className="font-bold text-yellow-300">Yellow</span>, <span className="font-bold text-blue-300">Blue</span> and <span className="font-bold text-green-300">Green</span> fly for a few seconds.</span>
        </div>
        <div className="flex items-start gap-2">
          <span className="text-brand-300 shrink-0">🧠</span>
          <span>Track their turns, climbs, entry/exit sides and orientation.</span>
        </div>
        <div className="flex items-start gap-2">
          <span className="text-brand-300 shrink-0">❓</span>
          <span>Answer one multiple-choice question per round, from memory.</span>
        </div>
        <div className="flex items-start gap-2">
          <span className="text-brand-300 shrink-0">🏆</span>
          <span>+1 per correct answer. 8 rounds — aim for 8/8.</span>
        </div>
      </div>

      {personalBest && (
        <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 max-w-md mx-auto mb-2 text-center">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Personal Best</p>
          <p className="text-lg font-mono font-bold text-brand-300">{personalBest.bestScore}/{TRACE2_ROUNDS}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">{personalBest.attempts} attempt{personalBest.attempts !== 1 ? 's' : ''}</p>
        </div>
      )}

      <div className="text-center mb-4">
        <Link to="/cbat/trace-2/leaderboard" className="text-xs text-brand-300 hover:text-brand-200 transition-colors">View Leaderboard →</Link>
      </div>

      <div className="flex justify-center">
        <button
          onClick={onStart}
          className="px-8 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors"
        >
          Start Trace 2
        </button>
      </div>
    </div>
  )
}

export default function CbatTrace2({ traceModeSelector }) {
  const { user, apiFetch, API } = useAuth()
  const { start: startTracking, markCompleted: markGameCompleted } = useCbatTracking()
  const { enterImmersive, exitImmersive } = useGameChrome()

  const [phase, setPhase] = useState('menu') // menu | intro | watch | question | finished
  const [game, setGame] = useState(null)
  const [roundIndex, setRoundIndex] = useState(0)
  const [answered, setAnswered] = useState(false)
  const [chosen, setChosen] = useState(null)
  const [correctCount, setCorrectCount] = useState(0)
  const [personalBest, setPersonalBest] = useState(null)
  const [scoreSaved, setScoreSaved] = useState(false)
  const [queued, setQueued] = useState(false)
  const [showRoundBanner, setShowRoundBanner] = useState(false)
  const [replaying, setReplaying] = useState(false)
  const [replayStage, setReplayStage] = useState('rewind') // rewind | forward
  const [replayKey, setReplayKey] = useState(0)

  const correctRef = useRef(0)
  const startedAtRef = useRef(0)
  const introPlayedRef = useRef(false)
  const watchTimerRef = useRef(null)
  const feedbackTimerRef = useRef(null)

  const round = game?.rounds?.[roundIndex] ?? null

  // Immersive chrome during play.
  useEffect(() => {
    if (phase === 'menu') exitImmersive()
    else enterImmersive()
    return exitImmersive
  }, [phase, enterImmersive, exitImmersive])

  // Personal best.
  useEffect(() => {
    if (!user) return
    apiFetch(`${API}/api/games/cbat/trace-2/personal-best`)
      .then(r => r.json())
      .then(d => { if (d.data) setPersonalBest(d.data) })
      .catch(() => {})
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  const clearTimers = () => {
    if (watchTimerRef.current) { clearTimeout(watchTimerRef.current); watchTimerRef.current = null }
    if (feedbackTimerRef.current) { clearTimeout(feedbackTimerRef.current); feedbackTimerRef.current = null }
  }
  useEffect(() => () => clearTimers(), [])

  // Watch-phase timer: play the round's animation, then reveal the question.
  useEffect(() => {
    if (phase !== 'watch' || !round) return
    setShowRoundBanner(true)
    const bannerT = setTimeout(() => setShowRoundBanner(false), 1100)
    // durationMs already includes a couple of ticks of onward flight past the
    // last turn; the aircraft fly continuously (never freeze), so the picture
    // clears with everything still in motion.
    watchTimerRef.current = setTimeout(() => setPhase('question'), round.durationMs)
    return () => { clearTimeout(bannerT); if (watchTimerRef.current) clearTimeout(watchTimerRef.current) }
  }, [phase, roundIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  const startGame = useCallback(() => {
    startTracking('trace-2', {})
    const g = generateTrace2Game()
    setGame(g)
    setRoundIndex(0)
    setAnswered(false)
    setChosen(null)
    setCorrectCount(0)
    correctRef.current = 0
    setScoreSaved(false)
    setQueued(false)
    startedAtRef.current = performance.now()
    setPhase(introPlayedRef.current ? 'watch' : 'intro')
  }, [startTracking])

  const handleIntroComplete = useCallback(() => {
    introPlayedRef.current = true
    setPhase('watch')
  }, [])

  const submitScore = useCallback((correct) => {
    setScoreSaved(false)
    setQueued(false)
    const totalTime = Math.round(performance.now() - startedAtRef.current)
    markGameCompleted({ score: correct })
    submitCbatResult('trace-2', {
      correctCount: correct,
      totalQuestions: TRACE2_ROUNDS,
      totalTime,
      avgTimePerQuestionMs: Math.round(totalTime / TRACE2_ROUNDS),
    }, { apiFetch, API })
      .then(r => {
        setScoreSaved(!!r?.synced)
        setQueued(!!r?.queued)
        apiFetch(`${API}/api/games/cbat/trace-2/personal-best`)
          .then(r => r.json())
          .then(d => { if (d.data) setPersonalBest(d.data) })
          .catch(() => {})
      })
      .catch(() => {})
  }, [apiFetch, API, markGameCompleted])

  const handleAnswer = (optIndex) => {
    if (answered || !round) return
    setAnswered(true)
    setChosen(optIndex)
    const correct = round.question.options[optIndex]?.correct
    if (correct) { correctRef.current += 1; setCorrectCount(correctRef.current) }
    // No auto-advance: the player chooses to Replay or Continue.
  }

  const advanceRound = () => {
    clearTimers()
    setReplaying(false)
    if (roundIndex + 1 >= TRACE2_ROUNDS) {
      setPhase('finished')
      submitScore(correctRef.current)
    } else {
      setRoundIndex(i => i + 1)
      setAnswered(false)
      setChosen(null)
      setPhase('watch')
    }
  }

  const startReplay = () => { setReplayStage('rewind'); setReplayKey(k => k + 1); setReplaying(true) }
  const handleReplayStage = (stage) => setReplayStage(stage)
  const handleReplayDone = () => setReplaying(false)

  const handlePlayAgain = () => {
    clearTimers()
    startGame()
  }
  const handleBackToMenu = () => {
    clearTimers()
    introPlayedRef.current = false
    setPhase('menu')
    setGame(null)
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (!user) return null // parent gates auth

  return (
    <div className="w-full flex flex-col items-center">
      {/* Header — back goes to the Instructions (menu) screen while in a game,
          or out to the CBAT hub from the menu, like every other CBAT game. */}
      <div className="w-full flex items-center gap-2 mb-2">
        {phase === 'menu'
          ? <Link to="/cbat" className="text-slate-500 hover:text-brand-400 transition-colors text-sm">&larr; CBAT</Link>
          : <button onClick={handleBackToMenu} className="text-slate-500 hover:text-brand-400 transition-colors text-sm bg-transparent border-0 p-0 cursor-pointer">&larr; Instructions</button>
        }
        <h1 className="text-sm font-extrabold text-slate-900">Trace 2</h1>
      </div>

      {phase === 'menu' && (
        <div className="w-full max-w-md bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-5">
          <StartScreen onStart={startGame} personalBest={personalBest} traceModeSelector={traceModeSelector} />
        </div>
      )}

      {phase === 'finished' && (
        <CbatGameOver
          gameKey="trace-2"
          score={correctCount}
          scoreSaved={scoreSaved}
          queued={queued}
          personalBest={personalBest}
          onPlayAgain={handlePlayAgain}
          extraActions={[{ label: 'Back to Modes', onClick: handleBackToMenu }]}
        >
          <div className="w-full bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-8 text-center">
            <p className="text-4xl mb-2">🛩️</p>
            <p className="text-xl font-extrabold text-white mb-1">Trace 2 Complete</p>
            <p className="text-sm text-slate-400 mb-5">All {TRACE2_ROUNDS} rounds finished.</p>
            <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-4 sm:p-5">
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">Final Score</p>
              <p className="text-3xl sm:text-4xl font-mono font-bold text-brand-300">
                {correctCount}<span className="text-slate-400">/{TRACE2_ROUNDS}</span>
              </p>
              <p className="text-xs text-slate-500 mt-1">correct</p>
            </div>
          </div>
        </CbatGameOver>
      )}

      {(phase === 'watch' || phase === 'question') && round && (
        <div className="w-full max-w-md">
          <Trace2HUD round={roundIndex} score={correctCount} phase={phase} />

          <div
            className="relative border-2 border-[#3a7bbf] rounded-xl overflow-hidden shadow-[0_0_30px_rgba(91,170,255,0.08)]"
            style={{ width: '100%', aspectRatio: '1', background: SKY_BG }}
          >
            {/* Persistent scene across watch + question; frozen (and covered) once
                the question is up so the player answers from memory. */}
            <Suspense fallback={null}>
              <Trace2Scene
                aircraft={round.aircraft}
                modelUrl={MODEL_URL}
                active={phase === 'watch'}
                roundKey={roundIndex}
                replaying={replaying}
                replayKey={replayKey}
                replayStat={replayStatKind(round.question.id)}
                durationMs={round.durationMs}
                onReplayStage={handleReplayStage}
                onReplayDone={handleReplayDone}
                onReady={() => {}}
                onError={() => {}}
              />
            </Suspense>

            {/* Round banner at the start of each watch phase */}
            <AnimatePresence>
              {phase === 'watch' && showRoundBanner && (
                <motion.div
                  key={`banner-${roundIndex}`}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="absolute top-3 inset-x-0 z-20 flex justify-center pointer-events-none"
                >
                  <span className="px-4 py-1.5 rounded-full bg-[#0a1628]/85 border border-brand-500 text-brand-800 text-xs font-extrabold uppercase tracking-[0.2em] backdrop-blur">
                    Round {roundIndex + 1} · {round.tier === 'easy' ? 'Watch' : 'Watch closely'}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Question overlay — opaque, covers the (frozen) arena. Hidden
                during a replay so the round is visible. */}
            <AnimatePresence>
              {phase === 'question' && !replaying && (
                <motion.div
                  key={`q-${roundIndex}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 p-4 bg-[#060e1a] overflow-y-auto"
                >
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest">Round {roundIndex + 1} · Question</p>
                  <p className="text-base sm:text-lg font-bold text-[#ddeaf8] text-center leading-snug max-w-sm">
                    {round.question.prompt}
                  </p>
                  <div className="grid grid-cols-2 gap-2.5 w-full max-w-sm">
                    {round.question.options.map((opt, i) => {
                      const reveal = answered
                      const isChosen = chosen === i
                      const isCorrect = opt.correct
                      let cls = 'border-[#1a3a5c] bg-[#0a1628] hover:border-brand-400 hover:bg-[#0f2240] text-[#ddeaf8]'
                      if (reveal && isCorrect) cls = 'border-[#34d399] bg-[#34d399]/15 text-[#8ef0b0]'
                      else if (reveal && isChosen && !isCorrect) cls = 'border-[#f87171] bg-[#f87171]/15 text-[#ffb4b4]'
                      else if (reveal) cls = 'border-[#1a3a5c] bg-[#0a1628] text-[#7c8ba3]'
                      return (
                        <button
                          key={i}
                          onClick={() => handleAnswer(i)}
                          disabled={answered}
                          className={`flex items-center justify-center gap-2 px-3 py-3 rounded-lg border-2 text-sm font-bold transition-colors ${cls}`}
                        >
                          <Dots colors={opt.colors} />
                          <span>{opt.label}</span>
                          {reveal && isCorrect && <span className="ml-0.5">✓</span>}
                          {reveal && isChosen && !isCorrect && <span className="ml-0.5">✗</span>}
                        </button>
                      )
                    })}
                  </div>

                  {/* After answering — Continue is the clear primary action;
                      Replay is a subtle secondary option. */}
                  {answered && (
                    <div className="flex flex-col items-center gap-2.5 w-full max-w-sm mt-0.5">
                      <button
                        onClick={advanceRound}
                        className="w-full px-5 py-3 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-extrabold uppercase tracking-wide transition-colors shadow-[0_0_18px_rgba(91,170,255,0.35)]"
                      >
                        {roundIndex + 1 >= TRACE2_ROUNDS ? 'Finish →' : 'Continue →'}
                      </button>
                      <motion.button
                        onClick={startReplay}
                        animate={{ opacity: [0.7, 1, 0.7] }}
                        transition={{ repeat: Infinity, duration: 2.2, ease: 'easeInOut' }}
                        className="flex items-center gap-1.5 px-4 py-1.5 rounded-full border border-[#1a3a5c] bg-[#0a1628] text-slate-400 hover:text-brand-300 hover:border-brand-500 text-[11px] font-bold uppercase tracking-wide transition-colors"
                      >
                        🔁 Replay round
                      </motion.button>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Replay indicator — shown over the (now visible) round while it
                rewinds then plays back. */}
            <AnimatePresence>
              {replaying && (
                <motion.div
                  key="replay-ui"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-30 flex flex-col justify-between p-3 pointer-events-none"
                >
                  <div className="flex justify-center">
                    {/* Tapping the indicator while the round is playing back
                        rewinds and starts the replay again from the beginning. */}
                    <motion.button
                      onClick={startReplay}
                      animate={replayStage === 'rewind'
                        ? { scale: [1, 1.09, 1], opacity: [1, 0.65, 1] }
                        : { scale: 1, opacity: 1 }}
                      transition={replayStage === 'rewind'
                        ? { repeat: Infinity, duration: 0.7, ease: 'easeInOut' }
                        : { duration: 0.2 }}
                      className="pointer-events-auto cursor-pointer px-4 py-1.5 rounded-full bg-[#0a1628]/90 border border-amber-500 text-amber-300 hover:text-amber-200 hover:border-amber-400 text-xs font-extrabold uppercase tracking-[0.2em] backdrop-blur flex items-center gap-2 transition-colors"
                    >
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                      {replayStage === 'rewind' ? '⏪ Rewinding' : '▶ Replay'}
                    </motion.button>
                  </div>
                  <div className="flex justify-center">
                    <button
                      onClick={() => setReplaying(false)}
                      className="pointer-events-auto px-4 py-2 rounded-full bg-[#0a1628]/90 border border-brand-500 text-[#ddeaf8] hover:text-white hover:border-brand-400 text-xs font-extrabold uppercase tracking-wide transition-colors"
                    >
                      Skip ▶▶
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <p className="text-center text-[10px] text-slate-500 mt-3">
            {phase === 'watch'
              ? 'Watch the four jets — the question comes next'
              : 'Pick the aircraft (or pair) that matches'}
          </p>
        </div>
      )}

      {phase === 'intro' && <SkywatchLogoIntro onComplete={handleIntroComplete} />}
    </div>
  )
}
