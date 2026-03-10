import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'

const GAME_MODES = [
  {
    key: 'quiz',
    emoji: '🧠',
    title: 'Intel Quiz',
    desc: 'Test your knowledge on a specific brief. Standard or Advanced difficulty.',
    available: true,
    badge: null,
  },
  {
    key: 'flashcard',
    emoji: '⚡',
    title: 'Flashcard Recall',
    desc: 'Quick-fire keyword and terminology drills.',
    available: false,
    badge: 'Coming soon',
  },
  {
    key: 'whos-at-aircraft',
    emoji: '✈️',
    title: "Who's at Aircraft",
    desc: 'Identify aircraft and match them to their squadrons.',
    available: false,
    badge: 'Coming soon',
  },
  {
    key: 'battle-order',
    emoji: '🗺️',
    title: 'Battle Order',
    desc: 'Arrange squadrons, bases, and assets in correct operational order.',
    available: false,
    badge: 'Coming soon',
  },
]

export default function Play() {
  const { user, API } = useAuth()
  const navigate = useNavigate()
  const [recentBriefs, setRecentBriefs] = useState([])

  // Fetch recently read briefs to suggest as quiz starting points
  useEffect(() => {
    if (!user) return
    fetch(`${API}/api/briefs?limit=6`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => setRecentBriefs(data?.data?.briefs ?? []))
      .catch(() => {})
  }, [user, API])

  return (
    <div>
      <h1 className="text-2xl font-extrabold text-slate-900 mb-1">Play</h1>
      <p className="text-sm text-slate-500 mb-6">Test your RAF knowledge with training games.</p>

      {/* Game mode grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
        {GAME_MODES.map((mode, i) => (
          <motion.div
            key={mode.key}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06, duration: 0.35 }}
          >
            <div
              className={`relative flex items-start gap-4 bg-white rounded-2xl p-4 border transition-all card-shadow
                ${mode.available
                  ? 'border-slate-200 hover:border-brand-300 hover:bg-brand-50 cursor-pointer group hover:-translate-y-0.5'
                  : 'border-slate-100 opacity-60'
                }`}
              onClick={() => {
                if (!mode.available) return
                if (mode.key === 'quiz') navigate('/learn')
              }}
              role={mode.available ? 'button' : undefined}
              tabIndex={mode.available ? 0 : undefined}
            >
              <span className="text-3xl shrink-0 group-hover:scale-110 transition-transform">{mode.emoji}</span>
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="font-bold text-slate-800">{mode.title}</p>
                  {mode.badge && (
                    <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">{mode.badge}</span>
                  )}
                </div>
                <p className="text-xs text-slate-400">{mode.desc}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Quiz launcher — pick a brief */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-bold text-slate-800">Start a Quiz</h2>
        <Link to="/learn" className="text-xs font-semibold text-brand-600 hover:text-brand-700">Browse briefs →</Link>
      </div>

      {!user ? (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 text-center">
          <p className="text-sm text-slate-500 mb-3">Sign in to take quizzes and earn Aircoins.</p>
          <Link to="/login" className="inline-flex px-5 py-2 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors">
            Sign In
          </Link>
        </div>
      ) : recentBriefs.length > 0 ? (
        <div className="space-y-2">
          {recentBriefs.map((brief, i) => (
            <motion.div
              key={brief._id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Link
                to={`/quiz/${brief._id}`}
                className="flex items-center gap-3 bg-white rounded-2xl px-4 py-3 border border-slate-200 hover:border-brand-300 hover:bg-brand-50 transition-all card-shadow group"
              >
                <div className="w-8 h-8 rounded-xl bg-brand-100 flex items-center justify-center shrink-0">
                  <span className="text-brand-600 font-bold text-xs">Q</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-800 truncate">{brief.title}</p>
                  <p className="text-xs text-slate-400">{brief.category}</p>
                </div>
                <span className="text-slate-300 group-hover:text-brand-400 transition-colors">→</span>
              </Link>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 text-center">
          <p className="text-sm text-slate-500 mb-3">Read some briefs first, then return here to quiz yourself.</p>
          <Link to="/learn" className="inline-flex px-5 py-2 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors">
            Browse Briefs
          </Link>
        </div>
      )}

      {/* Game history */}
      {user && (
        <div className="mt-6">
          <Link
            to="/game-history"
            className="flex items-center justify-between bg-white rounded-2xl px-4 py-3 border border-slate-200 hover:border-brand-300 transition-all card-shadow text-sm font-semibold text-slate-700"
          >
            <span>📜 View game history</span>
            <span className="text-slate-400">→</span>
          </Link>
        </div>
      )}
    </div>
  )
}
