// CBAT "Table Reading Test" (MATF).
//
// Two speeded parts: a symmetric coordinate grid running −N to +N on both axes,
// then a stack of wind tables read in three steps. See utils/cbat/matfGenerator.js
// for why the grid is symmetric and why the axes are signed — both come from the
// corpus, and the symmetry is what makes "the intersection value is the same
// whichever way round" genuinely true here rather than a claim we print and then
// contradict.
//
// The real test is worked against a pre-printed laminated sheet beside the
// screen, and the corpus is explicit that managing the sheet AND the screen is
// the actual difficulty. One display cannot reproduce that — so the run offers
// to print its own reference tables and let the player work the way the real
// candidate does, with paper on the desk and questions on the screen.
//
// That is why a run is built from a SEED rather than straight off Math.random:
// a sheet in someone's house has to find its way back to the run it belongs to
// weeks later. See utils/cbat/matfPrint.js for the store and the rule that a
// replayed sheet is never ranked.

import { useState, useCallback, useEffect, useRef, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { submitCbatResult } from '../lib/cbatOutbox'
import { useCbatTracking } from '../utils/cbat/useCbatTracking'
import { useGameChrome } from '../context/GameChromeContext'
import { useCbatDemo } from '../utils/cbat/demoMode'
import SEO from '../components/SEO'
import { CbatGameHeader, CbatFooterStrip, CbatKeyCap } from '../components/cbat/CbatTestChrome'
import { useCbatTheme } from '../hooks/useCbatTheme'
import { useCbatMcq } from '../hooks/useCbatAnswerKeys'
import CbatGameOver from '../components/CbatGameOver'
import { useGameBodyClass } from '../hooks/useGameBodyClass'
import { CbatModeRow, ModeMarker } from '../components/CbatModeSelector'
import CbatPersonalBest from '../components/CbatPersonalBest'
import { useCbatPersonalBest } from '../hooks/useCbatPersonalBest'
import CbatIntroLabel from '../components/cbat/CbatIntroLabel'
import CbatStickLayout from '../components/cbat/CbatStickLayout'
import MatfPrintSheet from '../components/cbat/MatfPrintSheet'
import MatfPrintoutRail from '../components/cbat/MatfPrintoutRail'
import {
  matfGridQuestion, axisLabels,
  matfSheetQuestion, READOUTS, buildMatfRun,
} from '../utils/cbat/matfGenerator'
import {
  matfRunSeed, matfSheetCode, matfPrintoutShape,
  readMatfPrintouts, recordMatfPrintout, clearMatfPrintouts,
} from '../utils/cbat/matfPrint'
import {
  MATF_DIFFICULTIES, MATF_LAUNCH_MS, DEFAULT_MATF_DIFFICULTY,
  matfTuning, computeMatfGrade,
  readStoredMatfDifficulty, storeMatfDifficulty,
} from '../utils/cbat/matfDifficulty'
import { initialDifficulty } from '../utils/cbat/difficultyParam'

// ── Reference panels ─────────────────────────────────────────────────────────
// Top-level components, never defined inside the page's render — these hold the
// player's horizontal scroll position, and a remount would throw it away on
// every answer.

// `table-fixed w-full` is what makes the grid grow into whatever width the shell
// gives it: equal columns sharing the row rather than shrink-wrapping to the
// text and leaving desktop mostly empty. The `min-width` underneath it is what
// keeps that honest on a phone — below it the container scrolls sideways instead
// of crushing the numbers into an unreadable column.
//
// Row height is set on the cells rather than the table so the grid keeps square-
// ish proportions as it widens; without it a wide table renders as a stack of
// short wide bands and the eye slips a row on the way across, which is precisely
// the error this test is measuring.
//
// NOTHING is highlighted. The axis labels the question names were picked out in
// brand blue until the guide was read back against this, which handed the player
// the one step the test actually measures — finding a label among 35. The corpus
// is clear the real sheet "is a fixed, wipe-clean object you slide about rather
// than something you can mark up", so the reference here stays unmarked too.
function GridPanel({ grid }) {
  const labels = axisLabels(grid.extent)
  return (
    <div className="overflow-auto max-h-[46vh] lg:max-h-[70vh] border border-game-line rounded-lg bg-game-arena">
      <table
        className="border-collapse font-mono w-full table-fixed text-[10px] sm:text-xs lg:text-sm"
        style={{ minWidth: `${(labels.length + 1) * 32}px` }}
      >
        <thead>
          <tr>
            <th className="sticky top-0 left-0 z-20 bg-game-raised text-slate-600 px-1 py-1 lg:py-1.5">·</th>
            {labels.map(l => (
              <th key={l} className="sticky top-0 z-10 px-1 py-1 lg:py-1.5 font-bold bg-game-raised text-slate-500">
                {l}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.cells.map((rowVals, r) => (
            <tr key={r}>
              <th className="sticky left-0 z-10 px-1 py-1 lg:py-1.5 font-bold bg-game-raised text-slate-500">
                {labels[r]}
              </th>
              {rowVals.map((v, c) => (
                <td key={c} className="px-1 py-1 lg:py-1.5 text-center text-game-text border-b border-[#0d1c30]">{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// The wind sheet: one table per air speed, stacked. Picking the right table is
// step one of the three, so every table is laid out identically and is
// distinguished only by the air speed in its caption — which is exactly what
// makes reading the right row and column off the wrong table so easy, and why
// that mistake is offered as an answer.
//
// Each angle column carries both readings side by side, DRIFT then GS, because
// the question names one of the two and the other is sitting right beside it.
function SheetPanel({ sheet }) {
  return (
    <div className="overflow-auto max-h-[46vh] lg:max-h-[70vh] border border-game-line rounded-lg bg-game-arena p-2 space-y-3">
      {sheet.tables.map(table => (
        <table key={table.airSpeed} className="border-collapse font-mono w-full text-[10px] sm:text-xs lg:text-sm" style={{ minWidth: '460px' }}>
          <caption className="caption-top text-left text-[10px] lg:text-xs font-bold text-brand-600 uppercase tracking-wide pb-1">
            Air Speed {table.airSpeed} kt
          </caption>
          <thead>
            <tr>
              <th rowSpan={2} className="bg-game-raised text-slate-600 px-2 py-1 text-left align-bottom">W/V</th>
              {sheet.angles.map(a => (
                <th key={a} colSpan={2} className="bg-game-raised text-slate-500 px-2 py-1 font-bold border-l border-game-line">
                  {a}°
                </th>
              ))}
            </tr>
            <tr>
              {sheet.angles.map(a => (
                <Fragment key={a}>
                  <th className="bg-[#0b1a2e] text-slate-600 px-1 py-0.5 font-bold border-l border-game-line">{READOUTS.drift.short}</th>
                  <th className="bg-[#0b1a2e] text-slate-600 px-1 py-0.5 font-bold">{READOUTS.ground.short}</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((v, r) => (
              <tr key={v}>
                <th className="bg-game-raised text-slate-500 px-2 py-1 font-bold text-left">{v}</th>
                {sheet.angles.map((a, c) => (
                  <Fragment key={a}>
                    <td className="px-1 py-1 text-center text-game-text border-b border-l border-[#0d1c30]">{table.cells[r][c].drift}</td>
                    <td className="px-1 py-1 text-center text-game-text border-b border-[#0d1c30]">{table.cells[r][c].ground}</td>
                  </Fragment>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  )
}

// ── Working from paper ───────────────────────────────────────────────────────

// Shown IN PLACE OF the on-screen reference once the player has printed the
// sheet, or loaded one they printed before.
//
// In place of, not on top of: a translucent sheet over a 70vh table is a table
// you can still half-read, and half-reading it is worse than either surface on
// its own. Covering it properly also hands the height back, so the question and
// its five options sit near the top of the screen — which is where they are on
// the real test, with the paper on the desk rather than on the monitor.
//
// Dismissing is one-way for the run. The player has said they would rather work
// on screen, and a control to put the cover back would be a button sitting over
// the game for the rest of the test for no good reason.
function PrintedSheetCover({ code, part, onReveal }) {
  return (
    <div className="w-full max-w-2xl mx-auto bg-game-panel border-2 border-brand-600/40 rounded-xl p-5 text-center">
      <p className="text-3xl mb-2" aria-hidden="true">📄</p>
      <p className="text-base font-extrabold text-white mb-1">
        Use your printed sheet to help train in a more realistic way
      </p>
      <p className="text-sm text-game-muted mb-4">
        Sheet <span className="font-mono text-brand-600">{code}</span>, page {part} of 2. The real
        test keeps the reference on the desk and the questions on the screen, so working across the
        two is part of what it measures.
      </p>
      <button
        type="button"
        onClick={onReveal}
        className="px-5 py-2 rounded-lg border-2 border-game-line bg-game-arena text-slate-600 font-bold text-xs hover:border-brand-400 hover:text-brand-600 transition-colors cursor-pointer"
      >
        Show the table on screen instead
      </button>
    </div>
  )
}

// The question asked between Start and the first item: paper or screen.
//
// It sits AFTER Start rather than on the instructions card because the tables
// do not exist until Start is pressed — a run's numbers are generated then, and
// printing them is the only reason the seed is kept. Asking beforehand would be
// offering to print something we have not built.
function PrintAskCard({ onPrint, onSkip }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-md lg:max-w-xl bg-game-panel border border-game-line rounded-xl p-6 lg:p-8 text-center"
    >
      <p className="text-4xl mb-3" aria-hidden="true">🖨️</p>
      <p className="text-xl font-extrabold text-white mb-2">Print the reference tables?</p>
      <p className="text-sm lg:text-base text-slate-400 mb-5 lg:max-w-md lg:mx-auto">
        The real test puts the grid and the wind sheet on a printed sheet beside the screen, and
        moving between paper and screen is a lot of what it costs you. You can print this run’s
        tables and work from them the same way.
      </p>
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <button
          type="button"
          onClick={onPrint}
          className="px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg transition-colors text-sm cursor-pointer"
        >
          Yes, print the tables
        </button>
        <button
          type="button"
          onClick={onSkip}
          data-demo-start
          className="px-6 py-3 rounded-lg border-2 border-game-line bg-game-arena text-slate-600 font-bold text-sm hover:border-brand-400 hover:text-brand-600 transition-colors cursor-pointer"
        >
          No, play on screen
        </button>
      </div>
      <p className="text-[11px] text-game-muted mt-4">
        Skipping this changes nothing about the test. It runs exactly as it always has.
      </p>
    </motion.div>
  )
}

function ResultsScreen({ gridCorrect, tableCorrect, attempted, totalTime, grade, replayedSheet }) {
  const correct = gridCorrect + tableCorrect
  const accuracy = attempted ? Math.round((correct / attempted) * 100) : 0
  const emoji = grade === 'Outstanding' ? '🎖️' : grade === 'Good' ? '📋' : grade === 'Needs Work' ? '🔧' : '💥'
  const color = grade === 'Outstanding' ? 'text-green-400' : grade === 'Good' ? 'text-brand-600' : grade === 'Needs Work' ? 'text-amber-400' : 'text-red-400'

  return (
    <div className="w-full bg-game-panel border border-game-line rounded-xl p-8 text-center">
      <p className="text-5xl mb-3">{emoji}</p>
      <p className={`text-2xl font-extrabold mb-1 ${color}`}>{grade}</p>
      <p className={`text-sm text-slate-400 ${replayedSheet ? 'mb-2' : 'mb-6'}`}>Table Reading Test Complete</p>
      {replayedSheet && (
        <p className="text-xs text-amber-400 mb-6">
          Replay of printed sheet {replayedSheet} · not submitted to the leaderboard
        </p>
      )}

      <div className="bg-game-arena rounded-lg border border-game-line p-4 sm:p-5 mb-4">
        <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">Overall Score</p>
        <div className="flex flex-wrap justify-center gap-4 sm:gap-8 items-end">
          <div>
            <p className="text-3xl sm:text-4xl font-mono font-bold text-brand-600 mb-1">{correct}</p>
            <p className="text-sm text-slate-400">correct</p>
          </div>
          <div className="w-px h-12 bg-game-line" />
          <div>
            <p className="text-3xl sm:text-4xl font-mono font-bold text-brand-600 mb-1">{accuracy}%</p>
            <p className="text-sm text-slate-400">of {attempted} attempted</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-game-arena rounded-lg border border-game-line p-3">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Part 1 · Grid</p>
          <p className="text-2xl font-mono font-bold text-brand-600">{gridCorrect}</p>
        </div>
        <div className="bg-game-arena rounded-lg border border-game-line p-3">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Part 2 · Wind Sheet</p>
          <p className="text-2xl font-mono font-bold text-brand-600">{tableCorrect}</p>
        </div>
      </div>
      <p className="text-[11px] text-slate-600 mt-3">{totalTime.toFixed(0)}s total</p>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────
export default function CbatMatf() {
  const { user, apiFetch, API } = useAuth()
  const { start: startTracking, markCompleted: markGameCompleted } = useCbatTracking()
  const isDemo = useCbatDemo()

  // intro | printAsk | printing | launching | part1 | interstitial | part2 | results
  const [phase, setPhase] = useState('intro')
  const { enterImmersive, exitImmersive } = useGameChrome()
  useEffect(() => {
    if (['part1', 'interstitial', 'part2'].includes(phase)) enterImmersive()
    else exitImmersive()
    return exitImmersive
  }, [phase, enterImmersive, exitImmersive])

  const [difficulty, setDifficulty] = useState(() => initialDifficulty(readStoredMatfDifficulty))
  const [runDifficulty, setRunDifficulty] = useState(difficulty)

  const [grid, setGrid] = useState(null)
  const [sheet, setSheet] = useState(null)
  const [question, setQuestion] = useState(null)
  const [flash, setFlash] = useState(null)   // 'right' | 'wrong', cleared on the next question
  const [remainingMs, setRemainingMs] = useState(0)
  const [gridCorrect, setGridCorrect] = useState(0)
  const [tableCorrect, setTableCorrect] = useState(0)
  const [attempted, setAttempted] = useState(0)
  const [scoreSaved, setScoreSaved] = useState(false)
  const [queued, setQueued] = useState(false)
  const cbat = useCbatTheme()

  // The run's reference tables are rebuildable from this number alone — that is
  // the whole basis of printing them and coming back to the same sheet later.
  // See utils/cbat/matfPrint.js.
  const [seed, setSeed] = useState(0)
  // Working from paper: set when the player prints this run's sheet, or loads
  // one they printed before. Cleared the moment they ask for the screen back.
  const [onPaper, setOnPaper] = useState(false)
  // A replay of a sheet the player has already seen. Never submitted.
  const [replayed, setReplayed] = useState(false)
  const [printouts, setPrintouts] = useState(() => readMatfPrintouts())

  const tickRef = useRef(null)
  const launchTimerRef = useRef(null)
  const phaseStartRef = useRef(null)
  const scoreRef = useRef({ grid: 0, table: 0, attempted: 0 })
  const gridRef = useRef(null)
  const sheetRef = useRef(null)
  // The tuning the CURRENT run was built with. A ref, not the `runDifficulty`
  // state, because prepareRun's callers need it on the same tick they set it.
  const runTuningRef = useRef(matfTuning(DEFAULT_MATF_DIFFICULTY))
  // Stamped once when the run is built, not read in render: the date printed in
  // the sheet's header has to be the same on every render of the print screen,
  // and Date.now() in a render body is not.
  const runBuiltAtRef = useRef(Date.now())

  const runTuning = matfTuning(runDifficulty)
  const introTuning = matfTuning(difficulty)
  const gameKey = runTuning.gameKey

  // The reference grid is the game; give it the screen while a part is running.
  // See the rule in main.css for why max-w-3xl is actively harmful here.
  useGameBodyClass('cbat-matf-wide', phase === 'part1' || phase === 'part2' || phase === 'printing')
  // Room for the saved-sheets rail beside the instructions card, the same way
  // ACT/RTT/SMA make room for the joystick panel. See CbatStickLayout.
  //
  // HELD ACROSS THE LAUNCH FLASH, and only on when there is actually a rail.
  // The layout's three tracks (19rem + 42rem + 19rem) live on the element, not
  // on the body class, so they stay on for as long as the card is mounted. Drop
  // the shell back to its 768px cap underneath them — which is what dropping
  // this at 'launching' did — and the two fixed outer tracks take 608px of it,
  // squeezing the card itself down to a sliver mid-flash.
  const hasSheets = printouts.length > 0
  useGameBodyClass('cbat-stick-wide', hasSheets && (phase === 'intro' || phase === 'launching'))
  // Strips the app chrome out of the printout. See @media print in main.css.
  useGameBodyClass('matf-printing', phase === 'printing')

  // Keyed by board, so flipping mode never shows one board's score under
  // another's name and never blanks the panel while the new one loads.
  const { best: personalBest, loading: bestLoading, refresh: fetchBest } =
    useCbatPersonalBest(matfTuning(difficulty).gameKey, { user, apiFetch, API })


  useEffect(() => () => {
    clearInterval(tickRef.current)
    clearTimeout(launchTimerRef.current)
  }, [])

  const submitScore = useCallback((totals, totalMs, key, unranked) => {
    const correctCount = totals.grid + totals.table
    setScoreSaved(false)
    setQueued(false)
    markGameCompleted({ score: correctCount })
    // A run on a sheet the player printed earlier is a run on numbers they have
    // already looked at, so it never reaches a board. Same rule as the admin
    // round-skip cheat: play it, see it, don't rank it.
    if (unranked) return
    submitCbatResult(key, {
      correctCount,
      attempted: totals.attempted,
      gridCorrect: totals.grid,
      tableCorrect: totals.table,
      totalTime: totalMs / 1000,
    }, { apiFetch, API })
      .then((r) => {
        setScoreSaved(!!r?.synced)
        setQueued(!!r?.queued)
        fetchBest(key)
      })
      .catch(() => {})
  }, [apiFetch, API, markGameCompleted, fetchBest])

  // Both parts run a plain countdown; a part ends when its clock does, never
  // when a question count is reached. That is what makes the test speeded.
  useEffect(() => {
    if (phase !== 'part1' && phase !== 'part2') return
    const limit = runTuning.partMs
    phaseStartRef.current = Date.now()
    setRemainingMs(limit)
    tickRef.current = setInterval(() => {
      const left = Math.max(0, limit - (Date.now() - phaseStartRef.current))
      setRemainingMs(left)
      if (left === 0) {
        clearInterval(tickRef.current)
        if (phase === 'part1') setPhase('interstitial')
        else finishRun()
      }
    }, 100)
    return () => clearInterval(tickRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  function nextQuestion(part) {
    setFlash(null)
    if (part === 'part1') setQuestion(matfGridQuestion(gridRef.current))
    else setQuestion(matfSheetQuestion(sheetRef.current))
  }

  function handlePick(option) {
    if (!question) return
    const correct = option === question.answer
    scoreRef.current.attempted += 1
    setAttempted(scoreRef.current.attempted)
    if (correct) {
      if (question.part === 'grid') {
        scoreRef.current.grid += 1
        setGridCorrect(scoreRef.current.grid)
      } else {
        scoreRef.current.table += 1
        setTableCorrect(scoreRef.current.table)
      }
    }
    // The real test gives no right/wrong mid-run, so under the Real CBAT theme
    // there is no flash at all.
    setFlash(cbat ? null : correct ? 'right' : 'wrong')
    // Straight on to the next question. No pause for feedback: a speeded test
    // that stops to congratulate you is no longer measuring the same thing, so
    // the flash rides on the next question's render instead.
    nextQuestion(question.part === 'grid' ? 'part1' : 'part2')
  }

  // Keyboard answering: 1-5 pick an option (marked under the Real CBAT theme
  // and committed with Enter; committed at once otherwise).
  const { pending, select, commit } = useCbatMcq({
    enabled: (phase === 'part1' || phase === 'part2') && !!question,
    count: question?.options?.length ?? 0,
    kind: 'number',
    onCommit: (i) => handlePick(question.options[i]),
    resetKey: question,
  })
  function finishRun() {
    const totalMs = runTuning.partMs * 2
    submitScore(scoreRef.current, totalMs, gameKey, replayed)
    setPhase('results')
  }

  function beginPart2() {
    nextQuestion('part2')
    setPhase('part2')
  }

  // Build a run's reference tables and hold them, without starting anything.
  // The print question sits between here and the first item, and it cannot be
  // answered until the tables it is offering to print actually exist — which is
  // why they are built off Start rather than off the first question.
  //
  // Everything a run needs is `(seed, difficulty)`: see buildMatfRun. That pair
  // is what a printed sheet carries, and it is all the saved-sheets rail keeps.
  const prepareRun = useCallback((runSeed, key, isReplay) => {
    const tuning = matfTuning(key)
    runTuningRef.current = tuning
    setRunDifficulty(key)
    storeMatfDifficulty(key)

    runBuiltAtRef.current = Date.now()
    const { grid: g, sheet: sh } = buildMatfRun(tuning, runSeed)
    gridRef.current = g
    sheetRef.current = sh
    setGrid(g)
    setSheet(sh)
    setSeed(runSeed)
    setQuestion(matfGridQuestion(g))
    setFlash(null)
    scoreRef.current = { grid: 0, table: 0, attempted: 0 }
    setGridCorrect(0)
    setTableCorrect(0)
    setAttempted(0)
    setScoreSaved(false)
    setQueued(false)
    setReplayed(isReplay)
    // A replay starts covered: the player picked it off the rail because the
    // sheet is already in front of them.
    setOnPaper(isReplay)
    return tuning
  }, [])

  // The only way into part 1 — both answers to the print question come through
  // here, as does a sheet loaded from the rail.
  const beginRun = useCallback(() => {
    startTracking(runTuningRef.current.gameKey)
    setPhase('part1')
  }, [startTracking])

  // Start: flash the mode the way FLAG, SAT and RTT do, then ask about paper.
  // The flash belongs to the instructions card it is flashing on, so it runs
  // before the print question rather than after it.
  const beginLaunch = useCallback(() => {
    const tuning = prepareRun(matfRunSeed(), difficulty, false)
    if (isDemo) { startTracking(tuning.gameKey); setPhase('part1'); return }
    setPhase('launching')
    launchTimerRef.current = setTimeout(() => setPhase('printAsk'), MATF_LAUNCH_MS)
  }, [difficulty, prepareRun, isDemo, startTracking])

  // Print this run's sheet. Recorded at the moment the print dialog opens
  // rather than on the way out of the screen, because a player who prints and
  // then quits still has the paper and should still find it on the rail.
  const printSheet = useCallback(() => {
    setPrintouts(recordMatfPrintout({ seed, difficulty: runTuningRef.current.key }))
    setOnPaper(true)
    try { window.print() } catch { /* no print surface */ }
  }, [seed])

  const replaySheet = useCallback((entry) => {
    setDifficulty(entry.difficulty)
    prepareRun(entry.seed, entry.difficulty, true)
    beginRun()
  }, [prepareRun, beginRun])

  const forgetSheets = useCallback(() => {
    clearMatfPrintouts()
    setPrintouts([])
  }, [])

  const goToIntro = useCallback(() => {
    clearInterval(tickRef.current)
    clearTimeout(launchTimerRef.current)
    setPhase('intro')
    setQuestion(null)
    setFlash(null)
    scoreRef.current = { grid: 0, table: 0, attempted: 0 }
    setGridCorrect(0)
    setTableCorrect(0)
    setAttempted(0)
    setScoreSaved(false)
    setOnPaper(false)
    setReplayed(false)
    setPrintouts(readMatfPrintouts())
  }, [])

  const playing = phase === 'part1' || phase === 'part2'
  const correctSoFar = gridCorrect + tableCorrect
  // A part is a countdown with no fixed problem count, so the title bar shows
  // no item count and the Time meter carries the part.
  const testBar = playing ? {
    stage: 'Testing',
    timeFrac: remainingMs / runTuning.partMs,
    progressFrac: phase === 'part2' ? 0.5 : 0,
  } : null
  // Everything on the intro card except the flashing difficulty button dims
  // during the launch flash — the same treatment FLAG, SAT and RTT use.
  const dim = phase === 'launching' ? ' cbat-launch-dim' : ''
  // Only built once the player has printed something; null keeps the layout's
  // left track empty and the instructions card dead centre.
  const printoutRail = printouts.length
    ? <MatfPrintoutRail printouts={printouts} onReplay={replaySheet} onClear={forgetSheets} className={dim} />
    : null

  return (
    <div>
      <SEO title="Table Reading Test (CBAT)" description="A signed coordinate grid and a wind reference sheet, worked against the clock." />

      <CbatGameHeader
        className={phase === 'printing' ? 'matf-print-chrome' : ''}
        title="Table Reading Test"
        fullTitle={`MAT-F Part ${phase === 'part2' ? 'Two' : 'One'}`}
        intro={phase === 'intro'}
        onQuit={goToIntro}
        confirmNeeded={playing}
        test={testBar}
      >
        {phase !== 'intro' && <ModeMarker mode={runTuning} />}
      </CbatGameHeader>

      {!user && (
        <div className="bg-surface rounded-2xl border border-slate-200 p-6 text-center card-shadow">
          <div className="text-4xl mb-3">🔒</div>
          <p className="font-bold text-slate-800 mb-1">Sign in to play</p>
          <p className="text-sm text-slate-500 mb-4">Create a free account to access CBAT games.</p>
          <Link to="/login" className="inline-flex px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors">Sign In</Link>
        </div>
      )}

      {user && (
        <div className="flex flex-col items-center">

          {(phase === 'intro' || phase === 'launching') && (
            <CbatStickLayout stick={printoutRail}>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full max-w-md lg:max-w-2xl bg-game-panel border border-game-line rounded-xl p-6 lg:p-9 text-center"
            >
              <p className={`text-4xl lg:text-5xl mb-3${dim}`}>📋</p>

              {/* MATF_DIFFICULTIES is ordered [easier, hard], so the easier
                  option lands left and hard lands right. The pair sits under the
                  title, matching FLAG, CUT, Numerical Operations, SAT and RTT. */}
              <p className={`text-xl lg:text-2xl font-extrabold text-white mb-2${dim}`}>Table Reading Test</p>
              <CbatModeRow
                modes={MATF_DIFFICULTIES}
                value={difficulty}
                onSelect={setDifficulty}
                launching={phase === 'launching'}
              />
              <p className={`text-[11px] text-brand-600 mb-3${dim}`}>{introTuning.blurb}</p>

              <p className={`text-sm lg:text-base text-slate-400 mb-5 lg:mb-7 lg:max-w-lg lg:mx-auto${dim}`}>
                Two parts against the clock. Answer as many as you can. Nothing here is hard to understand, and everything here is hard to do quickly.
              </p>

              <div className={`bg-game-arena rounded-lg border border-game-line p-4 lg:p-6 mb-5 lg:mb-7 text-left space-y-2 lg:space-y-3 text-sm lg:text-base text-game-text${dim}`}>
                <div className="flex items-start gap-3">
                  <CbatIntroLabel>1.</CbatIntroLabel>
                  <span className="pt-0.5">Coordinate grid, running from minus {introTuning.gridExtent} to plus {introTuning.gridExtent} both ways. Bring one number across, one down, read where they meet.</span>
                </div>
                <div className="flex items-start gap-3">
                  <CbatIntroLabel>2.</CbatIntroLabel>
                  <span className="pt-0.5">Wind sheet, in three steps. Air speed picks the table, wind velocity picks the row, wind angle picks the column. Then read the one of Drift Correction or Ground Speed you were asked for.</span>
                </div>
                <div className="flex items-start gap-3 text-xs lg:text-sm text-brand-600/90 border-t border-game-line pt-2 lg:pt-3 mt-1">
                  <span className="shrink-0 w-8 text-center" aria-hidden>{'💡'}</span>
                  <span className="pt-0.5">On the grid the pair works either way round. The value at 4, −11 is the value at −11, 4. Don’t spend a moment deciding which is which.</span>
                </div>
                <div className="flex items-start gap-3 text-xs lg:text-sm text-brand-600/90">
                  <span className="shrink-0 w-8 text-center" aria-hidden>{'💡'}</span>
                  <span className="pt-0.5">On the wind sheet, check the air speed on the table you have landed in before you read anything off it. Every table looks the same, and the right row and column of the wrong table is offered as an answer.</span>
                </div>
                <div className="flex items-start gap-3 text-xs lg:text-sm text-game-muted pt-1">
                  <span className="shrink-0 w-8 text-center" aria-hidden>{'📄'}</span>
                  <span className="pt-0.5">The real test puts the reference on a printed sheet beside the screen, and moving between two surfaces is a lot of what it costs. Press Start and you can print this run’s tables before it begins.</span>
                </div>
                <div className="flex items-start gap-3 text-xs lg:text-sm text-game-muted">
                  <span className="shrink-0 w-8 text-center" aria-hidden>{'⏱'}</span>
                  <span className="pt-0.5">±{introTuning.gridExtent} grid · {introTuning.tableCount} air-speed tables · {Math.round(introTuning.partMs / 1000)}s per part</span>
                </div>
              </div>

              <CbatPersonalBest label={introTuning.label} best={personalBest} loading={bestLoading} className={dim}>
                {best => <>{best.bestScore} correct</>}
              </CbatPersonalBest>

              <div className={`text-center mb-4${dim}`}>
                <Link to={`/cbat/${introTuning.gameKey}/leaderboard`} className="text-xs lg:text-sm text-brand-600 hover:text-brand-700 transition-colors">
                  View Leaderboard →
                </Link>
              </div>

              <button
                onClick={beginLaunch}
                disabled={phase === 'launching'}
                data-demo-start
                className="px-8 py-3 lg:px-10 lg:py-3.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-bold rounded-lg transition-colors text-sm lg:text-base"
              >
                Start
              </button>
            </motion.div>

            {/* Below `lg` CbatStickLayout drops both side tracks, so the rail
                would vanish on a phone. A player who printed at a desk and then
                practises on the sofa still wants their sheets, so on a narrow
                screen it goes under the card instead of beside it. */}
            {printoutRail && (
              <div className="lg:hidden w-full max-w-md mt-4">{printoutRail}</div>
            )}
            </CbatStickLayout>
          )}

          {phase === 'printAsk' && (
            <PrintAskCard onPrint={() => setPhase('printing')} onSkip={beginRun} />
          )}

          {phase === 'printing' && grid && sheet && (
            <div className="w-full flex flex-col items-center">
              <div className="matf-print-chrome w-full max-w-3xl mb-4 text-center">
                <p className="text-lg font-extrabold text-white mb-1">Your reference sheets</p>
                <p className="text-sm text-slate-400 mb-1">
                  Two pages, sized for A4. Print them, put them beside the keyboard, then start the
                  test.
                </p>
                <p className="text-sm text-amber-400 mb-4">
                  Every run builds a different set of numbers on purpose, so your brain learns the
                  lookup instead of one set of values. We recommend a fresh print each time you play.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  <button
                    type="button"
                    onClick={printSheet}
                    className="px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg transition-colors text-sm cursor-pointer"
                  >
                    Print these sheets
                  </button>
                  <button
                    type="button"
                    onClick={beginRun}
                    className="px-6 py-3 rounded-lg border-2 border-game-line bg-game-arena text-slate-600 font-bold text-sm hover:border-brand-400 hover:text-brand-600 transition-colors cursor-pointer"
                  >
                    {onPaper ? 'Start the test' : 'Skip printing and start'}
                  </button>
                </div>
                <p className="text-[11px] text-game-muted mt-3">
                  Sheet <span className="font-mono text-brand-600">{matfSheetCode(seed)}</span>. Keep
                  the paper and you can play these same tables again from the instructions screen,
                  though a repeat run is not submitted to the leaderboard.
                </p>
              </div>

              <MatfPrintSheet
                grid={grid}
                sheet={sheet}
                seed={seed}
                shape={matfPrintoutShape(runTuning.key)}
                printedAt={runBuiltAtRef.current}
              />
            </div>
          )}

          {phase === 'interstitial' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              className="w-full max-w-md bg-game-panel border border-game-line rounded-xl p-8 text-center"
            >
              <p className="text-4xl mb-3">✅</p>
              <p className="text-lg font-extrabold text-white mb-1">Part 1 complete</p>
              <p className="text-sm text-slate-400 mb-5">{gridCorrect} correct on the grid.</p>
              <p className="text-sm text-game-text mb-6">
                Part 2 swaps the grid for the wind sheet. Three steps: the air speed tells you which table, the wind velocity the row, the wind angle the column. Each column carries a Drift Correction and a Ground Speed, and the question says which one it wants.
              </p>
              <button
                onClick={beginPart2}
                data-demo-start
                className="px-8 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg transition-colors text-sm"
              >
                Start Part 2
              </button>
            </motion.div>
          )}

          {/* No max-width while a part runs — the shell override above hands the
              page the full desktop width and the grid is sized to take it. The
              answer row is capped separately below so four options don't stretch
              into a letterbox on a wide monitor. */}
          {playing && question && (
            <div className="w-full">
              {/* HUD — under the Real CBAT theme the title bar carries this */}
              {!cbat && <div className="flex items-center justify-between text-xs font-mono mb-2 px-1 max-w-2xl mx-auto">
                <span className="text-slate-400">Part <span className="text-brand-600">{phase === 'part1' ? 1 : 2}</span>/2</span>
                <span className="text-slate-400">✓ <span className="text-green-400">{correctSoFar}</span>/{attempted}</span>
                <span className="text-slate-400">
                  ⏱ <span className={remainingMs < 15000 ? 'text-red-400' : 'text-brand-600'}>{Math.ceil(remainingMs / 1000)}s</span>
                </span>
              </div>}

              {!cbat && <div className="w-full max-w-2xl mx-auto h-1 bg-game-line rounded-full mb-3 overflow-hidden">
                <motion.div
                  className="h-full bg-brand-600 rounded-full"
                  initial={false}
                  animate={{ width: `${100 - (remainingMs / runTuning.partMs) * 100}%` }}
                  transition={{ duration: 0.1 }}
                />
              </div>}

              {/* Question above the reference, so the two numbers you are
                  carrying stay in view while you scan. */}
              <div
                className={`bg-game-panel border-2 rounded-xl p-4 mb-3 max-w-2xl mx-auto transition-colors duration-150 ${
                  flash === 'right' ? 'border-green-500/60' : flash === 'wrong' ? 'border-red-500/60' : 'border-game-line'
                }`}
              >
                {question.part === 'grid' ? (
                  <p className="text-center text-lg sm:text-xl font-bold text-game-text mb-3 font-mono">
                    {question.a} <span className="text-slate-600">,</span> {question.b}
                  </p>
                ) : (
                  // All three lookups named at once, the way the real prompt
                  // gives them. The readout is on its own line because it is the
                  // step people forget: right cell, wrong half of it.
                  <div className="text-center mb-3">
                    <p className="font-mono text-base sm:text-lg font-bold text-game-text">
                      <span className="text-slate-500 text-xs font-sans font-normal">A/S </span>{question.airSpeed}
                      <span className="text-slate-600 mx-2">·</span>
                      <span className="text-slate-500 text-xs font-sans font-normal">W/V </span>{question.windVelocity}
                      <span className="text-slate-600 mx-2">·</span>
                      <span className="text-slate-500 text-xs font-sans font-normal">ANGLE </span>{question.windAngle}°
                    </p>
                    <p className="text-xs font-bold text-brand-600 uppercase tracking-wide mt-1">
                      Read the {question.readoutLabel}
                    </p>
                  </div>
                )}
                {/* Five numbered options, which is what the corpus reports the
                    real test offering. The number is the label a candidate calls
                    an answer by, so it is drawn rather than implied. */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {question.options.map((opt, i) => (
                    <button
                      key={`${opt}-${i}`}
                      type="button"
                      onClick={() => select(i)}
                      data-demo-answer
                      className={`py-3 rounded-lg border-2 border-game-line bg-game-arena text-game-text font-mono font-bold text-base hover:border-brand-400 hover:bg-game-raised transition-all cursor-pointer${pending === i ? ' cbat-option-pending' : ''}`}
                    >
                      {cbat ? <CbatKeyCap label={i + 1} className="mr-1.5" /> : <span className="text-[10px] text-slate-600 mr-1.5">{i + 1}</span>}{opt}
                    </button>
                  ))}
                </div>
              </div>

              {onPaper ? (
                <PrintedSheetCover
                  code={matfSheetCode(seed)}
                  part={phase === 'part1' ? 1 : 2}
                  onReveal={() => setOnPaper(false)}
                />
              ) : (<>
                {phase === 'part1' && grid && <GridPanel grid={grid} />}
                {phase === 'part2' && sheet && <SheetPanel sheet={sheet} />}
              </>)}

              {/* Real CBAT theme: the instruction strip */}
              <CbatFooterStrip
                answer={pending != null ? pending + 1 : null}
                onSubmit={commit}
                canSubmit={pending != null}
              />
            </div>
          )}

          {phase === 'results' && (
            <CbatGameOver
              gameKey={gameKey}
              score={correctSoFar}
              time={(runTuning.partMs * 2) / 1000}
              scoreSaved={scoreSaved}
              queued={queued}
              personalBest={personalBest}
              onPlayAgain={() => { setScoreSaved(false); beginLaunch() }}
            >
              <ResultsScreen
                gridCorrect={gridCorrect}
                tableCorrect={tableCorrect}
                attempted={attempted}
                totalTime={(runTuning.partMs * 2) / 1000}
                grade={computeMatfGrade(correctSoFar, runTuning)}
                replayedSheet={replayed ? matfSheetCode(seed) : null}
              />
            </CbatGameOver>
          )}
        </div>
      )}
    </div>
  )
}
