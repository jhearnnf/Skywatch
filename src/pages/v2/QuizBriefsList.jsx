import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'

const TABS = ['Available', 'Completed', 'All']

export default function QuizBriefsList() {
  const { user, API } = useAuth()

  const [briefs,               setBriefs]               = useState([])
  const [readBriefIds,         setReadBriefIds]         = useState(new Set())
  const [quizPlayableBriefIds, setQuizPlayableBriefIds] = useState(new Set())
  const [passedBriefIds,       setPassedBriefIds]       = useState(new Set())
  const [loading,              setLoading]              = useState(true)
  const [activeTab,            setActiveTab]            = useState('Available')
  const [search,               setSearch]              = useState('')

  useEffect(() => {
    if (!user) {
      setReadBriefIds(new Set())
      setQuizPlayableBriefIds(new Set())
      setPassedBriefIds(new Set())
      setLoading(false)
      return
    }

    Promise.all([
      fetch(`${API}/api/briefs?limit=200`, { credentials: 'include' }).then(r => r.json()),
      fetch(`${API}/api/briefs/completed-brief-ids`,        { credentials: 'include' }).then(r => r.json()),
      fetch(`${API}/api/games/quiz/playable-brief-ids`,     { credentials: 'include' }).then(r => r.json()),
      fetch(`${API}/api/games/quiz/completed-brief-ids`,    { credentials: 'include' }).then(r => r.json()),
    ])
      .then(([briefsData, readData, playableData, passedData]) => {
        setBriefs(briefsData?.data?.briefs ?? [])
        setReadBriefIds(new Set(readData?.data?.ids ?? []))
        setQuizPlayableBriefIds(new Set(playableData?.data?.ids ?? []))
        setPassedBriefIds(new Set(passedData?.data?.ids ?? []))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [user, API])

  function getState(brief) {
    if (!quizPlayableBriefIds.has(brief._id)) return 'no-questions'
    if (passedBriefIds.has(brief._id)) return 'passed'
    if (!readBriefIds.has(brief._id)) return 'needs-read'
    return 'active'
  }

  const filtered = briefs
    .filter(b => {
      const s = getState(b)
      if (activeTab === 'Available')  return s === 'active' || s === 'needs-read'
      if (activeTab === 'Completed')  return s === 'passed'
      return true
    })
    .filter(b => {
      if (!search.trim()) return true
      const q = search.toLowerCase()
      return b.title.toLowerCase().includes(q) || b.category?.toLowerCase().includes(q)
    })
    .sort((a, b) => {
      const ORDER = { 'active': 0, 'needs-read': 1, 'passed': 2, 'no-questions': 3 }
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
          <p className="font-semibold text-slate-600 mb-2">Sign in to track your quiz progress</p>
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

            if (state === 'no-questions') {
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
                    <span className="text-xs text-slate-400 shrink-0">No questions yet</span>
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
      )}
    </div>
  )
}
