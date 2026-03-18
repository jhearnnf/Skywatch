import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'

const TABS = ['Available', 'Completed', 'All']

const BOO_CATEGORIES = ['Aircrafts', 'Ranks', 'Training', 'Missions', 'Tech', 'Treaties']

export default function BOOBriefsList() {
  const { user, API } = useAuth()

  const [briefs,                setBriefs]                = useState([])
  const [passedBriefIds,        setPassedBriefIds]        = useState(new Set())
  const [booAvailableCategories,setBooAvailableCategories]= useState(new Set())
  const [loading,               setLoading]               = useState(true)
  const [activeTab,             setActiveTab]             = useState('Available')
  const [search,                setSearch]               = useState('')

  useEffect(() => {
    if (!user) {
      setPassedBriefIds(new Set())
      setBooAvailableCategories(new Set())
      setLoading(false)
      return
    }

    Promise.all([
      fetch(`${API}/api/briefs?limit=200`, { credentials: 'include' }).then(r => r.json()),
      fetch(`${API}/api/games/quiz/completed-brief-ids`,            { credentials: 'include' }).then(r => r.json()),
      fetch(`${API}/api/games/battle-of-order/available-categories`,{ credentials: 'include' }).then(r => r.json()),
    ])
      .then(([briefsData, passedData, catData]) => {
        // Only show BOO-eligible category briefs
        const all = briefsData?.data?.briefs ?? []
        setBriefs(all.filter(b => BOO_CATEGORIES.includes(b.category)))
        setPassedBriefIds(new Set(passedData?.data?.ids ?? []))
        setBooAvailableCategories(new Set(catData?.data?.categories ?? []))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [user, API])

  // Returns: 'no-data' | 'needs-quiz' | 'active'
  function getState(brief) {
    if (!booAvailableCategories.has(brief.category)) return 'no-data'
    if (!passedBriefIds.has(brief._id)) return 'needs-quiz'
    return 'active'
  }

  const filtered = briefs
    .filter(b => {
      const s = getState(b)
      if (activeTab === 'Available') return s === 'active' || s === 'needs-quiz'
      if (activeTab === 'Completed') return s === 'active'
      return true
    })
    .filter(b => {
      if (!search.trim()) return true
      const q = search.toLowerCase()
      return b.title.toLowerCase().includes(q) || b.category?.toLowerCase().includes(q)
    })
    .sort((a, b) => {
      const ORDER = { 'active': 0, 'needs-quiz': 1, 'no-data': 2 }
      return (ORDER[getState(a)] ?? 99) - (ORDER[getState(b)] ?? 99)
    })

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          to="/play"
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors"
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
            onClick={() => setActiveTab(tab)}
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
          <p className="font-semibold text-slate-600 mb-2">Sign in to play Battle of Order</p>
          <Link to="/login" className="text-brand-600 font-semibold text-sm hover:text-brand-700">Sign In →</Link>
        </div>
      ) : loading ? (
        <div className="space-y-3 animate-pulse">
          {[...Array(6)].map((_, i) => <div key={i} className="h-16 bg-slate-100 rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="font-semibold text-slate-600 mb-1">
            {search ? 'No briefs match your search' : 'No briefs in this category yet'}
          </p>
          <Link to="/learn" className="text-brand-600 font-semibold text-sm hover:text-brand-700">Browse all briefs →</Link>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((brief, i) => {
            const state = getState(brief)

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

            return (
              <motion.div
                key={brief._id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
              >
                <Link
                  to={`/battle-of-order/${brief._id}`}
                  className="flex items-center gap-3 rounded-xl px-4 py-3 border bg-slate-50 border-slate-200 hover:border-brand-300 hover:bg-brand-50 transition-all group"
                >
                  <div className="w-8 h-8 rounded-xl bg-slate-800 flex items-center justify-center shrink-0 group-hover:bg-slate-700 transition-colors">
                    <span className="font-bold text-xs text-white">⊞</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-800 truncate">{brief.title}</p>
                    <p className="text-xs text-slate-400">{brief.category}</p>
                  </div>
                  <span className="text-slate-300 group-hover:text-brand-400 transition-colors">→</span>
                </Link>
              </motion.div>
            )
          })}
        </div>
      )}
    </div>
  )
}
