import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

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
        className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-3 bg-amber-500 text-white px-5 py-3 rounded-2xl shadow-xl shadow-amber-200/60 font-bold text-sm whitespace-nowrap"
      >
        <svg width="26" height="26" viewBox="0 0 32 32" fill="none" className="shrink-0">
          <circle cx="16" cy="16" r="14" fill="#f59e0b" stroke="#fbbf24" strokeWidth="1.5"/>
          <circle cx="16" cy="16" r="10" fill="none" stroke="#fef3c7" strokeWidth="1"/>
          <text x="16" y="21" textAnchor="middle" fontSize="10" fontWeight="bold" fill="#7c2d12" fontFamily="monospace">AC</text>
        </svg>
        <div>
          <p className="text-base font-extrabold">+{amount} Aircoins</p>
          <p className="text-amber-100 text-xs font-semibold">{label}</p>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
