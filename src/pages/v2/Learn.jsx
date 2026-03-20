import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'
import { useAppTutorial } from '../../context/AppTutorialContext'
import { useAppSettings } from '../../context/AppSettingsContext'
import { isCategoryLocked, requiredTier } from '../../utils/subscription'
import TutorialModal from '../../components/tutorial/TutorialModal'
import LockedCategoryModal from '../../components/LockedCategoryModal'
import { CATEGORIES, CATEGORY_ICONS, CATEGORY_DESCRIPTIONS, SUBCATEGORIES } from '../../data/mockData'

export default function Learn() {
  const { user, API } = useAuth()
  const { start } = useAppTutorial()
  const { settings } = useAppSettings()
  const [counts,      setCounts]      = useState({}) // { [category]: total }
  const [progress,    setProgress]    = useState({}) // { [category]: { total, done } }
  const [search,      setSearch]      = useState('')
  const [briefTitles, setBriefTitles] = useState([]) // [{ title, category }]
  const [lockedModal, setLockedModal] = useState(null) // { category, tier }

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

  // All brief titles — used for search matching
  useEffect(() => {
    fetch(`${API}/api/briefs?limit=500`)
      .then(r => r.json())
      .then(data => {
        const briefs = data?.data?.briefs ?? []
        setBriefTitles(briefs.map(b => ({ title: b.title, category: b.category })))
      })
      .catch(() => {})
  }, [API])

  const q = search.toLowerCase()

  const filtered = !q
    ? CATEGORIES
    : CATEGORIES.filter(cat => {
        if (cat.toLowerCase().includes(q)) return true
        if ((CATEGORY_DESCRIPTIONS[cat] ?? '').toLowerCase().includes(q)) return true
        if ((SUBCATEGORIES[cat] ?? []).some(sub => sub.toLowerCase().includes(q))) return true
        if (briefTitles.some(b => b.category === cat && b.title.toLowerCase().includes(q))) return true
        return false
      })

  return (
    <>
      <TutorialModal />

      {lockedModal && (
        <LockedCategoryModal
          category={lockedModal.category}
          tier={lockedModal.tier}
          user={user}
          onClose={() => setLockedModal(null)}
        />
      )}

      <h1 className="text-2xl font-extrabold text-slate-900 mb-1">Subject Areas</h1>
      <p className="text-sm text-slate-500 mb-4">Choose a subject to start reading intel briefs.</p>

      {/* Search */}
      <div className="relative mb-5">
        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search subjects, subcategories, or briefs…"
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
                      <p className="text-xs text-slate-400 truncate">{CATEGORY_DESCRIPTIONS[cat] ?? ''}</p>
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
                  <button
                    onClick={() => setLockedModal({ category: cat, tier: requiredTier(cat, settings) })}
                    className={`w-full text-left ${cardClass} hover:opacity-80`}
                  >
                    {inner}
                  </button>
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
