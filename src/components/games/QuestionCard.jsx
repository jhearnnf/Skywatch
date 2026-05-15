import { motion, AnimatePresence } from 'framer-motion'

// Single answer-card from a quiz. Pure-presentational — no router/store deps.
// Used by both the real Intel Recall game (QuizFlow.jsx) and the home-page
// preview montage (homePreview/scenes/IntelRecallScene.jsx). If you restyle
// this, both surfaces update together.
export default function QuestionCard({ question, answers, onAnswer, answered, correctAnswerId, selectedAnswerId }) {
  return (
    <div>
      <h2 className="text-xl font-bold text-slate-900 leading-snug mb-6">
        {question}
      </h2>

      <div className="space-y-3">
        {answers.map((ans) => {
          const isCorrect  = String(ans._id) === String(correctAnswerId)
          const isSelected = String(ans._id) === String(selectedAnswerId)
          let state = 'idle'
          if (answered) {
            if (isCorrect)       state = 'correct'
            else if (isSelected) state = 'wrong'
          }

          return (
            <motion.button
              key={String(ans._id)}
              onClick={() => !answered && onAnswer?.(ans._id)}
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
                                        'bg-surface border-slate-200 text-slate-700 hover:border-brand-400 hover:bg-brand-50 cursor-pointer'
                }`}
            >
              <div className="flex items-center gap-3">
                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 shrink-0
                  ${state === 'correct' ? 'bg-emerald-500 border-emerald-500 text-white' :
                    state === 'wrong'   ? 'bg-red-400 border-red-400 text-white' :
                    answered            ? 'border-slate-200 text-slate-300' :
                                          'border-slate-300 text-slate-500'
                  }`}
                >
                  {state === 'correct' ? '✓' : state === 'wrong' ? '✗' : ''}
                </span>
                {ans.title}
              </div>
            </motion.button>
          )
        })}
      </div>

      {/* Feedback */}
      <AnimatePresence>
        {answered && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={`mt-4 p-3 rounded-xl text-sm font-semibold
              ${String(selectedAnswerId) === String(correctAnswerId)
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-red-50 text-red-800 border border-red-200'
              }`}
          >
            {String(selectedAnswerId) === String(correctAnswerId)
              ? '✅ Correct! Well done.'
              : `❌ The correct answer was: ${answers.find(a => String(a._id) === String(correctAnswerId))?.title ?? '—'}`
            }
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
