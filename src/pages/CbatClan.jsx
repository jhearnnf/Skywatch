// Colours, Letters and Numbers (CLAN).
//
// The test the RAF replaced with FLAG in 2021 and that Canada's CFAST still
// sits, which is why it is offered on the FLAG tile to players in Canada (see
// utils/cbat/clanOffer.js). Three tasks at once for a fixed 90 seconds: press
// R, Y or G as each coloured diamond crosses its colour band, memorise a
// letter code and pick it out of four near-identical options in the corners,
// and type the sums as they come up. The run itself is a pure simulation
// (utils/cbat/clanSim.js) driven from one rAF loop here; the board renders
// its snapshot (./CbatClan/ClanBoard.jsx).
//
// Same page shape as FLAG: intro card with the mode row under the title, a
// launch flash on Start, the Easier/Hard split on separate boards, and the
// Real CBAT theme's title bar and footer strip while playing.

import { useState, useEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { submitCbatResult } from '../lib/cbatOutbox'
import { useGameChrome } from '../context/GameChromeContext'
import { useCbatTracking } from '../utils/cbat/useCbatTracking'
import { useCbatDemo } from '../utils/cbat/demoMode'
import { useCbatTheme } from '../hooks/useCbatTheme'
import { initialDifficulty } from '../utils/cbat/difficultyParam'
import {
  CLAN_DIFFICULTIES, CLAN_LAUNCH_MS, CLAN_DURATION_MS, clanTuning, computeClanGrade,
  readStoredClanDifficulty, storeClanDifficulty,
} from '../utils/cbat/clanDifficulty'
import { createClanSim } from '../utils/cbat/clanSim'
import ClanBoard from './CbatClan/ClanBoard'
import { keyAction } from './CbatClan/keys'
import SEO from '../components/SEO'
import { CbatGameHeader, CbatFooterStrip } from '../components/cbat/CbatTestChrome'
import CbatGameOver from '../components/CbatGameOver'
import { CbatModeRow, ModeMarker } from '../components/CbatModeSelector'
import CbatPersonalBest from '../components/CbatPersonalBest'
import { useCbatPersonalBest } from '../hooks/useCbatPersonalBest'

const GAME_DURATION_S = CLAN_DURATION_MS / 1000

// ── Grade badge helper ────────────────────────────────────────────────────────
const GRADE_STYLE = {
  'Outstanding': { emoji: '🎖️', color: 'text-green-400' },
  'Good':        { emoji: '✈️', color: 'text-brand-600' },
  'Needs Work':  { emoji: '🔧', color: 'text-amber-400' },
  'Failed':      { emoji: '💥', color: 'text-red-400' },
}

// ── Results screen ────────────────────────────────────────────────────────────
function ResultsScreen({ stats, tuning }) {
  const grade = computeClanGrade(stats.totalScore, tuning)
  const gs = GRADE_STYLE[grade]

  const row = (label, val, sub) => (
    <div className="bg-game-arena rounded-lg border border-game-line p-3">
      <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-xl font-mono font-bold text-brand-600">{val}</p>
      {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  )

  return (
    <div className="w-full bg-game-panel border border-game-line rounded-xl p-6 text-center">
      <p className="text-5xl mb-3">{gs.emoji}</p>
      <p className={`text-2xl font-extrabold mb-1 ${gs.color}`}>{grade}</p>
      <p className="text-sm text-slate-400 mb-5">CLAN Assessment Complete</p>

      <div className="grid grid-cols-3 gap-2">
        {row('Colours', stats.colourScore, `${stats.colourHits}✓ ${stats.colourWrong}✗ ${stats.colourMissed}⏱`)}
        {row('Letters', stats.letterScore, `${stats.letterCorrect}✓ ${stats.letterWrong}✗ ${stats.letterTimeout}⏱`)}
        {row('Numbers', stats.mathScore, `${stats.mathCorrect}✓ ${stats.mathWrong}✗ ${stats.mathTimeout}⏱`)}
      </div>

      <p className="text-[10px] text-slate-500 mt-3 uppercase tracking-wide">{tuning.label} difficulty</p>
    </div>
  )
}

// ── Intro screen ──────────────────────────────────────────────────────────────
function IntroScreen({ onStart, personalBest, bestLoading, difficulty, onDifficulty, tuning, launching }) {
  // During the launch flash everything on the card except the chosen difficulty
  // button greys out, so the flashing button is the only thing left alive.
  const dim = launching ? ' cbat-launch-dim' : ''

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-md lg:max-w-2xl bg-game-panel border border-game-line rounded-xl p-6 lg:p-9 text-center"
    >
      <p className={`text-4xl lg:text-5xl mb-3${dim}`}>💎</p>

      {/* Title, then the pair UNDER it, then the blurb. FLAG's arrangement. */}
      <p className={`text-xl lg:text-2xl font-extrabold text-white mb-2${dim}`}>CLAN</p>
      <CbatModeRow
        modes={CLAN_DIFFICULTIES}
        value={difficulty}
        onSelect={onDifficulty}
        launching={launching}
      />
      <p className={`text-[11px] text-brand-600 mb-3${dim}`}>{tuning.blurb}</p>

      <p className={`text-sm lg:text-base text-slate-400 mb-5 lg:mb-7 lg:max-w-lg lg:mx-auto${dim}`}>
        Colours, Letters and Numbers. Catch diamonds, remember a code and do the sums. All at once.
      </p>

      <div className={`bg-game-arena rounded-lg border border-game-line p-4 lg:p-6 mb-5 lg:mb-7 text-left space-y-2 lg:space-y-3${dim}`}>
        <div className="flex items-start gap-3 text-sm lg:text-base text-game-text">
          <span className="shrink-0 w-8 text-center text-brand-600 lg:text-lg" aria-hidden>{'⏱'}</span>
          <span className="pt-0.5">{GAME_DURATION_S}-second run</span>
        </div>
        <div className="flex items-start gap-3 text-sm lg:text-base text-game-text">
          <span className="shrink-0 w-8 text-center text-brand-600 lg:text-lg" aria-hidden>{'💎'}</span>
          <span className="pt-0.5">Diamonds cross the arena toward three colour bands. Press <b>R</b>, <b>Y</b> or <b>G</b> while a diamond is inside the band of its own colour</span>
        </div>
        <div className="flex items-start gap-3 text-sm lg:text-base text-game-text">
          <span className="shrink-0 w-8 text-center text-brand-600 lg:text-lg" aria-hidden>{'🔤'}</span>
          <span className="pt-0.5">A letter code appears at the top. Memorise it. When four codes appear in the corners, press <b>A</b> to <b>D</b> for the one you saw</span>
        </div>
        <div className="flex items-start gap-3 text-sm lg:text-base text-game-text">
          <span className="shrink-0 w-8 text-center text-brand-600 lg:text-lg" aria-hidden>{'🔢'}</span>
          <span className="pt-0.5">Type the answer to each sum at the bottom on the number keys before it times out</span>
        </div>
        <div className="flex items-start gap-3 text-xs lg:text-sm text-game-muted border-t border-game-line pt-2 lg:pt-3 mt-1">
          <span className="shrink-0 w-8 text-center" aria-hidden>{'⚠️'}</span>
          <span className="pt-0.5">Wrong presses and missed diamonds lose points. Score can go negative.</span>
        </div>
      </div>

      {/* Personal best and the leaderboard link both follow the selected
          difficulty — the two boards are entirely separate. */}
      <CbatPersonalBest label={tuning.label} best={personalBest} loading={bestLoading} className={dim}>
        {best => best.bestScore}
      </CbatPersonalBest>

      <div className={`text-center mb-4${dim}`}>
        <Link to={`/cbat/${tuning.gameKey}/leaderboard`} className="text-xs lg:text-sm text-brand-600 hover:text-brand-700 transition-colors">
          View Leaderboard →
        </Link>
      </div>

      <div className={`flex flex-wrap gap-3 lg:gap-4 justify-center${dim}`}>
        <button
          onClick={onStart}
          disabled={launching}
          data-demo-start
          className="px-8 py-3 lg:px-10 lg:py-3.5 bg-brand-600 hover:bg-brand-700 disabled:bg-game-fill disabled:text-slate-500 text-white font-bold rounded-lg transition-colors text-sm lg:text-base cursor-pointer disabled:cursor-not-allowed"
        >
          Start
        </button>
      </div>

      {/* The other test on the same tile. Whoever is here was offered CLAN
          because FLAG is not their battery's test; this is the way back. */}
      <p className={`mt-5 text-[11px] text-slate-500${dim}`}>
        Sitting the RAF or Royal Navy battery? That one uses FLAG.{' '}
        <Link to="/cbat/flag" data-testid="clan-to-flag" className="text-brand-600 hover:text-brand-700 transition-colors">Play FLAG →</Link>
      </p>
    </motion.div>
  )
}

function typingTarget(el) {
  if (!el || !el.tagName) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

export default function CbatClan() {
  const { user, apiFetch, API } = useAuth()
  const { start: startTracking, markCompleted: markGameCompleted } = useCbatTracking()
  const demo = useCbatDemo()
  const cbat = useCbatTheme()
  const { enterImmersive, exitImmersive } = useGameChrome()

  const [phase, setPhase] = useState('intro')   // intro | launching | playing | results

  // Defaults to 'easier'; a user who switches gets their most recent choice
  // back on the next visit. `?difficulty=` overrides both for one arrival.
  const [difficulty, setDifficulty] = useState(() => initialDifficulty(readStoredClanDifficulty))
  const tuning = clanTuning(difficulty)
  // The difficulty in force for the run currently on screen. Pinned at launch so
  // a mid-results difficulty switch can't relabel or misfile a finished run.
  // Held twice on purpose: the ref is what the game loop reads (no re-render
  // churn), the state is what the render tree reads.
  const runTuningRef = useRef(tuning)
  const [runDifficulty, setRunDifficulty] = useState(difficulty)
  const runTuning = clanTuning(runDifficulty)
  // Keyed by board, so a flip never shows one difficulty's score under the
  // other's name and never blanks the panel while the new one loads.
  const { best: personalBest, loading: bestLoading, refresh: refreshBest } =
    useCbatPersonalBest(tuning.gameKey, { user, apiFetch, API })
  const [scoreSaved, setScoreSaved] = useState(false)
  const [queued, setQueued] = useState(false)
  const [finalStats, setFinalStats] = useState(null)

  // The live sim and the immutable snapshot the tree renders from.
  const simRef = useRef(null)
  const startedAtRef = useRef(0)
  const rafRef = useRef(null)
  const [snapshot, setSnapshot] = useState(null)
  // Guard against the end-of-run submit firing twice (StrictMode, or a tick
  // that lands after the phase has already moved on).
  const resultSubmittedRef = useRef(false)

  useEffect(() => {
    if (phase === 'playing') enterImmersive()
    else exitImmersive()
    return exitImmersive
  }, [phase, enterImmersive, exitImmersive])

  // ── End of run ──
  const finishRun = useCallback(() => {
    if (resultSubmittedRef.current) return
    resultSubmittedRef.current = true
    const sim = simRef.current
    const stats = sim.stats
    // The ref, not the runTuning state — this is the tuning the finished run
    // was actually played under.
    const playedTuning = runTuningRef.current
    const grade = computeClanGrade(stats.totalScore, playedTuning)
    setFinalStats(stats)
    setScoreSaved(false)
    setQueued(false)
    setPhase('results')
    markGameCompleted({ score: stats.totalScore })
    submitCbatResult(playedTuning.gameKey, {
      totalScore: stats.totalScore,
      colourHits: stats.colourHits,
      colourWrong: stats.colourWrong,
      colourMissed: stats.colourMissed,
      letterCorrect: stats.letterCorrect,
      letterWrong: stats.letterWrong,
      letterTimeout: stats.letterTimeout,
      mathCorrect: stats.mathCorrect,
      mathWrong: stats.mathWrong,
      mathTimeout: stats.mathTimeout,
      totalTime: GAME_DURATION_S,
      grade,
    }, { apiFetch, API })
      .then((r) => {
        setScoreSaved(!!r?.synced)
        setQueued(!!r?.queued)
        // The board the run was played on, not whatever is selected now.
        refreshBest(playedTuning.gameKey)
      })
      .catch(() => {})
  }, [apiFetch, API, markGameCompleted, refreshBest])

  // ── The loop ──
  // One rAF while playing. Each frame advances the sim to the wall-clock
  // elapsed time and publishes a fresh snapshot; when the sim reports the clock
  // has run out, the run is finished from here.
  const finishRef = useRef(finishRun)
  useEffect(() => { finishRef.current = finishRun })
  useEffect(() => {
    if (phase !== 'playing') return
    let cancelled = false
    const frame = (now) => {
      if (cancelled) return
      const sim = simRef.current
      sim.tick(now - startedAtRef.current)
      const snap = sim.snapshot()
      setSnapshot(snap)
      if (snap.finished) { finishRef.current(); return }
      rafRef.current = requestAnimationFrame(frame)
    }
    rafRef.current = requestAnimationFrame(frame)
    return () => { cancelled = true; cancelAnimationFrame(rafRef.current) }
  }, [phase])

  // ── Input ──
  // Every handler pushes a snapshot straight away so a press is painted on the
  // very next frame rather than a frame late.
  const publish = useCallback(() => {
    const sim = simRef.current
    if (sim) setSnapshot(sim.snapshot())
  }, [])
  const onColour = useCallback((c) => { simRef.current?.pressColour(c); publish() }, [publish])
  const onOption = useCallback((i) => { simRef.current?.pickLetterOption(i); publish() }, [publish])
  const onDigit = useCallback((d) => { simRef.current?.pressDigit(d); publish() }, [publish])
  const onBackspace = useCallback(() => { simRef.current?.backspace(); publish() }, [publish])
  const onEnter = useCallback(() => { simRef.current?.submitMath(); publish() }, [publish])

  useEffect(() => {
    if (phase !== 'playing') return
    function onKey(e) {
      if (typingTarget(e.target)) return
      if (document.querySelector('[role="dialog"]')) return
      const action = keyAction(e)
      if (!action) return
      e.preventDefault()
      switch (action.kind) {
        case 'colour':    onColour(action.value); break
        case 'option':    onOption(action.value); break
        case 'digit':     onDigit(action.value); break
        case 'backspace': onBackspace(); break
        case 'enter':     onEnter(); break
        default: break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, onColour, onOption, onDigit, onBackspace, onEnter])

  // ── Start ──
  const startGame = useCallback(() => {
    const sim = createClanSim({ tuning: runTuningRef.current })
    simRef.current = sim
    startedAtRef.current = performance.now()
    resultSubmittedRef.current = false
    setFinalStats(null)
    setScoreSaved(false)
    setQueued(false)
    setSnapshot(sim.snapshot())
    startTracking(runTuningRef.current.gameKey)
    setPhase('playing')
  }, [startTracking])

  // Pressing Start doesn't drop straight into the game: the chosen difficulty
  // button flashes on a greyed-out card for CLAN_LAUNCH_MS first, so the run
  // you're about to play is the last thing you see. The difficulty is pinned
  // here, before the flash, so the whole run reads from one tuning.
  const beginLaunch = useCallback(() => {
    runTuningRef.current = tuning
    setRunDifficulty(tuning.key)
    // A demo tile skips the flash — the landing wall drives the Start button
    // and shouldn't sit on a dimmed card for a second of its short loop.
    if (demo) startGame()
    else setPhase('launching')
  }, [tuning, demo, startGame])

  // Keyed to `phase` alone. Depending on startGame meant any re-render that
  // changed its identity cleared the pending timeout and started a fresh one.
  const startGameRef = useRef(startGame)
  useEffect(() => { startGameRef.current = startGame })
  useEffect(() => {
    if (phase !== 'launching') return
    const t = setTimeout(() => startGameRef.current(), CLAN_LAUNCH_MS)
    return () => clearTimeout(t)
  }, [phase])

  const chooseDifficulty = useCallback((key) => {
    setDifficulty(key)
    storeClanDifficulty(key)
  }, [])

  const goToIntro = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    setPhase('intro')
  }, [])

  const elapsedMs = snapshot?.t ?? 0
  const remainingS = Math.max(0, (CLAN_DURATION_MS - elapsedMs) / 1000)

  return (
    <div className="cbat-clan-page">
      <SEO title="CLAN — CBAT" description="Colours, Letters and Numbers: catch diamonds, remember a code and do the sums, all at once." />

      {!user && (
        <div className="bg-game-panel rounded-2xl border border-game-line p-6 text-center">
          <div className="text-4xl mb-3">🔒</div>
          <p className="font-bold text-game-text mb-1">Sign in to play</p>
          <p className="text-sm text-slate-400 mb-4">Create a free account to access CBAT games.</p>
          <Link to="/login" className="inline-flex px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors no-underline">
            Sign In
          </Link>
        </div>
      )}

      {user && (
        <>
          <CbatGameHeader
            title="CLAN"
            fullTitle="Colours, Letters and Numbers"
            titleClass="text-game-text"
            intro={phase === 'intro' || phase === 'launching'}
            onQuit={goToIntro}
            confirmNeeded={phase === 'playing'}
            className={`max-[600px]:mb-1${phase === 'launching' ? ' cbat-launch-dim' : ''}`}
            test={phase === 'playing' ? {
              stage: 'Testing',
              timeFrac: 1 - elapsedMs / CLAN_DURATION_MS,
              progressFrac: elapsedMs / CLAN_DURATION_MS,
            } : null}
          >
            {phase === 'playing' && <ModeMarker mode={runTuning} />}
          </CbatGameHeader>

          <div className="flex flex-col items-center max-[600px]:w-full">
            {(phase === 'intro' || phase === 'launching') && (
              <IntroScreen
                onStart={beginLaunch}
                personalBest={personalBest}
                bestLoading={bestLoading}
                difficulty={difficulty}
                onDifficulty={chooseDifficulty}
                tuning={tuning}
                launching={phase === 'launching'}
              />
            )}

            {phase === 'playing' && snapshot && (
              <div className="w-full">
                {/* HUD — under the Real CBAT theme the title bar carries this */}
                {!cbat && (
                  <div className="flex items-center justify-between text-xs font-mono mb-2 px-1">
                    <span className="text-slate-400">
                      ⏱ <span className="text-brand-600">{remainingS.toFixed(1)}s</span>
                    </span>
                    <span className="text-slate-400">
                      Score: <span className={snapshot.score >= 0 ? 'text-brand-600' : 'text-red-400'} data-testid="clan-score">{snapshot.score}</span>
                    </span>
                  </div>
                )}

                <ClanBoard
                  snapshot={snapshot}
                  cbat={cbat}
                  onColour={onColour}
                  onOption={onOption}
                  onDigit={onDigit}
                  onBackspace={onBackspace}
                  onEnter={onEnter}
                />

                {/* Real CBAT theme: the instruction strip */}
                <CbatFooterStrip
                  className="w-full"
                  text="R, Y or G for a diamond in its band. A to D for the code. Type the sum, then press"
                  answer={snapshot.maths.question ? snapshot.maths.entered : undefined}
                  onSubmit={onEnter}
                  canSubmit={!!snapshot.maths.question && snapshot.maths.entered !== ''}
                />
              </div>
            )}

            {phase === 'results' && finalStats && (
              <CbatGameOver
                gameKey={runTuning.gameKey}
                score={finalStats.totalScore}
                scoreSaved={scoreSaved}
                queued={queued}
                personalBest={personalBest}
                onPlayAgain={() => { setPhase('intro') }}
              >
                <ResultsScreen stats={finalStats} tuning={runTuning} />
              </CbatGameOver>
            )}
          </div>
        </>
      )}
    </div>
  )
}
