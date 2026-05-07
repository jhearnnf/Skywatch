import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import SEO from '../components/SEO'

const GAME_LABELS = {
  'plane-turn':       'Plane Turn',
  'angles':           'Angles',
  'code-duplicates':  'Code Duplicates',
  'symbols':          'Symbols',
  'target':           'Target',
  'instruments':      'Instruments',
  'ant':              'Airborne Numerical Test',
  'flag':             'FLAG',
  'visualisation-2d': 'Visualisation 2D',
  'dpt':              'DPT',
}

const PRIMARY_LABELS = {
  totalRotations: 'Rotations',
  correctCount:   'Correct',
  totalScore:     'Score',
}

function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}
function formatTime(secs) {
  if (!secs && secs !== 0) return null
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m ${secs % 60}s`
}

function StatusBadge({ status }) {
  const cls = 'text-[10px] font-extrabold px-2 py-0.5 rounded-full'
  if (status === 'finished')  return <span className={`${cls} bg-emerald-100 text-emerald-700`}>Finished</span>
  if (status === 'abandoned') return <span className={`${cls} bg-slate-100 text-slate-500`}>Abandoned</span>
  return <span className={`${cls} bg-slate-100 text-slate-500`}>{status}</span>
}

function SessionRow({ session, index }) {
  const score = session.primaryValue != null
    ? `${PRIMARY_LABELS[session.primaryField] ?? 'Score'}: ${session.primaryValue}`
    : null

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04 }}
      className="border-b border-slate-100 last:border-0"
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0 text-lg">
          🧪
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
            <span className="text-sm font-bold text-slate-800">{session.gameLabel}</span>
            <StatusBadge status={session.status} />
            {session.grade && (
              <span className="text-[10px] font-bold bg-brand-100 text-brand-600 px-1.5 py-0.5 rounded-full">
                {session.grade}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {score && <span className="text-[10px] text-slate-400 font-semibold">{score}</span>}
            {formatTime(session.totalTimeSeconds) && (
              <span className="text-[10px] text-slate-400">{formatTime(session.totalTimeSeconds)}</span>
            )}
            <span className="text-[10px] text-slate-400">
              {session.status === 'finished'
                ? formatDate(session.finishedAt)
                : `Started ${formatDate(session.startedAt)}`}
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

export default function CbatGameHistory() {
  const { user, API, apiFetch } = useAuth()
  const navigate  = useNavigate()
  const location  = useLocation()

  const adminUserId   = location.state?.adminUserId   ?? null
  const adminUserName = location.state?.adminUserName ?? null
  const isAdminView   = !!(adminUserId && user?.isAdmin)

  const [sessions,     setSessions]     = useState([])
  const [counts,       setCounts]       = useState({ total: 0, finished: 0, abandoned: 0 })
  const [total,        setTotal]        = useState(0)
  const [page,         setPage]         = useState(1)
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState(null)
  const [gameFilter,   setGameFilter]   = useState('all')
  const [resultFilter, setResultFilter] = useState('all')

  const LIMIT = 20

  const fetchHistory = useCallback(async (p, gameKey, result) => {
    setLoading(true); setError(null)
    try {
      const params = new URLSearchParams({ page: p, limit: LIMIT })
      if (gameKey !== 'all') params.set('gameKey', gameKey)
      if (result  !== 'all') params.set('result',  result)
      if (!isAdminView) {
        // No self-serve endpoint exists yet; this page is admin-only.
        throw new Error('Admin only')
      }
      const baseUrl = `${API}/api/admin/users/${adminUserId}/cbat-history`
      const res  = await apiFetch(`${baseUrl}?${params}`, { credentials: 'include' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.message || 'Failed to load history')
      setSessions(json.data.sessions)
      setTotal(json.data.total)
      setCounts(json.data.counts ?? { total: 0, finished: 0, abandoned: 0 })
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [API, isAdminView, adminUserId, apiFetch])

  useEffect(() => {
    if (!user) { navigate('/login'); return }
    if (!isAdminView) { navigate('/admin', { state: { tab: 'users' } }); return }
    fetchHistory(page, gameFilter, resultFilter)
  }, [user, isAdminView, page, gameFilter, resultFilter, fetchHistory, navigate])

  const changeGameFilter   = (val) => { setGameFilter(val);   setPage(1) }
  const changeResultFilter = (val) => { setResultFilter(val); setPage(1) }

  const totalPages = Math.ceil(total / LIMIT)

  return (
    <div className="max-w-lg mx-auto">
      <SEO title="CBAT Games" description="Review CBAT session history." noIndex={true} />

      {/* Header */}
      <div className="mb-4">
        <button
          onClick={() => navigate('/admin', { state: { tab: 'users' } })}
          className="text-sm text-slate-500 hover:text-slate-700 transition-colors mb-3 flex items-center gap-1"
        >
          ← Back to Admin
        </button>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] font-bold bg-brand-600 text-white px-2 py-0.5 rounded-full uppercase tracking-wider">Admin View</span>
        </div>
        <h1 className="text-2xl font-extrabold text-slate-900">CBAT Games</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Viewing CBAT sessions for <span className="font-semibold text-slate-700">{adminUserName}</span>
          {' — '}
          <span className="font-semibold text-emerald-700">{counts.finished}</span> finished
          {' · '}
          <span className="font-semibold text-slate-600">{counts.abandoned}</span> abandoned
          {' · '}
          {counts.total} total.
        </p>
      </div>

      {/* Filters */}
      <div className="space-y-2 mb-4">
        <div className="flex flex-wrap gap-1.5">
          {[
            { val: 'all', label: 'All Games' },
            ...Object.entries(GAME_LABELS).map(([val, label]) => ({ val, label })),
          ].map(({ val, label }) => (
            <button
              key={val}
              onClick={() => changeGameFilter(val)}
              className={`text-[11px] font-bold px-2.5 py-1 rounded-full transition-all
                ${gameFilter === val
                  ? 'bg-brand-600 text-white'
                  : 'bg-surface border border-slate-200 text-slate-500 hover:border-brand-300'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[
            { val: 'all',       label: 'All Results' },
            { val: 'finished',  label: '✓ Finished' },
            { val: 'abandoned', label: '— Abandoned' },
          ].map(({ val, label }) => (
            <button
              key={val}
              onClick={() => changeResultFilter(val)}
              className={`text-[11px] font-bold px-2.5 py-1 rounded-full transition-all
                ${resultFilter === val
                  ? 'bg-brand-600 text-white'
                  : 'bg-surface border border-slate-200 text-slate-500 hover:border-brand-300'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-2xl mb-4">{error}</div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-surface rounded-2xl p-4 border border-slate-100 animate-pulse h-20" />
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <div className="text-4xl mb-3">🧪</div>
          <p className="font-semibold">No CBAT sessions yet.</p>
          <p className="text-sm mt-1">CBAT games this user has started will appear here.</p>
        </div>
      ) : (
        <div className="bg-surface rounded-2xl border border-slate-200 card-shadow overflow-hidden">
          {sessions.map((s, i) => (
            <SessionRow key={s._id} session={s} index={i} />
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
          <span className="text-sm text-slate-500 font-semibold whitespace-nowrap">{page} / {totalPages}</span>
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
