import { motion } from 'framer-motion'
import BaseNotification from './BaseNotification'

// Medium-tier motion: slightly bouncier than Airstar, less than RankPromotion.
// All notifs share the same direction (in/out from above) so a chained queue
// reads as one consistent reward sequence.
const MOTION_PROPS = {
  initial:    { opacity: 0, y: -80, scale: 0.85 },
  animate:    { opacity: 1, y: 0,   scale: 1    },
  exit:       { opacity: 0, y: -60, scale: 0.9  },
  transition: { type: 'spring', damping: 16, stiffness: 260 },
}

export default function LevelUpNotification({ level, onDone }) {
  return (
    <BaseNotification
      duration={3400}
      onDone={onDone}
      motionProps={MOTION_PROPS}
      className="fixed top-[72px] left-1/2 -translate-x-1/2 z-[1100] flex items-center gap-3 bg-brand-200 text-slate-900 px-5 py-3 rounded-2xl shadow-xl shadow-brand-300/50 font-bold text-sm whitespace-nowrap"
    >
      <motion.span
        animate={{ rotate: [0, -15, 15, -10, 10, 0], scale: [1, 1.3, 1.3, 1.1, 1] }}
        transition={{ duration: 0.7, delay: 0.1 }}
        className="text-2xl star-silver"
      >
        ⭐
      </motion.span>
      <div>
        <p className="text-base font-extrabold">Level Up!</p>
        <p className="text-brand-800 text-xs font-semibold">Agent Level {level} achieved</p>
      </div>
    </BaseNotification>
  )
}
