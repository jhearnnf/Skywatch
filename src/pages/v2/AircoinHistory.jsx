import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'

const REASON_LABELS = {
  brief_read:      'Intel Brief Read',
  quiz:            'Quiz Completed',
  order_of_battle: 'Battle of Order',
  whos_at_aircraft:"Where's That Aircraft",
  flashcard:       'Flashcard Recall',
  admin:           'Admin Award',
  login:           'Daily Login',
}

const REASON_ICONS = {
  brief_read:      '📄',
  quiz:            '🎯',
  order_of_battle: '📋',
  whos_at_aircraft:'✈️',
  flashcard:       '🃏',
  admin:           '⚙️',
  login:           '🔐',
}

function formatDate(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

export default function AircoinHistory() {
  const { user, API } = useAuth()
  const navigate = useNavigate()

  const [logs,    setLogs]    = useState([])
  const [total,   setTotal]   = useState(0)
  const [page,    setPage]    = useState(1)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  const LIMIT = 30

  const fetchHistory = useCallback(async (p) => {
    setLoading(true); setError(null)
    try {
      const res  = await fetch(`${API}/api/users/aircoins/history?page=${p}&limit=${LIMIT}`, { credentials: 'include' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.message || 'Failed to load history')
      setLogs(json.data.logs)
      setTotal(json.data.total)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [API])

  useEffect(() => {
    if (!user) { navigate('/login'); return }
    fetchHistory(page)
  }, [user, page, fetchHistory, navigate])

  const totalPages = Math.ceil(total / LIMIT)

  return (
    <div className="max-w-lg mx-auto">

      {/* Header */}
      <div className="mb-5">
        <button onClick={() => navigate('/profile')} className="text-sm text-slate-500 hover:text-slate-700 transition-colors mb-3 flex items-center gap-1">
          ← Back
        </button>
        <h1 className="text-2xl font-extrabold text-slate-900">Aircoin Ledger</h1>
        <p className="text-sm text-slate-500 mt-0.5">Your complete rewards history.</p>
      </div>

      {/* Balance card */}
      <div className="bg-gradient-to-r from-amber-500 to-amber-400 rounded-2xl p-4 mb-5 text-white card-shadow">
        <p className="text-xs font-bold text-amber-100 uppercase tracking-wider mb-1">Total Balance</p>
        <p className="text-3xl font-extrabold">⭐ {(user?.totalAircoins ?? 0).toLocaleString()}</p>
        <p className="text-amber-100 text-xs mt-1">{total} award{total !== 1 ? 's' : ''} on record</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-2xl mb-4">{error}</div>
      )}

      {/* Log list */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-surface rounded-2xl p-4 border border-slate-100 animate-pulse h-16" />
          ))}
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <div className="text-4xl mb-3">⭐</div>
          <p className="font-semibold">No awards on record yet.</p>
          <p className="text-sm mt-1">Read intel briefs and complete quizzes to earn Aircoins.</p>
        </div>
      ) : (
        <div className="bg-surface rounded-2xl border border-slate-200 card-shadow overflow-hidden">
          {logs.map((log, i) => (
            <motion.div
              key={log._id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.025 }}
              className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-0"
            >
              <div className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center shrink-0 text-lg">
                {REASON_ICONS[log.reason] ?? '⭐'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">
                  {REASON_LABELS[log.reason] ?? log.reason}
                </p>
                {log.label && <p className="text-xs text-slate-400 truncate">{log.label}</p>}
                <p className="text-[10px] text-slate-400 mt-0.5">{formatDate(log.createdAt)}</p>
              </div>
              <span className="text-sm font-extrabold text-amber-600 shrink-0">
                +{log.amount.toLocaleString()} ⭐
              </span>
            </motion.div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 gap-3">
          <button
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
            className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:border-brand-300 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            ← Prev
          </button>
          <span className="text-sm text-slate-500 font-semibold whitespace-nowrap">
            {page} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}
            className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:border-brand-300 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
