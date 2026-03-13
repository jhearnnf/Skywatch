import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

export default function RankPromotionNotification({ rank, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 4200)
    return () => clearTimeout(t)
  }, [onDone])

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.7, y: 40 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.85, y: -40 }}
        transition={{ type: 'spring', damping: 14, stiffness: 220 }}
        aria-live="polite"
        className="fixed inset-x-4 top-8 mx-auto max-w-xs z-[200] bg-gradient-to-br from-brand-200 to-brand-300 text-slate-900 p-5 rounded-3xl shadow-2xl shadow-brand-300/60 text-center"
      >
        <motion.div
          animate={{ scale: [1, 1.25, 1], rotate: [0, -8, 8, 0] }}
          transition={{ duration: 0.8, delay: 0.15 }}
          className="text-4xl mb-2"
        >
          🏅
        </motion.div>
        <p className="text-xs font-bold text-brand-800 uppercase tracking-widest mb-1">Rank Promotion</p>
        <p className="text-xl font-extrabold">
          {rank?.rankAbbreviation && <span className="mr-1">{rank.rankAbbreviation}</span>}
          {rank?.rankName ?? 'New Rank'}
        </p>
      </motion.div>
    </AnimatePresence>
  )
}
