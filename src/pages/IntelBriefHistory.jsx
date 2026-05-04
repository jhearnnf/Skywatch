import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import SEO from '../components/SEO'
import CategoryHeader from '../components/CategoryHeader'

function formatDate(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

function formatTime(seconds) {
  if (!seconds || seconds < 1) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m === 0) return `${s}s`
  return s === 0 ? `${m}m` : `${m}m ${s}s`
}

function FlashcardRow({ read, index }) {
  const [expanded, setExpanded] = useState(false)

  const toggle = () => setExpanded(e => !e)

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.025 }}
      className="border-b border-slate-100 last:border-0"
    >
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors"
        onClick={toggle}
        role="button"
        tabIndex={0}
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && toggle()}
      >
        <div className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center shrink-0 text-lg">
          🃏
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate">{read.title}</p>
          <CategoryHeader
            category={read.category}
            subcategory={read.subcategory}
            briefId={read.briefId}
            className="mt-0.5"
          />
          <p className="text-[10px] text-slate-400 mt-0.5">{formatDate(read.flashcardUnlockedAt || read.completedAt || read.lastReadAt)}</p>
        </div>
        <span className="text-slate-400 text-xs shrink-0">{expanded ? '▲' : '▼'}</span>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            <div className="border-t border-slate-100 bg-amber-50/60 px-4 py-3 space-y-3">
              {/* Question */}
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Flashcard Question</p>
                {read.flashcardQuestion ? (
                  <p className="text-sm text-slate-700 leading-snug">{read.flashcardQuestion}</p>
                ) : (
                  <p className="text-sm text-slate-400 italic">No question available.</p>
                )}
              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

export default function IntelBriefHistory() {
  const { user, API, apiFetch } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const adminUserId   = location.state?.adminUserId   ?? null
  const adminUserName = location.state?.adminUserName ?? null
  const isAdminView   = !!(adminUserId && user?.isAdmin)

  const [tab, setTab] = useState('briefs') // 'briefs' | 'flashcards'

  // Briefs tab state
  const [reads,   setReads]   = useState([])
  const [total,   setTotal]   = useState(0)
  const [avgTime, setAvgTime] = useState(0)
  const [page,    setPage]    = useState(1)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  // Flashcards tab state
  const [fcReads,   setFcReads]   = useState([])
  const [fcTotal,   setFcTotal]   = useState(0)
  const [fcPage,    setFcPage]    = useState(1)
  const [fcLoading, setFcLoading] = useState(false)
  const [fcError,   setFcError]   = useState(null)

  const LIMIT = 30

  const fetchHistory = useCallback(async (p) => {
    setLoading(true); setError(null)
    try {
      const url = isAdminView
        ? `${API}/api/admin/users/${adminUserId}/brief-history?page=${p}&limit=${LIMIT}`
        : `${API}/api/briefs/history?page=${p}&limit=${LIMIT}`
      const res  = await apiFetch(url, { credentials: 'include' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.message || 'Failed to load history')
      setReads(json.data.reads)
      setTotal(json.data.total)
      setAvgTime(json.data.avgTimeSeconds)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [API, isAdminView, adminUserId])

  const fetchFlashcards = useCallback(async (p) => {
    setFcLoading(true); setFcError(null)
    try {
      const url = isAdminView
        ? `${API}/api/admin/users/${adminUserId}/brief-history?flashcard=1&page=${p}&limit=${LIMIT}`
        : `${API}/api/briefs/history?flashcard=1&page=${p}&limit=${LIMIT}`
      const res  = await apiFetch(url, { credentials: 'include' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.message || 'Failed to load flashcards')
      setFcReads(json.data.reads)
      setFcTotal(json.data.total)
    } catch (e) {
      setFcError(e.message)
    } finally {
      setFcLoading(false)
    }
  }, [API, isAdminView, adminUserId])

  useEffect(() => {
    if (!user) { navigate('/login'); return }
    fetchHistory(page)
  }, [user, page, fetchHistory, navigate])

  // Fetch flashcards tab when first opened or page changes
  useEffect(() => {
    if (!user || tab !== 'flashcards') return
    fetchFlashcards(fcPage)
  }, [user, tab, fcPage, fetchFlashcards])

  const totalPages   = Math.ceil(total / LIMIT)
  const fcTotalPages = Math.ceil(fcTotal / LIMIT)

  return (
    <div className="max-w-lg mx-auto">
      <SEO title="Brief History" description="Review the intel briefs you've read." noIndex={true} />

      {/* Header */}
      <div className="mb-5">
        {isAdminView ? (
          <>
            <button
              onClick={() => navigate('/admin', { state: { tab: 'users' } })}
              className="text-sm text-slate-500 hover:text-slate-700 transition-colors mb-3 flex items-center gap-1"
            >
              ← Back to Admin
            </button>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-bold bg-brand-600 text-white px-2 py-0.5 rounded-full uppercase tracking-wider">Admin View</span>
            </div>
            <h1 className="text-2xl font-extrabold text-slate-900">Intel Brief History</h1>
            <p className="text-sm text-slate-500 mt-0.5">Viewing briefs read by <span className="font-semibold text-slate-700">{adminUserName}</span>.</p>
          </>
        ) : (
          <>
            <button onClick={() => navigate('/profile')} className="text-sm text-slate-500 hover:text-slate-700 transition-colors mb-3 flex items-center gap-1">
              ← Back
            </button>
            <h1 className="text-2xl font-extrabold text-slate-900">Intel Brief History</h1>
            <p className="text-sm text-slate-500 mt-0.5">Every brief you've read, and your collected flashcards.</p>
          </>
        )}
      </div>

      {/* Tab toggle */}
      <div className="flex gap-2 mb-5">
        <button
          onClick={() => setTab('briefs')}
          className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all
            ${tab === 'briefs' ? 'bg-brand-600 text-white' : 'bg-surface border border-slate-200 text-slate-500 hover:border-brand-300'}`}
        >
          📋 Briefs Read
        </button>
        <button
          onClick={() => setTab('flashcards')}
          className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all
            ${tab === 'flashcards' ? 'bg-brand-600 text-white' : 'bg-surface border border-slate-200 text-slate-500 hover:border-brand-300'}`}
        >
          🃏 Flashcards
        </button>
      </div>

      {/* ── Briefs tab ── */}
      {tab === 'briefs' && (
        <motion.div key="briefs" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          {/* Avg read time card */}
          <div className="bg-gradient-to-r from-brand-700 to-brand-500 rounded-2xl p-4 mb-5 text-white card-shadow">
            <p className="text-xs font-bold text-brand-100 uppercase tracking-wider mb-1">Avg Read Time</p>
            <p className="text-3xl font-extrabold">{formatTime(avgTime)}</p>
            <p className="text-brand-100 text-xs mt-1">{total} brief{total !== 1 ? 's' : ''} on record</p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-2xl mb-4">{error}</div>
          )}

          {loading ? (
            <div className="space-y-2">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="bg-surface rounded-2xl p-4 border border-slate-100 animate-pulse h-16" />
              ))}
            </div>
          ) : reads.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <div className="text-4xl mb-3">📋</div>
              <p className="font-semibold">No briefs read yet.</p>
              <p className="text-sm mt-1">Head to the Learn page to start reading intel briefs.</p>
            </div>
          ) : (
            <div className="bg-surface rounded-2xl border border-slate-200 card-shadow overflow-hidden">
              {reads.map((read, i) => (
                <motion.div
                  key={read._id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.025 }}
                  className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-0"
                >
                  <div className="w-9 h-9 rounded-xl bg-brand-50 border border-brand-100 flex items-center justify-center shrink-0 text-lg">
                    📋
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{read.title}</p>
                    <CategoryHeader
                      category={read.category}
                      subcategory={read.subcategory}
                      briefId={read.briefId}
                      className="mt-0.5"
                    />
                    <p className="text-[10px] text-slate-400 mt-0.5">{formatDate(read.completedAt || read.lastReadAt)}</p>
                  </div>
                  <span className="text-sm font-bold text-slate-500 shrink-0 intel-mono">
                    {formatTime(read.timeSpentSeconds)}
                  </span>
                </motion.div>
              ))}
            </div>
          )}

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
        </motion.div>
      )}

      {/* ── Flashcards tab ── */}
      {tab === 'flashcards' && (
        <motion.div key="flashcards" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          {/* Summary card */}
          <div className="bg-gradient-to-r from-amber-600 to-amber-400 rounded-2xl p-4 mb-5 text-white card-shadow">
            <p className="text-xs font-bold text-amber-100 uppercase tracking-wider mb-1">Flashcards Collected</p>
            <p className="text-3xl font-extrabold">{fcTotal}</p>
          </div>

          {fcError && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-2xl mb-4">{fcError}</div>
          )}

          {fcLoading ? (
            <div className="space-y-2">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="bg-surface rounded-2xl p-4 border border-slate-100 animate-pulse h-16" />
              ))}
            </div>
          ) : fcReads.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <div className="text-4xl mb-3">🃏</div>
              <p className="font-semibold">No flashcards collected yet.</p>
              <p className="text-sm mt-1">Read briefs all the way through to unlock their flashcard.</p>
            </div>
          ) : (
            <div className="bg-surface rounded-2xl border border-slate-200 card-shadow overflow-hidden">
              {fcReads.map((read, i) => (
                <FlashcardRow key={read._id} read={read} index={i} />
              ))}
            </div>
          )}

          {fcTotalPages > 1 && (
            <div className="flex items-center justify-between mt-4 gap-3">
              <button
                disabled={fcPage <= 1}
                onClick={() => setFcPage(p => p - 1)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:border-brand-300 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                ← Prev
              </button>
              <span className="text-sm text-slate-500 font-semibold whitespace-nowrap">{fcPage} / {fcTotalPages}</span>
              <button
                disabled={fcPage >= fcTotalPages}
                onClick={() => setFcPage(p => p + 1)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:border-brand-300 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                Next →
              </button>
            </div>
          )}
        </motion.div>
      )}
    </div>
  )
}
