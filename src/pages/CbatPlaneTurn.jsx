import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import SEO from '../components/SEO'

// ── Constants ────────────────────────────────────────────────────────────────
const GRID = 10
const TOTAL_PACKAGES = 5
const MAX_LEVEL = 5
const BASE_INTERVAL = 500 // ms per move at level 1
const SPEED_STEP = 40     // ms faster each level

// Direction vectors: index matches rotation (0=up,1=right,2=down,3=left)
const DIR = [
  { dr: -1, dc: 0 },  // 0 — up
  { dr: 0, dc: 1 },   // 1 — right
  { dr: 1, dc: 0 },   // 2 — down
  { dr: 0, dc: -1 },  // 3 — left
]
const DIR_DEG = [0, 90, 180, 270]

// Safe zone: plane won't spawn on outer 2 rows/cols
function randomSafePos() {
  return {
    r: 2 + Math.floor(Math.random() * (GRID - 4)),
    c: 2 + Math.floor(Math.random() * (GRID - 4)),
  }
}
function randomDir() { return Math.floor(Math.random() * 4) }

function randomPackagePos(planeR, planeC) {
  let pos
  do {
    pos = { r: Math.floor(Math.random() * GRID), c: Math.floor(Math.random() * GRID) }
  } while (pos.r === planeR && pos.c === planeC)
  return pos
}

// ── Aircraft Selection Screen ────────────────────────────────────────────────
function AircraftSelect({ aircraft, onSelect, loading }) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-brand-400 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm text-slate-400">Loading aircraft...</p>
      </div>
    )
  }

  if (!aircraft.length) {
    return (
      <div className="text-center py-16">
        <p className="text-4xl mb-3">✈️</p>
        <p className="font-bold text-slate-700 mb-1">No aircraft available</p>
        <p className="text-sm text-slate-400">Aircraft cutout images need to be generated first.</p>
      </div>
    )
  }

  return (
    <div>
      <h2 className="text-lg font-bold text-slate-800 text-center mb-1">Choose Your Aircraft</h2>
      <p className="text-xs text-slate-400 text-center mb-5">This will be your character in the game.</p>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 max-w-md mx-auto">
        {aircraft.map((a, i) => (
          <motion.button
            key={a.briefId}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.04 }}
            onClick={() => onSelect(a)}
            className="flex flex-col items-center gap-1.5 p-3 rounded-xl border border-[#1a3a5c] bg-[#0a1628] hover:border-[#5baaff] hover:bg-[#0f2240] transition-all group cursor-pointer"
          >
            <img
              src={a.cutoutUrl}
              alt={a.title}
              className="w-14 h-14 object-contain group-hover:scale-110 transition-transform drop-shadow-[0_0_6px_rgba(91,170,255,0.4)]"
            />
            <span className="text-[10px] text-slate-400 group-hover:text-brand-300 text-center leading-tight truncate w-full">
              {a.title}
            </span>
          </motion.button>
        ))}
      </div>
    </div>
  )
}

// ── Game Over Overlay ────────────────────────────────────────────────────────
function GameOverOverlay({ won, score, level, maxLevel, onRestart, onMenu }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 rounded-xl"
    >
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.15 }}
        className="text-center p-6"
      >
        <p className="text-4xl mb-2">{won ? '🎖️' : '💥'}</p>
        <p className="text-xl font-extrabold text-white mb-1">
          {won ? 'Mission Complete' : 'Crashed'}
        </p>
        {won ? (
          <div className="text-sm text-slate-300 mb-4">
            <p>Level {level} cleared</p>
            <p className="font-mono text-brand-300 text-lg mt-1">
              {score.rotations} rotations &middot; {score.time}s
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-400 mb-4">Your aircraft hit the grid boundary.</p>
        )}
        <div className="flex gap-3 justify-center">
          <button
            onClick={onRestart}
            className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-lg transition-colors"
          >
            {won ? (level >= maxLevel ? 'View Score' : 'Next Level') : 'Retry'}
          </button>
          <button
            onClick={onMenu}
            className="px-4 py-2 bg-[#1a3a5c] hover:bg-[#254a6e] text-slate-300 text-sm font-bold rounded-lg transition-colors"
          >
            Change Aircraft
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── HUD ──────────────────────────────────────────────────────────────────────
function HUD({ collected, rotations, elapsed, level }) {
  return (
    <div className="flex items-center justify-between text-xs font-mono mb-2 px-1">
      <span className="text-slate-400">LVL <span className="text-brand-300">{level}</span>/{MAX_LEVEL}</span>
      <span className="text-slate-400">
        📦 <span className="text-brand-300">{collected}</span>/{TOTAL_PACKAGES}
      </span>
      <span className="text-slate-400">
        ↻ <span className="text-brand-300">{rotations}</span>
      </span>
      <span className="text-slate-400">
        ⏱ <span className="text-brand-300">{elapsed.toFixed(1)}s</span>
      </span>
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function CbatPlaneTurn() {
  const { user, apiFetch } = useAuth()

  // Aircraft selection
  const [aircraft, setAircraft] = useState([])
  const [loadingAircraft, setLoadingAircraft] = useState(true)
  const [selected, setSelected] = useState(null) // { briefId, title, cutoutUrl }

  // Game state
  const [phase, setPhase] = useState('select') // select | playing | over | finished
  const [plane, setPlane] = useState({ r: 5, c: 5, dir: 0 })
  const [pkg, setPkg] = useState({ r: 0, c: 0 })
  const [collected, setCollected] = useState(0)
  const [rotations, setRotations] = useState(0)
  const [level, setLevel] = useState(1)
  const [won, setWon] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  // Totals across all levels
  const [totalRotations, setTotalRotations] = useState(0)
  const [totalTime, setTotalTime] = useState(0)

  // Refs for game loop
  const gameRef = useRef({})
  const timerRef = useRef(null)
  const moveRef = useRef(null)

  // Fetch aircraft on mount
  useEffect(() => {
    if (!user) return
    apiFetch('/api/games/cbat/aircraft-cutouts')
      .then(res => res.json())
      .then(d => setAircraft(d.data || []))
      .catch(() => {})
      .finally(() => setLoadingAircraft(false))
  }, [user])

  // Keep gameRef in sync
  useEffect(() => {
    gameRef.current = { plane, pkg, collected, rotations, level, won, phase }
  })

  const startGame = useCallback((lvl = 1, keepSelected = false) => {
    const start = randomSafePos()
    const dir = randomDir()
    const p = randomPackagePos(start.r, start.c)
    setPlane({ r: start.r, c: start.c, dir })
    setPkg(p)
    setCollected(0)
    setRotations(0)
    setLevel(lvl)
    setWon(false)
    setElapsed(0)
    setPhase('playing')
  }, [])

  // Timer
  useEffect(() => {
    if (phase !== 'playing') { clearInterval(timerRef.current); return }
    const t0 = Date.now() - elapsed * 1000
    timerRef.current = setInterval(() => {
      setElapsed((Date.now() - t0) / 1000)
    }, 100)
    return () => clearInterval(timerRef.current)
  }, [phase])

  // Movement loop
  useEffect(() => {
    if (phase !== 'playing') { clearInterval(moveRef.current); return }

    const interval = Math.max(150, BASE_INTERVAL - (level - 1) * SPEED_STEP)

    moveRef.current = setInterval(() => {
      setPlane(prev => {
        const { dr, dc } = DIR[prev.dir]
        const nr = prev.r + dr
        const nc = prev.c + dc

        // Boundary check — game over
        if (nr < 0 || nr >= GRID || nc < 0 || nc >= GRID) {
          clearInterval(moveRef.current)
          clearInterval(timerRef.current)
          setPhase('over')
          setWon(false)
          return prev
        }

        // Check care package pickup
        const g = gameRef.current
        if (nr === g.pkg.r && nc === g.pkg.c) {
          const next = g.collected + 1
          setCollected(next)
          if (next >= TOTAL_PACKAGES) {
            clearInterval(moveRef.current)
            clearInterval(timerRef.current)
            setPhase('over')
            setWon(true)
          } else {
            setPkg(randomPackagePos(nr, nc))
          }
        }

        return { ...prev, r: nr, c: nc }
      })
    }, interval)

    return () => clearInterval(moveRef.current)
  }, [phase, level])

  // Keyboard controls
  useEffect(() => {
    if (phase !== 'playing') return

    function handleKey(e) {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setPlane(prev => ({ ...prev, dir: (prev.dir + 3) % 4 }))
        setRotations(r => r + 1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        setPlane(prev => ({ ...prev, dir: (prev.dir + 1) % 4 }))
        setRotations(r => r + 1)
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [phase])

  // Handlers
  const handleSelect = (a) => {
    setSelected(a)
    setTotalRotations(0)
    setTotalTime(0)
    startGame(1)
  }

  const handleRestart = () => {
    if (won) {
      // Accumulate this level's stats
      const newTotalRot = totalRotations + rotations
      const newTotalTime = totalTime + elapsed
      setTotalRotations(newTotalRot)
      setTotalTime(newTotalTime)

      if (level >= MAX_LEVEL) {
        // All levels done — show final screen
        setTotalRotations(newTotalRot)
        setTotalTime(newTotalTime)
        setPhase('finished')
        return
      }
      startGame(level + 1)
    } else {
      startGame(level)
    }
  }

  const handleMenu = () => {
    setSelected(null)
    setPhase('select')
  }

  const handlePlayAgain = () => {
    setTotalRotations(0)
    setTotalTime(0)
    startGame(1)
  }

  const handleRotate = (direction) => {
    if (phase !== 'playing') return
    setPlane(prev => ({
      ...prev,
      dir: direction === 'left' ? (prev.dir + 3) % 4 : (prev.dir + 1) % 4,
    }))
    setRotations(r => r + 1)
  }

  // Cell size for responsive grid
  const cellPx = 'calc((min(100vw - 2rem, 28rem)) / 10)'

  return (
    <div className="cbat-plane-turn-page">
      <SEO title="Plane Turn — CBAT" description="Navigate your aircraft to collect care packages." />

      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <Link to="/cbat" className="text-slate-500 hover:text-brand-400 transition-colors text-sm">&larr; CBAT</Link>
        <h1 className="text-xl font-extrabold text-slate-900">Plane Turn</h1>
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

      {/* Logged in — game area */}
      {user && (
        <div className="flex flex-col items-center">

          {/* Aircraft selection */}
          {phase === 'select' && (
            <div className="w-full max-w-md bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-5">
              <AircraftSelect aircraft={aircraft} onSelect={handleSelect} loading={loadingAircraft} />
            </div>
          )}

          {/* Final score screen */}
          {phase === 'finished' && selected && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="w-full max-w-md bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-8 text-center"
            >
              <p className="text-5xl mb-3">🎖️</p>
              <p className="text-2xl font-extrabold text-white mb-1">All Levels Complete</p>
              <p className="text-sm text-slate-400 mb-6">You cleared all {MAX_LEVEL} levels.</p>

              <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-5 mb-6">
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">Final Score</p>
                <div className="flex justify-center gap-8">
                  <div>
                    <p className="text-3xl font-mono font-bold text-brand-300">{totalRotations}</p>
                    <p className="text-xs text-slate-500 mt-1">rotations</p>
                  </div>
                  <div className="w-px bg-[#1a3a5c]" />
                  <div>
                    <p className="text-3xl font-mono font-bold text-brand-300">{totalTime.toFixed(1)}s</p>
                    <p className="text-xs text-slate-500 mt-1">total time</p>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 justify-center">
                <button
                  onClick={handlePlayAgain}
                  className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-lg transition-colors"
                >
                  Play Again
                </button>
                <button
                  onClick={handleMenu}
                  className="px-5 py-2.5 bg-[#1a3a5c] hover:bg-[#254a6e] text-slate-300 text-sm font-bold rounded-lg transition-colors"
                >
                  Change Aircraft
                </button>
                <Link
                  to="/cbat"
                  className="px-5 py-2.5 bg-[#1a3a5c] hover:bg-[#254a6e] text-slate-300 text-sm font-bold rounded-lg transition-colors no-underline"
                >
                  Back to CBAT
                </Link>
              </div>
            </motion.div>
          )}

          {/* Game board */}
          {(phase === 'playing' || phase === 'over') && selected && (
            <div className="w-full max-w-md">
              <HUD collected={collected} rotations={rotations} elapsed={elapsed} level={level} />

              {/* Grid container */}
              <div className="relative bg-[#060e1a] border-2 border-[#1a3a5c] rounded-xl overflow-hidden shadow-[0_0_30px_rgba(91,170,255,0.08)]">
                {/* Radar sweep overlay */}
                <div className="absolute inset-0 pointer-events-none z-10 opacity-[0.03]"
                  style={{
                    background: 'conic-gradient(from 0deg, transparent 0deg, rgba(91,170,255,0.5) 30deg, transparent 60deg)',
                    animation: 'radar-sweep 4s linear infinite',
                  }}
                />

                {/* Grid */}
                <div
                  className="grid relative z-20"
                  style={{
                    gridTemplateColumns: `repeat(${GRID}, 1fr)`,
                    aspectRatio: '1',
                  }}
                >
                  {Array.from({ length: GRID * GRID }, (_, i) => {
                    const r = Math.floor(i / GRID)
                    const c = i % GRID
                    const isPlane = r === plane.r && c === plane.c
                    const isPkg = r === pkg.r && c === pkg.c

                    return (
                      <div
                        key={i}
                        className="relative border border-[#0f2440]/60"
                        style={{ aspectRatio: '1' }}
                      >
                        {/* Care package */}
                        {isPkg && (
                          <motion.div
                            key={`pkg-${pkg.r}-${pkg.c}`}
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            className="absolute inset-0 flex items-center justify-center z-20"
                          >
                            <span className="text-base drop-shadow-[0_0_8px_rgba(255,200,50,0.6)]">📦</span>
                          </motion.div>
                        )}

                        {/* Plane */}
                        {isPlane && (
                          <div className="absolute inset-0 flex items-center justify-center z-20">
                            <img
                              src={selected.cutoutUrl}
                              alt={selected.title}
                              className="w-[80%] h-[80%] object-contain drop-shadow-[0_0_6px_rgba(91,170,255,0.6)]"
                              style={{
                                transform: `rotate(${DIR_DEG[plane.dir]}deg)`,
                                transition: 'transform 0.15s ease-out',
                              }}
                            />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Grid crosshair lines */}
                <div className="absolute inset-0 pointer-events-none z-10">
                  <div className="absolute top-1/2 left-0 right-0 h-px bg-[#1a3a5c]/40" />
                  <div className="absolute left-1/2 top-0 bottom-0 w-px bg-[#1a3a5c]/40" />
                </div>

                {/* Game over overlay */}
                <AnimatePresence>
                  {phase === 'over' && (
                    <GameOverOverlay
                      won={won}
                      score={{ rotations, time: elapsed.toFixed(1) }}
                      level={level}
                      maxLevel={MAX_LEVEL}
                      onRestart={handleRestart}
                      onMenu={handleMenu}
                    />
                  )}
                </AnimatePresence>
              </div>

              {/* Mobile touch controls */}
              <div className="flex gap-4 justify-center mt-4">
                <button
                  onPointerDown={() => handleRotate('left')}
                  className="w-16 h-16 rounded-xl bg-[#0a1628] border-2 border-[#1a3a5c] active:border-brand-400 active:bg-[#0f2240] transition-colors flex items-center justify-center text-2xl text-slate-400 active:text-brand-300 select-none"
                  aria-label="Rotate left"
                >
                  &#8592;
                </button>
                <button
                  onPointerDown={() => handleRotate('right')}
                  className="w-16 h-16 rounded-xl bg-[#0a1628] border-2 border-[#1a3a5c] active:border-brand-400 active:bg-[#0f2240] transition-colors flex items-center justify-center text-2xl text-slate-400 active:text-brand-300 select-none"
                  aria-label="Rotate right"
                >
                  &#8594;
                </button>
              </div>

              {/* Instructions */}
              <p className="text-center text-[10px] text-slate-500 mt-3">
                Use <span className="font-mono text-slate-400">&larr;</span> <span className="font-mono text-slate-400">&rarr;</span> arrow keys or tap the buttons to rotate
              </p>
            </div>
          )}
        </div>
      )}

      {/* Radar sweep keyframe — injected once */}
      <style>{`
        @keyframes radar-sweep {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
