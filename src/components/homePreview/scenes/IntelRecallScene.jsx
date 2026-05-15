import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import QuestionCard from '../../games/QuestionCard'

// Scripted montage of 3 quiz questions. Uses the same QuestionCard atom as
// the real Intel Recall game (src/pages/QuizFlow.jsx) — restyle that atom and
// this scene updates too. Re-runs cleanly when `runKey` changes (replay).
const QUESTIONS = [
  {
    question: 'Which RAF aircraft is the UK\'s primary multi-role fighter?',
    answers: [
      { _id: 'q1a', title: 'Typhoon FGR4' },
      { _id: 'q1b', title: 'Tornado GR4'  },
      { _id: 'q1c', title: 'Harrier GR9'  },
    ],
    correctId: 'q1a',
    pickIndex: 0,
  },
  {
    question: 'Which base hosts the Red Arrows display team?',
    answers: [
      { _id: 'q2a', title: 'RAF Coningsby' },
      { _id: 'q2b', title: 'RAF Waddington' },
      { _id: 'q2c', title: 'RAF Waddington Annex' },
      { _id: 'q2d', title: 'RAF Scampton (historic)' },
    ],
    correctId: 'q2d',
    pickIndex: 1, // pick a wrong answer first to show the wrong state
    wrongPickFirst: true,
  },
  {
    question: 'What does CAS stand for in RAF doctrine?',
    answers: [
      { _id: 'q3a', title: 'Close Air Support' },
      { _id: 'q3b', title: 'Combat Air Standard' },
      { _id: 'q3c', title: 'Coordinated Action System' },
    ],
    correctId: 'q3a',
    pickIndex: 0,
  },
]

const PER_QUESTION_MS = 1900

export default function IntelRecallScene({ runKey }) {
  const [qIdx, setQIdx]           = useState(0)
  const [selected, setSelected]   = useState(null)
  const [answered, setAnswered]   = useState(false)

  // Reset on replay
  useEffect(() => {
    setQIdx(0)
    setSelected(null)
    setAnswered(false)
  }, [runKey])

  // Scripted timeline: for each question, after ~700ms "pick" an answer,
  // then ~1200ms later advance to the next.
  useEffect(() => {
    const q = QUESTIONS[qIdx]
    if (!q) return
    const pickT = setTimeout(() => {
      // For "wrong-pick-first" questions, briefly show wrong then correct.
      if (q.wrongPickFirst) {
        setSelected(q.answers[q.pickIndex]._id)
        setAnswered(true)
        const correctT = setTimeout(() => {
          setSelected(q.correctId)
        }, 550)
        return () => clearTimeout(correctT)
      }
      setSelected(q.answers[q.pickIndex]._id === q.correctId
        ? q.correctId
        : q.answers[q.pickIndex]._id)
      // Force "correct" since pickIndex 0 happens to be correct here
      setSelected(q.correctId)
      setAnswered(true)
    }, 650)

    const advanceT = setTimeout(() => {
      const next = (qIdx + 1) % QUESTIONS.length
      if (next === 0) return // let scene loop via parent
      setQIdx(next)
      setSelected(null)
      setAnswered(false)
    }, PER_QUESTION_MS)

    return () => { clearTimeout(pickT); clearTimeout(advanceT) }
  }, [qIdx, runKey])

  const q = QUESTIONS[qIdx]

  return (
    <div className="absolute inset-0 flex items-center justify-center p-4 sm:p-8">
      {/* Backdrop grid lines for tactical feel */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none opacity-20"
        style={{
          background:
            'linear-gradient(90deg, rgba(91,170,255,0.4) 1px, transparent 1px) 0 0/40px 40px,' +
            'linear-gradient(0deg,  rgba(91,170,255,0.4) 1px, transparent 1px) 0 0/40px 40px',
        }}
      />

      {/* Question count chip */}
      <div className="absolute top-16 sm:top-20 left-4 sm:left-8 z-10">
        <span className="intel-mono text-[10px] text-brand-600 px-2 py-1 rounded-full border border-brand-600/40 bg-brand-600/10">
          QUESTION {qIdx + 1} / {QUESTIONS.length}
        </span>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={`q-${qIdx}-${runKey}`}
          initial={{ opacity: 0, x: 18, scale: 0.97 }}
          animate={{ opacity: 1, x: 0,  scale: 1 }}
          exit={{    opacity: 0, x: -18, scale: 0.97 }}
          transition={{ duration: 0.3 }}
          className="bg-surface rounded-2xl p-4 sm:p-5 border border-slate-200 card-shadow w-full max-w-md mx-auto"
          style={{ position: 'relative', zIndex: 5 }}
        >
          <QuestionCard
            question={q.question}
            answers={q.answers}
            answered={answered}
            correctAnswerId={q.correctId}
            selectedAnswerId={selected}
            onAnswer={() => {}}
          />
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
