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
// the actual difficulty. One display cannot reproduce that. Rather than pretend
// otherwise, the intro says so and suggests the drill the corpus recommends.

import { useState, useCallback, useEffect, useRef, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { submitCbatResult } from '../lib/cbatOutbox'
import { useCbatTracking } from '../utils/cbat/useCbatTracking'
import { useGameChrome } from '../context/GameChromeContext'
import { useCbatDemo } from '../utils/cbat/demoMode'
import SEO from '../components/SEO'
import CbatQuitButton from '../components/CbatQuitButton'
import CbatGameOver from '../components/CbatGameOver'
import { useGameBodyClass } from '../hooks/useGameBodyClass'
import { CbatModeRow, ModeMarker } from '../components/CbatModeSelector'
import CbatPersonalBest from '../components/CbatPersonalBest'
import { useCbatPersonalBest } from '../hooks/useCbatPersonalBest'
import {
  buildMatfGrid, matfGridQuestion, axisLabels,
  buildMatfSheet, matfSheetQuestion, READOUTS,
} from '../utils/cbat/matfGenerator'
import {
  MATF_DIFFICULTIES, MATF_LAUNCH_MS,
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
    <div className="overflow-auto max-h-[46vh] lg:max-h-[70vh] border border-[#1a3a5c] rounded-lg bg-[#060e1a]">
      <table
        className="border-collapse font-mono w-full table-fixed text-[10px] sm:text-xs lg:text-sm"
        style={{ minWidth: `${(labels.length + 1) * 32}px` }}
      >
        <thead>
          <tr>
            <th className="sticky top-0 left-0 z-20 bg-[#0f2240] text-slate-600 px-1 py-1 lg:py-1.5">·</th>
            {labels.map(l => (
              <th key={l} className="sticky top-0 z-10 px-1 py-1 lg:py-1.5 font-bold bg-[#0f2240] text-slate-500">
                {l}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.cells.map((rowVals, r) => (
            <tr key={r}>
              <th className="sticky left-0 z-10 px-1 py-1 lg:py-1.5 font-bold bg-[#0f2240] text-slate-500">
                {labels[r]}
              </th>
              {rowVals.map((v, c) => (
                <td key={c} className="px-1 py-1 lg:py-1.5 text-center text-[#ddeaf8] border-b border-[#0d1c30]">{v}</td>
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
    <div className="overflow-auto max-h-[46vh] lg:max-h-[70vh] border border-[#1a3a5c] rounded-lg bg-[#060e1a] p-2 space-y-3">
      {sheet.tables.map(table => (
        <table key={table.airSpeed} className="border-collapse font-mono w-full text-[10px] sm:text-xs lg:text-sm" style={{ minWidth: '460px' }}>
          <caption className="caption-top text-left text-[10px] lg:text-xs font-bold text-brand-600 uppercase tracking-wide pb-1">
            Air Speed {table.airSpeed} kt
          </caption>
          <thead>
            <tr>
              <th rowSpan={2} className="bg-[#0f2240] text-slate-600 px-2 py-1 text-left align-bottom">W/V</th>
              {sheet.angles.map(a => (
                <th key={a} colSpan={2} className="bg-[#0f2240] text-slate-500 px-2 py-1 font-bold border-l border-[#1a3a5c]">
                  {a}°
                </th>
              ))}
            </tr>
            <tr>
              {sheet.angles.map(a => (
                <Fragment key={a}>
                  <th className="bg-[#0b1a2e] text-slate-600 px-1 py-0.5 font-bold border-l border-[#1a3a5c]">{READOUTS.drift.short}</th>
                  <th className="bg-[#0b1a2e] text-slate-600 px-1 py-0.5 font-bold">{READOUTS.ground.short}</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((v, r) => (
              <tr key={v}>
                <th className="bg-[#0f2240] text-slate-500 px-2 py-1 font-bold text-left">{v}</th>
                {sheet.angles.map((a, c) => (
                  <Fragment key={a}>
                    <td className="px-1 py-1 text-center text-[#ddeaf8] border-b border-l border-[#0d1c30]">{table.cells[r][c].drift}</td>
                    <td className="px-1 py-1 text-center text-[#ddeaf8] border-b border-[#0d1c30]">{table.cells[r][c].ground}</td>
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

function ResultsScreen({ gridCorrect, tableCorrect, attempted, totalTime, grade }) {
  const correct = gridCorrect + tableCorrect
  const accuracy = attempted ? Math.round((correct / attempted) * 100) : 0
  const emoji = grade === 'Outstanding' ? '🎖️' : grade === 'Good' ? '📋' : grade === 'Needs Work' ? '🔧' : '💥'
  const color = grade === 'Outstanding' ? 'text-green-400' : grade === 'Good' ? 'text-brand-600' : grade === 'Needs Work' ? 'text-amber-400' : 'text-red-400'

  return (
    <div className="w-full bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-8 text-center">
      <p className="text-5xl mb-3">{emoji}</p>
      <p className={`text-2xl font-extrabold mb-1 ${color}`}>{grade}</p>
      <p className="text-sm text-slate-400 mb-6">Table Reading Test Complete</p>

      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-5 mb-4">
        <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">Overall Score</p>
        <div className="flex justify-center gap-8 items-end">
          <div>
            <p className="text-4xl font-mono font-bold text-brand-600 mb-1">{correct}</p>
            <p className="text-sm text-slate-400">correct</p>
          </div>
          <div className="w-px h-12 bg-[#1a3a5c]" />
          <div>
            <p className="text-4xl font-mono font-bold text-brand-600 mb-1">{accuracy}%</p>
            <p className="text-sm text-slate-400">of {attempted} attempted</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Part 1 · Grid</p>
          <p className="text-2xl font-mono font-bold text-brand-600">{gridCorrect}</p>
        </div>
        <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3">
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

  // intro | launching | part1 | interstitial | part2 | results
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

  const tickRef = useRef(null)
  const launchTimerRef = useRef(null)
  const phaseStartRef = useRef(null)
  const scoreRef = useRef({ grid: 0, table: 0, attempted: 0 })
  const gridRef = useRef(null)
  const sheetRef = useRef(null)

  const runTuning = matfTuning(runDifficulty)
  const introTuning = matfTuning(difficulty)
  const gameKey = runTuning.gameKey

  // The reference grid is the game; give it the screen while a part is running.
  // See the rule in main.css for why max-w-3xl is actively harmful here.
  useGameBodyClass('cbat-matf-wide', phase === 'part1' || phase === 'part2')

  // Keyed by board, so flipping mode never shows one board's score under
  // another's name and never blanks the panel while the new one loads.
  const { best: personalBest, loading: bestLoading, refresh: fetchBest } =
    useCbatPersonalBest(matfTuning(difficulty).gameKey, { user, apiFetch, API })


  useEffect(() => () => {
    clearInterval(tickRef.current)
    clearTimeout(launchTimerRef.current)
  }, [])

  const submitScore = useCallback((totals, totalMs, key) => {
    const correctCount = totals.grid + totals.table
    setScoreSaved(false)
    setQueued(false)
    markGameCompleted({ score: correctCount })
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
    setFlash(correct ? 'right' : 'wrong')
    // Straight on to the next question. No pause for feedback: a speeded test
    // that stops to congratulate you is no longer measuring the same thing, so
    // the flash rides on the next question's render instead.
    nextQuestion(question.part === 'grid' ? 'part1' : 'part2')
  }

  function finishRun() {
    const totalMs = runTuning.partMs * 2
    submitScore(scoreRef.current, totalMs, gameKey)
    setPhase('results')
  }

  function beginPart2() {
    nextQuestion('part2')
    setPhase('part2')
  }

  const beginLaunch = useCallback(() => {
    const tuning = matfTuning(difficulty)
    setRunDifficulty(difficulty)
    storeMatfDifficulty(difficulty)

    const g = buildMatfGrid(tuning.gridExtent)
    const s = buildMatfSheet(tuning)
    gridRef.current = g
    sheetRef.current = s
    setGrid(g)
    setSheet(s)
    setQuestion(matfGridQuestion(g))
    setFlash(null)
    scoreRef.current = { grid: 0, table: 0, attempted: 0 }
    setGridCorrect(0)
    setTableCorrect(0)
    setAttempted(0)
    startTracking(tuning.gameKey)

    if (isDemo) { setPhase('part1'); return }
    setPhase('launching')
    launchTimerRef.current = setTimeout(() => setPhase('part1'), MATF_LAUNCH_MS)
  }, [difficulty, startTracking, isDemo])

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
  }, [])

  const playing = phase === 'part1' || phase === 'part2'
  const correctSoFar = gridCorrect + tableCorrect
  // Everything on the intro card except the flashing difficulty button dims
  // during the launch flash — the same treatment FLAG, SAT and RTT use.
  const dim = phase === 'launching' ? ' cbat-launch-dim' : ''

  return (
    <div>
      <SEO title="Table Reading Test (CBAT)" description="A signed coordinate grid and a wind reference sheet, worked against the clock." />

      <div className="flex items-center gap-2 mb-2">
        {phase === 'intro'
          ? <Link to="/cbat" className="text-slate-500 hover:text-brand-400 transition-colors text-sm">&larr; CBAT</Link>
          : <CbatQuitButton onConfirm={goToIntro} confirmNeeded={playing} />
        }
        <h1 className="text-sm font-extrabold text-slate-900">Table Reading Test</h1>
        {phase !== 'intro' && <ModeMarker mode={runTuning} />}
      </div>

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
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full max-w-md bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-6 text-center"
            >
              <p className={`text-4xl mb-3${dim}`}>📋</p>

              {/* MATF_DIFFICULTIES is ordered [easier, hard], so the easier
                  option lands left and hard lands right. The pair sits under the
                  title, matching FLAG, CUT, Numerical Operations, SAT and RTT. */}
              <p className={`text-xl font-extrabold text-white mb-2${dim}`}>Table Reading Test</p>
              <CbatModeRow
                modes={MATF_DIFFICULTIES}
                value={difficulty}
                onSelect={setDifficulty}
                launching={phase === 'launching'}
              />
              <p className={`text-[11px] text-brand-600 mb-3${dim}`}>{introTuning.blurb}</p>

              <p className={`text-sm text-slate-400 mb-5${dim}`}>
                Two parts against the clock. Answer as many as you can. Nothing here is hard to understand, and everything here is hard to do quickly.
              </p>

              <div className={`bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-4 mb-5 text-left space-y-2 text-sm text-[#ddeaf8]${dim}`}>
                <div className="flex items-start gap-2">
                  <span className="text-brand-600 font-bold shrink-0">1.</span>
                  <span>Coordinate grid, running from minus {introTuning.gridExtent} to plus {introTuning.gridExtent} both ways. Bring one number across, one down, read where they meet.</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-brand-600 font-bold shrink-0">2.</span>
                  <span>Wind sheet, in three steps. Air speed picks the table, wind velocity picks the row, wind angle picks the column. Then read the one of Drift Correction or Ground Speed you were asked for.</span>
                </div>
                <div className="flex items-start gap-2 text-xs text-brand-600/90 pt-1">
                  <span className="shrink-0">💡</span>
                  <span>On the grid the pair works either way round. The value at 4, −11 is the value at −11, 4. Don’t spend a moment deciding which is which.</span>
                </div>
                <div className="flex items-start gap-2 text-xs text-brand-600/90">
                  <span className="shrink-0">💡</span>
                  <span>On the wind sheet, check the air speed on the table you have landed in before you read anything off it. Every table looks the same, and the right row and column of the wrong table is offered as an answer.</span>
                </div>
                <div className="flex items-start gap-2 text-xs text-[#8a9bb5] pt-1">
                  <span className="shrink-0">📄</span>
                  <span>The real test puts the reference on a printed sheet beside the screen, and moving between two surfaces is a lot of what it costs. Practise with a printed grid next to you as well as here.</span>
                </div>
                <div className="flex items-start gap-2 text-xs text-[#8a9bb5]">
                  <span className="shrink-0">⏱</span>
                  <span>±{introTuning.gridExtent} grid · {introTuning.tableCount} air-speed tables · {Math.round(introTuning.partMs / 1000)}s per part</span>
                </div>
              </div>

              <CbatPersonalBest label={introTuning.label} best={personalBest} loading={bestLoading} className={dim}>
                {best => <>{best.bestScore} correct</>}
              </CbatPersonalBest>

              <div className={`text-center mb-4${dim}`}>
                <Link to={`/cbat/${introTuning.gameKey}/leaderboard`} className="text-xs text-brand-600 hover:text-brand-700 transition-colors">
                  View Leaderboard →
                </Link>
              </div>

              <button
                onClick={beginLaunch}
                disabled={phase === 'launching'}
                data-demo-start
                className="px-8 py-3 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-bold rounded-lg transition-colors text-sm"
              >
                Start
              </button>
            </motion.div>
          )}

          {phase === 'interstitial' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              className="w-full max-w-md bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-8 text-center"
            >
              <p className="text-4xl mb-3">✅</p>
              <p className="text-lg font-extrabold text-white mb-1">Part 1 complete</p>
              <p className="text-sm text-slate-400 mb-5">{gridCorrect} correct on the grid.</p>
              <p className="text-sm text-[#ddeaf8] mb-6">
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
              <div className="flex items-center justify-between text-xs font-mono mb-2 px-1 max-w-2xl mx-auto">
                <span className="text-slate-400">Part <span className="text-brand-600">{phase === 'part1' ? 1 : 2}</span>/2</span>
                <span className="text-slate-400">✓ <span className="text-green-400">{correctSoFar}</span>/{attempted}</span>
                <span className="text-slate-400">
                  ⏱ <span className={remainingMs < 15000 ? 'text-red-400' : 'text-brand-600'}>{Math.ceil(remainingMs / 1000)}s</span>
                </span>
              </div>

              <div className="w-full max-w-2xl mx-auto h-1 bg-[#1a3a5c] rounded-full mb-3 overflow-hidden">
                <motion.div
                  className="h-full bg-brand-600 rounded-full"
                  initial={false}
                  animate={{ width: `${100 - (remainingMs / runTuning.partMs) * 100}%` }}
                  transition={{ duration: 0.1 }}
                />
              </div>

              {/* Question above the reference, so the two numbers you are
                  carrying stay in view while you scan. */}
              <div
                className={`bg-[#0a1628] border-2 rounded-xl p-4 mb-3 max-w-2xl mx-auto transition-colors duration-150 ${
                  flash === 'right' ? 'border-green-500/60' : flash === 'wrong' ? 'border-red-500/60' : 'border-[#1a3a5c]'
                }`}
              >
                {question.part === 'grid' ? (
                  <p className="text-center text-lg sm:text-xl font-bold text-[#ddeaf8] mb-3 font-mono">
                    {question.a} <span className="text-slate-600">,</span> {question.b}
                  </p>
                ) : (
                  // All three lookups named at once, the way the real prompt
                  // gives them. The readout is on its own line because it is the
                  // step people forget: right cell, wrong half of it.
                  <div className="text-center mb-3">
                    <p className="font-mono text-base sm:text-lg font-bold text-[#ddeaf8]">
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
                      onClick={() => handlePick(opt)}
                      data-demo-answer
                      className="py-3 rounded-lg border-2 border-[#1a3a5c] bg-[#060e1a] text-[#ddeaf8] font-mono font-bold text-base hover:border-brand-400 hover:bg-[#0f2240] transition-all cursor-pointer"
                    >
                      <span className="text-[10px] text-slate-600 mr-1.5">{i + 1}</span>{opt}
                    </button>
                  ))}
                </div>
              </div>

              {phase === 'part1' && grid && <GridPanel grid={grid} />}
              {phase === 'part2' && sheet && <SheetPanel sheet={sheet} />}
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
              />
            </CbatGameOver>
          )}
        </div>
      )}
    </div>
  )
}
