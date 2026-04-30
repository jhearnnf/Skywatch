import { useState, useEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useGLTF } from '@react-three/drei'
import { useAuth } from '../context/AuthContext'
import { useAppSettings } from '../context/AppSettingsContext'
import { useGameChrome } from '../context/GameChromeContext'
import { recordCbatStart } from '../utils/cbat/recordStart'
import { getModelUrl, has3DModel } from '../data/aircraftModels'
import { generateMath } from './CbatFlag/mathBank'
import { generateUniqueSymbols } from './CbatFlag/symbols'
import { generatePalette, ShapeIcon } from './CbatFlag/shapes'
import PlayField from './CbatFlag/PlayField'
import Numpad from './CbatFlag/Numpad'
import AircraftQuestion from './CbatFlag/AircraftQuestion'
import SEO from '../components/SEO'

// ── Constants ─────────────────────────────────────────────────────────────────
const GAME_DURATION = 60
const MATH_COUNT = 10
const MATH_TIMEOUT = 8
const MATH_GAP = 3                  // min seconds between maths questions
const AC_QUESTION_COOLDOWN = 8
const AC_QUESTION_DURATION = 4
const AC_QUESTION_FIRST = 10

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
function ResultsScreen({ stats, onPlayAgain, scoreSaved }) {
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
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="w-full max-w-lg bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-6 text-center"
    >
      <p className="text-5xl mb-3">{gs.emoji}</p>
      <p className={`text-2xl font-extrabold mb-1 ${gs.color}`}>{grade}</p>
      <p className="text-sm text-slate-400 mb-5">FLAG Assessment Complete</p>

      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-4 mb-4">
        <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">Total Score</p>
        <p className={`text-4xl font-mono font-bold ${stats.totalScore >= 0 ? 'text-brand-300' : 'text-red-400'}`}>
          {stats.totalScore}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-5">
        {row('Maths', stats.mathScore, `${stats.mathCorrect}✓ ${stats.mathWrong}✗ ${stats.mathTimeout}⏱`)}
        {row('Aircraft', stats.aircraftScore, `${stats.aircraftCorrect}✓ ${stats.aircraftWrong}✗`)}
        {row('Targets', stats.targetScore, `${stats.targetHits}✓ ${stats.targetMisses}✗`)}
      </div>

      {scoreSaved && <p className="text-xs text-green-400 mb-4">✓ Score saved</p>}

      <div className="flex flex-wrap gap-3 justify-center">
        <button
          onClick={onPlayAgain}
          className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-lg transition-colors cursor-pointer"
        >
          Play Again
        </button>
        <Link
          to="/cbat/flag/leaderboard"
          className="px-5 py-2.5 bg-[#1a3a5c] hover:bg-[#254a6e] text-[#ddeaf8] text-sm font-bold rounded-lg transition-colors no-underline"
        >
          🏆 Leaderboard
        </Link>
      </div>
    </motion.div>
  )
}

// ── Intro screen ──────────────────────────────────────────────────────────────
function IntroScreen({ onStart, personalBest, aircraftList }) {
  const disabled = aircraftList.length === 0

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
          <span>60-second mission with 5 silent difficulty phases</span>
        </div>
        <div className="flex items-start gap-2 text-sm text-[#ddeaf8]">
          <span className="text-brand-300 font-bold shrink-0">🎯</span>
          <span>Click shapes when an aircraft circle overlaps them</span>
        </div>
        <div className="flex items-start gap-2 text-sm text-[#ddeaf8]">
          <span className="text-brand-300 font-bold shrink-0">✈️</span>
          <span>Monitor aircraft symbols — press YES/NO if the associated aircraft is currently on screen</span>
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

      <button
        onClick={onStart}
        disabled={disabled}
        className="px-8 py-3 bg-brand-600 hover:bg-brand-700 disabled:bg-[#1a3a5c] disabled:text-slate-500 text-white font-bold rounded-lg transition-colors text-sm cursor-pointer disabled:cursor-not-allowed"
      >
        {disabled ? 'No aircraft enabled — ask an admin to enable at least one in CBAT settings.' : 'Start'}
      </button>
    </motion.div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function CbatFlag() {
  const { user, apiFetch, API } = useAuth()
  const { settings } = useAppSettings()
  const { enterImmersive, exitImmersive } = useGameChrome()

  const [phase, setPhase] = useState('intro')
  const [personalBest, setPersonalBest] = useState(null)
  const [scoreSaved, setScoreSaved] = useState(false)
  const [aircraftList, setAircraftList] = useState([])
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
    if (phase === 'playing') enterImmersive()
    else exitImmersive()
    return exitImmersive
  }, [phase, enterImmersive, exitImmersive])

  // Fetch personal best and aircraft list
  useEffect(() => {
    if (!user) return
    apiFetch(`${API}/api/games/cbat/flag/personal-best`)
      .then(r => r.json())
      .then(d => { if (d.data) setPersonalBest(d.data) })
      .catch(() => {})

    apiFetch(`${API}/api/games/cbat/aircraft-cutouts`)
      .then(r => r.json())
      .then(d => {
        const allowlist = new Set((settings?.cbatFlagAircraftBriefIds ?? []).map(String))
        const list = (d.data || [])
          .filter(a => has3DModel(a.briefId, a.title))
          .filter(a => allowlist.has(String(a.briefId)))
          .map(a => ({ ...a, modelUrl: getModelUrl(a.briefId, a.title) }))
        setAircraftList(list)
      })
      .catch(() => {})
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

      // Aircraft question schedule (8s cooldown, random 80% roll)
      if (!acSymbolRef.current && t >= AC_QUESTION_FIRST) {
        const timeSinceLast = t - acLastQuestionRef.current
        if (timeSinceLast >= AC_QUESTION_COOLDOWN) {
          if (Math.random() < 0.015) {  // ~once per 8s at 100ms tick
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
      apiFetch(`${API}/api/games/cbat/flag/result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
        }),
      })
        .then(r => r.json())
        .then(() => {
          setScoreSaved(true)
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

  const handleDelete = useCallback(() => {
    if (!mathActiveRef.current) return
    const next = mathEnteredRef.current.slice(0, -1)
    mathEnteredRef.current = next
    setMathEntered(next)
  }, [])

  // ── Keyboard input (desktop) ──────────────────────────────────────────────
  // Mirror numpad clicks: 0-9 → handleDigit, Backspace/Delete → handleDelete.
  useEffect(() => {
    if (phase !== 'playing') return
    const onKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault()
        handleDigit(e.key)
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        handleDelete()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [phase, handleDigit, handleDelete])

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
    recordCbatStart('flag', apiFetch, API)
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
            <Link to="/cbat" className="text-slate-500 hover:text-brand-400 transition-colors text-sm">&larr; CBAT</Link>
            <h1 className="text-sm font-extrabold text-[#ddeaf8]">FLAG</h1>
          </div>

          <div className="flex flex-col items-center max-[600px]:w-full">
            {phase === 'intro' && (
              <IntroScreen
                onStart={startGame}
                personalBest={personalBest}
                aircraftList={aircraftList}
              />
            )}

            {phase === 'playing' && (
              <div className="w-full max-[600px]:h-[calc(100dvh-3rem)] max-[600px]:flex max-[600px]:flex-col max-[600px]:overflow-hidden">
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
                      active={phase === 'playing'}
                    />
                  </div>

                  {/* Controls — numpad + aircraft question */}
                  <div
                    className="
                      max-[600px]:w-full max-[600px]:max-w-[280px] max-[600px]:mx-auto max-[600px]:static max-[600px]:shrink-0
                      min-[600px]:absolute min-[600px]:right-4 min-[600px]:bottom-4
                      min-[600px]:w-52 z-10
                    "
                  >
                    <div className="bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-3 max-[600px]:p-1.5 flex flex-col gap-3 max-[600px]:gap-1.5">
                      <Numpad
                        question={mathQuestion}
                        entered={mathEntered}
                        onDigit={handleDigit}
                        onDelete={handleDelete}
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
              <ResultsScreen
                stats={stats}
                onPlayAgain={() => { setPhase('intro') }}
                scoreSaved={scoreSaved}
              />
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
