import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { CATEGORY_ICONS } from '../data/mockData'

const TIER_CONFIG = {
  silver: {
    label:      'Silver',
    badge:      '🥈 Silver Required',
    badgeCls:   'bg-brand-100 border-brand-300 text-brand-700',
    perksCls:   'bg-brand-100 border-brand-300',
    labelCls:   'text-brand-700',
    btnCls:     'bg-brand-600 hover:bg-brand-500 text-slate-50',
    perks: [
      'Access to all Silver subject areas',
      'Advanced quiz difficulty',
      'Large intel brief library',
    ],
  },
  gold: {
    label:      'Gold',
    badge:      '🥇 Gold Required',
    badgeCls:   'bg-amber-100 border-amber-200 text-amber-700',
    perksCls:   'bg-amber-100 border-amber-200',
    labelCls:   'text-amber-700',
    btnCls:     'bg-amber-600 hover:bg-amber-700 text-slate-50',
    perks: [
      'Access to ALL subject areas',
      'Every intel brief and quiz',
      'Advanced quiz difficulty',
    ],
  },
}

export default function LockedCategoryModal({ category, tier = 'silver', onClose }) {
  const navigate = useNavigate()
  const cfg      = TIER_CONFIG[tier] ?? TIER_CONFIG.silver
  const icon     = CATEGORY_ICONS[category] ?? '📄'

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Prevent body scroll while open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  return (
    <AnimatePresence>
      {/* Backdrop */}
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/70 backdrop-blur-sm"
        onClick={onClose}
      >
        {/* Sheet */}
        <motion.div
          key="sheet"
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: 0,      opacity: 1 }}
          exit={{ y: '100%',    opacity: 0 }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full sm:max-w-sm bg-surface border border-slate-200 rounded-t-3xl sm:rounded-3xl p-6 pb-8 sm:pb-6 card-shadow"
        >
          {/* Drag handle (mobile) */}
          <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-5 sm:hidden" />

          {/* Category icon + name */}
          <div className="flex items-center gap-3 mb-4">
            <span className="text-4xl">{icon}</span>
            <div>
              <p className="font-extrabold text-slate-900 text-lg leading-tight">{category}</p>
              <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded-full border mt-1 ${cfg.badgeCls}`}>
                {cfg.badge}
              </span>
            </div>
          </div>

          {/* Description */}
          <p className="text-sm text-slate-600 mb-4 leading-relaxed">
            <span className="font-semibold text-slate-800">{category}</span> briefs and quizzes
            require a{' '}
            <span className={`font-bold ${cfg.labelCls}`}>{cfg.label}</span> subscription or higher.
          </p>

          {/* Perks */}
          <div className={`rounded-2xl border p-3 mb-5 ${cfg.perksCls}`}>
            <p className="intel-mono text-slate-500 mb-2">{cfg.label} includes</p>
            <ul className="space-y-1.5">
              {cfg.perks.map((perk) => (
                <li key={perk} className="flex items-center gap-2 text-sm text-slate-800">
                  <span className="text-emerald-600 font-bold shrink-0">✓</span>
                  {perk}
                </li>
              ))}
            </ul>
          </div>

          {/* CTA */}
          <button
            onClick={() => { onClose(); navigate('/subscribe') }}
            className={`w-full py-3 rounded-2xl font-bold text-sm transition-colors mb-2 ${cfg.btnCls}`}
          >
            View {cfg.label} Plans
          </button>

          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-2xl text-sm font-semibold text-slate-500 hover:text-slate-700 transition-colors"
          >
            Maybe Later
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
