import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import SEO from '../components/SEO'

const TABS = ['Available', 'Completed', 'All']
const TAB_STATE = { Available: 'available', Completed: 'completed', All: 'all' }
const LIMIT = 20

export default function QuizBriefsList() {
  const { user, API, apiFetch } = useAuth()

  const [briefs,        setBriefs]        = useState([])
  const [hasMore,       setHasMore]       = useState(false)
  const [availableMode, setAvailableMode] = useState(null)
  const [loading,       setLoading]       = useState(true)
  const [loadingMore,   setLoadingMore]   = useState(false)
  const [error,         setError]         = useState(null)
  const [activeTab,     setActiveTab]     = useState('Available')
  const [search,        setSearch]        = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page,          setPage]          = useState(1)

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350)
    return () => clearTimeout(t)
  }, [search])

  const fetchBriefs = useCallback(async (pageNum, reset) => {
    if (!user) return
    if (reset) { setLoading(true); setError(null) }
    else       setLoadingMore(true)

    try {
      const params = new URLSearchParams({
        state: TAB_STATE[activeTab],
        page:  pageNum,
        limit: LIMIT,
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
      })
      const res  = await apiFetch(`${API}/api/games/quiz/briefs?${params}`, { credentials: 'include' })
      const data = await res.json()

      if (!res.ok) {
        setError(data?.message ?? 'Failed to load briefs')
        return
      }

      const incoming = data?.data?.briefs ?? []
      setBriefs(prev => reset ? incoming : [...prev, ...incoming])
      setHasMore(pageNum < (data?.data?.totalPages ?? 0))
      if (reset) setAvailableMode(data?.data?.availableMode ?? null)
    } catch (err) {
      setError('Connection error — is the server running?')
    }
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
    setError(null)
  }

  function handleLoadMore() {
    const next = page + 1
    setPage(next)
    fetchBriefs(next, false)
  }

  return (
    <div>
      <SEO title="Quiz — Choose a Brief" description="Select an intel brief to start a quiz." noIndex={true} />
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          to="/play"
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors"
        >
          ← Back
        </Link>
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">🧠 Intel Quiz</h1>
          <p className="text-sm text-slate-500">All briefs available for quizzing</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <input
          type="text"
          placeholder="Search briefs…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full bg-surface border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition-all"
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
                ? 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
              }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {!user ? (
        <div className="text-center py-16 text-slate-400">
          <p className="font-semibold text-slate-600 mb-2">Sign in to track your quiz progress</p>
          <Link to="/login" className="text-brand-600 font-semibold text-sm hover:text-brand-700">Sign In →</Link>
        </div>
      ) : error ? (
        <div className="text-center py-16 text-slate-400">
          <p className="font-semibold text-red-600 mb-1">Something went wrong</p>
          <p className="text-xs text-slate-400 mb-3">{error}</p>
          <button
            onClick={() => fetchBriefs(1, true)}
            className="text-brand-600 font-semibold text-sm hover:text-brand-700"
          >
            Try again →
          </button>
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
          {/* Contextual banner for Available tab */}
          {activeTab === 'Available' && !debouncedSearch && availableMode === 'needs-read' && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-3">
              <span className="text-base shrink-0">📖</span>
              <p className="text-xs text-amber-800">Read these briefs to unlock their quizzes.</p>
            </div>
          )}
          {activeTab === 'Available' && !debouncedSearch && availableMode === 'all-passed' && (
            <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 mb-3">
              <span className="text-base shrink-0">🎉</span>
              <p className="text-xs text-emerald-800">All quizzes complete — replay any below to keep sharp.</p>
            </div>
          )}

          <div className="space-y-2">
            {briefs.map((brief, i) => {
              const state = brief.quizState

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

              const passed = state === 'passed'
              return (
                <motion.div
                  key={brief._id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                >
                  <Link
                    to={`/quiz/${brief._id}`}
                    className={`flex items-center gap-3 rounded-xl px-4 py-3 border transition-all group
                      ${passed
                        ? 'bg-emerald-50/60 border-emerald-200 hover:border-emerald-300'
                        : 'bg-slate-50 border-slate-200 hover:border-brand-300 hover:bg-brand-50'
                      }`}
                  >
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0
                      ${passed ? 'bg-emerald-100' : 'bg-brand-100'}`}
                    >
                      <span className={`font-bold text-xs ${passed ? 'text-emerald-600' : 'text-brand-600'}`}>
                        {passed ? '✓' : 'Q'}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-800 truncate">{brief.title}</p>
                      <p className="text-xs text-slate-400">{brief.category}</p>
                    </div>
                    {passed
                      ? <span className="text-xs font-bold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full shrink-0">✓ Passed</span>
                      : <span className="text-slate-300 group-hover:text-brand-400 transition-colors">→</span>
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
              className="w-full mt-4 py-3 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:border-brand-300 hover:text-brand-600 disabled:opacity-40 transition-all"
            >
              {loadingMore ? 'Loading…' : 'Load More'}
            </button>
          )}
        </>
      )}
    </div>
  )
}
