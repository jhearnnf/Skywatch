import { useState, useCallback, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { submitCbatResult } from '../lib/cbatOutbox'
import { useCbatTracking } from '../utils/cbat/useCbatTracking'
import { getSymbolScale } from '../utils/cbat/symbolScale'
import { useGameChrome } from '../context/GameChromeContext'
import SEO from '../components/SEO'
import { CbatGameHeader, CbatFooterStrip } from '../components/cbat/CbatTestChrome'
import { useCbatTheme } from '../hooks/useCbatTheme'
import CbatGameOver from '../components/CbatGameOver'
import { useAdminRoundParam } from '../utils/cbat/useAdminRoundParam'
import CbatIntroLabel from '../components/cbat/CbatIntroLabel'
import { useGameBodyClass } from '../hooks/useGameBodyClass'

// ── Constants ────────────────────────────────────────────────────────────────
const TOTAL_ROUNDS = 15
const FEEDBACK_MS = 1000

// Fast-restart countdown: 3 / 2 / 1 at half a second each, then a short GO flash.
const COUNTDOWN_FROM = 3
const COUNTDOWN_STEP_MS = 500
const COUNTDOWN_GO_MS = 400
// Background scatter shown behind the countdown
const SCATTER_TILES = 15
const SCATTER_TICK_MS = 110
const SCATTER_SWAPS_PER_TICK = 3

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

// ── Real CBAT pool — red capital letters and simple symbols ─────────────────
// The real Visual Search screen (rafcbat.wordpress.com, vst1.png) shows red
// capitals on grey tiles: A, E, K, R, B, S, T, H, G, P… Letters plus a set of
// plain Latin-1 symbols, so tier 3's 25 unique tiles still draw without a
// repeat. Code points, like SYMBOL_POOL, so the same picker serves both.
export const CBAT_SYMBOL_POOL = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', ...'!#$%&*+=?@£¥§¶±÷×']
  .map(c => c.codePointAt(0))

// The real tiles are numbered from 10, so every answer is exactly two digits.
export const CBAT_FIRST_TILE_NUMBER = 10
export const tileNumber = (i) => i + CBAT_FIRST_TILE_NUMBER

// The tile index a typed answer names, or -1 when it names none: fewer than
// two digits, or a number no tile on this grid carries.
export function entryTileIndex(entry, size) {
  if (!/^\d{2}$/.test(entry)) return -1
  const idx = Number(entry) - CBAT_FIRST_TILE_NUMBER
  return idx >= 0 && idx < size ? idx : -1
}

// Case-fold key so a round never draws both the uppercase and lowercase of the
// same base letter. Many Cyrillic lowercase forms are just scaled-down copies of
// the capital (e.g. И vs и, Н vs н), so showing both makes them near-identical.
// Cyrillic uppercase А–Я sit at 0x0410–0x042F and lowercase а–я at 0x0430–0x044F,
// a fixed +0x20 offset; folding lowercase down to its capital gives a shared key.
// Every other script returns its own code point, so unrelated symbols never fold.
export function collisionKey(codePoint) {
  if (codePoint >= 0x0430 && codePoint <= 0x044F) return codePoint - 0x20
  return codePoint
}

export function pickUniqueSymbols(count, pool = SYMBOL_POOL) {
  // Full Fisher-Yates shuffle, then greedily take symbols while skipping any
  // whose case-folded key is already in the selection. Either pool dwarfs the
  // largest tier size, so `count` is always satisfiable.
  const arr = [...pool]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  const out = []
  const usedKeys = new Set()
  for (const cp of arr) {
    if (out.length >= count) break
    const key = collisionKey(cp)
    if (usedKeys.has(key)) continue
    usedKeys.add(key)
    out.push(String.fromCodePoint(cp))
  }
  return out
}

function randomSymbol(pool = SYMBOL_POOL) {
  return String.fromCodePoint(pool[Math.floor(Math.random() * pool.length)])
}

function buildRounds(pool = SYMBOL_POOL) {
  const rounds = []
  for (let i = 0; i < TOTAL_ROUNDS; i++) {
    const tier = tierFor(i)
    const { min, max } = TIERS[tier]
    const size = min + Math.floor(Math.random() * (max - min + 1))
    const symbols = pickUniqueSymbols(size, pool)
    const targetIdx = Math.floor(Math.random() * size)
    rounds.push({ symbols, target: symbols[targetIdx], tier })
  }
  return rounds
}

// ── Real CBAT board ──────────────────────────────────────────────────────────
// The Visual Search screen as the test software draws it: grey tiles in rows
// of four on the navy, each with its red glyph top-left and a black two-digit
// number bottom-right, and the target tile alone underneath with "??" where
// its number would be. Nothing here is clickable — the answer is the number,
// typed. Styles in main.css ("Real CBAT test chrome").
function CbatSearchTile({ sym, label }) {
  return (
    <div className="cbat-vs-tile" data-testid="cbat-vs-tile">
      <span className="cbat-vs-glyph">{sym}</span>
      <span className="cbat-vs-num">{label}</span>
    </div>
  )
}

function CbatSearchBoard({ symbols, target, dim = false }) {
  return (
    <div className={`cbat-vs-board${dim ? ' opacity-40' : ''}`} aria-hidden={dim || undefined}>
      <div className="cbat-vs-grid" data-testid="cbat-vs-grid">
        {symbols.map((sym, i) => (
          <CbatSearchTile key={i} sym={sym} label={String(tileNumber(i))} />
        ))}
      </div>
      <div className="cbat-vs-target" data-testid="cbat-vs-target">
        <CbatSearchTile sym={target} label="??" />
      </div>
    </div>
  )
}

// Touch fallback for the typed answer: the real keyboard's number pad, drawn
// as key caps. Hidden by CSS wherever a physical keyboard is the norm.
const CBAT_NUMPAD_KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3']

function CbatSymbolsNumpad({ onDigit, onErase, onSubmit, canSubmit }) {
  return (
    <div className="cbat-vs-numpad" data-testid="cbat-vs-numpad">
      {CBAT_NUMPAD_KEYS.map(d => (
        <button key={d} type="button" className="cbat-keycap" onClick={() => onDigit(d)}>{d}</button>
      ))}
      <button type="button" className="cbat-keycap" onClick={onErase} aria-label="Erase">&#9003;</button>
      <button type="button" className="cbat-keycap" onClick={() => onDigit('0')}>0</button>
      <button type="button" className="cbat-keycap cbat-keycap-arrow" onClick={onSubmit} disabled={!canSubmit} aria-label="Submit answer">&#10140;</button>
    </div>
  )
}

// ── Fast-restart countdown ───────────────────────────────────────────────────
// A live scatter of symbols with a "selector" box hopping between tiles, so the
// wait reads as the game warming up rather than as dead time. Purely decorative:
// the real round is built when the countdown ends.
//
// The layout deliberately mirrors the play screen element for element — HUD row,
// progress bar, grid card, target card — so when the round takes over, nothing
// moves. Only the scrim lifts and the real symbols fade in over the scatter.
function CountdownScreen({ count, tileCount, cbat = false }) {
  const pool = cbat ? CBAT_SYMBOL_POOL : SYMBOL_POOL
  const [tiles, setTiles] = useState(() => pickUniqueSymbols(tileCount, pool))
  const [selected, setSelected] = useState(() => Math.floor(Math.random() * tileCount))

  useEffect(() => {
    const id = setInterval(() => {
      setSelected(Math.floor(Math.random() * tileCount))
      setTiles(prev => {
        const next = [...prev]
        for (let k = 0; k < SCATTER_SWAPS_PER_TICK; k++) {
          next[Math.floor(Math.random() * next.length)] = randomSymbol(pool)
        }
        return next
      })
    }, SCATTER_TICK_MS)
    return () => clearInterval(id)
  }, [tileCount, pool])

  const isGo = count <= 0
  const spotlit = tiles[selected] || tiles[0]

  const beat = (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"
      data-testid="symbols-countdown-beat"
    >
      <motion.div
        key={count}
        initial={{ scale: 1.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ duration: 0.22 }}
        className={`font-mono font-extrabold drop-shadow-[0_0_18px_rgba(6,16,26,0.9)] ${
          isGo ? 'text-5xl sm:text-6xl lg:text-8xl text-green-400' : 'text-7xl sm:text-8xl lg:text-9xl text-brand-600'
        }`}
      >
        {isGo ? 'GO' : count}
      </motion.div>
      <p className="text-[10px] text-slate-300 uppercase tracking-[0.2em] mt-2 drop-shadow-[0_0_10px_rgba(6,16,26,0.9)]">
        {isGo ? 'Find the target' : 'Get ready'}
      </p>
    </div>
  )

  // Real CBAT theme: the same board the round will draw, dimmed, with the
  // count over it — so, as below, nothing moves at the handoff.
  if (cbat) {
    return (
      <div className="relative w-full" data-testid="symbols-countdown">
        <CbatSearchBoard symbols={tiles} target={spotlit} dim />
        {beat}
      </div>
    )
  }

  return (
    <div className="w-full max-w-md lg:max-w-none lg:w-[min(48rem,calc(100vh_-_30rem))]" data-testid="symbols-countdown">
      {/* HUD — same row as in play, holding its place with resting values */}
      <div className="flex items-center justify-between text-xs lg:text-sm font-mono mb-2 px-1 text-slate-400 opacity-50">
        <span>Round <span className="text-brand-600">1</span>/{TOTAL_ROUNDS}</span>
        <span>Tier <span className="text-brand-600">1</span></span>
        <span>{'✓'} <span className="text-green-400">0</span></span>
        <span>{'⏱'} <span className="text-brand-600">0.0s</span></span>
      </div>

      {/* Progress bar — empty, ready to fill */}
      <div className="w-full h-1 bg-game-line rounded-full mb-3 overflow-hidden" />

      {/* Grid card */}
      <div className="relative bg-game-panel border border-game-line rounded-xl p-3 lg:p-4 mb-3 overflow-hidden">
        <p className="text-[10px] lg:text-xs text-slate-500 uppercase tracking-wide text-center mb-3">
          Find the target symbol
        </p>
        {/* Scatter — held at a constant dim through GO. It must never start to
            resolve into a readable grid: the real symbols appear only when the
            round takes over, so there is nothing to pre-read. */}
        <div className="grid grid-cols-4 sm:grid-cols-5 gap-1.5 lg:gap-2.5 opacity-40" aria-hidden="true">
          {tiles.map((sym, i) => (
            <div
              key={i}
              className={`aspect-square flex items-center justify-center overflow-hidden rounded-lg border-2 text-2xl sm:text-3xl lg:text-5xl transition-colors duration-100 ${
                i === selected
                  ? 'bg-game-raised border-brand-400 text-brand-200'
                  : 'bg-game-arena border-game-line text-game-text'
              }`}
            >
              <span style={{ fontSize: `${getSymbolScale(sym)}em`, lineHeight: 1 }}>{sym}</span>
            </div>
          ))}
        </div>

        {/* Scrim — constant, right up to the handoff */}
        <div className="absolute inset-0 bg-game-arena/55 pointer-events-none" />

        {/* Count */}
        {beat}
      </div>

      {/* Target card — same box the round uses, cycling with the selector */}
      <div className="bg-game-panel border border-game-line rounded-xl p-4">
        <p className="text-[10px] lg:text-xs text-slate-500 uppercase tracking-wide text-center mb-2">
          Target
        </p>
        <div className="flex items-center justify-center">
          <div className="w-24 h-24 lg:w-28 lg:h-28 overflow-hidden rounded-xl border-2 border-brand-400/50 bg-game-arena flex items-center justify-center text-6xl lg:text-7xl text-game-text/60">
            <span style={{ fontSize: `${getSymbolScale(spotlit)}em`, lineHeight: 1 }}>{spotlit}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Results screen ───────────────────────────────────────────────────────────
function ResultsScreen({ answers, totalTime }) {
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
    : pct >= 70 ? { label: 'Good', emoji: '\u2708\uFE0F', color: 'text-brand-600' }
    : pct >= 50 ? { label: 'Needs Work', emoji: '\u{1F527}', color: 'text-amber-400' }
    : { label: 'Failed', emoji: '\u{1F4A5}', color: 'text-red-400' }

  return (
    <div className="w-full bg-game-panel border border-game-line rounded-xl p-8 text-center">
      <p className="text-5xl mb-3">{grade.emoji}</p>
      <p className={`text-2xl font-extrabold mb-1 ${grade.color}`}>{grade.label}</p>
      <p className="text-sm text-slate-400 mb-6">Symbol Recognition Complete</p>

      <div className="bg-game-arena rounded-lg border border-game-line p-4 sm:p-5 mb-4">
        <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">Overall Score</p>
        <div className="flex flex-wrap justify-center gap-4 sm:gap-8 items-end">
          <div>
            <p className="text-3xl sm:text-4xl font-mono font-bold text-brand-600 mb-1">{pct}%</p>
            <p className="text-sm text-slate-400">{correct} / {TOTAL_ROUNDS} correct</p>
          </div>
          <div className="w-px h-12 bg-game-line" />
          <div>
            <p className="text-3xl sm:text-4xl font-mono font-bold text-brand-600 mb-1">{totalTime.toFixed(2)}s</p>
            <p className="text-sm text-slate-400">total time</p>
          </div>
        </div>
        {correctTimes.length > 0 && (
          <p className="text-xs text-slate-500 mt-3">
            Avg find time: <span className="text-brand-600 font-mono">{avgTime.toFixed(2)}s</span>
          </p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 mb-6">
        {['Tier 1', 'Tier 2', 'Tier 3'].map((label, i) => (
          <div key={i} className="bg-game-arena rounded-lg border border-game-line p-3">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">{label}</p>
            <p className="text-xl font-mono font-bold text-brand-600">
              {tierCorrect[i].correct}/{tierCorrect[i].total}
            </p>
          </div>
        ))}
      </div>

      {/* Answer review — scrollable */}
      <div className="bg-game-arena rounded-lg border border-game-line p-3 mb-6 max-h-48 overflow-y-auto">
        <div className="flex items-baseline justify-between mb-2 sticky top-0 bg-game-arena">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide">Round Review</p>
          <p className="text-[10px] text-slate-600">{'target \u2192 your pick'}</p>
        </div>
        <div className="space-y-1">
          {answers.map((a, i) => (
            <div key={i} className={`flex items-center justify-between gap-2 text-xs px-2 py-1 rounded ${a.correct ? 'text-green-400' : 'text-red-400'}`}>
              <span className="text-slate-500 w-6 shrink-0 text-left">#{i + 1}</span>
              <span className="text-lg w-7 shrink-0 text-center overflow-hidden text-game-text">
                <span style={{ fontSize: `${getSymbolScale(a.target)}em`, lineHeight: 1 }}>{a.target}</span>
              </span>
              <span className="w-4 shrink-0 text-center">{a.correct ? '\u2713' : '\u2717'}</span>
              {/* What was actually clicked \u2014 only meaningful on a miss, but the
                  slot is always reserved so the columns stay aligned. */}
              <span className="text-lg w-7 shrink-0 text-center overflow-hidden">
                {!a.correct && (
                  <span style={{ fontSize: `${getSymbolScale(a.picked)}em`, lineHeight: 1 }}>{a.picked}</span>
                )}
              </span>
              <span className="font-mono text-slate-500 ml-auto">
                {a.correct ? `${a.roundTime.toFixed(2)}s` : 'missed'}
              </span>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function CbatSymbols() {
  const { user, apiFetch, API } = useAuth()
  const cbat = useCbatTheme()
  const { start: startTracking, markCompleted: markGameCompleted } = useCbatTracking()

  const [phase, setPhase] = useState('intro') // intro | countdown | playing | feedback | results
  const [countdown, setCountdown] = useState(COUNTDOWN_FROM)
  const [scatterSize, setScatterSize] = useState(SCATTER_TILES)
  const pendingRoundsRef = useRef(null)
  const { enterImmersive, exitImmersive } = useGameChrome()
  useEffect(() => {
    if (phase === 'countdown' || phase === 'playing' || phase === 'feedback') enterImmersive()
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
  const [queued, setQueued] = useState(false)

  // Set by the admin round jump (?round=N). The skipped rounds still count
  // toward the score's denominator, so the result is meaningless and must not
  // reach the leaderboard. Mirrors cheatUsed in DPT and debugUsed in ACT.
  const [debugUsed, setDebugUsed] = useState(false)
  const debugUsedRef = useRef(false)

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
    setQueued(false)

    // Read from the ref: this is reached from an advance timeout whose closure
    // predates the flag being set.
    if (debugUsedRef.current) return

    markGameCompleted({ score: correct })
    submitCbatResult(`symbols`, {
        correctCount: correct,
        tier1Correct: tier1,
        tier2Correct: tier2,
        tier3Correct: tier3,
        totalTime: finalTime,
        grade,
        // Which screen this was played on: the Real CBAT variant is a
        // different game (typed answers, red capitals), and the leaderboard
        // marks each score with it.
        uiTheme: cbat ? 'cbat' : 'skywatch',
      }, { apiFetch, API })
      .then((r) => {
        setScoreSaved(!!r?.synced)
        setQueued(!!r?.queued)
        if (user) {
          apiFetch(`${API}/api/games/cbat/symbols/personal-best`)
            .then(r => r.json())
            .then(d => { if (d.data) setPersonalBest(d.data) })
            .catch(() => {})
        }
      })
      .catch(() => {})
  }, [apiFetch, API, cbat, user])

  // Under the Real CBAT theme the tiles carry red capitals and simple symbols,
  // as the real screen does, instead of the mixed-script pool.
  const symbolPool = cbat ? CBAT_SYMBOL_POOL : SYMBOL_POOL
  const currentRound = rounds[currentIdx] || null

  // Real CBAT theme: the answer is the target tile's two-digit number, typed
  // on the keyboard (or the on-screen pad) and committed with Enter.
  const [entry, setEntry] = useState('')

  // True elapsed since the run began. The clock is anchored to a single
  // start timestamp (set in startGame) rather than re-based on each phase
  // change — re-basing off the last sampled `elapsed` discarded up to one
  // tick of real time per round, so totals drifted progressively short.
  const readElapsed = useCallback(
    () => (startTimeRef.current ? (Date.now() - startTimeRef.current) / 1000 : 0),
    []
  )

  // Timer — runs during 'playing' and 'feedback' phases (feedback is part of total time)
  useEffect(() => {
    if (phase === 'playing' || phase === 'feedback') {
      timerRef.current = setInterval(() => {
        setElapsed(readElapsed())
      }, 100)
      return () => clearInterval(timerRef.current)
    } else {
      clearInterval(timerRef.current)
    }
  }, [phase, readElapsed])

  // Cleanup pending advance timeout on unmount
  useEffect(() => {
    return () => {
      if (advanceTimeoutRef.current) clearTimeout(advanceTimeoutRef.current)
    }
  }, [])

  const startGame = useCallback(() => {
    startTracking('symbols')
    // The countdown builds the run ahead of time so its scatter can be sized to
    // round 1 exactly; fall back to a fresh build for a normal start.
    const built = pendingRoundsRef.current || buildRounds(symbolPool)
    setRounds(built)
    pendingRoundsRef.current = null
    setCurrentIdx(0)
    setAnswers([])
    setPickedSymbol(null)
    setWasCorrect(null)
    setLastRoundTime(0)
    setElapsed(0)
    setDebugUsed(false)
    debugUsedRef.current = false
    startTimeRef.current = Date.now()
    roundStartRef.current = 0
    setPhase('playing')
  }, [apiFetch, API, setDebugUsed, symbolPool])

  // ?round=N — open on a harder tier instead of playing up to it. Moving the
  // cursor is the whole jump here: the rounds are pre-built, so round N is
  // already sitting in the array waiting. See utils/cbat/adminRoundParam.js.
  useAdminRoundParam({
    totalRounds: TOTAL_ROUNDS,
    ready: phase === 'playing' && rounds.length > 0,
    onJump: (roundNum) => {
      setDebugUsed(true)
      debugUsedRef.current = true
      setCurrentIdx(roundNum - 1)
      setPickedSymbol(null)
      setWasCorrect(null)
      roundStartRef.current = readElapsed()
    },
  })

  // Fast restart — abandons whatever is on screen and runs the countdown first.
  // Deliberately not confirmed: the point of the button is to be instant.
  const startCountdown = useCallback(() => {
    clearInterval(timerRef.current)
    if (advanceTimeoutRef.current) clearTimeout(advanceTimeoutRef.current)
    const built = buildRounds(symbolPool)
    pendingRoundsRef.current = built
    setScatterSize(built[0].symbols.length)
    setCountdown(COUNTDOWN_FROM)
    setPhase('countdown')
  }, [symbolPool])

  // Drive the countdown: COUNTDOWN_FROM..1, then a short GO flash at 0.
  useEffect(() => {
    if (phase !== 'countdown') return
    const isGo = countdown <= 0
    const t = setTimeout(
      () => { if (isGo) startGame(); else setCountdown(c => c - 1) },
      isGo ? COUNTDOWN_GO_MS : COUNTDOWN_STEP_MS
    )
    return () => clearTimeout(t)
  }, [phase, countdown, startGame])

  const goToIntro = useCallback(() => {
    clearInterval(timerRef.current)
    if (advanceTimeoutRef.current) clearTimeout(advanceTimeoutRef.current)
    setPhase('intro')
    startTimeRef.current = null
    setRounds([])
    setCurrentIdx(0)
    setAnswers([])
    setPickedSymbol(null)
    setWasCorrect(null)
    setElapsed(0)
    setScoreSaved(false)
  }, [])

  // Reset round-start timestamp when a new round begins
  useEffect(() => {
    if (phase === 'playing') {
      roundStartRef.current = readElapsed()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx, phase])

  // Desktop: the grid sizes itself to the viewport height (less the target card,
  // which always sits BELOW it — the eye drops from grid to target and back),
  // which on a tall monitor is wider than the shell's max-w-3xl. See main.css.
  useGameBodyClass('cbat-stage-wide', phase === 'countdown' || phase === 'playing' || phase === 'feedback')

  // Move on from round `fromIdx`.
  const advance = (fromIdx, finalAnswers) => {
    const nextIdx = fromIdx + 1
    if (nextIdx >= rounds.length) {
      // One authoritative reading, used for BOTH the results screen and the
      // submitted score. Previously the screen rendered the last 100ms tick
      // of `elapsed` while the leaderboard got `elapsed + FEEDBACK_MS`, so
      // the two could round to different tenths (e.g. 12.4s vs 12.5s).
      const finalTime = readElapsed()
      setElapsed(finalTime)
      submitScore(finalAnswers, finalTime)
      setPhase('results')
      return
    }
    setCurrentIdx(nextIdx)
    setPickedSymbol(null)
    setWasCorrect(null)
    setPhase('playing')
  }

  const handlePick = (symbol) => {
    if (phase !== 'playing' || !currentRound) return
    const correct = symbol === currentRound.target
    const roundTime = readElapsed() - roundStartRef.current
    const newAnswers = [
      ...answers,
      { target: currentRound.target, picked: symbol, correct, roundTime, tier: currentRound.tier },
    ]
    setAnswers(newAnswers)
    // The real test gives no right/wrong mid-run; under the Real CBAT theme
    // a round moves straight on.
    if (cbat) {
      advance(currentIdx, newAnswers)
      return
    }
    setPickedSymbol(symbol)
    setWasCorrect(correct)
    setLastRoundTime(roundTime)
    setPhase('feedback')

    advanceTimeoutRef.current = setTimeout(() => {
      advance(currentIdx, newAnswers)
    }, FEEDBACK_MS)
  }

  // ── Real CBAT theme: typed answer ──────────────────────────────────────────
  // Two digits name a tile. A third digit starts the answer over rather than
  // being dropped, so a mistyped answer is corrected by just typing it again.
  const entryIdx = currentRound ? entryTileIndex(entry, currentRound.symbols.length) : -1
  const typeDigit = (d) => setEntry(prev => (prev.length >= 2 ? d : prev + d))
  const eraseDigit = () => setEntry(prev => prev.slice(0, -1))
  const commitEntry = () => {
    if (phase !== 'playing' || !currentRound || entryIdx < 0) return
    handlePick(currentRound.symbols[entryIdx])
  }

  // A fresh round starts with an empty answer box.
  useEffect(() => { setEntry('') }, [currentIdx, phase])

  // The number row and the numeric keypad both report '0'-'9' through e.key,
  // and both Enters report 'Enter', so one branch serves either. Handlers ride
  // in a ref so the listener is attached once per round rather than per
  // keystroke, and never sees a stale round. Modifier chords are left alone
  // for browser shortcuts; typing targets and the quit dialog are left alone
  // the same way useCbatAnswerKeys leaves them.
  const entryHandlersRef = useRef(null)
  entryHandlersRef.current = { typeDigit, eraseDigit, commitEntry }
  useEffect(() => {
    if (!cbat || phase !== 'playing') return undefined
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return
      if (document.querySelector('[role="dialog"]')) return
      const h = entryHandlersRef.current
      if (/^[0-9]$/.test(e.key)) { h.typeDigit(e.key); e.preventDefault(); return }
      if (e.key === 'Backspace' || e.key === 'Delete') { h.eraseDigit(); e.preventDefault(); return }
      if (e.key === 'Enter') { h.commitEntry(); e.preventDefault() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cbat, phase])

  const testBar = (phase === 'playing' || phase === 'feedback') && currentRound ? {
    stage: 'Testing',
    item: currentIdx + 1,
    total: TOTAL_ROUNDS,
    timeFrac: null,
    progressFrac: (currentIdx + (phase === 'feedback' ? 1 : 0)) / TOTAL_ROUNDS,
  } : null

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
      <CbatGameHeader
        title="Symbols"
        fullTitle="Visual Search"
        intro={phase === 'intro'}
        onQuit={goToIntro}
        confirmNeeded={['playing', 'feedback'].includes(phase)}
        test={testBar}
      >
        {user && (
          // Stays mounted while counting — unmounting it reflowed the header
          // and nudged the whole game down a few pixels mid-animation.
          <button
            onClick={startCountdown}
            disabled={phase === 'countdown'}
            className={`ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-game-line bg-game-panel text-[11px] font-bold text-brand-600 transition-colors ${
              phase === 'countdown'
                ? 'opacity-40 cursor-default'
                : 'hover:text-brand-700 hover:border-brand-400'
            }`}
          >
            <span aria-hidden="true">{'⚡'}</span> Fast Restart
          </button>
        )}
      </CbatGameHeader>

      {/* Logged in — game */}
      {(
        <div className="flex flex-col items-center">

          {/* Intro screen */}
          {phase === 'intro' && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full max-w-md lg:max-w-2xl bg-game-panel border border-game-line rounded-xl p-6 lg:p-9 text-center"
            >
              <p className="text-4xl lg:text-5xl mb-3">{'\u{1F523}'}</p>
              <p className="text-xl lg:text-2xl font-extrabold text-white mb-2">Symbol Recognition</p>
              <p className="text-sm lg:text-base text-slate-400 mb-5 lg:mb-7 lg:max-w-lg lg:mx-auto">
                Spot the target symbol in the grid as fast as you can. 15 rounds of
                increasing difficulty.
              </p>

              <div className="bg-game-arena rounded-lg border border-game-line p-4 lg:p-6 mb-5 lg:mb-7 text-left space-y-2 lg:space-y-3">
                <div className="flex items-start gap-3 text-sm lg:text-base text-game-text">
                  <CbatIntroLabel>T1</CbatIntroLabel>
                  <span className="pt-0.5">{'Rounds 1\u20135 \u00b7 grid of 12\u201315 symbols'}</span>
                </div>
                <div className="flex items-start gap-3 text-sm lg:text-base text-game-text">
                  <CbatIntroLabel>T2</CbatIntroLabel>
                  <span className="pt-0.5">{'Rounds 6\u201310 \u00b7 grid of 15\u201320 symbols'}</span>
                </div>
                <div className="flex items-start gap-3 text-sm lg:text-base text-game-text">
                  <CbatIntroLabel>T3</CbatIntroLabel>
                  <span className="pt-0.5">{'Rounds 11\u201315 \u00b7 grid of 18\u201325 symbols'}</span>
                </div>
                <div className="flex items-start gap-3 text-xs lg:text-sm text-game-muted border-t border-game-line pt-2 lg:pt-3 mt-1">
                  <span className="shrink-0 w-8 text-center lg:text-lg" aria-hidden>{'\u26A0\uFE0F'}</span>
                  <span className="pt-0.5">
                    {cbat
                      ? 'Type the number of the matching tile, then press Enter'
                      : 'A wrong click counts as missed \u2014 round skips automatically'}
                  </span>
                </div>
              </div>

              {personalBest && (
                <div className="bg-game-arena rounded-lg border border-game-line p-3 lg:p-4 mb-4 text-center">
                  <p className="text-[10px] lg:text-xs text-slate-500 uppercase tracking-wide mb-1">Personal Best</p>
                  <p className="text-lg lg:text-xl font-mono font-bold text-brand-600">
                    {personalBest.bestScore}/{TOTAL_ROUNDS} ({Math.round((personalBest.bestScore / TOTAL_ROUNDS) * 100)}%)
                    <span className="text-slate-500 mx-1">{'\u00b7'}</span>
                    {personalBest.bestTime.toFixed(2)}s
                  </p>
                  <p className="text-[10px] lg:text-xs text-slate-500 mt-0.5">{personalBest.attempts} attempt{personalBest.attempts !== 1 ? 's' : ''}</p>
                </div>
              )}

              <div className="text-center mb-4">
                <Link to="/cbat/symbols/leaderboard" className="text-xs lg:text-sm text-brand-600 hover:text-brand-700 transition-colors">
                  {'View Leaderboard \u2192'}
                </Link>
              </div>

              <button
                onClick={startGame}
                data-demo-start
                className="px-8 py-3 lg:px-10 lg:py-3.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg transition-colors text-sm lg:text-base"
              >
                Start
              </button>
            </motion.div>
          )}

          {/* Fast-restart countdown */}
          {phase === 'countdown' && <CountdownScreen count={countdown} tileCount={scatterSize} cbat={cbat} />}

          {/* Playing — Real CBAT theme: the Visual Search screen. The title
              bar carries the round count, the board is the numbered tiles,
              and the footer strip is the answer box. No feedback phase. */}
          {cbat && phase === 'playing' && currentRound && (
            <div className="w-full">
              <CbatSearchBoard key={currentIdx} symbols={currentRound.symbols} target={currentRound.target} />
              <CbatSymbolsNumpad
                onDigit={typeDigit}
                onErase={eraseDigit}
                onSubmit={commitEntry}
                canSubmit={entryIdx >= 0}
              />
              <CbatFooterStrip
                answer={entry || null}
                onSubmit={commitEntry}
                canSubmit={entryIdx >= 0}
              />
            </div>
          )}

          {/* Playing / Feedback */}
          {!cbat && (phase === 'playing' || phase === 'feedback') && currentRound && (
            <div className="w-full max-w-md lg:max-w-none lg:w-[min(48rem,calc(100vh_-_30rem))]">
              {/* HUD */}
              <div className="flex items-center justify-between text-xs lg:text-sm font-mono mb-2 px-1">
                <span className="text-slate-400">
                  Round <span className="text-brand-600">{currentIdx + 1}</span>/{TOTAL_ROUNDS}
                  {/* Same badge as DPT and ACT: an admin who jumped a round
                      needs to see that the run will not be submitted, rather
                      than find out from a leaderboard that never moved. */}
                  {debugUsed && <span className="ml-2 text-amber-400">DEBUG · NO SUBMIT</span>}
                </span>
                <span className="text-slate-400">
                  Tier <span className="text-brand-600">{currentRound.tier + 1}</span>
                </span>
                <span className="text-slate-400">
                  {'\u2713'} <span className="text-green-400">{answers.filter(a => a.correct).length}</span>
                </span>
                <span className="text-slate-400">
                  {'\u23F1'} <span className="text-brand-600">{elapsed.toFixed(1)}s</span>
                </span>
              </div>

              {/* Progress bar */}
              <div className="w-full h-1 bg-game-line rounded-full mb-3 overflow-hidden">
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
                className="bg-game-panel border border-game-line rounded-xl p-3 lg:p-4 mb-3"
              >
                <p className="text-[10px] lg:text-xs text-slate-500 uppercase tracking-wide text-center mb-3">
                  Find the target symbol
                </p>
                <div className={`grid ${gridCols} gap-1.5 lg:gap-2.5`}>
                  {currentRound.symbols.map((sym, i) => {
                    let btnClass = 'bg-game-arena border-game-line text-game-text hover:border-brand-400 hover:bg-game-raised'
                    if (phase === 'feedback') {
                      if (sym === currentRound.target) {
                        btnClass = 'bg-green-500/20 border-green-500/50 text-green-300'
                      } else if (sym === pickedSymbol && !wasCorrect) {
                        btnClass = 'bg-red-500/20 border-red-500/50 text-red-300'
                      } else {
                        btnClass = 'bg-game-arena border-game-line text-game-faint opacity-50'
                      }
                    }
                    return (
                      <button
                        key={i}
                        onClick={() => handlePick(sym)}
                        disabled={phase === 'feedback'}
                        data-demo-answer
                        className={`aspect-square flex items-center justify-center overflow-hidden rounded-lg border-2 text-2xl sm:text-3xl lg:text-5xl transition-all ${btnClass} ${
                          phase === 'feedback' ? 'cursor-default' : 'cursor-pointer'
                        }`}
                      >
                        {/* Per-glyph normalisation — scripts ink at very different
                            heights, so an unscaled grid mixes tiny and huge symbols. */}
                        <span style={{ fontSize: `${getSymbolScale(sym)}em`, lineHeight: 1 }}>
                          {sym}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </motion.div>

              {/* Target card */}
              <div className="bg-game-panel border border-game-line rounded-xl p-4 relative overflow-hidden">
                <p className="text-[10px] lg:text-xs text-slate-500 uppercase tracking-wide text-center mb-2">
                  Target
                </p>
                <div className="flex items-center justify-center">
                  <div className="w-24 h-24 lg:w-28 lg:h-28 overflow-hidden rounded-xl border-2 border-brand-400 bg-game-arena flex items-center justify-center text-6xl lg:text-7xl">
                    <span style={{ fontSize: `${getSymbolScale(currentRound.target)}em`, lineHeight: 1 }}>
                      {currentRound.target}
                    </span>
                  </div>
                </div>

                {/* Feedback overlay */}
                <AnimatePresence>
                  {phase === 'feedback' && (
                    <motion.div
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className={`absolute top-2 right-2 px-3 py-1.5 rounded-lg text-xs lg:text-sm font-bold ${
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
                    <span className="text-xs lg:text-sm text-brand-600 font-bold">
                      Tier {tierFor(currentIdx) + 1} {'\u2014 grid grows larger'}
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Results */}
          {phase === 'results' && (
            <CbatGameOver
              gameKey="symbols"
              score={answers.filter(a => a.correct).length}
              time={elapsed}
              scoreSaved={scoreSaved}
              queued={queued}
              personalBest={personalBest}
              onPlayAgain={() => { setScoreSaved(false); startGame() }}
            >
              <ResultsScreen
                answers={answers}
                totalTime={elapsed}
              />
            </CbatGameOver>
          )}
        </div>
      )}
    </div>
  )
}
