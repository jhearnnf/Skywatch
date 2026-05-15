import { motion } from 'framer-motion'

// Default scene used until the dedicated implementation is built. Renders an
// emoji + label centred in the window so the preview registry can be wired up
// end-to-end before each scene is fleshed out.
export default function PlaceholderScene({ label = 'Coming soon', emoji = '✨', accent = '#5baaff' }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="text-center"
      >
        <motion.div
          initial={{ scale: 0.85 }}
          animate={{ scale: [0.95, 1.08, 0.95] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
          className="text-6xl mb-3"
          style={{ filter: `drop-shadow(0 0 20px ${accent}66)` }}
        >
          {emoji}
        </motion.div>
        <p className="intel-mono text-xs tracking-widest" style={{ color: accent }}>
          {label.toUpperCase()}
        </p>
      </motion.div>
    </div>
  )
}
