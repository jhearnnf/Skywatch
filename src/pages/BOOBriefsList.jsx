import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import SEO from '../components/SEO'

const TABS = ['Available', 'Completed', 'All']
const TAB_STATE = { Available: 'available', Completed: 'completed', All: 'all' }
const LIMIT = 20

export default function BOOBriefsList() {
  const { user, API, apiFetch } = useAuth()

  const [briefs,      setBriefs]      = useState([])
  const [hasMore,     setHasMore]     = useState(false)
  const [loading,     setLoading]     = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [activeTab,   setActiveTab]   = useState('Available')
  const [search,      setSearch]      = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page,        setPage]        = useState(1)

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350)
    return () => clearTimeout(t)
  }, [search])

  const fetchBriefs = useCallback(async (pageNum, reset) => {
    if (!user) return
    if (reset) setLoading(true)
    else       setLoadingMore(true)

    try {
      const params = new URLSearchParams({
        state: TAB_STATE[activeTab],
        page:  pageNum,
        limit: LIMIT,
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
      })
      const data = await apiFetch(`${API}/api/games/battle-of-order/briefs?${params}`, { credentials: 'include' })
        .then(r => r.json())

      const incoming = data?.data?.briefs ?? []
      setBriefs(prev => reset ? incoming : [...prev, ...incoming])
      setHasMore(pageNum < (data?.data?.totalPages ?? 0))
    } catch {}
    finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [user, API, activeTab, debouncedSearch])

  // Reset + fetch when tab or search changes
  useEffect(() => {
    if (!user) { setLoading(false); return }
    setPage(1)
    setBriefs([])
    fetchBriefs(1, true)
  }, [activeTab, debouncedSearch, user]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleTabChange(tab) {
    if (tab === activeTab) return
    setActiveTab(tab)
    setSearch('')
    setDebouncedSearch('')
  }

  function handleLoadMore() {
    const next = page + 1
    setPage(next)
    fetchBriefs(next, false)
  }

  return (
    <div>
      <SEO title="Battle of Order — Choose a Brief" description="Select an intel brief for Battle of Order." noIndex={true} />
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          to="/play"
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-violet-400 transition-colors"
        >
          ← Back
        </Link>
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">🗺️ Battle of Order</h1>
          <p className="text-sm text-slate-500">All eligible briefs for Battle of Order</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <input
          type="text"
          placeholder="Search briefs…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full bg-surface border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-500/20 transition-all"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
          >
            ✕
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 mb-5">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => handleTabChange(tab)}
            className={`flex-1 py-1.5 rounded-lg text-sm font-semibold transition-all
              ${activeTab === tab
                ? 'bg-violet-500/15 text-violet-400 shadow-sm'
                : 'text-slate-600 hover:text-slate-700'
              }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {!user ? (
        <div className="text-center py-16 text-slate-400">
          <p className="font-semibold text-slate-600 mb-2">Sign in to play Battle of Order</p>
          <Link to="/login" className="text-brand-600 font-semibold text-sm hover:text-brand-700">Sign In →</Link>
        </div>
      ) : loading ? (
        <div className="space-y-3 animate-pulse">
          {[...Array(6)].map((_, i) => <div key={i} className="h-16 bg-slate-100 rounded-xl" />)}
        </div>
      ) : briefs.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="font-semibold text-slate-600 mb-1">
            {debouncedSearch ? 'No briefs match your search' : 'No briefs in this category yet'}
          </p>
          <Link to="/learn-priority" className="text-brand-600 font-semibold text-sm hover:text-brand-700">Browse all briefs →</Link>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {briefs.map((brief, i) => {
              const state = brief.booState

              if (state === 'needs-aircraft-reads') {
                return (
                  <motion.div
                    key={brief._id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                  >
                    <div className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3 border border-slate-200 opacity-60 cursor-not-allowed">
                      <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                        <span className="text-slate-400 text-xs">🔒</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">{brief.title}</p>
                        <p className="text-xs text-slate-400">{brief.category}</p>
                      </div>
                      <span className="text-xs text-slate-400 shrink-0">Read more Aircrafts</span>
                    </div>
                  </motion.div>
                )
              }

              if (state === 'no-data') {
                return (
                  <motion.div
                    key={brief._id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                  >
                    <div className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3 border border-slate-200 opacity-60 cursor-not-allowed">
                      <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                        <span className="text-slate-400 text-xs">🔒</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">{brief.title}</p>
                        <p className="text-xs text-slate-400">{brief.category}</p>
                      </div>
                      <span className="text-xs text-slate-400 shrink-0">No data yet</span>
                    </div>
                  </motion.div>
                )
              }

              if (state === 'needs-more-reads') {
                return (
                  <motion.div
                    key={brief._id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                  >
                    <div className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3 border border-slate-200 opacity-60 cursor-not-allowed">
                      <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                        <span className="text-slate-400 text-xs">📚</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">{brief.title}</p>
                        <p className="text-xs text-slate-400">{brief.category}</p>
                      </div>
                      <span className="text-xs text-slate-400 shrink-0">Read more {brief.category}</span>
                    </div>
                  </motion.div>
                )
              }

              if (state === 'needs-read') {
                return (
                  <motion.div
                    key={brief._id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                  >
                    <Link
                      to={`/brief/${brief._id}`}
                      className="flex items-center gap-3 rounded-xl px-4 py-3 border bg-amber-50 border-amber-200 hover:border-amber-300 transition-all group"
                    >
                      <div className="w-8 h-8 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                        <span className="font-bold text-xs text-amber-600">📖</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">{brief.title}</p>
                        <p className="text-xs text-slate-400">{brief.category}</p>
                      </div>
                      <span className="text-xs font-semibold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full shrink-0">
                        Read first →
                      </span>
                    </Link>
                  </motion.div>
                )
              }

              if (state === 'needs-quiz') {
                return (
                  <motion.div
                    key={brief._id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                  >
                    <Link
                      to={`/quiz/${brief._id}`}
                      className="flex items-center gap-3 rounded-xl px-4 py-3 border bg-amber-50 border-amber-200 hover:border-amber-300 transition-all group"
                    >
                      <div className="w-8 h-8 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                        <span className="font-bold text-xs text-amber-600">🧠</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">{brief.title}</p>
                        <p className="text-xs text-slate-400">{brief.category}</p>
                      </div>
                      <span className="text-xs font-semibold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full shrink-0">
                        Pass quiz first →
                      </span>
                    </Link>
                  </motion.div>
                )
              }

              const completed = state === 'completed'
              return (
                <motion.div
                  key={brief._id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                >
                  <Link
                    to={`/battle-of-order/${brief._id}`}
                    className={`flex items-center gap-3 rounded-xl px-4 py-3 border transition-all group
                      ${completed
                        ? 'bg-emerald-50/60 border-emerald-200 hover:border-emerald-300'
                        : 'bg-slate-50 border-slate-200 hover:border-violet-400 hover:bg-violet-500/10'
                      }`}
                  >
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0
                      ${completed ? 'bg-emerald-500' : 'bg-violet-500/20 group-hover:bg-violet-500/30 transition-colors'}`}
                    >
                      {completed ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="5 13 10 18 19 7" />
                        </svg>
                      ) : (
                        <span className="font-bold text-xs text-white">⊞</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-800 truncate">{brief.title}</p>
                      <p className="text-xs text-slate-400">{brief.category}</p>
                    </div>
                    {completed
                      ? <span className="text-xs font-bold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full shrink-0">✓ Played</span>
                      : <span className="text-slate-300 group-hover:text-violet-400 transition-colors">→</span>
                    }
                  </Link>
                </motion.div>
              )
            })}
          </div>

          {hasMore && (
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="w-full mt-4 py-3 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:border-violet-400 hover:text-violet-400 disabled:opacity-40 transition-all"
            >
              {loadingMore ? 'Loading…' : 'Load More'}
            </button>
          )}
        </>
      )}
    </div>
  )
}
