import { motion } from 'framer-motion'
import RankBadge from './RankBadge'
import BaseNotification from './BaseNotification'

// Large-tier motion: enters from above (matching Airstar/LevelUp direction) with
// the bounciest spring of the four — reserved for the rare/big moments.
const MOTION_PROPS = {
  initial:    { opacity: 0, scale: 0.7,  y: -60 },
  animate:    { opacity: 1, scale: 1,    y: 0   },
  exit:       { opacity: 0, scale: 0.85, y: -50 },
  transition: { type: 'spring', damping: 14, stiffness: 220 },
}

export default function RankPromotionNotification({ rank, onDone }) {
  const hasRealBadge = rank?.rankNumber && rank.rankNumber > 1

  return (
    <BaseNotification
      duration={4200}
      onDone={onDone}
      motionProps={MOTION_PROPS}
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
    </BaseNotification>
  )
}
