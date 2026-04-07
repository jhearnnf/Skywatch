import { AnimatePresence, motion } from 'framer-motion'
import { useAppTutorial } from '../../context/AppTutorialContext'

export default function TutorialModal() {
  const { visible, step, current, total, next, skip, back, canGoBack } = useAppTutorial()

  return (
    <AnimatePresence>
      {visible && step && (
        <>
          {/* Backdrop */}
          <motion.div
            key="tut-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[48] bg-slate-900/60 backdrop-blur-sm"
            onClick={skip}
          />

          {/* Card */}
          <motion.div
            key="tut-card"
            initial={{ opacity: 0, y: 40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.97 }}
            transition={{ type: 'spring', damping: 24, stiffness: 280 }}
            className="fixed bottom-24 md:bottom-8 left-4 right-4 md:left-auto md:right-8 md:w-96 z-[52] bg-surface rounded-2xl shadow-2xl overflow-hidden"
          >
            {/* Progress bar */}
            <div className="h-1 bg-slate-100">
              <motion.div
                className="h-full bg-brand-500 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${(current / total) * 100}%` }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
              />
            </div>

            <div className="p-6">
              {/* Emoji + step count */}
              <div className="flex items-start justify-between mb-3">
                <span className="text-4xl">{step.emoji}</span>
                <span className="text-xs font-semibold text-slate-400 bg-slate-100 px-2 py-1 rounded-full">
                  {current} / {total}
                </span>
              </div>

              {/* Title */}
              <h3 className="text-lg font-bold text-slate-900 mb-2">
                {step.title}
              </h3>

              {/* Body */}
              <p className="text-sm text-slate-600 leading-relaxed mb-5">
                {step.body}
              </p>

              {/* Actions */}
              <div className="flex gap-3">
                {canGoBack ? (
                  <button
                    onClick={back}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-50 border border-slate-200 transition-colors"
                  >
                    ← Back
                  </button>
                ) : (
                  <button
                    onClick={skip}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-50 border border-slate-200 transition-colors"
                  >
                    Skip tour
                  </button>
                )}
                <button
                  onClick={next}
                  className="flex-2 flex-grow py-2.5 px-5 rounded-xl text-sm font-bold bg-brand-600 hover:bg-brand-700 text-white transition-colors shadow-sm"
                >
                  {current === total ? 'Got it! 🎉' : 'Next →'}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
