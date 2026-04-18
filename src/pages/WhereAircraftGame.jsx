/**
 * Where's That Aircraft — two-round identification game.
 *
 * Route: /wheres-that-aircraft/:aircraftBriefId
 *
 * Round 1 — identify aircraft from image (5 name options)
 * Round 1 Complete — interstitial: confirms ID, awards R1 coins, previews Round 2
 * Round 2 — select home base(s) on a map (react-leaflet)
 */
import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { useAppTutorial } from '../context/AppTutorialContext'
import TutorialModal from '../components/tutorial/TutorialModal'
import { playSound } from '../utils/sound'
import RafBasesMap from '../components/RafBasesMap'
import SEO from '../components/SEO'

// ── Phase constants ────────────────────────────────────────────────────────
const PHASE_LOADING     = 'loading'
const PHASE_ROUND1      = 'round1'
const PHASE_R1_COMPLETE = 'r1complete'
const PHASE_FAIL1       = 'fail1'
const PHASE_ROUND2      = 'round2'
const PHASE_RESULT      = 'result'

const ACTIVE_PHASES = new Set([PHASE_ROUND1, PHASE_R1_COMPLETE, PHASE_ROUND2])

function formatTime(s) {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

// ── Round 1 component ─────────────────────────────────────────────────────
function Round1({ data, onCorrect, onWrong }) {
  const [selected, setSelected]   = useState(null)
  const [answered, setAnswered]   = useState(false)
  const [startTime] = useState(() => Date.now())

  function handleSelect(opt) {
    if (answered) return
    setSelected(opt._id)
    setAnswered(true)

    if (opt.isCorrect) {
      playSound('quiz_answer_correct')
      const elapsed = Math.round((Date.now() - startTime) / 1000)
      setTimeout(() => onCorrect(elapsed), 900)
    } else {
      playSound('quiz_answer_incorrect')
      setTimeout(() => onWrong(), 1000)
    }
  }

  return (
    <div>
      <p className="text-xs font-bold tracking-[0.2em] text-brand-600 uppercase mb-1">Round 1 of 2</p>
      <h2 className="text-xl font-extrabold text-slate-900 mb-1">Identify the Aircraft</h2>
      <p className="text-sm text-slate-500 mb-5">Select the correct aircraft name from the options below.</p>

      {data.mediaUrl && (
        <div className="rounded-2xl overflow-hidden mb-5 aspect-video bg-slate-100 border border-slate-200">
          <img src={data.mediaUrl} alt="Aircraft" className="w-full h-full object-cover" />
        </div>
      )}

      <div className="space-y-3">
        {data.options.map(opt => {
          const isThisSelected = String(opt._id) === String(selected)
          let state = 'idle'
          if (answered) {
            if (opt.isCorrect)       state = 'correct'
            else if (isThisSelected) state = 'wrong'
          }

          return (
            <motion.button
              key={String(opt._id)}
              onClick={() => handleSelect(opt)}
              disabled={answered}
              whileTap={!answered ? { scale: 0.98 } : {}}
              animate={
                state === 'correct' ? { x: [0, -4, 4, -2, 2, 0] } :
                state === 'wrong'   ? { x: [0, -6, 6, -4, 4, 0] } :
                {}
              }
              transition={{ duration: 0.35 }}
              className={`w-full text-left p-4 rounded-2xl border-2 font-semibold text-sm transition-all
                ${state === 'correct' ? 'bg-emerald-50 border-emerald-500 text-emerald-800' :
                  state === 'wrong'   ? 'bg-red-50 border-red-400 text-red-700' :
                  answered            ? 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed' :
                                        'bg-surface border-slate-200 text-slate-800 hover:border-brand-400 hover:bg-brand-50 cursor-pointer'
                }`}
            >
              <div className="flex items-center gap-3">
                <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-xs shrink-0
                  ${state === 'correct' ? 'border-emerald-500 bg-emerald-500 text-white' :
                    state === 'wrong'   ? 'border-red-400 bg-red-400 text-white' :
                    answered            ? 'border-slate-200' :
                                          'border-slate-300'
                  }`}>
                  {state === 'correct' ? '✓' : state === 'wrong' ? '✗' : ''}
                </span>
                <span>{opt.title}</span>
              </div>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}

// ── Round 1 Complete interstitial ─────────────────────────────────────────
function Round1Complete({ aircraftTitle, round1Coins, correctBaseCount, onContinue }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="text-center py-6"
    >
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', damping: 12, delay: 0.05 }}
        className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center text-3xl mx-auto mb-4"
      >
        ✓
      </motion.div>

      <p className="text-xs font-bold tracking-[0.2em] text-emerald-600 uppercase mb-1">Round 1 Complete</p>
      <h2 className="text-2xl font-extrabold text-slate-900 mb-1">Aircraft Identified!</h2>
      <p className="text-sm text-slate-500 mb-5">
        You correctly identified <span className="font-semibold text-slate-700">{aircraftTitle}</span>
      </p>

      {round1Coins > 0 && (
        <div className="inline-flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-2.5 mb-6">
          <span className="text-amber-500 text-lg">✦</span>
          <span className="text-sm font-bold text-amber-800">+{round1Coins} Airstars earned</span>
        </div>
      )}

      <div className="bg-brand-50 border border-brand-200 rounded-2xl p-4 mb-8 text-left max-w-xs mx-auto">
        <p className="text-sm font-bold text-brand-800 mb-1">🗺️ Round 2 — Find the Base</p>
        <p className="text-xs text-brand-700 leading-relaxed">
          Now locate where this aircraft is based. Select its RAF home base{correctBaseCount > 1 ? 's' : ''} on the map to complete the mission.
        </p>
      </div>

      <button
        onClick={onContinue}
        className="w-full max-w-xs py-4 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-2xl text-base transition-colors mx-auto block"
      >
        Enter Round 2 →
      </button>
    </motion.div>
  )
}

// ── Fail Round 1 screen ───────────────────────────────────────────────────
function FailRound1({ onBack }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="text-center py-8"
    >
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', damping: 14, delay: 0.1 }}
        className="text-6xl mb-4"
      >
        🛬
      </motion.div>
      <p className="text-xs font-bold tracking-[0.2em] text-red-500 uppercase mb-2">Round 1 Failed</p>
      <h2 className="text-2xl font-extrabold text-slate-900 mb-3">Not quite, agent.</h2>
      <p className="text-slate-500 mb-2 max-w-xs mx-auto">
        That wasn't the right aircraft — keep reading those briefs and you'll get it next time!
      </p>
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-8 max-w-xs mx-auto text-left">
        <p className="text-sm font-bold text-amber-800 mb-1">🗺️ There was a Round 2!</p>
        <p className="text-xs text-amber-700 leading-relaxed">
          Identify the aircraft correctly to unlock the map round — where you mark its RAF home base.
          Nail both rounds for the full mission bonus!
        </p>
      </div>
      <button
        onClick={onBack}
        className="w-full max-w-xs py-4 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-2xl text-base transition-colors mx-auto block"
      >
        Return to Brief
      </button>
    </motion.div>
  )
}

// ── Round 2 map component ─────────────────────────────────────────────────
function Round2({ data, aircraftTitle, onSubmit }) {
  const [selected, setSelected]   = useState(new Set())
  const [submitted, setSubmitted] = useState(false)
  const [startTime] = useState(() => Date.now())

  function toggleBase(base) {
    if (submitted) return
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(String(base._id))) next.delete(String(base._id))
      else next.add(String(base._id))
      return next
    })
  }

  function handleSubmit() {
    if (submitted) return
    setSubmitted(true)
    const elapsed = Math.round((Date.now() - startTime) / 1000)

    const correctIds = new Set(data.correctBaseIds.map(id => String(id)))
    const isCorrect  = (
      selected.size === correctIds.size &&
      [...selected].every(id => correctIds.has(id))
    )

    playSound(isCorrect ? 'where_aircraft_win' : 'where_aircraft_lose')
    onSubmit({ correct: isCorrect, selectedIds: [...selected], elapsed })
  }

  return (
    <div>
      <p className="text-xs font-bold tracking-[0.2em] text-brand-600 uppercase mb-1">Round 2 of 2</p>
      <h2 className="text-xl font-extrabold text-slate-900 mb-1">Find the Home Base</h2>
      <p className="text-sm text-slate-500 mb-4">
        Select the RAF base(s) where <span className="font-semibold text-slate-700">{aircraftTitle}</span> is based.
        {data.correctBaseCount > 1 && (
          <span className="text-brand-600 font-semibold"> ({data.correctBaseCount} bases)</span>
        )}
      </p>

      <div className="mb-4">
        <RafBasesMap
          mode="game"
          height={340}
          bases={data.bases}
          selected={selected}
          submitted={submitted}
          onToggle={toggleBase}
        />
      </div>

      <div className="mb-4 min-h-[28px]">
        {selected.size > 0 ? (
          <div className="flex flex-wrap gap-2">
            {[...selected].map(id => {
              const b = data.bases.find(x => String(x._id) === id)
              return (
                <span key={id} className="text-xs font-semibold bg-amber-100 text-amber-800 px-2 py-1 rounded-full border border-amber-200">
                  {b?.title ?? id}
                </span>
              )
            })}
          </div>
        ) : (
          <p className="text-xs text-slate-400">Tap a base on the map to select it.</p>
        )}
      </div>

      {!submitted ? (
        <button
          onClick={handleSubmit}
          disabled={selected.size === 0}
          className={`w-full py-4 font-bold rounded-2xl text-base transition-colors
            ${selected.size === 0
              ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
              : 'bg-brand-600 hover:bg-brand-700 text-white'
            }`}
        >
          Confirm Selection →
        </button>
      ) : (
        <div className="text-center py-2">
          <div className="w-5 h-5 border-2 border-brand-400 border-t-brand-700 rounded-full animate-spin mx-auto" />
        </div>
      )}
    </div>
  )
}

// ── Results screen ─────────────────────────────────────────────────────────
function ResultScreen({ result, aircraftTitle, bases, selectedBaseIds, correctBaseIds, onDone }) {
  const { won, airstarsEarned, round1Correct, round2Correct } = result

  const emoji   = won ? '🏆' : round1Correct ? '🗺️' : '✈️'
  const heading = won
    ? 'Mission Complete!'
    : round1Correct
    ? 'Round 2 Failed'
    : 'Mission Failed'

  const subtext = won
    ? 'Outstanding work — both rounds cleared. Full mission bonus earned!'
    : round1Correct
    ? 'You identified the aircraft, but the base selection was incorrect. Keep reading!'
    : 'Better luck next time, agent. Read more aircraft and bases briefs to unlock this mission again.'

  const selectedSet = new Set((selectedBaseIds ?? []).map(String))
  const correctSet  = new Set((correctBaseIds  ?? []).map(String))

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="text-center py-8"
    >
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', damping: 14, delay: 0.1 }}
        className="text-6xl mb-4"
      >
        {emoji}
      </motion.div>
      <h2 className="text-2xl font-extrabold text-slate-900 mb-2">{heading}</h2>
      <p className="text-slate-500 mb-6 max-w-xs mx-auto">{subtext}</p>

      <div className="bg-surface rounded-2xl border border-slate-200 p-4 mb-4 card-shadow text-left max-w-xs mx-auto space-y-2">
        <RoundRow label="Round 1 — Aircraft ID" correct={round1Correct} />
        {round1Correct && <RoundRow label="Round 2 — Base Location" correct={round2Correct} />}
        {airstarsEarned > 0 && (
          <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
            <span className="text-sm font-bold text-slate-700">Airstars earned</span>
            <span className="text-sm font-black text-amber-600">+{airstarsEarned} ✦</span>
          </div>
        )}
      </div>

      {/* Base selection breakdown */}
      {round1Correct && (bases ?? []).some(b => correctSet.has(String(b._id))) && (
        <div className="bg-surface rounded-2xl border border-slate-200 p-4 mb-6 card-shadow text-left max-w-xs mx-auto">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Base Selection</p>
          <div className="space-y-2">
            {(bases ?? []).filter(b => correctSet.has(String(b._id))).map(b => {
              const wasSelected = selectedSet.has(String(b._id))
              return (
                <div key={String(b._id)} className="flex items-center justify-between gap-2">
                  <span className="text-sm text-slate-700">{b.title}</span>
                  <span className={`text-xs font-bold shrink-0 ${wasSelected ? 'text-emerald-600' : 'text-slate-400'}`}>
                    {wasSelected ? '✓ Selected' : '— Missed'}
                  </span>
                </div>
              )
            })}
            {(bases ?? []).filter(b => selectedSet.has(String(b._id)) && !correctSet.has(String(b._id))).map(b => (
              <div key={String(b._id)} className="flex items-center justify-between gap-2">
                <span className="text-sm text-slate-700">{b.title}</span>
                <span className="text-xs font-bold text-red-500 shrink-0">✗ Incorrect</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={onDone}
        className="w-full max-w-xs py-4 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-2xl text-base transition-colors mx-auto block"
      >
        Return to Brief
      </button>
    </motion.div>
  )
}

function RoundRow({ label, correct }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-slate-600">{label}</span>
      <span className={`text-sm font-bold ${correct ? 'text-emerald-600' : 'text-red-500'}`}>
        {correct ? '✓ Correct' : '✗ Incorrect'}
      </span>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────
export default function WhereAircraftGame() {
  const { aircraftBriefId } = useParams()
  const navigate = useNavigate()
  const { user, API, apiFetch, awardAirstars, refreshUser } = useAuth()
  const { start } = useAppTutorial()
  const gameSessionId  = useRef(crypto.randomUUID())
  const startTimeRef   = useRef(Date.now())
  const abandonedRef   = useRef(false)  // true once any submit (complete or abandon) has fired

  const [phase, setPhase]                     = useState(PHASE_LOADING)
  const [round1Data, setRound1Data]           = useState(null)
  const [round2Data, setRound2Data]           = useState(null)
  const [result, setResult]                   = useState(null)
  const [error, setError]                     = useState(null)
  const [round1Coins, setRound1Coins]         = useState(0)
  const [selectedBaseIds, setSelectedBaseIds] = useState([])
  const [elapsed, setElapsed]                 = useState(0)

  const round1CorrectRef = useRef(false)
  const round1ElapsedRef = useRef(0)

  // ── Timer ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ACTIVE_PHASES.has(phase)) return
    const id = setInterval(() => {
      setElapsed(s => s + 1)
    }, 1000)
    return () => clearInterval(id)
  }, [phase])

  // ── Tutorial ────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => start('wheres_aircraft'), 600)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch round 1 on mount ───────────────────────────────────────────────
  useEffect(() => {
    if (!user) { navigate('/login'); return }

    apiFetch(`${API}/api/games/wheres-aircraft/round1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aircraftBriefId, gameSessionId: gameSessionId.current }),
    })
      .then(r => r.json())
      .then(data => {
        if (!data?.data) { setError('Failed to load game.'); return }
        setRound1Data(data.data)
        startTimeRef.current = Date.now()
        setPhase(PHASE_ROUND1)
      })
      .catch(() => setError('Failed to load game.'))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Abandon on unmount (covers back-navigation / SPA route changes) ──────
  useEffect(() => {
    return () => {
      if (abandonedRef.current) return
      abandonedRef.current = true
      // keepalive ensures the request survives the component unmounting
      apiFetch(`${API}/api/games/wheres-aircraft/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          aircraftBriefId,
          gameSessionId:    gameSessionId.current,
          round1Correct:    round1CorrectRef.current,
          round2Attempted:  false,
          round2Correct:    false,
          selectedBaseIds:  [],
          correctBaseIds:   [],
          timeTakenSeconds: Math.round((Date.now() - startTimeRef.current) / 1000),
          status:           round1CorrectRef.current ? 'round1_only' : 'abandoned',
        }),
      }).catch(() => {})
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Abandon on page refresh / tab close ────────────────────────────────
  useEffect(() => {
    function handleUnload() {
      if (abandonedRef.current) return
      abandonedRef.current = true
      navigator.sendBeacon(
        `${API}/api/games/wheres-aircraft/submit`,
        new Blob([JSON.stringify({
          aircraftBriefId,
          gameSessionId:    gameSessionId.current,
          round1Correct:    round1CorrectRef.current,
          round2Attempted:  false,
          round2Correct:    false,
          selectedBaseIds:  [],
          correctBaseIds:   [],
          timeTakenSeconds: Math.round((Date.now() - startTimeRef.current) / 1000),
          status:           round1CorrectRef.current ? 'round1_only' : 'abandoned',
        })], { type: 'application/json' }),
      )
    }
    window.addEventListener('beforeunload', handleUnload)
    return () => window.removeEventListener('beforeunload', handleUnload)
  }, [API]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleRound1Correct = useCallback(async (elapsed) => {
    round1CorrectRef.current = true
    round1ElapsedRef.current = elapsed
    const preRound1Total = user?.totalAirstars ?? 0
    let awarded = false
    try {
      const r    = await apiFetch(`${API}/api/games/wheres-aircraft/round2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aircraftBriefId, gameSessionId: gameSessionId.current }),
      })
      const data = await r.json()
      if (!data?.data) { setError('Failed to load round 2.'); return }
      setRound2Data(data.data)
      const coins = data.data.round1Airstars ?? 0
      setRound1Coins(coins)
      if (coins > 0 && awardAirstars) {
        awardAirstars(coins, 'Round 1 — Aircraft ID', {
          cycleAfter:    data.data.cycleAirstars ?? undefined,
          totalAfter:    data.data.totalAirstars ?? undefined,
          rankPromotion: data.data.rankPromotion ?? null,
        })
        awarded = true
      }
      setPhase(PHASE_R1_COMPLETE)
    } catch {
      setError('Failed to load round 2.')
    }

    // Fallback: if the client didn't notify (malformed response, request failure),
    // resync the user and fire the airstar notification based on the delta.
    if (!awarded && refreshUser) {
      try {
        const fresh = await refreshUser()
        const delta = (fresh?.totalAirstars ?? 0) - preRound1Total
        if (delta > 0 && awardAirstars) {
          awardAirstars(delta, 'Round 1 — Aircraft ID', {
            totalAfter: fresh.totalAirstars,
            cycleAfter: fresh.cycleAirstars,
          })
          setRound1Coins(delta)
        }
      } catch { /* swallow — best-effort resync */ }
    }
  }, [aircraftBriefId, API, awardAirstars, apiFetch, refreshUser, user?.totalAirstars])

  const handleRound1Wrong = useCallback(() => {
    round1CorrectRef.current = false
    submitGame({ round1Correct: false, round2Attempted: false, round2Correct: false, selectedBaseIds: [], elapsed: 0 })
    setPhase(PHASE_FAIL1)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRound2Submit = useCallback(({ correct, selectedIds, elapsed }) => {
    setSelectedBaseIds(selectedIds)
    submitGame({
      round1Correct:        true,
      round2Attempted:      true,
      round2Correct:        correct,
      selectedBaseIds:      selectedIds,
      correctBaseIds:       round2Data?.correctBaseIds ?? [],
      elapsed:              round1ElapsedRef.current + elapsed,
      round1AlreadyAwarded: true,
    })
  }, [round2Data]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleQuit = useCallback(async () => {
    if (!abandonedRef.current) {
      abandonedRef.current = true
      await apiFetch(`${API}/api/games/wheres-aircraft/submit`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aircraftBriefId,
          gameSessionId:    gameSessionId.current,
          round1Correct:    round1CorrectRef.current,
          round2Attempted:  false,
          round2Correct:    false,
          selectedBaseIds:  [],
          correctBaseIds:   [],
          timeTakenSeconds: Math.round((Date.now() - startTimeRef.current) / 1000),
          status:           round1CorrectRef.current ? 'round1_only' : 'abandoned',
        }),
      }).catch(() => {})
    }
    navigate(-1)
  }, [API, aircraftBriefId, navigate])

  async function submitGame({ round1Correct, round2Attempted, round2Correct, selectedBaseIds, correctBaseIds, elapsed, round1AlreadyAwarded }) {
    abandonedRef.current = true // mark submitted so unmount cleanup doesn't double-fire
    const totalElapsed = Math.round((Date.now() - startTimeRef.current) / 1000)
    const preSubmitTotal = user?.totalAirstars ?? 0
    let awarded = false
    let responseOk = false
    let earnedForResult = 0
    let wonForResult = false

    try {
      const res = await apiFetch(`${API}/api/games/wheres-aircraft/submit`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aircraftBriefId,
          gameSessionId:        gameSessionId.current,
          round1Correct,
          round2Attempted,
          round2Correct,
          selectedBaseIds:      selectedBaseIds ?? [],
          correctBaseIds:       correctBaseIds  ?? [],
          timeTakenSeconds:     elapsed ?? totalElapsed,
          status:               'completed',
          round1AlreadyAwarded: !!round1AlreadyAwarded,
        }),
      })
      const data = await res.json()
      if (data?.data) {
        responseOk = true
        const { won, airstarsEarned, rankPromotion, cycleAirstars, totalAirstars } = data.data
        wonForResult = won
        earnedForResult = airstarsEarned ?? 0
        if (airstarsEarned > 0 && awardAirstars) {
          awardAirstars(airstarsEarned, "Where's That Aircraft", {
            cycleAfter:    cycleAirstars ?? undefined,
            totalAfter:    totalAirstars ?? undefined,
            rankPromotion: rankPromotion ?? null,
          })
          awarded = true
        }
      }
    } catch (err) {
      console.error("[wheres-aircraft submit] failed:", err)
    }

    // Fallback: if the client didn't notify (malformed response, request failure),
    // resync the user and fire the airstar notification based on the delta.
    if (!awarded && refreshUser) {
      try {
        const fresh = await refreshUser()
        const delta = (fresh?.totalAirstars ?? 0) - preSubmitTotal
        if (delta > 0 && awardAirstars) {
          awardAirstars(delta, "Where's That Aircraft", {
            totalAfter: fresh.totalAirstars,
            cycleAfter: fresh.cycleAirstars,
          })
          earnedForResult = delta
          wonForResult = true
          responseOk = true
        }
      } catch { /* swallow — best-effort resync */ }
    }

    if (responseOk) {
      setResult({ won: wonForResult, airstarsEarned: earnedForResult, round1Correct, round2Correct: round2Correct ?? false })
      if (round2Attempted) setPhase(PHASE_RESULT)
    }
  }

  function handleDone() {
    navigate(-1)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="text-center py-16 text-slate-400">
        <p className="text-4xl mb-3">⚠️</p>
        <p className="mb-4">{error}</p>
        <button onClick={handleDone} className="text-brand-600 font-semibold">← Go back</button>
      </div>
    )
  }

  const showActiveHeader = ACTIVE_PHASES.has(phase)

  return (
    <>
      <SEO title="Where's That Aircraft?" description="Identify RAF aircraft locations on the map." noIndex={true} />
      <TutorialModal />

      {/* Header — quit button + timer during active play; back button otherwise */}
      {showActiveHeader ? (
        <div className="flex items-center justify-between mb-5">
          <button
            onClick={handleQuit}
            className="text-sm text-slate-500 hover:text-slate-700 transition-colors"
          >
            ✕ Quit
          </button>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-brand-100 flex items-center justify-center text-base">✈️</div>
              <span className="text-sm font-extrabold text-slate-900 hidden sm:block">Where's That Aircraft?</span>
            </div>
          </div>
          <span className="text-xs font-bold font-mono text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
            {formatTime(elapsed)}
          </span>
        </div>
      ) : (
        <>
          <button
            onClick={handleDone}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-5 transition-colors"
          >
            ← Back
          </button>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-2xl bg-brand-100 flex items-center justify-center text-xl">✈️</div>
            <div>
              <h1 className="text-xl font-extrabold text-slate-900">Where's That Aircraft?</h1>
              <p className="text-xs text-slate-400">Two-round identification mission</p>
            </div>
          </div>
        </>
      )}

      <AnimatePresence mode="wait">
        {phase === PHASE_LOADING && (
          <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="space-y-4 animate-pulse">
              <div className="h-6 bg-slate-200 rounded-xl w-1/2" />
              <div className="h-48 bg-slate-100 rounded-2xl" />
              <div className="h-12 bg-slate-100 rounded-xl" />
              <div className="h-12 bg-slate-100 rounded-xl" />
            </div>
          </motion.div>
        )}

        {phase === PHASE_ROUND1 && round1Data && (
          <motion.div
            key="round1"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.25 }}
          >
            <Round1
              data={round1Data}
              onCorrect={handleRound1Correct}
              onWrong={handleRound1Wrong}
            />
          </motion.div>
        )}

        {phase === PHASE_R1_COMPLETE && round1Data && round2Data && (
          <motion.div
            key="r1complete"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.25 }}
          >
            <Round1Complete
              aircraftTitle={round1Data.options.find(o => o.isCorrect)?.title ?? ''}
              round1Coins={round1Coins}
              correctBaseCount={round2Data?.correctBaseCount ?? 1}
              onContinue={() => setPhase(PHASE_ROUND2)}
            />
          </motion.div>
        )}

        {phase === PHASE_FAIL1 && (
          <motion.div
            key="fail1"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
          >
            <FailRound1 onBack={handleDone} />
          </motion.div>
        )}

        {phase === PHASE_ROUND2 && round2Data && (
          <motion.div
            key="round2"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.25 }}
          >
            <Round2
              data={round2Data}
              aircraftTitle={round2Data.aircraftTitle}
              onSubmit={handleRound2Submit}
            />
          </motion.div>
        )}

        {phase === PHASE_RESULT && result && (
          <motion.div
            key="result"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
          >
            <ResultScreen
              result={result}
              aircraftTitle={round1Data?.options?.find(o => o.isCorrect)?.title ?? ''}
              bases={round2Data?.bases ?? []}
              selectedBaseIds={selectedBaseIds}
              correctBaseIds={round2Data?.correctBaseIds ?? []}
              onDone={handleDone}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
