import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { CATEGORIES, CATEGORY_ICONS } from '../../data/mockData'

const DESCRIPTIONS = {
  News:        'The latest RAF news and operations.',
  Aircrafts:   'Fast jets, transport, rotary wing, and more.',
  Bases:       'UK and overseas RAF stations.',
  Ranks:       'Commissioned officers and NCOs.',
  Squadrons:   'Active, reserve, and historic squadrons.',
  Training:    'From IOT to advanced flying training.',
  Roles:       'Every trade and branch explained.',
  Threats:     'Air threats, SAMs, and electronic warfare.',
  Allies:      'NATO, Five Eyes, and bilateral partners.',
  Missions:    'Operations from WWII to today.',
  AOR:         'Area of responsibility and global deployments.',
  Tech:        'Weapons, sensors, and future programmes.',
  Terminology: 'Key RAF terminology and concepts.',
  Treaties:    'Alliances, agreements, and arms control.',
}

export default function Learn() {
  return (
    <div>
      <h1 className="text-2xl font-extrabold text-slate-900 mb-1">Subject Areas</h1>
      <p className="text-sm text-slate-500 mb-6">Choose a subject to start reading intel briefs.</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {CATEGORIES.map((cat, i) => (
          <motion.div
            key={cat}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04, duration: 0.35 }}
          >
            <Link
              to={`/learn/${encodeURIComponent(cat)}`}
              className="flex items-center gap-4 bg-white rounded-2xl p-4 border border-slate-200 hover:border-brand-300 hover:bg-brand-50 transition-all card-shadow hover:card-shadow-hover group hover:-translate-y-0.5"
            >
              <span className="text-3xl shrink-0 group-hover:scale-110 transition-transform">
                {CATEGORY_ICONS[cat] ?? '📄'}
              </span>
              <div className="min-w-0">
                <p className="font-bold text-slate-800">{cat}</p>
                <p className="text-xs text-slate-400 truncate">{DESCRIPTIONS[cat] ?? ''}</p>
              </div>
              <span className="ml-auto text-slate-300 group-hover:text-brand-400 transition-colors shrink-0">→</span>
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
