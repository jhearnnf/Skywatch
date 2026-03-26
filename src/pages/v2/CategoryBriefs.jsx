import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'
import { useAppSettings } from '../../context/AppSettingsContext'
import { requiredTier, isCategoryLocked } from '../../utils/subscription'
import LockedCategoryModal from '../../components/LockedCategoryModal'
import { CATEGORY_ICONS, SUBCATEGORIES } from '../../data/mockData'

function BriefNode({ brief, index, isRead, isStarted, quizPassed, onLockedClick }) {
  const locked  = brief.isLocked ?? false
  const isStub  = brief.status === 'stub'

  const cardClass = isStub
    ? 'bg-slate-50 border-slate-200 hover:border-slate-300'
    : isRead
      ? 'bg-emerald-50 border-emerald-200 hover:border-emerald-300'
      : isStarted
        ? 'bg-amber-50 border-amber-200 hover:border-amber-300'
        : 'bg-surface border-slate-200 hover:border-brand-300 hover:bg-brand-50 card-shadow hover:card-shadow-hover'

  const circleClass = isStub
    ? 'bg-slate-100 border-slate-300 text-slate-400'
    : isRead
      ? 'bg-emerald-500 border-emerald-500 text-white'
      : isStarted
        ? 'bg-amber-400 border-amber-400 text-white'
        : 'bg-surface border-slate-200 group-hover:border-brand-400'

  const circleIcon = isStub
    ? '🔒'
    : isRead
      ? '✓'
      : isStarted
        ? '◑'
        : locked ? '🔒' : CATEGORY_ICONS[brief.category] ?? '📄'

  const titleClass = isStub
    ? 'text-slate-400'
    : isRead
      ? 'text-emerald-800'
      : isStarted
        ? 'text-amber-900'
        : 'text-slate-800'

  const arrowClass = isRead
    ? 'text-emerald-300'
    : isStarted
      ? 'text-amber-300'
      : 'text-slate-300 group-hover:text-brand-400'

  return (
    <motion.div
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04, duration: 0.35 }}
      className="relative"
    >
      {/* Connector line (not on last item) */}
      <div className="absolute left-6 top-14 bottom-0 w-0.5 bg-slate-200 -z-10" aria-hidden="true" />

      {(() => {
        const inner = (
          <>
            {/* Status circle */}
            <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 text-xl border-2 transition-all ${circleClass}`}>
              {circleIcon}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <p className={`font-bold text-sm leading-snug ${titleClass}`}>
                  {brief.title}
                </p>
                <div className="flex items-center gap-1.5 shrink-0">
                  {isStub && (
                    <span className="text-[10px] font-bold bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded-full tracking-wide">
                      CLASSIFIED
                    </span>
                  )}
                  {brief.historic && !isStub && (
                    <span className="text-[10px] font-semibold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">
                      Historic
                    </span>
                  )}
                </div>
              </div>
              {brief.subtitle && (
                <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{brief.subtitle}</p>
              )}
              {!isStub && (
                <div className="flex items-center gap-3 mt-2">
                  {brief.keywords?.length > 0 && (
                    <span className="text-[10px] text-slate-400">🔑 {brief.keywords.length} keywords</span>
                  )}
                  {isRead && (
                    <span className="text-[10px] text-emerald-600 font-semibold">✓ Read</span>
                  )}
                  {isStarted && !isRead && (
                    <span className="text-[10px] text-amber-600 font-semibold">◑ In Progress</span>
                  )}
                  {quizPassed && (
                    <span className="text-[10px] text-amber-600 font-semibold">★ Quiz Passed</span>
                  )}
                </div>
              )}
            </div>

            {/* Arrow / lock hint */}
            {locked
              ? <div className="text-slate-400 mt-1 shrink-0 text-xs font-semibold">Unlock →</div>
              : <div className={`transition-colors mt-1 shrink-0 ${arrowClass}`}>→</div>
            }
          </>
        )

        return locked ? (
          <button
            onClick={onLockedClick}
            className={`w-full text-left flex items-start gap-4 p-4 rounded-2xl border transition-all group ${cardClass} opacity-50 hover:opacity-75`}
          >
            {inner}
          </button>
        ) : (
          <Link
            to={`/brief/${brief._id}`}
            className={`flex items-start gap-4 p-4 rounded-2xl border transition-all group ${cardClass} hover:-translate-y-0.5 cursor-pointer ${isStub ? 'opacity-55 hover:opacity-75' : ''}`}
          >
            {inner}
          </Link>
        )
      })()}
    </motion.div>
  )
}

export default function CategoryBriefs() {
  const { category }       = useParams()
  const { user, API }      = useAuth()
  const { settings }       = useAppSettings()
  const navigate           = useNavigate()
  const [briefs,      setBriefs]      = useState([])
  const [total,       setTotal]       = useState(0)
  const [hasMore,     setHasMore]     = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [page,        setPage]        = useState(1)
  const [readIds,     setReadIds]     = useState(new Set())
  const [startedIds,  setStartedIds]  = useState(new Set())
  const [passedIds,   setPassedIds]   = useState(new Set())
  const [loading,     setLoading]     = useState(true)
  const [activeSubcat, setSubcat]     = useState('all')
  const [search,      setSearch]      = useState('')
  const [lockedModal, setLockedModal] = useState(null)

  const LIMIT = 30
  const icon        = CATEGORY_ICONS[category] ?? '📄'
  const subs        = SUBCATEGORIES[category]  ?? []
  const isPageLocked = settings ? isCategoryLocked(category, user, settings) : false

  useEffect(() => {
    setLoading(true)
    setPage(1)
    setBriefs([])
    Promise.all([
      fetch(`${API}/api/briefs?category=${encodeURIComponent(category)}&limit=${LIMIT}&page=1`, { credentials: 'include' }).then(r => r.json()),
      user
        ? fetch(`${API}/api/users/me/read-briefs`, { credentials: 'include' }).then(r => r.json())
        : Promise.resolve(null),
      user
        ? fetch(`${API}/api/games/quiz/completed-brief-ids`, { credentials: 'include' }).then(r => r.json())
        : Promise.resolve(null),
    ])
      .then(([briefsData, readData, quizData]) => {
        const incoming = briefsData.data?.briefs ?? []
        const tot      = briefsData.data?.total  ?? incoming.length
        setBriefs(incoming)
        setTotal(tot)
        setHasMore(incoming.length < tot)
        setReadIds(new Set(readData?.data?.briefIds   ?? []))
        setStartedIds(new Set(readData?.data?.startedIds ?? []))
        setPassedIds(new Set(quizData?.data?.ids      ?? []))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [category, user, API])

  async function handleLoadMore() {
    const next = page + 1
    setPage(next)
    setLoadingMore(true)
    try {
      const data = await fetch(
        `${API}/api/briefs?category=${encodeURIComponent(category)}&limit=${LIMIT}&page=${next}`,
        { credentials: 'include' }
      ).then(r => r.json())
      const incoming = data?.data?.briefs ?? []
      setBriefs(prev => {
        const updated = [...prev, ...incoming]
        setHasMore(updated.length < (data?.data?.total ?? updated.length))
        return updated
      })
    } catch {}
    finally { setLoadingMore(false) }
  }

  const filtered = briefs
    .filter(b => activeSubcat === 'all' || b.subcategory === activeSubcat)
    .filter(b => !search || b.title?.toLowerCase().includes(search.toLowerCase()) || b.subtitle?.toLowerCase().includes(search.toLowerCase()))

  const totalRead = briefs.filter(b => readIds.has(b._id)).length
  const pct       = total > 0 ? Math.round((totalRead / total) * 100) : 0

  if (isPageLocked) {
    return (
      <LockedCategoryModal
        category={category}
        tier={requiredTier(category, settings)}
        user={user}
        onClose={() => navigate('/learn')}
      />
    )
  }

  return (
    <div>
      {/* Back */}
      <button
        onClick={() => navigate('/learn')}
        className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-5 transition-colors"
      >
        ← Back
      </button>

      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <span className="text-4xl">{icon}</span>
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">{category}</h1>
          <p className="text-sm text-slate-500">{briefs.length} intel briefs</p>
        </div>
      </div>

      {/* Progress */}
      <div className="bg-surface rounded-2xl p-4 mb-5 border border-slate-200 card-shadow">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-slate-700">Your Progress</span>
          <span className="text-sm font-bold text-brand-600">{pct}%</span>
        </div>
        <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-brand-500 rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.7, ease: 'easeOut' }}
          />
        </div>
        <p className="text-xs text-slate-400 mt-2">{totalRead} of {briefs.length} briefs read</p>
      </div>

      {/* Search bar */}
      <div className="relative mb-4">
        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search briefs…"
          className="w-full pl-9 pr-8 py-2.5 rounded-xl border border-slate-200 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none text-sm bg-surface transition-all"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-sm">✕</button>
        )}
      </div>

      {/* Subcategory filter */}
      {subs.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2 mb-5 scrollbar-none">
          <button
            onClick={() => setSubcat('all')}
            className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors
              ${activeSubcat === 'all'
                ? 'bg-brand-600 text-white border-brand-600'
                : 'bg-surface text-slate-600 border-slate-200 hover:border-brand-300'}`}
          >
            All
          </button>
          {subs.map(s => (
            <button
              key={s}
              onClick={() => setSubcat(s)}
              className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors
                ${activeSubcat === s
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-surface text-slate-600 border-slate-200 hover:border-brand-300'}`}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Brief list */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-surface rounded-2xl p-4 border border-slate-100 animate-pulse h-20" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <div className="text-4xl mb-3">📭</div>
          <p className="font-semibold">No briefs in this section yet.</p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {filtered.map((brief, i) => (
              <BriefNode
                key={brief._id}
                brief={brief}
                index={i}
                isRead={readIds.has(brief._id)}
                isStarted={startedIds.has(brief._id)}
                quizPassed={passedIds.has(brief._id)}
                onLockedClick={brief.isLocked
                  ? () => setLockedModal({ category: brief.category, tier: requiredTier(brief.category, settings) })
                  : undefined}
              />
            ))}
          </div>
          {hasMore && !search && activeSubcat === 'all' && (
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="w-full mt-4 py-3 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:border-brand-300 hover:text-brand-600 disabled:opacity-40 transition-all"
            >
              {loadingMore ? 'Loading…' : 'Load More'}
            </button>
          )}
        </>
      )}

      {lockedModal && (
        <LockedCategoryModal
          category={lockedModal.category}
          tier={lockedModal.tier}
          user={user}
          onClose={() => setLockedModal(null)}
        />
      )}
    </div>
  )
}
