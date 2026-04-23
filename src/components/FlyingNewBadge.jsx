import { useRef } from 'react'
import { motion } from 'framer-motion'

export default function FlyingNewBadge({ from, to, label = 'NEW', onArrived }) {
  // framer-motion fires onAnimationComplete for BOTH the enter animation and
  // the exit animation (when AnimatePresence unmounts). We only want to notify
  // once — on arrival.
  const firedRef = useRef(false)
  return (
    <motion.div
      initial={{ left: from.x, top: from.y, opacity: 0, scale: 0.5 }}
      animate={{ left: to.x,   top: to.y,   opacity: 1, scale: 1   }}
      exit={{ opacity: 0, scale: 0.6 }}
      transition={{ type: 'spring', stiffness: 180, damping: 22 }}
      onAnimationComplete={() => {
        if (firedRef.current) return
        firedRef.current = true
        onArrived?.()
      }}
      style={{ position: 'fixed', zIndex: 9999, pointerEvents: 'none' }}
      className="text-[10px] font-bold bg-brand-600 text-white px-2 py-0.5 rounded-full shadow-lg"
    >
      {label}
    </motion.div>
  )
}
