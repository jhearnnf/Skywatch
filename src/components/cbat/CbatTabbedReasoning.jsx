// Shared game shell for the two "tabs then questions" CBAT tests — the System
// Logic Test and the Verbal Logic Test.
//
// They share this because the guide corpus says they ARE the same test: "[VLT]
// is structurally the System Logic Test with prose instead of figures, so
// prepare for them together." One difference in the content, none in the
// mechanic — read the tabs, then answer questions that send you back into them.
//
// What each game supplies is its content and its copy. What lives here is the
// phase machine (intro → launching → reading → playing → results), the tab
// strip, the per-question clock, the difficulty chrome and the submit path.
//
// The tabs STAY OPEN during the questions on purpose. The corpus is explicit
// that this is "a search and apply task, not a memory task — nobody expects you
// to have learned the content", and hiding them would turn both games into
// something the real tests are not.
//
// THE PANE RULE. Both tests limit how much of the index you can see at once, and
// both corpus entries say so independently: the System Logic Test has "a
// dual-pane display area on the left, so two tabs are readable at once — opening
// a third closes the oldest automatically", and the Verbal Logic Test has "only
// two pages readable at a time". This shell showed exactly one tab until the
// guide was read back against it, which quietly removed the constraint that
// makes both tests hard. It is now the `panes` prop, and the closes-the-oldest
// behaviour is the whole point of it: which tab you give up is a decision, and
// making it badly costs you the trip back.

import { useState, useCallback, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'
import { submitCbatResult } from '../../lib/cbatOutbox'
import { useCbatTracking } from '../../utils/cbat/useCbatTracking'
import { useGameChrome } from '../../context/GameChromeContext'
import { useCbatDemo } from '../../utils/cbat/demoMode'
import { initialDifficulty } from '../../utils/cbat/difficultyParam'
import SEO from '../SEO'
import CbatQuitButton from '../CbatQuitButton'
import CbatGameOver from '../CbatGameOver'
import { CbatModeRow, ModeMarker } from '../CbatModeSelector'
import CbatPersonalBest from '../CbatPersonalBest'
import { useCbatPersonalBest } from '../../hooks/useCbatPersonalBest'
import { useGameBodyClass } from '../../hooks/useGameBodyClass'

// ── Tab strip ────────────────────────────────────────────────────────────────
// Top-level so it is never re-created between renders — a component defined
// inside another's render remounts its whole subtree every time, which here
// would drop the scroll position of the open tab on every clock tick.
//
// The index is NUMBERED — "a numbered index of 15 tabs down the right" — because
// with fifteen of them the number is how you remember where something lives. The
// corpus's one piece of strategy for this test is to spend the reading time
// learning which tab holds which kind of information, and a number is what that
// knowledge attaches to.
function TabStrip({ tabs, openIds, onSelect }) {
  return (
    <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1" data-testid="tab-strip">
      {tabs.map((tab, i) => {
        const open = openIds.includes(tab.id)
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSelect(tab.id)}
            aria-pressed={open}
            className={`shrink-0 px-3 py-1.5 rounded-t-lg border-b-2 text-[11px] font-bold whitespace-nowrap transition-colors cursor-pointer ${
              open
                ? 'bg-[#0f2240] border-brand-600 text-[#ddeaf8]'
                : 'bg-[#060e1a] border-transparent text-slate-600 hover:text-[#ddeaf8]'
            }`}
          >
            <span className={`mr-1.5 ${open ? 'text-brand-600' : 'text-slate-700'}`}>{i + 1}</span>
            {tab.title}
          </button>
        )
      })}
    </div>
  )
}

function ResultsScreen({ answers, totalTime, totalQuestions, grade, gameName }) {
  const correct = answers.filter(a => a.correct).length
  const pct = Math.round((correct / totalQuestions) * 100)
  const emoji = grade === 'Outstanding' ? '🎖️' : grade === 'Good' ? '📗' : grade === 'Needs Work' ? '🔧' : '💥'
  const color = grade === 'Outstanding' ? 'text-green-400' : grade === 'Good' ? 'text-brand-600' : grade === 'Needs Work' ? 'text-amber-400' : 'text-red-400'

  return (
    <div className="w-full bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-8 text-center">
      <p className="text-5xl mb-3">{emoji}</p>
      <p className={`text-2xl font-extrabold mb-1 ${color}`}>{grade}</p>
      <p className="text-sm text-slate-400 mb-6">{gameName} Complete</p>

      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-5 mb-4">
        <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">Overall Score</p>
        <div className="flex justify-center gap-8 items-end">
          <div>
            <p className="text-4xl font-mono font-bold text-brand-600 mb-1">{correct}/{totalQuestions}</p>
            <p className="text-sm text-slate-400">{pct}% correct</p>
          </div>
          <div className="w-px h-12 bg-[#1a3a5c]" />
          <div>
            <p className="text-4xl font-mono font-bold text-brand-600 mb-1">{totalTime.toFixed(1)}s</p>
            <p className="text-sm text-slate-400">total time</p>
          </div>
        </div>
      </div>

      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 max-h-80 overflow-y-auto text-left">
        <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-2 sticky top-0 bg-[#060e1a]">Answer Review</p>
        <div className="space-y-1.5">
          {answers.map((a, i) => (
            <div key={i} className="text-xs px-2 py-1 rounded">
              <div className={`flex items-start gap-2 ${a.correct ? 'text-green-400' : 'text-red-400'}`}>
                <span className="shrink-0">{a.correct ? '✓' : '✗'}</span>
                <span className="text-slate-500 leading-snug">{a.prompt}</span>
              </div>
              {!a.correct && (
                <p className="pl-5 text-[11px] text-slate-500 mt-0.5">
                  {a.picked === null ? 'Ran out of time. ' : `You picked ${a.picked}. `}
                  Answer: <span className="text-green-400">{a.answer}</span>
                  {a.trap && a.picked === a.trap && (
                    <span className="text-amber-400"> That one is stated plainly in the text, which is what makes it the trap.</span>
                  )}
                </p>
              )}
              {!a.correct && a.steps?.length > 0 && (
                <div className="pl-5 mt-1.5">
                  <Walkthrough steps={a.steps} showQuotes />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Post-answer walkthrough ──────────────────────────────────────────────────
// Getting one wrong is the only moment a player is guaranteed to want the
// reasoning, so that is where the derivation goes rather than burying it in a
// guide nobody opens. A question's authored `evidence` drives three things: the
// tabs it came from reopen, the exact sentences inside them are marked, and the
// steps that join them are listed underneath.
//
// All of it is optional. The System Logic Test builds its content numerically
// and authors no evidence, so every branch here falls through and that game is
// exactly as it was.

// The tabs a walkthrough wants on screen, in the order it names them. Capped by
// the caller at `panes`, though in practice a question needs two tabs and shows
// two, which is the pane rule doing its job rather than a coincidence.
function evidenceTabIds(question) {
  const ids = []
  for (const step of question?.evidence || []) {
    if (step.tab && !ids.includes(step.tab)) ids.push(step.tab)
  }
  const trapTab = question?.trapEvidence?.tab
  if (trapTab && !ids.includes(trapTab)) ids.push(trapTab)
  return ids
}

// tabId → the spans to mark inside it. Answer quotes and the trap quote are
// tagged differently so the tab renderer can colour them apart; resolving any
// overlap between the two is the renderer's job, not this one's.
function evidenceHighlights(question) {
  const map = {}
  const push = (tab, quote, kind) => {
    if (!tab || !quote) return
    if (!map[tab]) map[tab] = []
    map[tab].push({ quote, kind })
  }
  for (const step of question?.evidence || []) push(step.tab, step.quote, 'answer')
  push(question?.trapEvidence?.tab, question?.trapEvidence?.quote, 'trap')
  return map
}

// Resolves each step against the run's own tab list, so a step can name the tab
// by the number the player sees in the strip. Done at answer time rather than at
// render time because the results screen outlives the run's tabs.
function evidenceSteps(question, tabs) {
  const labelById = new Map((tabs || []).map((t, i) => [t.id, `${i + 1} · ${t.title}`]))
  return (question?.evidence || []).map(step => ({
    why: step.why,
    quote: step.quote || null,
    tabLabel: step.tab ? labelById.get(step.tab) || null : null,
  }))
}

// `showQuotes` is for the results screen, where the tabs are gone and the
// sentence has to travel with the step. During play it stays off: the tab right
// underneath is already showing that sentence highlighted, and printing it twice
// makes the block look longer than the thinking it describes.
function Walkthrough({ steps, showQuotes = false }) {
  if (!steps?.length) return null
  return (
    <div className="bg-[#060e1a] border border-[#1a3a5c] rounded-lg p-3 text-left">
      <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">How to get there</p>
      <ol className="space-y-1.5">
        {steps.map((step, i) => (
          <li key={i} className="flex items-start gap-2 text-[11px] leading-snug">
            <span className="text-brand-600 font-bold shrink-0">{i + 1}</span>
            <span className="text-[#8a9bb5]">
              {step.tabLabel && <span className="text-brand-600 font-bold">Tab {step.tabLabel}: </span>}
              {showQuotes && step.quote && <span className="text-[#ddeaf8]">“{step.quote}” </span>}
              {step.why}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

export default function CbatTabbedReasoning({
  gameName,
  emoji,
  seoTitle,
  seoDescription,
  introLead,
  introBullets,
  difficulties,
  readStoredDifficulty,
  storeDifficulty,
  tuningFor,
  launchMs,
  totalQuestions,
  buildRun,
  renderTab,
  computeGrade,
  formatAnswer = (v) => `${v}`,
  readPhaseLabel = 'Reading time',
  // How many tabs are readable at once. Two on both real tests — see the pane
  // rule at the top of this file.
  panes = 2,
}) {
  const { user, apiFetch, API } = useAuth()
  const { start: startTracking, markCompleted: markGameCompleted } = useCbatTracking()
  const isDemo = useCbatDemo()

  const [phase, setPhase] = useState('intro') // intro | launching | reading | playing | results
  const { enterImmersive, exitImmersive } = useGameChrome()
  useEffect(() => {
    if (phase === 'reading' || phase === 'playing') enterImmersive()
    else exitImmersive()
    return exitImmersive
  }, [phase, enterImmersive, exitImmersive])

  const [difficulty, setDifficulty] = useState(() => initialDifficulty(readStoredDifficulty))
  // What the RENDER tree reads. Pinned when a run launches, so flipping the
  // selector mid-run could never retarget a board. Reading runTuningRef during
  // render would trip react-hooks/refs, hence the pair.
  const [runDifficulty, setRunDifficulty] = useState(difficulty)
  const runTuningRef = useRef(tuningFor(difficulty))

  const [run, setRun] = useState(null)
  // Oldest first, so the tab that gets dropped when a new one is opened is
  // always the one at the front.
  const [openTabIds, setOpenTabIds] = useState([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [answers, setAnswers] = useState([])
  const [feedback, setFeedback] = useState(null)
  const [remainingMs, setRemainingMs] = useState(0)
  const [totalElapsedMs, setTotalElapsedMs] = useState(0)
  const [scoreSaved, setScoreSaved] = useState(false)
  const [queued, setQueued] = useState(false)

  const phaseStartRef = useRef(null)
  const tickRef = useRef(null)
  const answersRef = useRef([])
  const totalElapsedRef = useRef(0)
  const launchTimerRef = useRef(null)

  const runTuning = tuningFor(runDifficulty)
  const gameKey = runTuning.gameKey

  useEffect(() => { answersRef.current = answers }, [answers])
  useEffect(() => { totalElapsedRef.current = totalElapsedMs }, [totalElapsedMs])

  // Keyed by board, so flipping mode never shows one board's score under
  // another's name and never blanks the panel while the new one loads.
  const { best: personalBest, loading: bestLoading, refresh: fetchBest } =
    useCbatPersonalBest(tuningFor(difficulty).gameKey, { user, apiFetch, API })


  useEffect(() => () => {
    clearInterval(tickRef.current)
    clearTimeout(launchTimerRef.current)
  }, [])

  const submitScore = useCallback((finalAnswers, finalTotalMs, key) => {
    const correctCount = finalAnswers.filter(a => a.correct).length
    const totalTime = finalTotalMs / 1000
    const avgTimePerQuestionMs = Math.round(finalTotalMs / Math.max(1, totalQuestions))

    setScoreSaved(false)
    setQueued(false)
    markGameCompleted({ score: correctCount })
    submitCbatResult(key, {
      correctCount,
      totalQuestions,
      totalTime,
      avgTimePerQuestionMs,
    }, { apiFetch, API })
      .then((r) => {
        setScoreSaved(!!r?.synced)
        setQueued(!!r?.queued)
        fetchBest(key)
      })
      .catch(() => {})
  }, [apiFetch, API, markGameCompleted, totalQuestions, fetchBest])

  const currentQuestion = run?.questions?.[currentIdx] || null

  // Opening a tab that is already open does nothing — it is already in front of
  // you, and re-selecting it must not silently reorder which pane gets dropped
  // next. Opening a new one appends it and pushes the oldest out.
  const selectTab = useCallback((id) => {
    setOpenTabIds(prev => (prev.includes(id) ? prev : [...prev, id].slice(-panes)))
  }, [panes])

  // One interval serves both timed phases. `reading` runs the study clock and
  // rolls into the questions when it expires; `playing` runs the per-question
  // clock and records a timeout as a wrong answer.
  useEffect(() => {
    if (phase !== 'reading' && phase !== 'playing') return
    const limit = phase === 'reading' ? runTuning.readMs : runTuning.perQuestionMs
    phaseStartRef.current = Date.now()
    setRemainingMs(limit)
    tickRef.current = setInterval(() => {
      const elapsed = Date.now() - phaseStartRef.current
      const left = Math.max(0, limit - elapsed)
      setRemainingMs(left)
      if (left === 0) {
        clearInterval(tickRef.current)
        if (phase === 'reading') beginQuestions()
        else recordAnswer(null, limit)
      }
    }, 100)
    return () => clearInterval(tickRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentIdx])

  function beginQuestions() {
    setCurrentIdx(0)
    setPhase('playing')
  }

  function recordAnswer(picked, elapsedMs) {
    const q = run?.questions?.[currentIdx]
    if (!q) return
    const correct = picked !== null && picked === q.answer
    const entry = {
      prompt: q.prompt,
      answer: formatAnswer(q.answer, q),
      picked: picked === null ? null : formatAnswer(picked, q),
      trap: q.trap ?? null,
      correct,
      ms: elapsedMs,
      // Resolved now, while the run's tabs are still around to be numbered.
      steps: correct ? [] : evidenceSteps(q, run?.tabs),
    }
    const next = [...answersRef.current, entry]
    setAnswers(next)
    answersRef.current = next
    setTotalElapsedMs(prev => prev + elapsedMs)
    totalElapsedRef.current += elapsedMs
    setFeedback({ correct, picked, answer: q.answer })

    // Put the evidence on screen rather than one click away. Whichever tabs the
    // player was reading have already done their job by this point, and landing
    // back on the two that mattered is the lesson.
    if (!correct) {
      const wanted = evidenceTabIds(q).slice(0, panes)
      if (wanted.length) setOpenTabIds(wanted)
    }
  }

  function handlePick(option) {
    if (phase !== 'playing' || feedback) return
    clearInterval(tickRef.current)
    recordAnswer(option, Date.now() - phaseStartRef.current)
  }

  function goNext() {
    const nextIdx = currentIdx + 1
    setFeedback(null)
    if (nextIdx >= totalQuestions || nextIdx >= (run?.questions?.length ?? 0)) {
      submitScore(answersRef.current, totalElapsedRef.current, gameKey)
      setPhase('results')
      return
    }
    setCurrentIdx(nextIdx)
  }

  const beginLaunch = useCallback(() => {
    const tuning = tuningFor(difficulty)
    runTuningRef.current = tuning
    setRunDifficulty(difficulty)
    storeDifficulty(difficulty)

    const built = buildRun(tuning)
    setRun(built)
    setOpenTabIds(built.tabs.slice(0, panes).map(t => t.id))
    setCurrentIdx(0)
    setAnswers([])
    answersRef.current = []
    setFeedback(null)
    setTotalElapsedMs(0)
    totalElapsedRef.current = 0
    startTracking(tuning.gameKey)

    // The launch flash is skipped on a demo mount so the landing wall is never
    // stuck showing a dimmed card — the same rule FLAG and CUT follow.
    if (isDemo) { setPhase('reading'); return }
    setPhase('launching')
    launchTimerRef.current = setTimeout(() => setPhase('reading'), launchMs)
  }, [difficulty, tuningFor, storeDifficulty, buildRun, startTracking, isDemo, launchMs, panes])

  const goToIntro = useCallback(() => {
    clearInterval(tickRef.current)
    clearTimeout(launchTimerRef.current)
    setPhase('intro')
    setRun(null)
    setCurrentIdx(0)
    setAnswers([])
    answersRef.current = []
    setFeedback(null)
    setTotalElapsedMs(0)
    totalElapsedRef.current = 0
    setScoreSaved(false)
  }, [])

  // Two tabs open at once inside a 672px column is two 320px columns of prose
  // and figures. See the rule in main.css — widening this component's own
  // container does nothing while the app shell caps the route at max-w-3xl.
  useGameBodyClass('cbat-tabs-wide', phase === 'reading' || phase === 'playing')

  const correctSoFar = answers.filter(a => a.correct).length
  const remainingSec = Math.ceil(remainingMs / 1000)
  // Resolved in the index's own order rather than in open order, so the panes
  // stay put on screen instead of swapping sides when a tab is replaced.
  const openTabs = (run?.tabs || []).filter(t => openTabIds.includes(t.id))
  // A timeout counts as wrong and gets the same walkthrough — running out of
  // time is usually the search going wrong, which is the thing being explained.
  const answeredWrong = !!feedback && !feedback.correct
  const walkthroughSteps = answeredWrong ? evidenceSteps(currentQuestion, run?.tabs) : []
  const tabHighlights = answeredWrong ? evidenceHighlights(currentQuestion) : null
  const introTuning = tuningFor(difficulty)
  // Everything on the intro card except the flashing difficulty button dims
  // during the launch flash — the same treatment FLAG, SAT and RTT use.
  const dim = phase === 'launching' ? ' cbat-launch-dim' : ''

  return (
    <div>
      <SEO title={seoTitle} description={seoDescription} />

      <div className="flex items-center gap-2 mb-2">
        {phase === 'intro'
          ? <Link to="/cbat" className="text-slate-500 hover:text-brand-400 transition-colors text-sm">&larr; CBAT</Link>
          : <CbatQuitButton onConfirm={goToIntro} confirmNeeded={['reading', 'playing'].includes(phase)} />
        }
        <h1 className="text-sm font-extrabold text-slate-900">{gameName}</h1>
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
              <p className={`text-4xl mb-3${dim}`}>{emoji}</p>

              {/* `difficulties` is ordered [easier, hard], so the easier option
                  lands left and hard lands right. The pair sits under the title,
                  matching FLAG, CUT, Numerical Operations, SAT and RTT. */}
              <p className={`text-xl font-extrabold text-white mb-2${dim}`}>{gameName}</p>
              <CbatModeRow
                modes={difficulties}
                value={difficulty}
                onSelect={setDifficulty}
                launching={phase === 'launching'}
              />
              <p className={`text-[11px] text-brand-600 mb-3${dim}`}>{introTuning.blurb}</p>

              <p className={`text-sm text-slate-400 mb-5${dim}`}>{introLead}</p>

              <div className={`bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-4 mb-5 text-left space-y-2 text-sm text-[#ddeaf8]${dim}`}>
                {introBullets.map((b, i) => (
                  <div key={i} className={`flex items-start gap-2 ${b.muted ? 'text-xs text-[#8a9bb5]' : ''}`}>
                    <span className="text-brand-600 font-bold shrink-0">{b.icon}</span>
                    <span>{b.text}</span>
                  </div>
                ))}
                <div className="flex items-start gap-2 text-xs text-[#8a9bb5] pt-1">
                  <span className="shrink-0">⏱</span>
                  <span>
                    {Math.round(introTuning.readMs / 1000)}s to read · {totalQuestions} questions ·{' '}
                    {Math.round(introTuning.perQuestionMs / 1000)}s each. Running out counts as wrong
                  </span>
                </div>
              </div>

              <CbatPersonalBest label={introTuning.label} best={personalBest} loading={bestLoading} className={dim}>
                {best => (
                  <>
                    {best.bestScore}/{totalQuestions}
                    <span className="text-slate-500 mx-1">·</span>
                    {best.bestTime.toFixed(1)}s
                  </>
                )}
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

          {(phase === 'reading' || phase === 'playing') && run && (
            /* Wide enough for two readable panes side by side; the HUD and the
               question keep their own narrower measure below, because a line of
               prose 1100px long is harder to read, not easier. */
            <div className="w-full max-w-[1180px]">
              <div className="flex items-center justify-between text-xs font-mono mb-2 px-1 max-w-2xl mx-auto">
                <span className="text-slate-400">
                  {phase === 'reading'
                    ? readPhaseLabel
                    : <>Q <span className="text-brand-600">{currentIdx + 1}</span>/{totalQuestions}</>}
                </span>
                {phase === 'playing' && (
                  <span className="text-slate-400">✓ <span className="text-green-400">{correctSoFar}</span></span>
                )}
                <span className="text-slate-400">
                  ⏱ <span className={remainingMs < 10000 ? 'text-red-400' : 'text-brand-600'}>{remainingSec}s</span>
                </span>
              </div>

              <div className="w-full h-1 bg-[#1a3a5c] rounded-full mb-3 overflow-hidden max-w-2xl mx-auto">
                <motion.div
                  className="h-full bg-brand-600 rounded-full"
                  initial={false}
                  animate={{ width: phase === 'reading' ? '0%' : `${(currentIdx / totalQuestions) * 100}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>

              {/* Question first, tabs below — the question is what you come back
                  to after every trip into the tabs, so it stays put at the top
                  rather than moving as the tab content changes height. */}
              {phase === 'playing' && currentQuestion && (
                <motion.div
                  key={currentIdx}
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-4 mb-3 max-w-3xl mx-auto"
                >
                  <p className="text-sm sm:text-base text-[#ddeaf8] leading-relaxed mb-3">{currentQuestion.prompt}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {currentQuestion.options.map((opt, i) => {
                      let cls = 'bg-[#060e1a] border-[#1a3a5c] text-[#ddeaf8] hover:border-brand-400 hover:bg-[#0f2240] cursor-pointer'
                      if (feedback) {
                        if (opt === feedback.answer) cls = 'bg-green-500/15 border-green-500/50 text-green-400'
                        else if (opt === feedback.picked) cls = 'bg-red-500/15 border-red-500/50 text-red-400'
                        else cls = 'bg-[#060e1a] border-[#1a3a5c] text-[#5a6a80]'
                      }
                      return (
                        <button
                          key={`${opt}-${i}`}
                          type="button"
                          onClick={() => handlePick(opt)}
                          disabled={!!feedback}
                          data-demo-answer
                          className={`px-3 py-2.5 rounded-lg border-2 text-sm font-bold text-left transition-all ${cls}`}
                        >
                          {formatAnswer(opt, currentQuestion)}
                        </button>
                      )
                    })}
                  </div>

                  <AnimatePresence>
                    {feedback && (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-3">
                        <p className={`text-center text-sm font-bold mb-2 ${feedback.correct ? 'text-green-400' : 'text-red-400'}`}>
                          {feedback.correct
                            ? '✓ Correct'
                            : feedback.picked === null
                              ? `⏱ Timeout. The answer was ${formatAnswer(feedback.answer, currentQuestion)}`
                              : `✗ The answer was ${formatAnswer(feedback.answer, currentQuestion)}`}
                        </p>
                        {walkthroughSteps.length > 0 && (
                          <div className="mb-3">
                            <Walkthrough steps={walkthroughSteps} />
                            <p className="text-[10px] text-slate-600 mt-1.5 text-center">
                              The sentences it points at are highlighted in the tabs below.
                            </p>
                          </div>
                        )}
                        <button
                          onClick={goNext}
                          data-demo-answer
                          className="w-full px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg transition-colors text-sm"
                        >
                          {currentIdx + 1 >= totalQuestions ? 'See Results' : 'Next'}
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )}

              <TabStrip tabs={run.tabs} openIds={openTabIds} onSelect={selectTab} />
              {/* Side by side where there is room, stacked on a phone. Both
                  panes stay open either way — the constraint is how many tabs
                  you can READ at once, not how they are arranged. */}
              <div className={`grid gap-2 ${panes > 1 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
                {openTabs.map(tab => (
                  <div
                    key={tab.id}
                    className="bg-[#0a1628] border border-[#1a3a5c] rounded-b-xl rounded-tr-xl p-4 min-h-[180px] overflow-y-auto max-h-[46vh] lg:max-h-[58vh]"
                  >
                    {renderTab(tab, tabHighlights?.[tab.id] || null)}
                  </div>
                ))}
              </div>
              {panes > 1 && (
                <p className="text-[10px] text-slate-600 mt-1.5 text-center">
                  Two tabs at a time. Opening a third closes whichever has been open longest.
                </p>
              )}

              {phase === 'reading' && (
                <button
                  onClick={() => { clearInterval(tickRef.current); beginQuestions() }}
                  data-demo-answer
                  className="w-full max-w-2xl mx-auto block mt-3 px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg transition-colors text-sm"
                >
                  Start the questions
                </button>
              )}
            </div>
          )}

          {phase === 'results' && (
            <CbatGameOver
              gameKey={gameKey}
              score={correctSoFar}
              time={totalElapsedMs / 1000}
              scoreSaved={scoreSaved}
              queued={queued}
              personalBest={personalBest}
              onPlayAgain={() => { setScoreSaved(false); beginLaunch() }}
            >
              <ResultsScreen
                answers={answers}
                totalTime={totalElapsedMs / 1000}
                totalQuestions={totalQuestions}
                grade={computeGrade(correctSoFar, runTuning)}
                gameName={gameName}
              />
            </CbatGameOver>
          )}
        </div>
      )}
    </div>
  )
}
