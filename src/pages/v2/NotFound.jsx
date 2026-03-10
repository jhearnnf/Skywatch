import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'

export default function NotFound() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4"
    >
      <motion.div
        animate={{ rotate: [0, -10, 10, -6, 6, 0] }}
        transition={{ duration: 1.2, delay: 0.3 }}
        className="text-7xl mb-6"
      >
        🎯
      </motion.div>
      <h1 className="text-5xl font-extrabold text-slate-900 mb-2">404</h1>
      <p className="text-xl font-bold text-slate-700 mb-2">Target not acquired</p>
      <p className="text-slate-500 mb-8 max-w-xs">
        This page doesn't exist or has been moved. Check your coordinates and try again.
      </p>
      <div className="flex flex-col sm:flex-row gap-3">
        <Link
          to="/home"
          className="px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-2xl transition-colors"
        >
          🏠 Return to Home
        </Link>
        <Link
          to="/learn"
          className="px-6 py-3 border border-slate-200 text-slate-700 font-bold rounded-2xl hover:bg-slate-50 transition-colors"
        >
          ✈️ Browse Subjects
        </Link>
      </div>
    </motion.div>
  )
}
