import { useRef } from 'react'
import { motion } from 'framer-motion'

// `from` / `to` are PAGE-relative coordinates (i.e. viewport top + scrollY),
// not viewport-relative. Using `position: absolute` rather than `fixed` so the
// badge scrolls with the document — otherwise a user scrolling during/after
// the fly animation would see the badge "float" away from the card it's
// landing on. Callers must add window.scrollX/scrollY to getBoundingClientRect
// values before passing them in.
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
      style={{ position: 'absolute', zIndex: 9999, pointerEvents: 'none' }}
      className="text-[10px] font-bold bg-brand-600 text-white px-2 py-0.5 rounded-full shadow-lg"
    >
      {label}
    </motion.div>
  )
}
