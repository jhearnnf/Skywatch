import { motion } from 'framer-motion'
import BaseNotification from './BaseNotification'

// Large-tier motion (matches RankPromotion) — same direction (top), same bouncy
// spring. Distinguished from RankPromotion by colour and icon, not by motion.
const MOTION_PROPS = {
  initial:    { opacity: 0, scale: 0.7,  y: -60 },
  animate:    { opacity: 1, scale: 1,    y: 0   },
  exit:       { opacity: 0, scale: 0.85, y: -50 },
  transition: { type: 'spring', damping: 14, stiffness: 220 },
}

export default function CategoryUnlockNotification({ categories, onDone }) {
  const list = Array.isArray(categories) ? categories : []
  const label = list.length === 1 ? 'New Pathway' : 'New Pathways'

  return (
    <BaseNotification
      duration={5000}
      onDone={onDone}
      motionProps={MOTION_PROPS}
      className="fixed inset-x-4 top-[72px] mx-auto max-w-xs z-[1100] bg-gradient-to-br from-cyan-200 to-teal-300 text-slate-900 p-5 rounded-3xl shadow-2xl shadow-teal-400/50 text-center"
    >
      <div className="relative flex items-center justify-center mb-3">
        <motion.div
          initial={{ scale: 0.6, opacity: 0.8 }}
          animate={{ scale: 1.8, opacity: 0 }}
          transition={{ duration: 0.9, delay: 0.1, ease: 'easeOut' }}
          className="absolute w-16 h-16 rounded-full bg-cyan-300/60"
        />
        <motion.div
          initial={{ scale: 0, rotate: -20 }}
          animate={{ scale: [0, 1.3, 1], rotate: [-20, 6, 0] }}
          transition={{ duration: 0.55, delay: 0.05, ease: 'easeOut' }}
          className="text-5xl"
          aria-hidden="true"
        >
          🗝️
        </motion.div>
      </div>

      <p className="text-xs font-bold text-teal-900 uppercase tracking-widest mb-1">Pathway Unlocked</p>
      <p className="text-base font-extrabold leading-snug">
        {list.join(' · ')}
      </p>
      <p className="text-xs font-semibold text-teal-800 mt-1">{label} now available in Learn</p>
    </BaseNotification>
  )
}
