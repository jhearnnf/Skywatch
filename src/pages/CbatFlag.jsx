import { useState, useEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useGLTF } from '@react-three/drei'
import { useAuth } from '../context/AuthContext'
import { submitCbatResult } from '../lib/cbatOutbox'
import { getAircraftRoster } from '../lib/offlineRoster'
import { useAppSettings } from '../context/AppSettingsContext'
import { useGameChrome } from '../context/GameChromeContext'
import { useCbatTracking } from '../utils/cbat/useCbatTracking'
import { getModelUrl, has3DModel } from '../data/aircraftModels'
import { generateMath } from './CbatFlag/mathBank'
import { generateUniqueSymbols } from './CbatFlag/symbols'
import { generatePalette, ShapeIcon } from './CbatFlag/shapes'
import PlayField from './CbatFlag/PlayField'
import Numpad from './CbatFlag/Numpad'
import AircraftQuestion from './CbatFlag/AircraftQuestion'
import SEO from '../components/SEO'
import CbatQuitButton from '../components/CbatQuitButton'
import CbatGameOver from '../components/CbatGameOver'

// ── Constants ─────────────────────────────────────────────────────────────────
const GAME_DURATION = 60
const MATH_COUNT = 10
const MATH_TIMEOUT = 8
const MATH_GAP = 3                  // min seconds between maths questions
const AC_QUESTION_COOLDOWN = 3
const AC_QUESTION_DURATION = 4
const AC_QUESTION_FIRST = 5

// Difficulty schedule: array of { start, end, diff }
const STAGE_SCHEDULE = [
  { start: 0,  end: 12, diff: 'easy'   },
  { start: 12, end: 24, diff: 'medium' },
  { start: 24, end: 36, diff: 'hard'   },
  { start: 36, end: 48, diff: 'medium' },
  { start: 48, end: 60, diff: 'easy'   },
]

// Weights for math difficulty distribution (indices match STAGE_SCHEDULE)
// Hard stage gets 1.5× — this is reflected by inserting more hard questions at that stage
const MATH_SCHEDULE = [0, 1, 2, 3, 4].map(i => {
  const stage = STAGE_SCHEDULE[i]
  const span = stage.end - stage.start
  const weight = stage.diff === 'hard' ? span * 1.5 : span
  return { ...stage, weight }
})
const TOTAL_WEIGHT = MATH_SCHEDULE.reduce((s, m) => s + m.weight, 0)

function pickMathDifficulty(gameTime) {
  // Weight toward harder stages
  const stage = STAGE_SCHEDULE.find(s => gameTime >= s.start && gameTime < s.end)
    || STAGE_SCHEDULE[STAGE_SCHEDULE.length - 1]
  const roll = Math.random()
  if (stage.diff === 'hard') {
    if (roll < 0.55) return 'hard'
    if (roll < 0.8)  return 'medium'
    return 'easy'
  }
  if (stage.diff === 'medium') {
    if (roll < 0.5) return 'medium'
    if (roll < 0.75) return 'easy'
    return 'hard'
  }
  if (roll < 0.5) return 'easy'
  if (roll < 0.8) return 'medium'
  return 'hard'
}

function computeGrade(score) {
  if (score >= 400) return 'Outstanding'
  if (score >= 250) return 'Good'
  if (score >= 100) return 'Needs Work'
  return 'Failed'
}

// Build a list of ~MATH_COUNT evenly-spaced trigger times across 60s
function buildMathSchedule() {
  const times = []
  const span = GAME_DURATION
  const step = span / MATH_COUNT
  for (let i = 0; i < MATH_COUNT; i++) {
    times.push(3 + i * step + (Math.random() - 0.5) * step * 0.4)
  }
  return times.sort((a, b) => a - b)
}

// ── Grade badge helper ────────────────────────────────────────────────────────
const GRADE_STYLE = {
  'Outstanding': { emoji: '🎖️', color: 'text-green-400' },
  'Good':        { emoji: '✈️', color: 'text-brand-300' },
  'Needs Work':  { emoji: '🔧', color: 'text-amber-400' },
  'Failed':      { emoji: '💥', color: 'text-red-400' },
}

// ── Results screen ────────────────────────────────────────────────────────────
function ResultsScreen({ stats }) {
  const grade = computeGrade(stats.totalScore)
  const gs = GRADE_STYLE[grade]

  const row = (label, val, sub) => (
    <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3">
      <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-xl font-mono font-bold text-brand-300">{val}</p>
      {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  )

  return (
    <div className="w-full bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-6 text-center">
      <p className="text-5xl mb-3">{gs.emoji}</p>
      <p className={`text-2xl font-extrabold mb-1 ${gs.color}`}>{grade}</p>
      <p className="text-sm text-slate-400 mb-5">FLAG Assessment Complete</p>

      <div className="grid grid-cols-3 gap-2">
        {row('Maths', stats.mathScore, `${stats.mathCorrect}✓ ${stats.mathWrong}✗ ${stats.mathTimeout}⏱`)}
        {row('Aircraft', stats.aircraftScore, `${stats.aircraftCorrect}✓ ${stats.aircraftWrong}✗`)}
        {row('Targets', stats.targetScore, `${stats.targetHits}✓ ${stats.targetMisses}✗`)}
      </div>
    </div>
  )
}

// ── Intro screen ──────────────────────────────────────────────────────────────
function IntroScreen({ onStart, onTutorial, personalBest, aircraftList, aircraftLoading }) {
  const disabled = aircraftLoading || aircraftList.length === 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-md bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-6 text-center"
    >
      <p className="text-4xl mb-3">🚩</p>
      <p className="text-xl font-extrabold text-white mb-2">FLAG</p>
      <p className="text-sm text-slate-400 mb-5">
        Track aircraft, solve maths under pressure, and strike target shapes. All at once.
      </p>

      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-4 mb-5 text-left space-y-2">
        <div className="flex items-start gap-2 text-sm text-[#ddeaf8]">
          <span className="text-brand-300 font-bold shrink-0">⏱</span>
          <span>60-second mission</span>
        </div>
        <div className="flex items-start gap-2 text-sm text-[#ddeaf8]">
          <span className="text-brand-300 font-bold shrink-0">🎯</span>
          <span>Click shapes when an aircraft circle overlaps them</span>
        </div>
        <div className="flex items-start gap-2 text-sm text-[#ddeaf8]">
          <span className="text-brand-300 font-bold shrink-0">✈️</span>
          <span>Only ringed aircraft carry a callsign — press YES/NO on whether that callsign is currently on screen</span>
        </div>
        <div className="flex items-start gap-2 text-sm text-[#ddeaf8]">
          <span className="text-brand-300 font-bold shrink-0">🔢</span>
          <span>Solve maths questions on the numpad before they time out</span>
        </div>
        <div className="flex items-start gap-2 text-xs text-[#8a9bb5]">
          <span className="shrink-0">⚠️</span>
          <span>Wrong answers lose points. Score can go negative.</span>
        </div>
      </div>

      {personalBest && (
        <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 mb-4">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Personal Best</p>
          <p className="text-lg font-mono font-bold text-brand-300">{personalBest.bestScore}</p>
          <p className="text-[10px] text-slate-500">{personalBest.attempts} attempt{personalBest.attempts !== 1 ? 's' : ''}</p>
        </div>
      )}

      <div className="text-center mb-4">
        <Link to="/cbat/flag/leaderboard" className="text-xs text-brand-300 hover:text-brand-200 transition-colors">
          View Leaderboard →
        </Link>
      </div>

      <div className="flex flex-wrap gap-3 justify-center">
        <button
          onClick={onTutorial}
          className="px-6 py-3 bg-[#1a3a5c] hover:bg-[#254a6e] text-[#ddeaf8] font-bold rounded-lg transition-colors text-sm cursor-pointer"
        >
          Tutorial
        </button>
        <button
          onClick={onStart}
          disabled={disabled}
          className="px-8 py-3 bg-brand-600 hover:bg-brand-700 disabled:bg-[#1a3a5c] disabled:text-slate-500 text-white font-bold rounded-lg transition-colors text-sm cursor-pointer disabled:cursor-not-allowed"
        >
          {aircraftLoading ? 'Loading aircraft…' : aircraftList.length === 0 ? 'No aircraft enabled — ask an admin to enable at least one in CBAT settings.' : 'Start'}
        </button>
      </div>
    </motion.div>
  )
}

// ── Tutorial / practice mode ────────────────────────────────────────────────
// Progressive walkthrough modelled on the CBAT Target and ANT practice modes: a
// coach card with prev/next navigation sits above a practice arena that mirrors
// the live layout. FLAG runs three tasks at once, so the tutorial teaches them
// one at a time — each step unlocks its own zone, dims the ones already covered,
// and locks the ones still ahead. The targets step embeds the real play field
// (aircraft genuinely drift their rings across the shapes); the aircraft and
// maths steps use small scripted scenarios so the correct action is always
// reachable and the copy always matches what's on screen.
const FLAG_TUTORIAL_STEPS = [
  {
    key: 'targets',
    title: 'Strike the targets',
    body: (
      <>
        The play field is live. Aircraft drift across it trailing a{' '}
        <b className="text-brand-300">white ring</b>. The moment a ring overlaps one of the
        coloured <b className="text-brand-300">shapes</b>, that shape is armed — click it, or tap
        its matching <b className="text-brand-300">colour button</b> below, to strike it. Land two
        strikes to move on. In the real game a wrong click loses points.
      </>
    ),
  },
  {
    key: 'aircraft',
    title: 'Monitor the aircraft',
    body: (
      <>
        Only aircraft inside a <b className="text-brand-300">white ring</b> carry a{' '}
        <b className="text-brand-300">callsign</b>, and it only flashes on for a moment before it
        hides — so you have to <b className="text-brand-300">remember it</b>. Watch this one blink on
        and off. When a callsign shows in the prompt below, press{' '}
        <b className="text-brand-300">YES</b> if it's the one on screen, or{' '}
        <b className="text-brand-300">NO</b> if it isn't. Answer two correctly to continue.
      </>
    ),
  },
  {
    key: 'maths',
    title: 'Solve the maths',
    body: (
      <>
        A <b className="text-brand-300">maths</b> question drops onto the numpad. Tap the digits to
        enter the answer before it times out — the entry submits itself once you've keyed enough
        digits. Solve this one to finish.
      </>
    ),
  },
]

// Fixed scenario data — no randomness, so the coaching copy always matches.
const TUT_MATH_QUESTION = { question: '12 + 7', answer: 19, expectedDigits: 2 }
const TUT_TARGET_HITS_REQUIRED = 4
const TUT_AC_CORRECT_REQUIRED = 2

// Per-playthrough id for tutorial usage tracking; the backend dedupes on it.
function makeTutorialRunId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch { /* fall through */ }
  return `tut_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function TutorialComplete({ onExit }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="w-full max-w-md bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-6 text-center"
    >
      <p className="text-5xl mb-3">✅</p>
      <p className="text-2xl font-extrabold text-white mb-1">Tutorial Complete</p>
      <p className="text-sm text-slate-400 mb-6">
        In the real thing all three run at once for 60 seconds — strike shapes, watch the callsigns,
        and clear the maths without letting any of them slide. Now try it for real.
      </p>
      <button
        onClick={onExit}
        className="px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg transition-colors text-sm cursor-pointer"
      >
        Back to Instructions
      </button>
    </motion.div>
  )
}

function FlagTutorial({ onExit, onProgress, modelUrl }) {
  const [stepIdx, setStepIdx] = useState(0)
  const [done, setDone] = useState(false)
  const [runId] = useState(makeTutorialRunId)

  // One shared play field for the whole tutorial — same as the live game. gameTime
  // is pinned to the easy stage so aircraft spawn at a gentle, learnable cadence.
  const playFieldRef = useRef(null)
  const tutGameTimeRef = useRef(8)
  const [symbols] = useState(() => generateUniqueSymbols(40))
  const [palette] = useState(() => generatePalette())
  // Re-entering the targets step remounts the field so its focus mechanic resets.
  const [fieldKey, setFieldKey] = useState(0)

  const stepIdxRef = useRef(0)
  useEffect(() => { stepIdxRef.current = stepIdx }, [stepIdx])

  // Targets step.
  const [targetHits, setTargetHits] = useState(0)
  const targetAdvancedRef = useRef(false)   // one-shot guard for the auto-advance
  const [hotColors, setHotColors] = useState([])
  const onHotColorsChange = useCallback((cols) => setHotColors(cols), [])

  // Aircraft step — live callsign tracking read off the shared field.
  const onScreenSymsRef = useRef(new Set())
  const seenSymsRef = useRef(new Set())
  const [acQuestion, setAcQuestion] = useState(null)   // { sym } | null
  const [acDisabled, setAcDisabled] = useState(false)
  const [acFlash, setAcFlash] = useState(null)         // 'ok' | 'miss' | null
  const [acCorrect, setAcCorrect] = useState(0)
  const acCorrectRef = useRef(0)
  const acTimerRef = useRef(null)
  const [acHighlightSym, setAcHighlightSym] = useState(null) // callsign to pulse (nudge)
  const [acHighlightOnScreen, setAcHighlightOnScreen] = useState(false) // is that callsign on the field?
  const acHintTimerRef = useRef(null)

  // Maths step.
  const [mathEntered, setMathEntered] = useState('')
  const [mathFlash, setMathFlash] = useState(null)     // 'ok' | 'miss' | null

  // Report tutorial usage for the admin Reports per-step drop-off funnel. Fires
  // on entry and on every section change (forward, backward, or completion).
  useEffect(() => {
    onProgress?.({ clientRunId: runId, furthestStep: stepIdx, totalSteps: FLAG_TUTORIAL_STEPS.length, completed: false })
  }, [stepIdx, runId, onProgress])
  useEffect(() => {
    if (done) onProgress?.({ clientRunId: runId, furthestStep: FLAG_TUTORIAL_STEPS.length - 1, totalSteps: FLAG_TUTORIAL_STEPS.length, completed: true })
  }, [done, runId, onProgress])

  const advance = useCallback(() => {
    setStepIdx(i => {
      if (i < FLAG_TUTORIAL_STEPS.length - 1) return i + 1
      setDone(true)
      return i
    })
  }, [])
  const goToStep = (i) => {
    if (i < 0 || i >= FLAG_TUTORIAL_STEPS.length) return
    // Re-entering the targets step restarts that practice: remount the field
    // (fresh focus aircraft), reset the strike counter/guard and armed-colour
    // flash, and clear the callsign tracking the aircraft step reads.
    if (i === 0) {
      setFieldKey(k => k + 1)
      setTargetHits(0)
      targetAdvancedRef.current = false
      setHotColors([])
      onScreenSymsRef.current = new Set()
      seenSymsRef.current = new Set()
    }
    if (i === 2) { setMathEntered(''); setMathFlash(null) }
    setStepIdx(i)
  }

  // Targets — count strikes with a pure updater (only on the targets step); the
  // auto-advance is handled by the effect below (scheduling it inside the updater
  // fires twice under StrictMode's double-invoke and skips the next step).
  const onTargetScore = useCallback((evt) => {
    if (stepIdxRef.current !== 0 || evt?.type !== 'targetHit') return
    setTargetHits(h => Math.min(h + 1, TUT_TARGET_HITS_REQUIRED))
  }, [])
  useEffect(() => {
    if (stepIdx !== 0 || targetHits < TUT_TARGET_HITS_REQUIRED || targetAdvancedRef.current) return
    targetAdvancedRef.current = true
    const t = setTimeout(advance, 450)
    return () => clearTimeout(t)
  }, [targetHits, stepIdx, advance])

  // Live callsign tracking off the shared field (used by the aircraft step).
  const handleAcSpawn = useCallback((sym) => { onScreenSymsRef.current.add(sym) }, [])
  const handleAcDespawn = useCallback((sym) => { onScreenSymsRef.current.delete(sym) }, [])
  const handleAcSeen = useCallback((sym) => { seenSymsRef.current.add(sym) }, [])

  // Aircraft — present a prompt about a callsign, biased so a "yes" is reachable
  // when aircraft are up. Correctness is judged live against what's on the field
  // at answer time, exactly as the real game does.
  const presentAcQuestion = useCallback(() => {
    const onScreen = [...onScreenSymsRef.current]
    let sym
    if (onScreen.length > 0 && Math.random() < 0.6) {
      sym = onScreen[Math.floor(Math.random() * onScreen.length)]
    } else {
      const gone = [...seenSymsRef.current].filter(s => !onScreenSymsRef.current.has(s))
      sym = gone.length
        ? gone[Math.floor(Math.random() * gone.length)]
        : generateUniqueSymbols(1, onScreenSymsRef.current)[0]
    }
    setAcQuestion({ sym })
    setAcDisabled(false)
    setAcFlash(null)
    // Nudge: if they haven't answered after a few seconds, pulse the referenced
    // callsign on the field. (If the code isn't on screen — a NO prompt — nothing
    // matches, so no ring appears, which is itself the answer.)
    setAcHighlightSym(null)
    setAcHighlightOnScreen(false)
    if (acHintTimerRef.current) clearTimeout(acHintTimerRef.current)
    acHintTimerRef.current = setTimeout(() => {
      setAcHighlightSym(sym)
      setAcHighlightOnScreen(onScreenSymsRef.current.has(sym))
    }, 4000)
  }, [])

  const onAcAnswer = useCallback((choice) => {
    if (acDisabled || !acQuestion) return
    if (acHintTimerRef.current) clearTimeout(acHintTimerRef.current)
    setAcHighlightSym(null)
    setAcHighlightOnScreen(false)
    const isOnScreen = onScreenSymsRef.current.has(acQuestion.sym)
    const correct = (choice === 'yes') === isOnScreen
    setAcDisabled(true)
    setAcFlash(correct ? 'ok' : 'miss')
    if (correct) {
      const n = acCorrectRef.current + 1
      acCorrectRef.current = n
      setAcCorrect(n)
      acTimerRef.current = setTimeout(() => {
        if (n >= TUT_AC_CORRECT_REQUIRED) advance()
        else presentAcQuestion()
      }, 700)
    } else {
      acTimerRef.current = setTimeout(presentAcQuestion, 900)
    }
  }, [acDisabled, acQuestion, advance, presentAcQuestion])

  // On entering the aircraft step, reset its progress and present the first
  // prompt after a short beat; clear timers when leaving.
  useEffect(() => {
    if (stepIdx !== 1) return
    const t = setTimeout(() => {
      acCorrectRef.current = 0
      setAcCorrect(0)
      presentAcQuestion()
    }, 600)
    return () => {
      clearTimeout(t)
      if (acTimerRef.current) clearTimeout(acTimerRef.current)
      if (acHintTimerRef.current) clearTimeout(acHintTimerRef.current)
    }
  }, [stepIdx, presentAcQuestion])

  // Maths — mirror the live auto-submit: grade once enough digits are keyed.
  const onMathDigit = (d) => {
    if (mathFlash === 'ok') return
    const next = mathEntered + d
    setMathEntered(next)
    if (next.length >= TUT_MATH_QUESTION.expectedDigits) {
      if (parseInt(next, 10) === TUT_MATH_QUESTION.answer) {
        setMathFlash('ok')
        setTimeout(advance, 550)
      } else {
        setMathFlash('miss')
        setTimeout(() => { setMathEntered(''); setMathFlash(null) }, 800)
      }
    }
  }

  if (done) {
    return (
      <div className="flex flex-col items-center">
        <TutorialComplete onExit={onExit} />
      </div>
    )
  }

  const step = FLAG_TUTORIAL_STEPS[stepIdx]
  const targetsActive = stepIdx === 0
  const aircraftActive = stepIdx === 1
  const mathsActive = stepIdx === 2
  // The control in use renders exactly like the live game; the ones not in use
  // for this step are greyed out + inert. (No glow on the active one — it stands
  // out simply by being the one that isn't greyed.)
  const zoneCls = (on) => (on ? '' : ' cbat-tutorial-dim')

  return (
    <div className="w-full max-w-md">
      {/* Coach card */}
      <div className="w-full bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-4 mb-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] uppercase tracking-wide text-brand-300 font-bold">Practice Mode</span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => goToStep(stepIdx - 1)}
              disabled={stepIdx === 0}
              aria-label="Previous section"
              className="px-1.5 py-0.5 text-base leading-none text-slate-400 hover:text-brand-300 disabled:opacity-30 disabled:cursor-not-allowed bg-transparent border-0 cursor-pointer"
            >
              {'‹'}
            </button>
            <span className="text-[10px] text-slate-500 tabular-nums">{stepIdx + 1} / {FLAG_TUTORIAL_STEPS.length}</span>
            <button
              onClick={() => goToStep(stepIdx + 1)}
              disabled={stepIdx === FLAG_TUTORIAL_STEPS.length - 1}
              aria-label="Next section"
              className="px-1.5 py-0.5 text-base leading-none text-slate-400 hover:text-brand-300 disabled:opacity-30 disabled:cursor-not-allowed bg-transparent border-0 cursor-pointer"
            >
              {'›'}
            </button>
          </div>
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={stepIdx}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
          >
            <h2 className="text-base font-extrabold text-white mb-1">{step.title}</h2>
            <p className="text-sm text-[#ddeaf8] leading-relaxed">{step.body}</p>
          </motion.div>
        </AnimatePresence>
        <div className="mt-4">
          <button onClick={onExit} className="text-xs text-slate-500 hover:text-slate-300 transition-colors bg-transparent border-0 cursor-pointer">
            Exit practice
          </button>
        </div>
      </div>

      {/* Per-step status line */}
      <div className="flex items-center justify-end h-4 mb-1 px-1 text-[10px] font-mono">
        {targetsActive && <span className="text-brand-300">Strikes {targetHits}/{TUT_TARGET_HITS_REQUIRED}</span>}
        {aircraftActive && <span className="text-brand-300">Correct {acCorrect}/{TUT_AC_CORRECT_REQUIRED}</span>}
      </div>

      {/* Practice arena — mirrors the live game: the field on top, then the
          numpad + colour strikes + aircraft Y/N below. Each step lights the
          control it teaches and greys the rest. */}
      <div
        className={`w-full rounded-lg overflow-hidden${mathsActive ? ' cbat-tutorial-dim' : ''}`}
        style={{ height: 'clamp(200px, 45vw, 340px)' }}
      >
        <PlayField
          key={fieldKey}
          ref={playFieldRef}
          modelUrl={modelUrl}
          symbols={symbols}
          palette={palette}
          gameTimeRef={tutGameTimeRef}
          onScoreEvent={onTargetScore}
          onHotColorsChange={onHotColorsChange}
          onAircraftSpawn={handleAcSpawn}
          onAircraftDespawn={handleAcDespawn}
          onAircraftSeen={handleAcSeen}
          tutorialHints={targetsActive}
          tutorialFocusOnly={targetsActive && targetHits === 0}
          dimAllShapes={aircraftActive}
          blinkSymbols={aircraftActive}
          keepAircraftLonger={aircraftActive}
          maxAircraft={aircraftActive ? 1 : null}
          highlightSymbol={aircraftActive ? acHighlightSym : null}
          active
        />
      </div>

      <div className="w-full max-w-[280px] mx-auto mt-3">
        <div className="bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-3 flex flex-col gap-3">
          {/* Numpad (maths) */}
          <div className={`rounded-lg${zoneCls(mathsActive)}`}>
            <Numpad
              question={mathsActive ? TUT_MATH_QUESTION : null}
              entered={mathEntered}
              onDigit={onMathDigit}
              disabled={!mathsActive}
            />
            {mathsActive && (
              <div className="mt-1.5 min-h-[1rem] text-[11px] leading-tight text-center">
                {mathFlash === 'miss' && <span className="text-red-400">Not quite — try again.</span>}
                {mathFlash === 'ok' && <span className="text-green-400">✓ Correct</span>}
              </div>
            )}
          </div>

          {/* Colour strike buttons (targets) */}
          {palette.length === 3 && (
            <div className={`rounded-lg${zoneCls(targetsActive)}`}>
              <div className="grid grid-cols-3 gap-1.5">
                {palette.map((p) => {
                  const hot = targetsActive && hotColors.includes(p.color)
                  // Phase A: while a shape is armed, grey every button but the one
                  // to press — mirrors the shape greying on the field above.
                  const dimBtn = targetsActive && targetHits === 0 && hotColors.length > 0 && !hot
                  return (
                    <div key={p.color} className="relative">
                      {hot && (
                        <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1 pointer-events-none z-20">
                          <div className="cbat-flag-click-here flex flex-col items-center">
                            <span className="text-[9px] font-extrabold text-red-400 whitespace-nowrap tracking-wide" style={{ textShadow: '0 0 4px #000' }}>CLICK HERE</span>
                            <svg width="14" height="9" viewBox="0 0 14 9" aria-hidden><path d="M7 9 L1 1 H13 Z" fill="#ef4444" /></svg>
                          </div>
                        </div>
                      )}
                      <button
                        onClick={() => playFieldRef.current?.clickColor(p.color)}
                        disabled={!targetsActive}
                        className={`w-full py-2 rounded-lg flex items-center justify-center transition-all duration-200 active:scale-95 hover:opacity-90 cursor-pointer${hot ? ' cbat-flag-btn-hot' : ''}${dimBtn ? ' opacity-20 grayscale pointer-events-none' : ''}`}
                        style={{ backgroundColor: p.color }}
                        aria-label={`Strike ${p.kind}`}
                      >
                        <ShapeIcon kind={p.kind} color={p.color} size={22} />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Aircraft Y/N */}
          <div className={`rounded-lg${zoneCls(aircraftActive)}`}>
            <AircraftQuestion
              symbol={aircraftActive ? (acQuestion?.sym ?? null) : null}
              onAnswer={onAcAnswer}
              disabled={!aircraftActive || acDisabled || !acQuestion}
              pulseSymbol={aircraftActive && acHighlightOnScreen}
            />
            {aircraftActive && (
              <div className="mt-1.5 min-h-[1rem] text-[11px] leading-tight text-center">
                {acFlash === 'miss' && <span className="text-red-400">Not quite — check the field.</span>}
                {acFlash === 'ok' && <span className="text-green-400">✓ Correct</span>}
                {!acFlash && acQuestion && <span className="text-slate-500">Is <b className="text-[#ddeaf8]">{acQuestion.sym}</b> on the field right now?</span>}
                {!acFlash && !acQuestion && <span className="text-slate-600">Watch the field…</span>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function CbatFlag() {
  const { user, apiFetch, API } = useAuth()
  const { start: startTracking, markCompleted: markGameCompleted } = useCbatTracking()
  const { settings } = useAppSettings()
  const { enterImmersive, exitImmersive } = useGameChrome()

  const [phase, setPhase] = useState('intro')
  const [personalBest, setPersonalBest] = useState(null)
  const [scoreSaved, setScoreSaved] = useState(false)
  const [queued, setQueued] = useState(false)
  const [aircraftList, setAircraftList] = useState([])
  const [aircraftLoading, setAircraftLoading] = useState(true)
  const [modelUrl, setModelUrl] = useState(null)
  const [symbols, setSymbols] = useState([])
  const [palette, setPalette] = useState([])
  const playFieldRef = useRef(null)

  // Game timer
  const [elapsed, setElapsed] = useState(0)
  const startedAtRef = useRef(null)
  const tickRef = useRef(null)
  const gameTimeRef = useRef(0)
  // Guard against StrictMode invoking the end-of-game setStats updater twice.
  // Without this, the result POST below fires twice in dev → two identical
  // sessions land in the DB for a single play.
  const resultSubmittedRef = useRef(false)

  // Score state
  const [stats, setStats] = useState(() => blankStats())

  // Maths state
  const mathScheduleRef = useRef([])
  const mathIdxRef = useRef(0)
  const [mathQuestion, setMathQuestion] = useState(null)
  const mathQuestionRef = useRef(null)
  const [mathEntered, setMathEntered] = useState('')
  const mathEnteredRef = useRef('')
  const mathTimerRef = useRef(null)
  const mathActiveRef = useRef(false)
  // Game-time at which the last maths question ended (answered/missed/timeout).
  // Used to enforce a minimum gap before the next question can spawn.
  const mathLastEndedRef = useRef(-Infinity)

  // Aircraft question state
  const [acSymbol, setAcSymbol] = useState(null)
  const acSymbolRef = useRef(null)
  const acQuestionTimerRef = useRef(null)
  const acLastQuestionRef = useRef(0)
  const acDisabledRef = useRef(false)
  const [acDisabled, setAcDisabled] = useState(false)

  // Symbol tracking
  const seenPoolRef = useRef(new Set())
  const onScreenRef = useRef(new Set())
  const allSymbolsRef = useRef(new Set())

  useEffect(() => {
    // Hide the nav chrome during the live game and the practice tutorial.
    if (phase === 'playing' || phase === 'tutorial') enterImmersive()
    else exitImmersive()
    return exitImmersive
  }, [phase, enterImmersive, exitImmersive])

  // Fire-and-forget tutorial usage tracking (admin Reports per-step drop-off).
  // Online-only by design — a learning aid, not a score, so no offline outbox.
  const reportTutorialProgress = useCallback((body) => {
    if (!user) return
    apiFetch(`${API}/api/games/cbat/flag/tutorial`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {})
  }, [user, apiFetch, API])

  // Fetch personal best and aircraft list
  useEffect(() => {
    if (!user) return
    apiFetch(`${API}/api/games/cbat/flag/personal-best`)
      .then(r => r.json())
      .then(d => { if (d.data) setPersonalBest(d.data) })
      .catch(() => {})

    getAircraftRoster('aircraft-cutouts', { apiFetch, API })
      .then(d => {
        const allowlist = new Set((settings?.cbatFlagAircraftBriefIds ?? []).map(String))
        const list = (d.data || [])
          .filter(a => has3DModel(a.briefId, a.title))
          .filter(a => allowlist.has(String(a.briefId)))
          .map(a => ({ ...a, modelUrl: getModelUrl(a.briefId, a.title) }))
        setAircraftList(list)
        setAircraftLoading(false)
      })
      .catch(() => { setAircraftLoading(false) })
  }, [user, settings?.cbatFlagAircraftBriefIds]) // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-load model during intro
  useEffect(() => {
    if (aircraftList.length === 0) return
    const pick = aircraftList[Math.floor(Math.random() * aircraftList.length)]
    const url = pick.modelUrl
    setModelUrl(url)
    try { useGLTF.preload(url) } catch {}
  }, [aircraftList])

  const addScore = useCallback((delta, field) => {
    setStats(prev => ({
      ...prev,
      totalScore: prev.totalScore + delta,
      [field + 'Score']: prev[field + 'Score'] + delta,
    }))
  }, [])

  const bumpCounter = useCallback((field) => {
    setStats(prev => ({ ...prev, [field]: (prev[field] || 0) + 1 }))
  }, [])

  // ── Maths question lifecycle ──────────────────────────────────────────────
  const clearMathTimeout = () => {
    if (mathTimerRef.current) { clearTimeout(mathTimerRef.current); mathTimerRef.current = null }
  }

  const endMathQuestion = useCallback((reason) => {
    clearMathTimeout()
    if (!mathActiveRef.current) return
    mathActiveRef.current = false
    mathLastEndedRef.current = gameTimeRef.current
    if (reason === 'timeout') {
      bumpCounter('mathTimeout')
      // No penalty for timeout per spec
    }
    setMathQuestion(null)
    mathQuestionRef.current = null
    setMathEntered('')
    mathEnteredRef.current = ''
  }, [bumpCounter])

  const startMathQuestion = useCallback((gameTime) => {
    if (mathActiveRef.current) return
    const diff = pickMathDifficulty(gameTime)
    const q = generateMath(diff)
    mathActiveRef.current = true
    mathQuestionRef.current = q
    setMathQuestion(q)
    setMathEntered('')
    mathEnteredRef.current = ''
    clearMathTimeout()
    mathTimerRef.current = setTimeout(() => endMathQuestion('timeout'), MATH_TIMEOUT * 1000)
  }, [endMathQuestion])

  // ── Aircraft question lifecycle ───────────────────────────────────────────
  const clearAcTimeout = () => {
    if (acQuestionTimerRef.current) { clearTimeout(acQuestionTimerRef.current); acQuestionTimerRef.current = null }
  }

  const endAcQuestion = useCallback(() => {
    clearAcTimeout()
    acDisabledRef.current = false
    setAcDisabled(false)
    setAcSymbol(null)
    acSymbolRef.current = null
  }, [])

  const spawnAcQuestion = useCallback((gameTime) => {
    if (acSymbolRef.current) return
    if (gameTime - acLastQuestionRef.current < AC_QUESTION_COOLDOWN) return
    if (gameTime < AC_QUESTION_FIRST) return

    const roll = Math.random()
    let sym
    const seenArr = [...seenPoolRef.current]
    const allArr = [...allSymbolsRef.current]
    const neverSeen = allArr.filter(s => !seenPoolRef.current.has(s))

    if (roll < 0.8 && seenArr.length > 0) {
      sym = seenArr[Math.floor(Math.random() * seenArr.length)]
    } else if (neverSeen.length > 0) {
      sym = neverSeen[Math.floor(Math.random() * neverSeen.length)]
    } else if (seenArr.length > 0) {
      sym = seenArr[Math.floor(Math.random() * seenArr.length)]
    } else {
      return
    }

    acLastQuestionRef.current = gameTime
    acSymbolRef.current = sym
    acDisabledRef.current = false
    setAcDisabled(false)
    setAcSymbol(sym)
    clearAcTimeout()
    acQuestionTimerRef.current = setTimeout(() => {
      // Timeout — counts as missed
      if (acSymbolRef.current) {
        bumpCounter('aircraftMissed')
        // Missed aircraft question: −3 per spec
        setStats(prev => ({ ...prev, totalScore: prev.totalScore - 3, aircraftScore: prev.aircraftScore - 3 }))
      }
      endAcQuestion()
    }, AC_QUESTION_DURATION * 1000)
  }, [bumpCounter, endAcQuestion])

  // ── Game timer tick ───────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'playing') return
    startedAtRef.current = performance.now()
    tickRef.current = setInterval(() => {
      const now = (performance.now() - startedAtRef.current) / 1000
      const t = Math.min(now, GAME_DURATION)
      gameTimeRef.current = t
      setElapsed(t)

      // Math schedule check — enforce ≥3s breather after the previous
      // question ends (answered, missed, or timed out).
      const mathTimes = mathScheduleRef.current
      const mIdx = mathIdxRef.current
      if (
        mIdx < mathTimes.length &&
        t >= mathTimes[mIdx] &&
        !mathActiveRef.current &&
        t - mathLastEndedRef.current >= MATH_GAP
      ) {
        mathIdxRef.current = mIdx + 1
        startMathQuestion(t)
      }

      // Aircraft question schedule — cooldown gate then a per-tick roll;
      // mean wait once eligible ≈ 1 / 0.015 ticks ≈ 6.7s at 100ms tick.
      if (!acSymbolRef.current && t >= AC_QUESTION_FIRST) {
        const timeSinceLast = t - acLastQuestionRef.current
        if (timeSinceLast >= AC_QUESTION_COOLDOWN) {
          if (Math.random() < 0.015) {
            spawnAcQuestion(t)
          }
        }
      }

      if (t >= GAME_DURATION) {
        clearInterval(tickRef.current)
      }
    }, 100)
    return () => clearInterval(tickRef.current)
  }, [phase, startMathQuestion, spawnAcQuestion])

  // ── End game ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'playing' || elapsed < GAME_DURATION) return
    clearMathTimeout()
    clearAcTimeout()
    setPhase('results')

    setStats(finalStats => {
      if (resultSubmittedRef.current) return finalStats
      resultSubmittedRef.current = true
      const grade = computeGrade(finalStats.totalScore)
      setScoreSaved(false)
      setQueued(false)
      markGameCompleted({ score: finalStats.totalScore })
      submitCbatResult(`flag`, {
          totalScore: finalStats.totalScore,
          mathCorrect: finalStats.mathCorrect,
          mathWrong: finalStats.mathWrong,
          mathTimeout: finalStats.mathTimeout,
          aircraftCorrect: finalStats.aircraftCorrect,
          aircraftWrong: finalStats.aircraftWrong,
          aircraftMissed: finalStats.aircraftMissed,
          targetHits: finalStats.targetHits,
          targetMisses: finalStats.targetMisses,
          aircraftsSeen: seenPoolRef.current.size,
          aircraftBriefId: aircraftList.find(a => a.modelUrl === modelUrl)?.briefId ?? null,
          totalTime: GAME_DURATION,
          grade,
        }, { apiFetch, API })
        .then((r) => {
          setScoreSaved(!!r?.synced)
          setQueued(!!r?.queued)
          apiFetch(`${API}/api/games/cbat/flag/personal-best`)
            .then(r => r.json())
            .then(d => { if (d.data) setPersonalBest(d.data) })
            .catch(() => {})
        })
        .catch(() => {})
      return finalStats
    })
  }, [elapsed, phase]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Numpad handlers ───────────────────────────────────────────────────────
  const handleDigit = useCallback((d) => {
    if (!mathActiveRef.current || !mathQuestionRef.current) return
    const q = mathQuestionRef.current
    const next = mathEnteredRef.current + d
    mathEnteredRef.current = next
    setMathEntered(next)

    if (next.length >= q.expectedDigits) {
      const submitted = parseInt(next, 10)
      const isCorrect = submitted === q.answer
      clearMathTimeout()
      mathActiveRef.current = false
      mathQuestionRef.current = null
      mathLastEndedRef.current = gameTimeRef.current
      if (isCorrect) {
        bumpCounter('mathCorrect')
        setStats(prev => ({ ...prev, totalScore: prev.totalScore + 30, mathScore: prev.mathScore + 30 }))
      } else {
        bumpCounter('mathWrong')
        setStats(prev => ({ ...prev, totalScore: prev.totalScore - 10, mathScore: prev.mathScore - 10 }))
      }
      setMathQuestion(null)
      setMathEntered('')
      mathEnteredRef.current = ''
    }
  }, [bumpCounter])

  // ── Keyboard input (desktop) ──────────────────────────────────────────────
  // Digits 0-9 mirror the numpad. Backspace/Delete/arrow keys are blocked
  // entirely — there's no delete affordance in the game and arrow keys
  // would otherwise scroll the page during play.
  useEffect(() => {
    if (phase !== 'playing') return
    const BLOCKED_KEYS = new Set([
      'Backspace', 'Delete',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    ])
    const onKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (BLOCKED_KEYS.has(e.key)) {
        e.preventDefault()
        return
      }
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault()
        handleDigit(e.key)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [phase, handleDigit])

  // ── Aircraft Y/N handlers ─────────────────────────────────────────────────
  const handleAcAnswer = useCallback((choice) => {
    if (acDisabledRef.current || !acSymbolRef.current) return
    const sym = acSymbolRef.current
    const isOnScreen = onScreenRef.current.has(sym)
    const correct = (choice === 'yes' && isOnScreen) || (choice === 'no' && !isOnScreen)

    acDisabledRef.current = true
    setAcDisabled(true)

    if (correct) {
      bumpCounter('aircraftCorrect')
      setStats(prev => ({ ...prev, totalScore: prev.totalScore + 20, aircraftScore: prev.aircraftScore + 20 }))
    } else {
      bumpCounter('aircraftWrong')
      setStats(prev => ({ ...prev, totalScore: prev.totalScore - 15, aircraftScore: prev.aircraftScore - 15 }))
    }

    clearAcTimeout()
    acQuestionTimerRef.current = setTimeout(() => { endAcQuestion() }, 600)
  }, [bumpCounter, endAcQuestion])

  // ── PlayField callbacks ───────────────────────────────────────────────────
  const handleScoreEvent = useCallback(({ type }) => {
    if (type === 'targetHit') {
      bumpCounter('targetHits')
      setStats(prev => ({ ...prev, totalScore: prev.totalScore + 15, targetScore: prev.targetScore + 15 }))
    } else if (type === 'targetMiss') {
      bumpCounter('targetMisses')
      setStats(prev => ({ ...prev, totalScore: prev.totalScore - 10, targetScore: prev.targetScore - 10 }))
    }
  }, [bumpCounter])

  const handleAircraftSeen = useCallback((sym) => {
    seenPoolRef.current = new Set([...seenPoolRef.current, sym])
  }, [])

  const handleAircraftSpawn = useCallback((sym) => {
    onScreenRef.current = new Set([...onScreenRef.current, sym])
  }, [])

  const handleAircraftDespawn = useCallback((sym) => {
    const next = new Set(onScreenRef.current)
    next.delete(sym)
    onScreenRef.current = next
  }, [])

  // ── Start game ────────────────────────────────────────────────────────────
  const goToIntro = useCallback(() => {
    clearInterval(tickRef.current)
    if (mathTimerRef.current) clearTimeout(mathTimerRef.current)
    if (acQuestionTimerRef.current) clearTimeout(acQuestionTimerRef.current)
    mathActiveRef.current = false
    mathQuestionRef.current = null
    acSymbolRef.current = null
    setMathQuestion(null)
    setMathEntered('')
    mathEnteredRef.current = ''
    setAcSymbol(null)
    setPhase('intro')
  }, [])

  const startGame = useCallback(() => {
    if (aircraftList.length === 0) return
    const syms = generateUniqueSymbols(40)
    syms.forEach(s => allSymbolsRef.current.add(s))
    setSymbols(syms)
    setPalette(generatePalette())
    allSymbolsRef.current = new Set(syms)
    seenPoolRef.current = new Set()
    onScreenRef.current = new Set()
    mathScheduleRef.current = buildMathSchedule()
    mathIdxRef.current = 0
    mathActiveRef.current = false
    mathQuestionRef.current = null
    mathLastEndedRef.current = -Infinity
    acSymbolRef.current = null
    acLastQuestionRef.current = 0
    acDisabledRef.current = false
    setMathQuestion(null)
    setMathEntered('')
    mathEnteredRef.current = ''
    setAcSymbol(null)
    setAcDisabled(false)
    setStats(blankStats())
    setElapsed(0)
    setScoreSaved(false)
    gameTimeRef.current = 0
    resultSubmittedRef.current = false
    startTracking('flag')
    setPhase('playing')
  }, [aircraftList, apiFetch, API])

  const remainingS = Math.max(0, GAME_DURATION - elapsed)

  return (
    <div className="cbat-flag-page">
      <SEO title="FLAG — CBAT" description="Multi-task: track aircraft, solve maths, and strike target shapes." />

      {!user && (
        <div className="bg-[#0a1628] rounded-2xl border border-[#1a3a5c] p-6 text-center">
          <div className="text-4xl mb-3">🔒</div>
          <p className="font-bold text-[#ddeaf8] mb-1">Sign in to play</p>
          <p className="text-sm text-slate-400 mb-4">Create a free account to access CBAT games.</p>
          <Link to="/login" className="inline-flex px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors no-underline">
            Sign In
          </Link>
        </div>
      )}

      {user && (
        <>
          <div className="flex items-center gap-2 mb-2 max-[600px]:mb-1">
            {phase === 'intro'
              ? <Link to="/cbat" className="text-slate-500 hover:text-brand-400 transition-colors text-sm">&larr; CBAT</Link>
              : <CbatQuitButton onConfirm={goToIntro} confirmNeeded={phase === 'playing'} />
            }
            <h1 className="text-sm font-extrabold text-[#ddeaf8]">FLAG</h1>
          </div>

          <div className="flex flex-col items-center max-[600px]:w-full">
            {phase === 'intro' && (
              <IntroScreen
                onStart={startGame}
                onTutorial={() => setPhase('tutorial')}
                personalBest={personalBest}
                aircraftList={aircraftList}
                aircraftLoading={aircraftLoading}
              />
            )}

            {phase === 'tutorial' && (
              <FlagTutorial
                onExit={() => setPhase('intro')}
                onProgress={reportTutorialProgress}
                modelUrl={modelUrl}
              />
            )}

            {phase === 'playing' && (
              <div className="w-full max-[600px]:h-[calc(100dvh-3rem-env(safe-area-inset-bottom))] max-[600px]:flex max-[600px]:flex-col max-[600px]:overflow-hidden">
                {/* HUD */}
                <div className="flex items-center justify-between text-xs font-mono mb-2 px-1 max-[600px]:mb-1 max-[600px]:shrink-0">
                  <span className="text-slate-400">
                    ⏱ <span className="text-brand-300">{remainingS.toFixed(1)}s</span>
                  </span>
                  <span className="text-slate-400">
                    Score: <span className={stats.totalScore >= 0 ? 'text-brand-300' : 'text-red-400'}>{stats.totalScore}</span>
                  </span>
                </div>

                {/* Mobile: column with play field flex-1 + controls auto */}
                <div className="flex flex-col gap-2 max-[600px]:flex-1 max-[600px]:min-h-0 max-[600px]:gap-1.5">
                  {/* Play field */}
                  <div
                    className="w-full rounded-lg overflow-hidden h-[clamp(200px,45vw,380px)] max-[600px]:h-auto max-[600px]:flex-1 max-[600px]:min-h-0"
                  >
                    <PlayField
                      ref={playFieldRef}
                      modelUrl={modelUrl}
                      symbols={symbols}
                      palette={palette}
                      gameTimeRef={gameTimeRef}
                      onScoreEvent={handleScoreEvent}
                      onAircraftSeen={handleAircraftSeen}
                      onAircraftSpawn={handleAircraftSpawn}
                      onAircraftDespawn={handleAircraftDespawn}
                      gameCues
                      active={phase === 'playing'}
                    />
                  </div>

                  {/* Controls — numpad + aircraft question.
                      In normal flow below the play field on every size; centered
                      and width-capped so it sits just under the game on desktop. */}
                  <div
                    className="w-full max-w-[280px] mx-auto shrink-0 z-10"
                  >
                    <div className="bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-3 max-[600px]:p-1.5 flex flex-col gap-3 max-[600px]:gap-1.5">
                      <Numpad
                        question={mathQuestion}
                        entered={mathEntered}
                        onDigit={handleDigit}
                        disabled={!mathQuestion}
                      />
                      {palette.length === 3 && (
                        <div className="grid grid-cols-3 gap-1.5 max-[600px]:gap-1">
                          {palette.map((p) => (
                            <button
                              key={p.color}
                              onClick={() => playFieldRef.current?.clickColor(p.color)}
                              className="py-2 max-[600px]:py-1.5 rounded-lg flex items-center justify-center transition-transform active:scale-95 hover:opacity-90 cursor-pointer"
                              style={{ backgroundColor: p.color }}
                              aria-label={`Strike ${p.kind}`}
                            >
                              <ShapeIcon kind={p.kind} color={p.color} size={22} />
                            </button>
                          ))}
                        </div>
                      )}
                      <AircraftQuestion
                        symbol={acSymbol}
                        onAnswer={handleAcAnswer}
                        disabled={acDisabled || !acSymbol}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {phase === 'results' && (
              <CbatGameOver
                gameKey="flag"
                score={stats.totalScore}
                scoreSaved={scoreSaved}
                queued={queued}
                personalBest={personalBest}
                onPlayAgain={() => { setPhase('intro') }}
              >
                <ResultsScreen
                  stats={stats}
                />
              </CbatGameOver>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── Blank stats ───────────────────────────────────────────────────────────────
function blankStats() {
  return {
    totalScore: 0,
    mathScore: 0,     mathCorrect: 0,   mathWrong: 0,    mathTimeout: 0,
    aircraftScore: 0, aircraftCorrect: 0, aircraftWrong: 0, aircraftMissed: 0,
    targetScore: 0,   targetHits: 0,    targetMisses: 0,
  }
}
