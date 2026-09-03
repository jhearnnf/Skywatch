// ── ANT Practise ─────────────────────────────────────────────────────────────
// A sheet of eight plain speed/distance/time questions — two of each of ANT's
// four calculations, shuffled. No map, no timings panel, no parcel table: just
// the sums, so you can get reps in on the arithmetic the real game buries under
// board-reading.
//
// The whole sheet is on screen at once. You can start with whichever question
// you can already see how to do, skip the one you can't, and come back to it —
// which is the point of a drill, and is exactly what a one-question-at-a-time
// flow takes away. Nothing is marked until you hand it in, and the worked
// answers all come at the end.
//
// Scored and ranked on its own board (`ant-practise`), the way Trace Practise
// 2D/3D sit beside Trace 1/2.

import { useState, useCallback, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { submitCbatResult } from '../../lib/cbatOutbox'
import { useCbatTracking } from '../../utils/cbat/useCbatTracking'
import CbatGameOver from '../CbatGameOver'
import { scoreAnswer, formatHHMM, QUESTION_META } from '../../utils/antGenerator'
import {
  buildPractiseRun,
  practiseQuestion,
  practiseSolution,
  practiseGrade,
  PRACTISE_QUESTION_COUNT,
  PRACTISE_PER_TYPE,
  PRACTISE_MAX_SCORE,
} from '../../utils/cbat/antPractise'

const GAME_KEY = 'ant-practise'

// The figures lifted just clear of the words around them — weight and a
// brighter ink, nothing more. Colouring all three of them on all eight
// questions turned a page of sums into twenty-four blue flecks and cost more
// legibility than the emphasis bought.
function QuestionText({ parts }) {
  return (
    <p className="text-base sm:text-[17px] leading-[1.75] text-[#c9dcf0]">
      {parts.map((p, i) => (
        typeof p === 'string'
          ? <span key={i}>{p}</span>
          : <b key={i} className="font-semibold text-white whitespace-nowrap">{p.v}</b>
      ))}
    </p>
  )
}

// ── one question on the sheet ────────────────────────────────────────────────
// A numbered row on one shared surface. It was a bordered card with a filled
// number badge and a FIND THE ARRIVAL TIME label over it, which framed every
// question three times over; the sentence already says what to find and the box
// already says which unit. What is left is the question and somewhere to write.
//
// Three columns, and the middle one is the only one that varies: number gutter,
// question, answer. Every box therefore lands in one column down the right, so
// the eight of them are a single vertical run — you can see at a glance which
// are still empty, and tab down them without hunting. Below `sm` there is no
// room for a column, so the box drops under its question, indented to clear the
// number so the sheet still reads as a list.
function QuestionRow({ n, round, value, onChange, onEnter, inputRef }) {
  const q = practiseQuestion(round)
  return (
    <div className="px-4 sm:px-6 py-4 sm:py-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5 transition-colors focus-within:bg-[#0b1c30]">
      <div className="flex gap-3 sm:gap-4 flex-1 min-w-0">
        <span className="shrink-0 w-5 text-sm font-mono text-slate-500">{n}.</span>
        <QuestionText parts={q.parts} />
      </div>
      <div className="shrink-0 pl-8 sm:pl-0 flex items-center gap-2.5 sm:flex-col sm:items-stretch sm:gap-1 sm:w-24">
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter() } }}
          placeholder={q.placeholder}
          aria-label={`Question ${n} answer in ${q.unit}`}
          className="w-24 bg-[#060e1a] border border-[#1a3a5c] rounded-lg px-2 py-2 text-white font-mono text-base text-center focus:outline-none focus:border-brand-400"
        />
        <span className="text-xs text-slate-500 sm:text-center">{q.unit}</span>
      </div>
    </div>
  )
}

// ── results ──────────────────────────────────────────────────────────────────
function Stat({ label, value }) {
  return (
    <div className="bg-[#060e1a] border border-[#1a3a5c] rounded-lg p-2.5 text-center">
      <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">{label}</p>
      <p className="text-base font-mono font-bold text-brand-300">{value}</p>
    </div>
  )
}

// Per calculation, not per question: the whole reason to drill is finding out
// which of the four you keep dropping.
function ByCalculation({ answers }) {
  const rows = ['arrival', 'distance', 'fuel', 'speed'].map(type => {
    const of = answers.filter(a => a.type === type)
    return { type, exact: of.filter(a => a.exact).length, points: of.reduce((s, a) => s + a.points, 0) }
  })
  return (
    <div className="bg-[#060e1a] border border-[#1a3a5c] rounded-lg p-3">
      <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">By calculation</p>
      <div className="space-y-1.5">
        {rows.map(row => (
          <div key={row.type} className="flex items-center gap-2 text-xs">
            <span className="w-20 shrink-0 text-slate-400">{QUESTION_META[row.type].short}</span>
            <div className="flex-1 h-1.5 bg-[#1a3a5c] rounded-full overflow-hidden">
              <div
                className="h-full bg-brand-600 rounded-full"
                style={{ width: `${(row.points / (PRACTISE_PER_TYPE * 10)) * 100}%` }}
              />
            </div>
            <span className="w-24 shrink-0 text-right font-mono text-slate-400">
              <span className="text-brand-300 font-bold">{row.exact}</span>/{PRACTISE_PER_TYPE} exact
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function formatCorrect(type, value) {
  return type === 'arrival' ? formatHHMM(value) : `${value} ${QUESTION_META[type].unit}`
}

// Every question marked, in the order it was asked, each with the maths under
// it. Nothing is explained while the sheet is live, so this is where it lands.
function MarkedSheet({ run, answers }) {
  return (
    <div className="space-y-2.5">
      {run.map((round, i) => {
        const a = answers[i]
        // Only the verdict is coloured. Ringing the whole row in the same colour
        // as well said nothing extra and made eight marked rows hard to read.
        const tone = a.exact ? 'green' : a.partial ? 'amber' : 'red'
        const chip = {
          green: 'bg-green-500/20 text-green-300',
          amber: 'bg-amber-500/20 text-amber-300',
          red: 'bg-red-500/20 text-red-300',
        }[tone]
        const verdict = a.exact ? 'Exact' : a.partial ? 'Close' : a.userInput.trim() === '' ? 'Blank' : 'Off'
        return (
          <div key={i} className="bg-[#060e1a] border border-[#15293f] rounded-lg p-3 text-left">
            <div className="flex items-start justify-between gap-3 mb-1.5">
              <p className="text-xs text-slate-400 leading-snug">
                <span className="text-slate-500 font-mono mr-1.5">{i + 1}.</span>
                {practiseQuestion(round).text}
              </p>
              <span className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wide ${chip}`}>
                {`${verdict} +${a.points}`}
              </span>
            </div>

            <p className="text-xs font-mono text-slate-400 mb-2">
              Correct: <span className="text-brand-300 font-bold">{formatCorrect(round.type, round.correctAnswer)}</span>
              {a.userInput.trim() !== '' && (
                <>
                  <span className="text-slate-600 mx-2">{'·'}</span>
                  You: <span className={a.exact ? 'text-green-300' : 'text-slate-400'}>{a.userInput}</span>
                </>
              )}
            </p>

            <ol className="space-y-1">
              {practiseSolution(round).map(step => (
                <li key={step.n} className="flex flex-wrap items-baseline gap-x-1.5 text-[11px] font-mono">
                  <span className="text-slate-600 w-[5.5rem] shrink-0">{step.label}</span>
                  <span className="text-slate-400">{step.expr}</span>
                  <span className="text-slate-600">=</span>
                  <span className="text-[#ddeaf8] font-bold">{step.result}</span>
                </li>
              ))}
            </ol>
          </div>
        )
      })}
    </div>
  )
}

// ── the drill ────────────────────────────────────────────────────────────────
export default function AntPractise({ onExit }) {
  const { user, apiFetch, API } = useAuth()
  const { start: startTracking, markCompleted: markGameCompleted } = useCbatTracking()

  const [run, setRun] = useState(() => buildPractiseRun())
  const [inputs, setInputs] = useState(() => Array(PRACTISE_QUESTION_COUNT).fill(''))
  const [marked, setMarked] = useState(null)     // null until the sheet is handed in
  const [elapsed, setElapsed] = useState(0)
  const [finalTime, setFinalTime] = useState(0)
  const [personalBest, setPersonalBest] = useState(null)
  const [scoreSaved, setScoreSaved] = useState(false)
  const [queued, setQueued] = useState(false)

  // Stamped on mount rather than at useRef() — reading the clock during render
  // is impure, and the first tick is 100ms after the effects have run anyway.
  const startedRef = useRef(0)
  const tickRef = useRef(null)
  const boxRefs = useRef([])

  const answeredCount = inputs.filter(v => v.trim() !== '').length
  const totalScore = marked ? marked.reduce((s, a) => s + a.points, 0) : 0

  useEffect(() => {
    startTracking(GAME_KEY)
    startedRef.current = Date.now()
  }, [startTracking])

  // Personal best — the board this drill ranks on, not ANT's.
  const fetchBest = useCallback(() => {
    if (!user) return
    apiFetch(`${API}/api/games/cbat/${GAME_KEY}/personal-best`)
      .then(r => r.json())
      .then(d => { if (d.data) setPersonalBest(d.data) })
      .catch(() => {})
  }, [user, apiFetch, API])
  useEffect(() => { fetchBest() }, [fetchBest])

  // One clock for the sheet, stopped the moment it is handed in.
  useEffect(() => {
    if (marked) {
      clearInterval(tickRef.current)
      return
    }
    tickRef.current = setInterval(() => {
      setElapsed((Date.now() - startedRef.current) / 1000)
    }, 100)
    return () => clearInterval(tickRef.current)
  }, [marked])

  useEffect(() => () => clearInterval(tickRef.current), [])

  const setAnswer = useCallback((i, value) => {
    setInputs(prev => prev.map((v, j) => (j === i ? value : v)))
  }, [])

  // Enter jumps to the next box still empty, wrapping round to the top — so a
  // sheet filled in out of order still finishes on the keyboard alone.
  const focusNextEmpty = useCallback((from) => {
    const after = Array.from({ length: PRACTISE_QUESTION_COUNT - from - 1 }, (_, k) => from + 1 + k)
    const before = Array.from({ length: from }, (_, k) => k)
    const next = [...after, ...before].find(i => boxRefs.current[i]?.value.trim() === '')
    if (next != null) boxRefs.current[next].focus()
    else boxRefs.current[from]?.blur()
  }, [])

  const handIn = useCallback(() => {
    const time = (Date.now() - startedRef.current) / 1000
    const results = run.map((round, i) => ({
      type: round.type,
      userInput: inputs[i],
      correctAnswer: round.correctAnswer,
      ...scoreAnswer(round, inputs[i]),
    }))
    const score = results.reduce((s, a) => s + a.points, 0)
    const exactCount = results.filter(a => a.exact).length
    const partialCount = results.filter(a => a.partial).length

    setMarked(results)
    setFinalTime(time)
    setScoreSaved(false)
    setQueued(false)
    markGameCompleted({ score })
    submitCbatResult(GAME_KEY, {
      totalScore: score,
      exactCount,
      partialCount,
      missCount: results.length - exactCount - partialCount,
      roundsPlayed: results.length,
      totalTime: time,
      grade: practiseGrade(score),
    }, { apiFetch, API })
      .then((r) => {
        setScoreSaved(!!r?.synced)
        setQueued(!!r?.queued)
        fetchBest()
      })
      .catch(() => {})
  }, [run, inputs, apiFetch, API, markGameCompleted, fetchBest])

  const playAgain = useCallback(() => {
    setRun(buildPractiseRun())
    setInputs(Array(PRACTISE_QUESTION_COUNT).fill(''))
    setMarked(null)
    setElapsed(0)
    setFinalTime(0)
    setScoreSaved(false)
    setQueued(false)
    startedRef.current = Date.now()
    startTracking(GAME_KEY)
  }, [startTracking])

  if (marked) {
    return (
      <CbatGameOver
        gameKey={GAME_KEY}
        score={totalScore}
        time={finalTime}
        scoreSaved={scoreSaved}
        queued={queued}
        personalBest={personalBest}
        onPlayAgain={playAgain}
      >
        <div className="w-full">
          <div className="grid grid-cols-3 gap-2 mb-3">
            <Stat label="Score" value={`${totalScore}/${PRACTISE_MAX_SCORE}`} />
            <Stat label="Exact" value={`${marked.filter(a => a.exact).length}/${PRACTISE_QUESTION_COUNT}`} />
            <Stat label="Time" value={`${finalTime.toFixed(1)}s`} />
          </div>
          <div className="mb-3">
            <ByCalculation answers={marked} />
          </div>
          <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">Your sheet, marked</p>
          <MarkedSheet run={run} answers={marked} />
        </div>
      </CbatGameOver>
    )
  }

  return (
    <div className="w-full max-w-2xl">
      {/* Heading */}
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h2 className="text-base font-extrabold text-white">ANT Practise</h2>
        <span className="text-xs font-mono text-slate-400">
          {'⏱'} <span className="text-brand-300">{elapsed.toFixed(1)}s</span>
        </span>
      </div>
      <p className="text-xs text-slate-500 mb-4 leading-snug">
        Answer them in any order. Nothing is marked until you hand the sheet in at the bottom.
      </p>

      {/* The sheet — one surface, hairline between questions */}
      <div className="bg-[#0a1628] border border-[#1a3a5c] rounded-xl divide-y divide-[#13273d]">
        {run.map((round, i) => (
          <QuestionRow
            key={i}
            n={i + 1}
            round={round}
            value={inputs[i]}
            onChange={(v) => setAnswer(i, v)}
            onEnter={() => focusNextEmpty(i)}
            inputRef={(el) => { boxRefs.current[i] = el }}
          />
        ))}
      </div>

      {/* Hand-in bar — sticks to the bottom so it stays reachable from any
          question on a sheet taller than the viewport. */}
      <div className="sticky bottom-0 mt-4 -mx-1 px-1 pt-3 pb-3 bg-[#06101e]/95 backdrop-blur-sm border-t border-[#1a3a5c]">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-400">
            <span className="text-brand-300 font-bold font-mono">{answeredCount}</span>
            {` of ${PRACTISE_QUESTION_COUNT} answered`}
            {answeredCount < PRACTISE_QUESTION_COUNT && (
              <span className="text-slate-600">{' · blanks score 0'}</span>
            )}
          </span>
          <button
            onClick={handIn}
            data-demo-answer
            className="shrink-0 px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-lg transition-colors cursor-pointer"
          >
            Mark My Answers
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between mt-3 px-1">
        <button
          onClick={onExit}
          className="text-xs text-slate-500 hover:text-brand-400 transition-colors cursor-pointer"
        >
          {'← Back to ANT'}
        </button>
        <Link to={`/cbat/${GAME_KEY}/leaderboard`} className="text-xs text-brand-300 hover:text-brand-200 transition-colors">
          {'Leaderboard →'}
        </Link>
      </div>
    </div>
  )
}
