import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// Shared scaffold for top-banner notifications (Aircoin, LevelUp, RankPromotion):
// auto-dismiss after `duration` ms, framer-motion enter/exit, aria-live region.
// Each notification passes its own className + motion params + children.
export default function BaseNotification({ duration, onDone, className, motionProps, children }) {
  useEffect(() => {
    const t = setTimeout(onDone, duration)
    return () => clearTimeout(t)
  }, [onDone, duration])

  return (
    <AnimatePresence>
      <motion.div {...motionProps} aria-live="polite" className={className}>
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
