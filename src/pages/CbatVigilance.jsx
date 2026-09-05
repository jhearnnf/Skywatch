// CBAT "Vigilance Test" — the star grid.
//
// Three minutes of clearing coordinates off a grid, with yellow priority tasks
// that appear once the job has gone quiet. The simulation and the reasoning
// behind the scoring live in utils/cbat/vigilanceSim.js.
//
// ONE difficulty, deliberately. Every other CBAT game with a split lowers the
// load and keeps the clock; here the clock is the load, and a shorter Vigilance
// test would not be measuring vigilance. That is why this page has no
// difficulty pair under its title while its four siblings do.
//
// The grid carries its labels on ALL FOUR edges. That is not decoration: the
// corpus's technique — "edge squares can be entered without checking the grid
// labels at all, so they're quicker than anything in the middle" — is only true
// if a label sits next to every edge cell. Labelling one side would silently
// make the advice false here.
//
// 9×9, labelled 1–9, keyed ROW FIRST then column. All three come straight from
// the corpus ("A 9×9 grid ... row number first, then column, so a star at 2,7 is
// entered as those two digits") and all three are load-bearing: the pad is a
// plain 3×3 with no zero, and the corpus's worked example — 2,1 then 2,2 then
// 2,3 — only reads as a walk along a row if the row is the digit you key first.

import { useState, useCallback, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { submitCbatResult } from '../lib/cbatOutbox'
import { useCbatTracking } from '../utils/cbat/useCbatTracking'
import { useGameChrome } from '../context/GameChromeContext'
import SEO from '../components/SEO'
import CbatQuitButton from '../components/CbatQuitButton'
import CbatGameOver from '../components/CbatGameOver'
import { useGameBodyClass } from '../hooks/useGameBodyClass'
import {
  createVigilanceSim, VIGILANCE_GRID, VIGILANCE_DURATION_MS,
  STAR_POINTS, PRIORITY_BASE_POINTS, MISKEY_PENALTY,
} from '../utils/cbat/vigilanceSim'

// Cell indices, 0-based. The LABEL drawn for index i is i + 1, so the axes read
// 1–9 and every coordinate is two keystrokes off a pad with no zero on it.
const CELLS = Array.from({ length: VIGILANCE_GRID }, (_, i) => i)

// ── Grid ─────────────────────────────────────────────────────────────────────
// Top-level so it never remounts mid-run.
//
// The half-entered coordinate highlights the ROW, because the row is the digit
// keyed first. It is the visual half of the corpus's "work along a row in
// sequence" advice: commit the row and the whole row lights up, leaving one
// digit to pick off each star in it.
//
// THE BOARD MUST NOT MOVE. Under the default `table-layout: auto` a column is
// sized to its widest content, and an empty cell contributes nothing while a
// cell holding a ★ contributes a glyph — so every spawn and every clear
// re-flowed the grid and the cells visibly jittered through the run. On a test
// that is three minutes of holding your eye on a fixed board, a board that
// shifts under you is close to the worst bug available.
//
// Two things are needed, and the first alone is not enough:
//
//   1. `table-fixed`, so column widths come from the first row and content is
//      ignored.
//   2. A DEFINITE WIDTH on the table. Fixed layout is silently ignored when the
//      width is auto — the browser falls back to the automatic algorithm. That
//      was the first attempt at this fix, and it left the table's overall width
//      pinned while the columns underneath carried on redistributing, which is
//      hard to spot and just as wrong.
//
// The width has to equal the sum of the columns or they get scaled to fit, so it
// is built from the same custom properties the cells use (see .vigilance-board
// in main.css) and from the grid size, which means the three cannot drift apart.
const CELL_SIZE = 'var(--vig-cell)'
const LABEL_SIZE = 'var(--vig-label)'
const BOARD_WIDTH = `calc(${LABEL_SIZE} * 2 + ${CELL_SIZE} * ${VIGILANCE_GRID})`

// How long a clear effect lives. Must outlast the longest animation in the set
// (the score readout, at 560ms) or the burst is yanked off screen mid-flight.
export const CLEAR_EFFECT_MS = 620

// A quick confirming pulse and the number it paid, and nothing else. An earlier
// cut threw six sparks and a glow on every clear, which on a board where hits
// come a second apart competed with the task for attention — the one thing an
// effect on an attention test must not do. See main.css for the timings.
function ClearBurst({ priority, delta }) {
  return (
    <span className={`vig-burst ${priority ? 'vig-burst-priority' : ''}`} aria-hidden="true">
      <span className="vig-burst-glyph">{priority ? '◆' : '★'}</span>
      <span className="vig-burst-ring" />
      <span className="vig-burst-score">+{delta}</span>
    </span>
  )
}

function StarGrid({ stars, pendingRow, lastEvent, clears }) {
  const byCell = new Map(stars.map(s => [`${s.row},${s.col}`, s]))
  // Grouped once per render rather than filtered inside all 81 cells — this
  // component re-renders on every frame of the run.
  const burstsByCell = new Map()
  for (const c of clears) {
    const key = `${c.row},${c.col}`
    if (!burstsByCell.has(key)) burstsByCell.set(key, [])
    burstsByCell.get(key).push(c)
  }
  return (
    <div className="vigilance-board inline-block bg-[#060e1a] border border-[#1a3a5c] rounded-lg p-1.5 select-none">
      <table
        className="table-fixed border-collapse font-mono text-[10px] sm:text-xs lg:text-lg"
        style={{ width: BOARD_WIDTH }}
      >
        <thead>
          <tr>
            <th style={{ width: LABEL_SIZE }} />
            {CELLS.map(c => (
              <th key={c} className="px-0 py-0.5 font-bold text-center text-slate-600" style={{ width: CELL_SIZE }}>
                {c + 1}
              </th>
            ))}
            <th style={{ width: LABEL_SIZE }} />
          </tr>
        </thead>
        <tbody>
          {CELLS.map(r => (
            <tr key={r}>
              <th className={`px-0.5 font-bold text-right ${pendingRow === r ? 'text-brand-600' : 'text-slate-600'}`} style={{ width: LABEL_SIZE }}>{r + 1}</th>
              {CELLS.map(c => {
                const star = byCell.get(`${r},${c}`)
                const isLast = lastEvent && lastEvent.row === r && lastEvent.col === c
                const bursts = burstsByCell.get(`${r},${c}`)
                return (
                  <td
                    key={c}
                    data-cell={`${r},${c}`}
                    // `relative` so the burst can be positioned inside the cell.
                    // It costs the layout nothing: the burst is out of flow, so
                    // it cannot widen a column — which on this board matters.
                    className={`relative text-center align-middle border border-[#0d1c30] ${
                      pendingRow === r ? 'bg-[#0b1a2e]' : ''
                    } ${isLast && lastEvent.type === 'miss' ? 'bg-red-500/25' : ''} ${
                      bursts ? 'vig-cell-cleared' : ''
                    } ${bursts?.some(b => b.priority) ? 'vig-cell-cleared-priority' : ''}`}
                    style={{ width: CELL_SIZE, height: CELL_SIZE }}
                  >
                    {star && (
                      <span className={`leading-none lg:text-2xl ${star.priority ? 'text-amber-300' : 'text-brand-600'}`}>
                        {star.priority ? '◆' : '★'}
                      </span>
                    )}
                    {bursts?.map(b => (
                      <ClearBurst key={b.id} priority={b.priority} delta={b.delta} />
                    ))}
                  </td>
                )
              })}
              <th className={`px-0.5 font-bold text-left ${pendingRow === r ? 'text-brand-600' : 'text-slate-600'}`} style={{ width: LABEL_SIZE }}>{r + 1}</th>
            </tr>
          ))}
          <tr>
            <th style={{ width: LABEL_SIZE }} />
            {CELLS.map(c => (
              <th key={c} className="px-0 py-0.5 font-bold text-center text-slate-600" style={{ width: CELL_SIZE }}>
                {c + 1}
              </th>
            ))}
            <th style={{ width: LABEL_SIZE }} />
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// Standard telephone/numpad layout — 7-8-9 / 4-5-6 / 1-2-3 across three columns,
// matching DPT's controls and FLAG's maths pad. A player moving between CBAT
// games should not have to relearn where a digit is, and muscle memory built
// here has to transfer to the real test's Stream Deck, which is itself a 3×3 pad.
//
// No zero key, because a 9×9 grid labelled 1–9 has no zero coordinate. That is
// what lets the pad be exactly the 3×3 the real hardware is — the previous
// 10×10 grid needed a fourth row carrying a lone 0 and two blank spacers.
const PAD_ROWS = [[7, 8, 9], [4, 5, 6], [1, 2, 3]]

function Keypad({ onDigit, onClear, pendingRow }) {
  return (
    <div className="mt-3 w-full max-w-[280px] lg:max-w-[240px] lg:mt-0 mx-auto">
      {/* The half-entered coordinate, shown the way DPT shows its bearing: the
          digit you have committed and a placeholder for the one still owed. */}
      <div className="bg-[#060e1a] border border-[#1a3a5c] rounded-lg py-2 mb-2 text-center">
        <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">
          {pendingRow === null ? 'Enter row' : 'Enter column'}
        </p>
        <span className="font-mono text-2xl font-bold tracking-[0.4em] text-brand-600">
          {pendingRow === null ? <span className="text-slate-600">__</span> : <>{pendingRow + 1}<span className="text-slate-600">_</span></>}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {PAD_ROWS.flat().map(d => (
          <button
            key={d}
            type="button"
            onClick={() => onDigit(d)}
            data-demo-answer
            className="py-3 rounded-lg border border-[#1a3a5c] bg-[#0a1628] text-[#ddeaf8] font-mono text-base font-bold hover:bg-[#0f2240] hover:border-brand-400 active:bg-brand-600 transition-all cursor-pointer"
          >
            {d}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onClear}
        className="mt-1.5 w-full py-1.5 rounded-lg border border-[#1a3a5c] bg-[#060e1a] text-slate-500 text-[11px] font-bold hover:text-[#ddeaf8] transition-colors cursor-pointer"
      >
        Clear
      </button>
      <p className="text-[10px] text-slate-600 mt-2 text-center">
        Keys: <span className="font-mono">1–9</span>, <span className="font-mono">Backspace</span> to clear
      </p>
    </div>
  )
}

function ResultsScreen({ stats, grade }) {
  const emoji = grade === 'Outstanding' ? '🎖️' : grade === 'Good' ? '⭐' : grade === 'Needs Work' ? '🔧' : '💥'
  const color = grade === 'Outstanding' ? 'text-green-400' : grade === 'Good' ? 'text-brand-600' : grade === 'Needs Work' ? 'text-amber-400' : 'text-red-400'

  return (
    <div className="w-full bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-8 text-center">
      <p className="text-5xl mb-3">{emoji}</p>
      <p className={`text-2xl font-extrabold mb-1 ${color}`}>{grade}</p>
      <p className="text-sm text-slate-400 mb-6">Vigilance Test Complete</p>

      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-5 mb-4">
        <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">Score</p>
        <p className="text-4xl font-mono font-bold text-brand-600">{stats.score}</p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Stars</p>
          <p className="text-xl font-mono font-bold text-brand-600">{stats.starsCleared}</p>
        </div>
        <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Priority</p>
          <p className="text-xl font-mono font-bold text-amber-300">{stats.prioritiesCleared}</p>
        </div>
        <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Mis-keyed</p>
          <p className="text-xl font-mono font-bold text-red-400">{stats.misKeyed}</p>
        </div>
      </div>
      {stats.misKeyed > 3 && (
        <p className="text-[11px] text-slate-500 mt-3">
          Each mis-key cost {MISKEY_PENALTY} points. Work along a row in sequence rather than jumping
          about. The row is the digit you key first, so you re-key only the second one that way.
        </p>
      )}
    </div>
  )
}

function computeGrade(score) {
  if (score >= 800) return 'Outstanding'
  if (score >= 550) return 'Good'
  if (score >= 300) return 'Needs Work'
  return 'Failed'
}

// ── Main component ───────────────────────────────────────────────────────────
export default function CbatVigilance() {
  const { user, apiFetch, API } = useAuth()
  const { start: startTracking, markCompleted: markGameCompleted } = useCbatTracking()

  const [phase, setPhase] = useState('intro') // intro | playing | results
  // The board is the test, and at 22px a cell it is a 200px square to hold
  // attention on for three minutes. See the rule in main.css — the app shell
  // caps every route at max-w-3xl, so this page cannot widen itself alone.
  useGameBodyClass('cbat-vigilance-wide', phase === 'playing')
  const { enterImmersive, exitImmersive } = useGameChrome()
  useEffect(() => {
    if (phase === 'playing') enterImmersive()
    else exitImmersive()
    return exitImmersive
  }, [phase, enterImmersive, exitImmersive])

  const [snapshot, setSnapshot] = useState(null)
  const [pendingRow, setPendingRow] = useState(null)
  const [lastEvent, setLastEvent] = useState(null)
  // Live clear effects, one per star cleared. Held here rather than in StarGrid
  // so they survive that component's re-render on every frame of the run.
  const [clears, setClears] = useState([])
  const [finalStats, setFinalStats] = useState(null)
  const [personalBest, setPersonalBest] = useState(null)
  const [scoreSaved, setScoreSaved] = useState(false)
  const [queued, setQueued] = useState(false)

  // The sim is stepped from a rAF loop and read through a snapshot each frame —
  // the same pattern CUT uses. React never renders off the live simulation.
  const simRef = useRef(null)
  const rafRef = useRef(null)
  const lastTsRef = useRef(null)
  const pendingRowRef = useRef(null)
  const clearIdRef = useRef(0)
  // Every retirement timer, so a run that ends mid-animation does not leave one
  // pending — and so quitting cannot land a setState on an unmounted page.
  const clearTimersRef = useRef(new Set())

  const fetchBest = useCallback(() => {
    apiFetch(`${API}/api/games/cbat/vigilance/personal-best`)
      .then(r => r.json())
      .then(d => setPersonalBest(d?.data ?? null))
      .catch(() => {})
  }, [apiFetch, API])

  useEffect(() => { if (user) fetchBest() }, [user, fetchBest])

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])
  useEffect(() => () => {
    for (const t of clearTimersRef.current) clearTimeout(t)
    clearTimersRef.current.clear()
  }, [])

  // Fires the burst. Removal is on a timer rather than on `animationend`,
  // because the burst runs four animations of different lengths and the event
  // would fire on the first one to finish.
  const addClear = useCallback((event) => {
    const id = ++clearIdRef.current
    setClears(prev => [...prev, {
      id, row: event.row, col: event.col,
      priority: event.type === 'priority', delta: event.delta,
    }])
    const timer = setTimeout(() => {
      setClears(prev => prev.filter(c => c.id !== id))
      clearTimersRef.current.delete(timer)
    }, CLEAR_EFFECT_MS)
    clearTimersRef.current.add(timer)
  }, [])

  const finishRun = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    const sim = simRef.current
    if (!sim) return
    const stats = {
      score: sim.finalScore(),
      starsCleared: sim.state.starsCleared,
      prioritiesCleared: sim.state.prioritiesCleared,
      misKeyed: sim.state.misKeyed,
    }
    setFinalStats(stats)
    setPhase('results')

    setScoreSaved(false)
    setQueued(false)
    markGameCompleted({ score: stats.score })
    submitCbatResult('vigilance', {
      totalScore: stats.score,
      starsCleared: stats.starsCleared,
      prioritiesCleared: stats.prioritiesCleared,
      misKeyed: stats.misKeyed,
      totalTime: VIGILANCE_DURATION_MS / 1000,
    }, { apiFetch, API })
      .then((r) => {
        setScoreSaved(!!r?.synced)
        setQueued(!!r?.queued)
        fetchBest()
      })
      .catch(() => {})
  }, [apiFetch, API, markGameCompleted, fetchBest])

  // The rAF driver lives in an effect keyed on `phase` rather than in a
  // self-scheduling useCallback. A callback that re-requests itself has to
  // reference its own binding before it is declared, which pins the loop to
  // whichever version of `finishRun` existed on the first frame — so a run that
  // ended would submit through a stale closure. Scoping the frame function to
  // the effect makes that impossible and gives the cleanup for free.
  useEffect(() => {
    if (phase !== 'playing') return undefined
    let raf
    const step = (ts) => {
      const sim = simRef.current
      if (!sim) return
      if (lastTsRef.current == null) lastTsRef.current = ts
      // Clamped so a backgrounded tab does not return and advance the sim by a
      // single enormous step, spawning a whole run's worth of stars at once.
      const dt = Math.min(100, ts - lastTsRef.current)
      lastTsRef.current = ts
      sim.step(dt)
      setSnapshot(sim.snapshot())
      if (sim.state.finished) { finishRun(); return }
      raf = requestAnimationFrame(step)
      rafRef.current = raf
    }
    raf = requestAnimationFrame(step)
    rafRef.current = raf
    return () => cancelAnimationFrame(raf)
  }, [phase, finishRun])

  // `d` is a LABEL (1–9); the sim works in 0-based indices, so every digit is
  // converted on the way in. Row first, then column.
  const submitDigit = useCallback((d) => {
    const sim = simRef.current
    if (!sim || sim.state.finished) return
    if (d < 1 || d > VIGILANCE_GRID) return
    const idx = d - 1
    if (pendingRowRef.current === null) {
      pendingRowRef.current = idx
      setPendingRow(idx)
      return
    }
    const event = sim.submitCoord(pendingRowRef.current, idx)
    pendingRowRef.current = null
    setPendingRow(null)
    setLastEvent(event)
    if (event.type === 'star' || event.type === 'priority') addClear(event)
  }, [addClear])

  const clearPending = useCallback(() => {
    pendingRowRef.current = null
    setPendingRow(null)
  }, [])

  // Physical keyboard is the PRIMARY input on desktop — the corpus is blunt that
  // "the bottleneck is the keying, not the finding", and a number row or a
  // numeric keypad beats tapping a screen by a wide margin. The on-screen pad
  // exists for touch.
  //
  // `e.key` is what makes both work from one branch: the number row and the
  // numeric keypad (NumLock on) both report '1'–'9', so there is no separate
  // `Numpad1`-style case to keep in step. A regex rather than a `>=`/`<=` range,
  // which on strings would also admit anything sorting between '1' and '9'. Zero
  // is left out because a 9×9 grid labelled 1–9 has no zero coordinate.
  //
  // Modifier chords are left alone so browser and OS shortcuts (Ctrl+1 to switch
  // tab, Cmd+2, Alt+3) keep working instead of being eaten as coordinates.
  useEffect(() => {
    if (phase !== 'playing') return undefined
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (/^[1-9]$/.test(e.key)) { submitDigit(Number(e.key)); e.preventDefault(); return }
      if (e.key === 'Backspace' || e.key === 'Escape' || e.key === 'Delete') {
        clearPending()
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, submitDigit, clearPending])

  const startGame = useCallback(() => {
    const sim = createVigilanceSim({})
    simRef.current = sim
    lastTsRef.current = null
    pendingRowRef.current = null
    setPendingRow(null)
    setLastEvent(null)
    setClears([])
    setFinalStats(null)
    setSnapshot(sim.snapshot())
    startTracking('vigilance')
    // The rAF loop starts itself off the phase change — see the effect above.
    setPhase('playing')
  }, [startTracking])

  const goToIntro = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    simRef.current = null
    setPhase('intro')
    setSnapshot(null)
    setPendingRow(null)
    setLastEvent(null)
    setClears([])
    setScoreSaved(false)
  }, [])

  return (
    <div>
      <SEO title="Vigilance Test (CBAT)" description="The star grid. Three minutes of clearing coordinates, with priority tasks that appear when the job has gone quiet." />

      <div className="flex items-center gap-2 mb-2">
        {phase === 'intro'
          ? <Link to="/cbat" className="text-slate-500 hover:text-brand-400 transition-colors text-sm">&larr; CBAT</Link>
          : <CbatQuitButton onConfirm={goToIntro} confirmNeeded={phase === 'playing'} />
        }
        <h1 className="text-sm font-extrabold text-slate-900">Vigilance Test</h1>
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

          {phase === 'intro' && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full max-w-md bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-6 text-center"
            >
              <p className="text-4xl mb-3">⭐</p>
              <p className="text-xl font-extrabold text-white mb-2">Vigilance Test</p>
              <p className="text-sm text-slate-400 mb-5">
                Stars appear on a 9 by 9 grid. Clear each one by keying its coordinates: the row number first, then the column. It is the simplest thing on the battery, and it runs for three minutes, which is the point of it.
              </p>

              <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-4 mb-5 text-left space-y-2 text-sm text-[#ddeaf8]">
                <div className="flex items-start gap-2">
                  <span className="text-brand-600 font-bold shrink-0">★</span>
                  <span>A star is worth {STAR_POINTS} points. Key the row, then the column. A star on row 2, column 7 is keyed 2 then 7.</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-amber-300 font-bold shrink-0">◆</span>
                  <span>A priority task is worth {PRIORITY_BASE_POINTS} and up to {PRIORITY_BASE_POINTS + 30} if you break off for it straight away. Deal with it the moment it appears.</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-red-400 font-bold shrink-0">−</span>
                  <span>A coordinate with no star on it costs {MISKEY_PENALTY} points, so guessing is worse than looking.</span>
                </div>
                <div className="flex items-start gap-2 text-xs text-[#8a9bb5] pt-1">
                  <span className="shrink-0">⌨</span>
                  <span>Use the number row. The bottleneck is the keying, not the finding. Backspace clears a half-entered coordinate.</span>
                </div>
                <div className="flex items-start gap-2 text-xs text-[#8a9bb5]">
                  <span className="shrink-0">💡</span>
                  <span>Work along a row in sequence, 2 then 1, 2 then 2, 2 then 3, rather than jumping about. You re-key only the second digit that way. Clear the edges first as well, because they sit right next to their labels.</span>
                </div>
                <div className="flex items-start gap-2 text-xs text-[#8a9bb5]">
                  <span className="shrink-0">⏱</span>
                  <span>{VIGILANCE_DURATION_MS / 1000} seconds. One difficulty, because a shorter version would not be testing the same thing.</span>
                </div>
              </div>

              {personalBest && (
                <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 mb-4 text-center">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Personal Best</p>
                  <p className="text-lg font-mono font-bold text-brand-600">{personalBest.bestScore}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{personalBest.attempts} attempt{personalBest.attempts !== 1 ? 's' : ''}</p>
                </div>
              )}

              <div className="text-center mb-4">
                <Link to="/cbat/vigilance/leaderboard" className="text-xs text-brand-600 hover:text-brand-700 transition-colors">
                  View Leaderboard →
                </Link>
              </div>

              <button
                onClick={startGame}
                data-demo-start
                className="px-8 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg transition-colors text-sm"
              >
                Start
              </button>
            </motion.div>
          )}

          {phase === 'playing' && snapshot && (
            <div className="w-full max-w-md lg:max-w-4xl flex flex-col items-center">
              <div className="w-full max-w-md flex items-center justify-between text-xs font-mono mb-2 px-1">
                <span className="text-slate-400">Score <span className="text-brand-600">{snapshot.score}</span></span>
                <span className="text-slate-400">★ <span className="text-green-400">{snapshot.starsCleared}</span></span>
                <span className="text-slate-400">
                  ⏱ <span className={snapshot.remainingMs < 30000 ? 'text-red-400' : 'text-brand-600'}>
                    {Math.ceil(snapshot.remainingMs / 1000)}s
                  </span>
                </span>
              </div>

              <div className="w-full max-w-md h-1 bg-[#1a3a5c] rounded-full mb-3 overflow-hidden">
                <div
                  className="h-full bg-brand-600 rounded-full transition-[width] duration-100"
                  style={{ width: `${100 - (snapshot.remainingMs / VIGILANCE_DURATION_MS) * 100}%` }}
                />
              </div>

              {/* Side by side once there is room: the pad is a touch fallback,
                  and stacked under a 400px board it pushes the board off the top
                  of the screen on a laptop. */}
              <div className="flex flex-col lg:flex-row lg:items-start lg:gap-8 items-center">
                <StarGrid stars={snapshot.stars} pendingRow={pendingRow} lastEvent={lastEvent} clears={clears} />
                <Keypad onDigit={submitDigit} onClear={clearPending} pendingRow={pendingRow} />
              </div>
            </div>
          )}

          {phase === 'results' && finalStats && (
            <CbatGameOver
              gameKey="vigilance"
              score={finalStats.score}
              time={VIGILANCE_DURATION_MS / 1000}
              scoreSaved={scoreSaved}
              queued={queued}
              personalBest={personalBest}
              onPlayAgain={() => { setScoreSaved(false); startGame() }}
            >
              <ResultsScreen stats={finalStats} grade={computeGrade(finalStats.score)} />
            </CbatGameOver>
          )}
        </div>
      )}
    </div>
  )
}
