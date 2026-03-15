import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'
import { useAppTutorial } from '../../context/AppTutorialContext'
import { useAppSettings } from '../../context/AppSettingsContext'
import { isCategoryLocked } from '../../utils/subscription'
import TutorialModal from '../../components/tutorial/TutorialModal'
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
  const { user, API } = useAuth()
  const { start } = useAppTutorial()
  const { settings } = useAppSettings()
  const [counts,   setCounts]   = useState({}) // { [category]: total }
  const [progress, setProgress] = useState({}) // { [category]: { total, done } }
  const [search,   setSearch]   = useState('')

  // Tutorial on first visit
  useEffect(() => {
    const t = setTimeout(() => start('learn'), 600)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Live brief counts per category
  useEffect(() => {
    fetch(`${API}/api/briefs/category-counts`)
      .then(r => r.json())
      .then(data => { if (data?.data?.counts) setCounts(data.data.counts) })
      .catch(() => {})
  }, [API])

  // Per-category progress for logged-in user
  useEffect(() => {
    if (!user) { setProgress({}); return }
    fetch(`${API}/api/briefs/category-stats`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => { if (data?.data?.stats) setProgress(data.data.stats) })
      .catch(() => {})
  }, [user, API])

  const filtered = CATEGORIES.filter(cat =>
    cat.toLowerCase().includes(search.toLowerCase()) ||
    (DESCRIPTIONS[cat] ?? '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <>
      <TutorialModal />

      <h1 className="text-2xl font-extrabold text-slate-900 mb-1">Subject Areas</h1>
      <p className="text-sm text-slate-500 mb-4">Choose a subject to start reading intel briefs.</p>

      {/* Search */}
      <div className="relative mb-5">
        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search subjects…"
          className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none text-sm bg-surface transition-all"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-sm"
          >
            ✕
          </button>
        )}
      </div>

      {/* Category grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <div className="text-4xl mb-3">🔍</div>
          <p className="font-semibold">No subjects match "{search}"</p>
          <button onClick={() => setSearch('')} className="mt-3 text-brand-600 font-semibold text-sm hover:text-brand-700">Clear search</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filtered.map((cat, i) => (
            <motion.div
              key={cat}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, duration: 0.35 }}
            >
              {(() => {
                const prog     = progress[cat]
                const total    = counts[cat] ?? prog?.total ?? 0
                const done     = prog?.done ?? 0
                const pct      = total > 0 ? Math.round((done / total) * 100) : 0
                const complete = user && pct === 100 && total > 0
                const locked   = isCategoryLocked(cat, user, settings)

                const cardClass = `relative flex items-center gap-4 bg-surface rounded-2xl p-4 border transition-all card-shadow
                  ${locked
                    ? 'border-slate-200 opacity-60 cursor-not-allowed'
                    : complete
                      ? 'border-emerald-200 bg-emerald-50/40 hover:border-emerald-300 hover:card-shadow-hover hover:-translate-y-0.5'
                      : 'border-slate-200 hover:border-brand-300 hover:bg-brand-50 hover:card-shadow-hover hover:-translate-y-0.5'
                  }`

                const inner = (
                  <>
                    {locked && (
                      <span className="absolute top-2 right-2 text-xs bg-slate-200 text-slate-500 rounded-full px-1.5 py-0.5 font-bold leading-none">
                        🔒
                      </span>
                    )}
                    <span className={`text-3xl shrink-0 ${!locked ? 'group-hover:scale-110' : ''} transition-transform`}>
                      {CATEGORY_ICONS[cat] ?? '📄'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <p className="font-bold text-slate-800">{cat}</p>
                        {complete && !locked && <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">✓ Done</span>}
                      </div>
                      <p className="text-xs text-slate-400 truncate">{DESCRIPTIONS[cat] ?? ''}</p>
                      {user && total > 0 && !locked && (
                        <div className="mt-1.5">
                          <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                            <motion.div
                              className={`h-full rounded-full ${complete ? 'bg-emerald-500' : 'bg-brand-500'}`}
                              initial={{ width: 0 }}
                              animate={{ width: `${pct}%` }}
                              transition={{ duration: 0.5, delay: 0.1 }}
                            />
                          </div>
                          <p className="text-[10px] text-slate-400 mt-0.5">{done}/{total} read</p>
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      {total > 0 && (
                        <p className={`text-xs font-bold mb-0.5 ${locked ? 'text-slate-400' : complete ? 'text-emerald-600' : 'text-brand-600'}`}>{total}</p>
                      )}
                      {!locked && (
                        <span className={`transition-colors block ${complete ? 'text-emerald-300 group-hover:text-emerald-500' : 'text-slate-300 group-hover:text-brand-400'}`}>→</span>
                      )}
                    </div>
                  </>
                )

                return locked ? (
                  <div className={cardClass}>{inner}</div>
                ) : (
                  <Link to={`/learn/${encodeURIComponent(cat)}`} className={`group ${cardClass}`}>
                    {inner}
                  </Link>
                )
              })()}
            </motion.div>
          ))}
        </div>
      )}
    </>
  )
}
