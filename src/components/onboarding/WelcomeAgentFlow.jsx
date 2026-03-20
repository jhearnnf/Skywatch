import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppSettings } from '../../context/AppSettingsContext'
import { CATEGORY_ICONS, CATEGORY_DESCRIPTIONS } from '../../data/mockData'

export const ONBOARDING_KEY = 'skywatch_onboarded'

export function markOnboarded() {
  localStorage.setItem(ONBOARDING_KEY, '1')
}

export default function WelcomeAgentFlow({ onClose }) {
  const navigate     = useNavigate()
  const { settings } = useAppSettings()

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  function pickCategory(cat) {
    markOnboarded()
    onClose()
    navigate(`/learn/${encodeURIComponent(cat)}`)
  }

  const freeCategories = settings?.freeCategories ?? ['News']

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center px-5 py-8 overflow-y-auto"
        style={{ background: 'rgba(6, 16, 30, 0.97)' }}
      >
        <div className="w-full max-w-lg">
          {/* Header */}
          <div className="text-center mb-8">
            <span
              className="inline-block text-xs font-bold tracking-widest px-2 py-1 rounded mb-4"
              style={{ background: 'rgba(91,170,255,0.12)', color: '#5baaff', border: '1px solid rgba(91,170,255,0.3)' }}
            >
              MISSION BRIEFING
            </span>
            <h2 className="text-2xl font-extrabold text-white mb-2">
              Choose your first mission area
            </h2>
            <p className="text-slate-400 text-sm">
              Select a subject to start reading intel briefs — free, no account needed.
            </p>
          </div>

          {/* Category grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
            {freeCategories.map((cat, i) => (
              <motion.button
                key={cat}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06, duration: 0.3 }}
                onClick={() => pickCategory(cat)}
                className="flex flex-col items-center gap-2 rounded-2xl p-4 text-center transition-all hover:-translate-y-0.5 group"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.1)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(91,170,255,0.1)'
                  e.currentTarget.style.borderColor = 'rgba(91,170,255,0.5)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'
                }}
              >
                <span className="text-3xl group-hover:scale-110 transition-transform">
                  {CATEGORY_ICONS[cat] ?? '📄'}
                </span>
                <span className="text-sm font-bold text-white">{cat}</span>
                <span className="text-[11px] text-slate-400 leading-tight">
                  {CATEGORY_DESCRIPTIONS[cat] ?? ''}
                </span>
              </motion.button>
            ))}
          </div>

          {/* Footer */}
          <div className="text-center">
            <p className="text-xs text-slate-500 mb-3">
              Free accounts include these subject areas + a 5-day Silver trial on sign-up.
            </p>
            <button
              onClick={() => { markOnboarded(); onClose(); navigate('/login?tab=register') }}
              className="text-sm font-semibold"
              style={{ color: '#5baaff' }}
            >
              Create account first →
            </button>
            <span className="text-slate-600 mx-2">·</span>
            <button
              onClick={onClose}
              className="text-sm text-slate-500 hover:text-slate-400"
            >
              Maybe later
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
