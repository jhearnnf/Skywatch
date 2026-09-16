import { useState, useCallback, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useGameChrome } from '../../context/GameChromeContext'
import { useCbatTheme } from '../../hooks/useCbatTheme'
import { useCbatMcq } from '../../hooks/useCbatAnswerKeys'
import { useGameBodyClass } from '../../hooks/useGameBodyClass'
import { CbatGameHeader, CbatFooterStrip, CbatKeyCap } from './CbatTestChrome'
import OrientationInstruments from './OrientationInstruments'
import OrientationAircraft from './OrientationAircraft'
import {
  buildOrientationRun, describeAttitude, ORIENTATION_QUESTIONS, ORIENTATION_TIME_LIMIT, ORIENTATION_OPTIONS,
} from '../../utils/cbat/instrumentsOrientation'

// The Orientation run of the Instruments tile: ten questions against one
// clock. Each shows an attitude indicator and a heading indicator and asks
// which of four aircraft pictures matches them.
//
// Owns its own clock, header and answer flow; the page mounts it for the run
// and takes the answers back through `onFinish`. Kept apart from the Reading
// run in CbatInstruments.jsx because the two share nothing but the tile: no
// calibration pause, a fixed question count, pictures instead of sentences.

const LETTERS = ['A', 'B', 'C', 'D']

export default function InstrumentsOrientationRun({ onFinish, onQuit, rng }) {
  const cbat = useCbatTheme()
  const { enterImmersive, exitImmersive } = useGameChrome()
  useEffect(() => { enterImmersive(); return exitImmersive }, [enterImmersive, exitImmersive])
  useGameBodyClass('cbat-stage-wide', true)

  const [questions] = useState(() => buildOrientationRun(ORIENTATION_QUESTIONS, rng))
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState('playing') // playing | feedback
  const [elapsed, setElapsed] = useState(0)
  const [pickedIdx, setPickedIdx] = useState(null)
  const [correctSoFar, setCorrectSoFar] = useState(0)

  const answersRef = useRef([])
  const startRef = useRef(null)   // set when the clock starts, below
  const roundStartRef = useRef(0)
  const finishedRef = useRef(false)
  const onFinishRef = useRef(onFinish)
  useEffect(() => { onFinishRef.current = onFinish }, [onFinish])

  // The clock stops while the answer is on screen. Under the SkyWatch theme
  // the feedback waits for Next, and reading why you were wrong is learning
  // time, not answering time; it should not cost you against the cap or on
  // the board's time tiebreak. `pausedMsRef` is everything the clock has
  // sat out so far; `pauseStartRef` is set while it is sitting out now.
  const pausedMsRef = useRef(0)
  const pauseStartRef = useRef(null)

  const readElapsed = useCallback(() => {
    if (startRef.current == null) return 0
    const pausedNow = pauseStartRef.current == null ? 0 : Date.now() - pauseStartRef.current
    return (Date.now() - startRef.current - pausedMsRef.current - pausedNow) / 1000
  }, [])

  const finish = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    onFinishRef.current?.(answersRef.current, Math.min(readElapsed(), ORIENTATION_TIME_LIMIT))
  }, [readElapsed])

  // Master clock. Ends the run at the cap whatever question is up.
  useEffect(() => {
    if (startRef.current == null) startRef.current = Date.now()
    const id = setInterval(() => {
      const now = readElapsed()
      setElapsed(now)
      if (now >= ORIENTATION_TIME_LIMIT) { clearInterval(id); finish() }
    }, 100)
    return () => clearInterval(id)
  }, [readElapsed, finish])

  const advance = useCallback(() => {
    if (pauseStartRef.current != null) {
      pausedMsRef.current += Date.now() - pauseStartRef.current
      pauseStartRef.current = null
    }
    if (answersRef.current.length >= questions.length || readElapsed() >= ORIENTATION_TIME_LIMIT) {
      finish()
      return
    }
    setIndex(answersRef.current.length)
    setPickedIdx(null)
    setPhase('playing')
    roundStartRef.current = readElapsed()
  }, [questions.length, readElapsed, finish])

  const question = questions[index]

  const handlePick = useCallback((idx) => {
    if (phase !== 'playing' || finishedRef.current) return
    const correct = idx === question.correctIdx
    answersRef.current = [
      ...answersRef.current,
      {
        pickedIdx: idx,
        correctIdx: question.correctIdx,
        correct,
        roundTime: readElapsed() - roundStartRef.current,
        attitude: question.attitude,
        picked: question.options[idx],
      },
    ]
    if (correct) setCorrectSoFar(n => n + 1)
    // The real test gives no right/wrong mid-run; under the Real CBAT theme
    // the next question comes straight up. Under SkyWatch the answer stays
    // up, clock stopped, until Next.
    if (cbat) { advance(); return }
    setPickedIdx(idx)
    setPhase('feedback')
    pauseStartRef.current = Date.now()
  }, [phase, question, readElapsed, cbat, advance])

  // Enter or Space moves on from the feedback, so a keyboard player never
  // has to reach for the mouse between questions.
  useEffect(() => {
    if (phase !== 'feedback') return
    const onKey = (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); advance() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, advance])

  // In feedback the answered count is index + 1, so the last question's
  // feedback offers results rather than a Next.
  const isLast = index + 1 >= questions.length

  const { pending, select, commit } = useCbatMcq({
    enabled: phase === 'playing',
    count: ORIENTATION_OPTIONS,
    kind: 'both',
    onCommit: handlePick,
    resetKey: index,
  })

  const timeRemaining = Math.max(0, ORIENTATION_TIME_LIMIT - elapsed)
  const testBar = {
    stage: 'Testing',
    timeFrac: timeRemaining / ORIENTATION_TIME_LIMIT,
    progressFrac: index / questions.length,
  }

  // Rendered inside the page's centred column, so both blocks say w-full:
  // a centred column sizes an auto-width child to its content, and the
  // Typhoon canvas has no content width of its own.
  return (
    <>
      <div className="w-full">
        <CbatGameHeader
          title="Instruments"
          fullTitle="Instrument Comprehension"
          onQuit={onQuit}
          confirmNeeded
          test={testBar}
        />
      </div>

      <div className="w-full max-w-md lg:max-w-6xl" data-testid="orientation-run">
        {/* HUD: under the Real CBAT theme the title bar carries this */}
        {!cbat && (
          <div className="flex items-center justify-between text-xs lg:text-sm font-mono mb-2 px-1">
            <span className="text-slate-400">
              Question <span className="text-brand-600">{index + 1}</span> / {questions.length}
            </span>
            <span className="text-slate-400">
              {'✓'} <span className="text-green-400">{correctSoFar}</span>
            </span>
            <span className="text-slate-400">
              {'⏱'} <span className={timeRemaining < 15 ? 'text-red-400' : 'text-brand-600'}>{timeRemaining.toFixed(1)}s</span>
            </span>
          </div>
        )}
        {!cbat && (
          <div className="w-full h-1 bg-game-line rounded-full mb-3 overflow-hidden">
            <motion.div
              className={`h-full rounded-full ${timeRemaining < 15 ? 'bg-red-500' : 'bg-brand-600'}`}
              initial={false}
              animate={{ width: `${(timeRemaining / ORIENTATION_TIME_LIMIT) * 100}%` }}
              transition={{ duration: 0.1, ease: 'linear' }}
            />
          </div>
        )}

        <div className="lg:flex lg:gap-5 lg:items-center">
          {/* The two instruments */}
          <div className="bg-game-panel border border-game-line rounded-xl p-3 lg:p-4 mb-3 lg:mb-0 lg:shrink-0 lg:w-[min(30rem,calc(100vh_-_22rem))]">
            <OrientationInstruments key={index} attitude={question.attitude} />
            {/* One line on a phone: with the dials and four pictures stacked,
                a second line here was the few pixels that put a scrollbar on
                the run. The viewpoint reminder stays on wider screens. */}
            <p className="mt-2 text-center text-[10px] lg:text-xs text-slate-500">
              Which aircraft is flying like this?
              <span className="hidden sm:inline"> Every picture is seen from behind an aircraft flying north.</span>
            </p>
          </div>

          {/* The four pictures. Keyed by slot, never by question: each
              picture is a WebGL canvas, and remounting four of them per
              question means four fresh contexts and a shader compile each,
              which froze the page for seconds. A stable canvas just redraws
              with the new attitude. */}
          <div className="grid grid-cols-2 gap-2 lg:gap-3 lg:flex-1 lg:min-w-0">
            {question.options.map((option, i) => {
              let btnClass = 'bg-game-arena border-game-line hover:border-brand-400'
              if (pending === i) btnClass += ' cbat-option-pending'
              if (phase === 'feedback') {
                if (i === question.correctIdx) btnClass = 'bg-green-500/20 border-green-500/60'
                else if (i === pickedIdx) btnClass = 'bg-red-500/20 border-red-500/60'
                else btnClass = 'bg-game-arena border-game-line opacity-50'
              }
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => select(i)}
                  disabled={phase === 'feedback'}
                  data-demo-answer
                  data-option={i}
                  aria-label={`Option ${LETTERS[i]}: ${describeAttitude(option)}`}
                  className={`relative rounded-lg border-2 p-1.5 lg:p-2 text-left transition-all ${btnClass} ${
                    phase === 'feedback' ? 'cursor-default' : 'cursor-pointer'
                  }`}
                >
                  {/* The real test numbers its pictures bottom-left. */}
                  <span className={`absolute left-2 z-10 ${cbat ? 'bottom-2' : 'top-2'}`}>
                    {cbat
                      ? <CbatKeyCap label={i + 1} />
                      : <span className="inline-block min-w-[1.5rem] px-1.5 py-0.5 rounded bg-black/60 text-center font-mono text-[11px] lg:text-sm font-bold text-white">{LETTERS[i]}</span>}
                  </span>
                  <OrientationAircraft attitude={option} className="rounded-md" />
                </button>
              )
            })}
          </div>
        </div>

        <AnimatePresence>
          {phase === 'feedback' && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4 mt-3"
              data-testid="orientation-feedback"
            >
              <p className={`text-center text-xs lg:text-sm font-bold ${
                pickedIdx === question.correctIdx ? 'text-green-400' : 'text-red-400'
              }`}>
                {pickedIdx === question.correctIdx ? '✓ Correct' : `✗ Wrong. ${describeAttitude(question.attitude)}`}
              </p>
              <button
                type="button"
                onClick={advance}
                data-testid="orientation-next"
                className="px-5 py-2 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg text-xs lg:text-sm transition-colors"
              >
                {isLast ? 'See results' : 'Next'}
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <CbatFooterStrip
          answer={pending != null ? pending + 1 : null}
          onSubmit={commit}
          canSubmit={pending != null}
        />
      </div>
    </>
  )
}
