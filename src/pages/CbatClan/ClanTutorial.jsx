// CLAN's tutorial: the real board in slow motion, stopping for every press.
// See utils/cbat/clanTutorial.js for what it does and why; this file owns the
// loop, the clock and the keyboard.
//
// The sim is ticked on a clock of its own (`gameT`) that advances by real time
// times the current speed. The speed eases toward a crawl whenever something
// needs the player and back to full once they have answered, so every part of
// the game (diamonds, the code, the sum's timer) slows down together.
//
// One mount is one run: Try Again asks the page to remount it (`onRetry`), so
// nothing here ever has to be reset.

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { createClanSim } from '../../utils/cbat/clanSim'
import {
  CLAN_TUTORIAL_TUNING, CLAN_TUTORIAL_DURATION_MS, CLAN_TUTORIAL_GOALS, POPUP_MS,
  tutorialProgress, tutorialFocus, tutorialLighting, tutorialInstruction,
  targetTimeScale, nextTimeScale, zoomOrigin, eventPopup,
} from '../../utils/cbat/clanTutorial'
import ClanBoard from './ClanBoard'
import { keyAction } from './keys'

const TOTAL_STEPS = 4   // started, then one per task whose goal is met

// Per-playthrough id for tutorial usage tracking; the backend dedupes on it.
function makeTutorialRunId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch { /* fall through */ }
  return `tut_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function typingTarget(el) {
  if (!el || !el.tagName) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

function GoalChip({ label, have, need }) {
  const met = have >= need
  return (
    <span
      data-clan-goal={label}
      className={`px-2 py-0.5 rounded-md border text-[11px] font-bold tabular-nums ${met ? 'border-green-500 text-green-400' : 'border-game-line text-slate-400'}`}
    >
      {met ? '✓ ' : ''}{label} {have}/{need}
    </span>
  )
}

function TutorialComplete({ stats, completed, onExit, onRetry }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="w-full max-w-md mx-auto bg-game-panel border border-game-line rounded-xl p-6 text-center"
      data-testid="clan-tutorial-complete"
    >
      <p className="text-5xl mb-3">{completed ? '✅' : '⏱'}</p>
      <p className="text-2xl font-extrabold text-white mb-1">{completed ? 'Tutorial Complete' : 'Tutorial Over'}</p>
      <p className="text-3xl font-mono font-bold text-brand-600 mb-3">{stats.totalScore}</p>
      <p className="text-sm text-slate-400 mb-6">
        {completed
          ? 'In the real test nothing slows down. All three tasks run at once for 90 seconds, so the keys need to be second nature. Now try it for real.'
          : 'The time ran out before every task was done. Run it again to get more practice on the keys.'}
      </p>
      <div className="flex flex-wrap gap-3 justify-center">
        {!completed && (
          <button
            onClick={onRetry}
            className="px-6 py-3 bg-game-fill hover:bg-game-fill-strong text-game-text font-bold rounded-lg transition-colors text-sm cursor-pointer"
          >
            Try Again
          </button>
        )}
        <button
          onClick={onExit}
          className="px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg transition-colors text-sm cursor-pointer"
        >
          Back to Instructions
        </button>
      </div>
    </motion.div>
  )
}

export default function ClanTutorial({ layoutKey, layout, cbat, onExit, onRetry, onProgress }) {
  const [runId] = useState(makeTutorialRunId)
  const [sim] = useState(() => createClanSim({ tuning: CLAN_TUTORIAL_TUNING, durationMs: CLAN_TUTORIAL_DURATION_MS }))
  const [snapshot, setSnapshot] = useState(() => sim.snapshot())
  // What the tutorial is slowed down for (held until it is answered or gone,
  // see tutorialFocus), and where the zoom points. The origin is kept after
  // the focus ends so the zoom comes back out the way it went in.
  const [focus, setFocus] = useState(null)
  const [origin, setOrigin] = useState('50% 50%')
  const [popups, setPopups] = useState([])
  const [result, setResult] = useState(null)   // { stats, completed } once over

  const simRef = useRef(sim)
  const focusRef = useRef(null)
  const clockRef = useRef({ gameT: 0, scale: 1, lastNow: null })
  const lastEventRef = useRef(null)
  const metRef = useRef(-1)
  const popupIdRef = useRef(0)
  const popupTimersRef = useRef([])

  useEffect(() => {
    const timers = popupTimersRef.current
    return () => timers.forEach(clearTimeout)
  }, [])

  // Moves the focus on from a new snapshot. Called every frame and straight
  // after every press, so an answer ends the slow motion on the next frame.
  const refocus = useCallback((snap) => {
    const next = tutorialFocus(focusRef.current, snap)
    if (next === focusRef.current) return
    focusRef.current = next
    setFocus(next)
    if (next) setOrigin(zoomOrigin(next))
  }, [])

  const report = useCallback((met, completed) => {
    onProgress?.({ clientRunId: runId, furthestStep: Math.min(met, TOTAL_STEPS - 1), totalSteps: TOTAL_STEPS, completed })
  }, [onProgress, runId])

  const showEvent = useCallback((event) => {
    const popup = eventPopup(event)
    if (!popup) return
    const id = ++popupIdRef.current
    setPopups(list => [...list, { ...popup, id }])
    popupTimersRef.current.push(setTimeout(() => setPopups(list => list.filter(p => p.id !== id)), POPUP_MS))
  }, [])

  // ── The loop ──
  useEffect(() => {
    if (result) return undefined
    let raf = null
    let cancelled = false
    const frame = (now) => {
      if (cancelled) return
      const sim = simRef.current
      const clock = clockRef.current
      const dt = clock.lastNow == null ? 0 : Math.min(100, now - clock.lastNow)
      clock.lastNow = now

      // The speed follows whatever was waiting on the player last frame.
      const target = targetTimeScale(focusRef.current)
      clock.scale = nextTimeScale(clock.scale, target, dt)
      clock.gameT += dt * clock.scale
      sim.tick(clock.gameT)

      const snap = sim.snapshot()
      setSnapshot(snap)
      refocus(snap)
      if (snap.lastEvent && snap.lastEvent !== lastEventRef.current) {
        lastEventRef.current = snap.lastEvent
        showEvent(snap.lastEvent)
      }

      const progress = tutorialProgress(snap.stats)
      if (progress.met !== metRef.current) {
        metRef.current = progress.met
        report(progress.met, progress.done)
      }
      if (progress.done || snap.finished) {
        setResult({ stats: snap.stats, completed: progress.done })
        return
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelled = true; cancelAnimationFrame(raf) }
  }, [result, report, showEvent, refocus])

  // ── Input ── every press paints on the very next frame.
  const publish = useCallback(() => {
    const snap = simRef.current.snapshot()
    setSnapshot(snap)
    refocus(snap)
  }, [refocus])
  const onColour = useCallback((c) => { simRef.current?.pressColour(c); publish() }, [publish])
  const onOption = useCallback((i) => { simRef.current?.pickLetterOption(i); publish() }, [publish])
  const onDigit = useCallback((d) => { simRef.current?.pressDigit(d); publish() }, [publish])
  const onBackspace = useCallback(() => { simRef.current?.backspace(); publish() }, [publish])
  const onEnter = useCallback(() => { simRef.current?.submitMath(); publish() }, [publish])

  useEffect(() => {
    if (result) return undefined
    function onKey(e) {
      if (typingTarget(e.target)) return
      if (document.querySelector('[role="dialog"]')) return
      const action = keyAction(e, layoutKey)
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
  }, [result, layoutKey, onColour, onOption, onDigit, onBackspace, onEnter])

  if (result) {
    return (
      <TutorialComplete
        stats={result.stats}
        completed={result.completed}
        onExit={onExit}
        onRetry={onRetry}
      />
    )
  }

  const progress = tutorialProgress(snapshot.stats)

  return (
    <div className="w-full" data-testid="clan-tutorial">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2 px-1">
        <div className="flex flex-wrap gap-1.5">
          <GoalChip label="Diamonds" have={progress.colours} need={CLAN_TUTORIAL_GOALS.colours} />
          <GoalChip label="Codes" have={progress.codes} need={CLAN_TUTORIAL_GOALS.codes} />
          <GoalChip label="Sums" have={progress.sums} need={CLAN_TUTORIAL_GOALS.sums} />
        </div>
        <span className="text-xs font-mono text-slate-400">
          Score: <span className={snapshot.score >= 0 ? 'text-brand-600' : 'text-red-400'} data-testid="clan-tutorial-score">{snapshot.score}</span>
        </span>
      </div>
      <p
        className={`text-sm lg:text-base font-bold text-center mb-2 min-h-[1.5em] transition-colors ${focus ? 'text-white' : 'text-slate-400'}`}
        data-testid="clan-tutorial-instruction"
      >
        {tutorialInstruction(focus, snapshot, layout)}
      </p>
      <ClanBoard
        snapshot={snapshot}
        cbat={cbat}
        layout={layout}
        tutorial={{ focus, lighting: tutorialLighting(focus, snapshot), zoomOrigin: origin, popups }}
        onColour={onColour}
        onOption={onOption}
        onDigit={onDigit}
        onBackspace={onBackspace}
        onEnter={onEnter}
      />
    </div>
  )
}
