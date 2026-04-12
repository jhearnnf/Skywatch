import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const STAR_COUNT = 5

export default function AircoinNotification({ amount, label = 'Brief Read Reward', onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2800)
    return () => clearTimeout(t)
  }, [onDone])

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -80, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -60, scale: 0.9 }}
        transition={{ type: 'spring', damping: 18, stiffness: 280 }}
        aria-live="polite"
        className="fixed top-[72px] left-1/2 -translate-x-1/2 z-[1100] flex items-center gap-3 bg-slate-200 border border-slate-300 text-white px-5 py-3 rounded-2xl shadow-xl shadow-slate-500/30 font-bold text-sm whitespace-nowrap"
      >
        {/* Silver star collection */}
        <div className="flex items-center -space-x-1 shrink-0">
          {Array.from({ length: STAR_COUNT }, (_, i) => (
            <motion.span
              key={i}
              initial={{ opacity: 0, scale: 0, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.08, type: 'spring', damping: 12, stiffness: 300 }}
              className="star-silver text-base"
            >
              ⭐
            </motion.span>
          ))}
        </div>
        <div>
          <p className="text-base font-extrabold">+{amount} Aircoins</p>
          <p className="text-slate-400 text-xs font-semibold">{label}</p>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
