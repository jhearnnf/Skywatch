import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import RankBadge from './RankBadge'

export default function RankPromotionNotification({ rank, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 4200)
    return () => clearTimeout(t)
  }, [onDone])

  const hasRealBadge = rank?.rankNumber && rank.rankNumber > 1

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.7, y: 40 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.85, y: -40 }}
        transition={{ type: 'spring', damping: 14, stiffness: 220 }}
        aria-live="polite"
        className="fixed inset-x-4 top-[72px] mx-auto max-w-xs z-[1100] bg-gradient-to-br from-brand-200 to-brand-300 text-slate-900 p-5 rounded-3xl shadow-2xl shadow-brand-300/60 text-center"
      >
        <div className="relative flex items-center justify-center mb-3">
          {/* Glow ring */}
          <motion.div
            initial={{ scale: 0.6, opacity: 0.8 }}
            animate={{ scale: 1.8, opacity: 0 }}
            transition={{ duration: 0.9, delay: 0.1, ease: 'easeOut' }}
            className="absolute w-16 h-16 rounded-full bg-amber-400/50"
          />
          {/* Badge stamp */}
          <motion.div
            initial={{ scale: 0, rotate: -20 }}
            animate={{ scale: [0, 1.3, 1], rotate: [-20, 6, 0] }}
            transition={{ duration: 0.55, delay: 0.05, ease: 'easeOut' }}
          >
            {hasRealBadge ? (
              <RankBadge rankNumber={rank.rankNumber} size={72} color="#f59e0b" />
            ) : (
              <span className="text-4xl">🏅</span>
            )}
          </motion.div>
        </div>

        <p className="text-xs font-bold text-brand-800 uppercase tracking-widest mb-1">Rank Promotion</p>
        <p className="text-xl font-extrabold">{rank?.rankName ?? 'New Rank'}</p>
        {rank?.rankAbbreviation && (
          <p className="text-xs font-semibold text-brand-700 tracking-widest mt-0.5">{rank.rankAbbreviation}</p>
        )}
      </motion.div>
    </AnimatePresence>
  )
}
