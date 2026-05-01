import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import SEO from '../components/SEO'

const TYPE_LABELS = {
  quiz:            'Intel Recall',
  wheres_that_aircraft: "Where's That Aircraft",
  wheres_aircraft:      "Where's That Aircraft",
  order_of_battle: 'Battle of Order',
  flashcard:       'Flashcards',
  aptitude_sync:   'APTITUDE_SYNC',
}
const TYPE_ICONS = {
  quiz:            '🎯',
  wheres_that_aircraft: '✈️',
  wheres_aircraft:      '✈️',
  order_of_battle: '📋',
  flashcard:       '🃏',
  aptitude_sync:   '🧠',
}
const ORDER_TYPE_META = {
  speed:           { label: 'Top Speed',       direction: 'Slowest → Fastest',    startLabel: 'Slowest',     endLabel: 'Fastest'     },
  year_introduced: { label: 'Year Introduced', direction: 'Oldest → Newest',      startLabel: 'Oldest',      endLabel: 'Newest'      },
  year_retired:    { label: 'Year Retired',    direction: 'Earliest → Latest',    startLabel: 'Earliest',    endLabel: 'Latest'      },
  rank_hierarchy:  { label: 'Rank Hierarchy',  direction: 'Most Senior → Junior', startLabel: 'Most Senior', endLabel: 'Most Junior' },
  training_week:   { label: 'Training Phase',  direction: 'First → Last Phase',   startLabel: 'First Phase', endLabel: 'Last Phase'  },
  start_year:      { label: 'Year Started',    direction: 'Earliest → Latest',    startLabel: 'Earliest',    endLabel: 'Latest'      },
  end_year:        { label: 'Year Concluded',  direction: 'Earliest → Latest',    startLabel: 'Earliest',    endLabel: 'Latest'      },
}

function formatDate(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}
function formatTime(secs) {
  if (!secs && secs !== 0) return null
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m ${secs % 60}s`
}

function StatusBadge({ session }) {
  const cls = 'text-[10px] font-extrabold px-2 py-0.5 rounded-full'
  if (session.type === 'quiz') {
    if (session.status === 'abandoned') return <span className={`${cls} bg-slate-100 text-slate-500`}>Abandoned</span>
    if (session.percentageCorrect === 100) return <span className={`${cls} bg-amber-100 text-amber-700`}>Perfect</span>
    if (session.percentageCorrect >= 60)   return <span className={`${cls} bg-emerald-100 text-emerald-700`}>Passed</span>
    return <span className={`${cls} bg-red-100 text-red-600`}>Failed</span>
  }
  if (session.type === 'flashcard') {
    if (session.status === 'abandoned') return <span className={`${cls} bg-slate-100 text-slate-500`}>Abandoned</span>
    if (session.status === 'perfect') return <span className={`${cls} bg-amber-100 text-amber-700`}>Perfect Recall</span>
    return <span className={`${cls} bg-emerald-100 text-emerald-700`}>Completed</span>
  }
  if (session.type === 'order_of_battle') {
    if (session.abandoned) return <span className={`${cls} bg-slate-100 text-slate-500`}>Abandoned</span>
    if (session.won)       return <span className={`${cls} bg-emerald-100 text-emerald-700`}>Victory</span>
    return <span className={`${cls} bg-red-100 text-red-600`}>Defeat</span>
  }
  if (session.type === 'wheres_aircraft') {
    if (session.status === 'abandoned') return <span className={`${cls} bg-slate-100 text-slate-500`}>Abandoned</span>
    if (session.won)                   return <span className={`${cls} bg-amber-100 text-amber-700`}>Full Mission</span>
    if (session.status === 'partial')  return <span className={`${cls} bg-emerald-100 text-emerald-700`}>Round 1 Only</span>
    return <span className={`${cls} bg-red-100 text-red-600`}>Mission Failed</span>
  }
  if (session.type === 'aptitude_sync') {
    if (session.status === 'abandoned') return <span className={`${cls} bg-slate-100 text-slate-500`}>Abandoned</span>
    return <span className={`${cls} bg-emerald-100 text-emerald-700`}>Completed</span>
  }
  if (session.isCorrect) return <span className={`${cls} bg-emerald-100 text-emerald-700`}>Correct</span>
  return <span className={`${cls} bg-red-100 text-red-600`}>Incorrect</span>
}

function QuizDrillDown({ attemptId }) {
  const { apiFetch, API } = useAuth()
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    setLoading(true)
    apiFetch(`${API}/api/games/history/quiz/${attemptId}`)
      .then(r => r.json())
      .then(json => {
        if (json.status === 'success') setData(json.data)
        else throw new Error(json.message || 'Failed to load')
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [attemptId, apiFetch])

  if (loading) return <div className="px-4 py-3 text-xs text-slate-400 animate-pulse">Loading breakdown…</div>
  if (error)   return <div className="px-4 py-3 text-xs text-red-500">{error}</div>
  if (!data)   return null

  return (
    <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 space-y-2">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
        Question Breakdown — {data.questions.length} questions
      </p>
      {data.questions.map((q, i) => (
        <div
          key={i}
          className={`rounded-xl p-3 border text-xs
            ${q.isCorrect ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-bold text-slate-700">Q{i + 1}</span>
            <div className="flex items-center gap-2">
              {formatTime(q.timeTakenSeconds) && (
                <span className="text-slate-400">{formatTime(q.timeTakenSeconds)}</span>
              )}
              <span className={q.isCorrect ? 'text-emerald-700 font-bold' : 'text-red-600 font-bold'}>
                {q.isCorrect ? '✓ Correct' : '✗ Incorrect'}
              </span>
            </div>
          </div>
          <p className="text-slate-700 mb-2 leading-snug">{q.questionText}</p>
          <div className="space-y-1">
            {q.displayedAnswers.map((a, j) => (
              <div
                key={j}
                className={`px-2 py-1 rounded-lg text-[11px] font-medium
                  ${a.isCorrect ? 'bg-emerald-100 text-emerald-800' :
                    a.isSelected && !a.isCorrect ? 'bg-red-100 text-red-700' :
                    'text-slate-500'}`}
              >
                {a.isCorrect ? '✓' : a.isSelected ? '✗' : '·'} {a.title}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function WtaDrillDown({ sessionId }) {
  const { apiFetch, API } = useAuth()
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    setLoading(true)
    apiFetch(`${API}/api/games/history/wheres-aircraft/${sessionId}`)
      .then(r => r.json())
      .then(json => {
        if (json.status === 'success') setData(json.data)
        else throw new Error(json.message || 'Failed to load')
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [sessionId, apiFetch])

  if (loading) return <div className="px-4 py-3 text-xs text-slate-400 animate-pulse">Loading mission data…</div>
  if (error)   return <div className="px-4 py-3 text-xs text-red-500">{error}</div>
  if (!data)   return null

  const correctIds = new Set((data.correctBases ?? []).map(b => String(b._id)))

  return (
    <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 space-y-3">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Mission Breakdown — {data.aircraftName}</p>

      {/* Round 1 */}
      <div className={`rounded-xl p-3 border text-xs ${data.round1Correct ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
        <div className="flex items-center justify-between">
          <span className="font-bold text-slate-700">Round 1 — Identify Aircraft</span>
          <span className={data.round1Correct ? 'text-emerald-700 font-bold' : 'text-red-600 font-bold'}>
            {data.round1Correct ? '✓ Correct' : '✗ Incorrect'}
          </span>
        </div>
      </div>

      {/* Round 2 */}
      {!data.round2Attempted ? (
        <div className="rounded-xl p-3 border border-slate-200 bg-white text-xs text-slate-400 italic">
          Round 2 not reached
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 overflow-hidden text-xs">
          <div className="flex items-center justify-between px-3 py-2 bg-white border-b border-slate-100">
            <span className="font-bold text-slate-700">Round 2 — Locate Bases</span>
            <span className={data.round2Correct ? 'text-emerald-700 font-bold' : 'text-red-600 font-bold'}>
              {data.round2Correct ? '✓ Correct' : '✗ Incorrect'}
            </span>
          </div>
          <div className="divide-y divide-slate-100">
            {/* Correct bases */}
            {(data.correctBases ?? []).map(base => {
              const selected = (data.selectedBases ?? []).some(s => String(s._id) === String(base._id))
              return (
                <div key={String(base._id)} className={`flex items-center justify-between px-3 py-2 ${selected ? 'bg-emerald-50' : 'bg-red-50'}`}>
                  <span className="text-slate-700">{base.title}</span>
                  <span className={selected ? 'text-emerald-600 font-bold' : 'text-red-500 font-bold'}>
                    {selected ? '✓ Selected' : '✗ Missed'}
                  </span>
                </div>
              )
            })}
            {/* Wrongly selected bases */}
            {(data.selectedBases ?? []).filter(s => !correctIds.has(String(s._id))).map(base => (
              <div key={String(base._id)} className="flex items-center justify-between px-3 py-2 bg-red-50">
                <span className="text-slate-700">{base.title}</span>
                <span className="text-red-500 font-bold">✗ Wrong</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function BooOrderDrillDown({ sessionId }) {
  const { apiFetch, API } = useAuth()
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    setLoading(true)
    apiFetch(`${API}/api/games/history/battle-of-order/${sessionId}`)
      .then(r => r.json())
      .then(json => {
        if (json.status === 'success') setData(json.data)
        else throw new Error(json.message || 'Failed to load')
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [sessionId, apiFetch])

  if (loading) return <div className="px-4 py-3 text-xs text-slate-400 animate-pulse">Loading order data…</div>
  if (error)   return <div className="px-4 py-3 text-xs text-red-500">{error}</div>
  if (!data)   return null

  const meta       = ORDER_TYPE_META[data.orderType]
  const typeLabel  = meta?.label     ?? data.orderType.replace(/_/g, ' ')
  const direction  = meta?.direction ?? ''
  const startLabel = meta?.startLabel ?? '#1'
  const endLabel   = meta?.endLabel   ?? `#${data.items.length}`
  const total      = data.items.length
  const byUserOrder = {}
  data.items.forEach(item => { if (item.userOrder != null) byUserOrder[item.userOrder] = item })

  return (
    <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-bold text-slate-700">{typeLabel}</span>
        <span className="text-[10px] text-slate-400">{direction}</span>
      </div>
      <div className="space-y-1.5">
        {data.items.map((item, i) => {
          const isStart = item.correctOrder === 1
          const isEnd   = item.correctOrder === total
          const userChoice = byUserOrder[item.correctOrder]
          return (
            <div
              key={i}
              className={`flex items-start gap-2 rounded-xl p-2.5 border text-xs
                ${item.isCorrect ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}
            >
              <span className={`shrink-0 font-extrabold text-[10px] px-1.5 py-0.5 rounded-full mt-0.5
                ${isStart ? 'bg-brand-100 text-brand-700' : isEnd ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                {isStart ? startLabel : isEnd ? endLabel : `#${item.correctOrder}`}
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-800 truncate">{item.briefTitle}</p>
                {item.displayValue && <p className="text-slate-400">{item.displayValue}</p>}
              </div>
              <span className="shrink-0 text-[10px] font-bold">
                {item.isCorrect ? (
                  <span className="text-emerald-600">✓</span>
                ) : (
                  <span className="text-red-500">✗ {userChoice?.briefTitle ?? '—'}</span>
                )}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function FlashcardCardRow({ c, index }) {
  const [open, setOpen] = useState(false)
  const hasSnippet = !!c.contentSnippet

  return (
    <div className={`rounded-xl border text-xs ${c.recalled ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
      <div
        className={`flex items-center gap-2 p-3 ${hasSnippet ? 'cursor-pointer select-none' : ''}`}
        onClick={() => hasSnippet && setOpen(o => !o)}
      >
        <span className="font-semibold text-slate-700 truncate flex-1 pr-1">{c.briefTitle}</span>
        <div className="flex items-center gap-2 shrink-0">
          {formatTime(c.timeTakenSeconds) && (
            <span className="text-slate-400">{formatTime(c.timeTakenSeconds)}</span>
          )}
          <span className={c.recalled ? 'text-emerald-700 font-bold' : 'text-red-600 font-bold'}>
            {c.recalled ? '✓ Recalled' : '✗ Missed'}
          </span>
          {hasSnippet && (
            <span className="text-slate-400 text-[10px]">{open ? '▲' : '▼'}</span>
          )}
        </div>
      </div>
      <AnimatePresence>
        {open && hasSnippet && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            style={{ overflow: 'hidden' }}
          >
            <div
              className="px-3 pb-3 pt-1 border-t text-[11px] leading-relaxed text-slate-600"
              style={{ borderColor: c.recalled ? '#a7f3d0' : '#fecaca' }}
            >
              {c.contentSnippet}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function FlashcardDrillDown({ sessionId }) {
  const { apiFetch, API } = useAuth()
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    setLoading(true)
    apiFetch(`${API}/api/games/history/flashcard/${sessionId}`)
      .then(r => r.json())
      .then(json => {
        if (json.status === 'success') setData(json.data)
        else throw new Error(json.message || 'Failed to load')
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [sessionId, apiFetch])

  if (loading) return <div className="px-4 py-3 text-xs text-slate-400 animate-pulse">Loading card breakdown…</div>
  if (error)   return <div className="px-4 py-3 text-xs text-red-500">{error}</div>
  if (!data)   return null

  return (
    <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 space-y-2">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
        Card Breakdown — {data.cards.length} card{data.cards.length !== 1 ? 's' : ''}
        {data.abandoned && <span className="ml-2 text-slate-400 normal-case font-normal">(abandoned)</span>}
      </p>
      {data.cards.map((c, i) => (
        <FlashcardCardRow key={i} c={c} index={i} />
      ))}
    </div>
  )
}

function AptitudeSyncDrillDown({ session }) {
  return (
    <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 space-y-3">
      {session.finalSummary && (
        <div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Debrief Summary</p>
          <p className="text-xs text-slate-700 leading-relaxed">{session.finalSummary}</p>
        </div>
      )}
      {session.knowledgeGaps && (
        <div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Knowledge Gaps — Correct Answers</p>
          {session.knowledgeGaps === 'No significant gaps.' ? (
            <p className="text-xs text-emerald-600 font-semibold">No significant gaps — outstanding recall.</p>
          ) : (
            <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-line">{session.knowledgeGaps}</p>
          )}
        </div>
      )}
    </div>
  )
}

function SessionRow({ session, API, index }) {
  const [expanded, setExpanded] = useState(false)

  const scoreText = () => {
    if (session.type === 'quiz')             return `${session.correctAnswers}/${session.totalQuestions} (${session.percentageCorrect}%)`
    if (session.type === 'flashcard')        return `${session.recalled}/${session.cardCount} recalled`
    if (session.type === 'order_of_battle')  return ORDER_TYPE_META[session.orderType]?.label ?? session.orderType?.replace(/_/g, ' ') ?? '—'
    return null
  }

  const score = scoreText()

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04 }}
      className="border-b border-slate-100 last:border-0"
    >
      <div
        className={`flex items-center gap-3 px-4 py-3 ${session.canDrillDown ? 'cursor-pointer hover:bg-slate-50 transition-colors' : ''}`}
        onClick={() => session.canDrillDown && setExpanded(e => !e)}
        role={session.canDrillDown ? 'button' : undefined}
        tabIndex={session.canDrillDown ? 0 : undefined}
        onKeyDown={e => session.canDrillDown && (e.key === 'Enter' || e.key === ' ') && setExpanded(v => !v)}
      >
        <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0 text-lg">
          {TYPE_ICONS[session.type] ?? '🎮'}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
            <span className="text-sm font-bold text-slate-800">{TYPE_LABELS[session.type] ?? session.type}</span>
            {session.difficulty && (
              <span className="text-[10px] font-bold bg-brand-100 text-brand-600 px-1.5 py-0.5 rounded-full">
                {session.difficulty}
              </span>
            )}
            <StatusBadge session={session} />
            {session.airstarsEarned > 0 && (
              <span className="text-[10px] font-bold text-white">+{session.airstarsEarned} <span className="star-silver">⭐</span></span>
            )}
          </div>

          {session.briefTitle && (
            <p className="text-xs text-slate-500 truncate">{session.briefTitle}</p>
          )}

          <div className="flex items-center gap-2 mt-0.5">
            {score && <span className="text-[10px] text-slate-400 font-semibold">{score}</span>}
            {formatTime(session.timeTakenSeconds) && (
              <span className="text-[10px] text-slate-400">{formatTime(session.timeTakenSeconds)}</span>
            )}
            <span className="text-[10px] text-slate-400">{formatDate(session.date)}</span>
          </div>
        </div>

        {session.canDrillDown && (
          <span className="text-slate-400 text-xs shrink-0">{expanded ? '▲' : '▼'}</span>
        )}
      </div>

      <AnimatePresence>
        {expanded && session.canDrillDown && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            {session.type === 'quiz'            && <QuizDrillDown        attemptId={session._id} />}
            {session.type === 'order_of_battle' && <BooOrderDrillDown   sessionId={session._id} />}
            {session.type === 'wheres_aircraft' && <WtaDrillDown        sessionId={session._id} />}
            {session.type === 'flashcard'       && <FlashcardDrillDown  sessionId={session._id} />}
            {session.type === 'aptitude_sync'   && <AptitudeSyncDrillDown session={session} />}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

export default function GameHistory() {
  const { user, API, apiFetch } = useAuth()
  const navigate  = useNavigate()

  const [sessions,      setSessions]      = useState([])
  const [total,         setTotal]         = useState(0)
  const [page,          setPage]          = useState(1)
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState(null)
  const [typeFilter,    setTypeFilter]    = useState('all')
  const [resultFilter,  setResultFilter]  = useState('all')

  const LIMIT = 20

  const fetchHistory = useCallback(async (p, type, result) => {
    setLoading(true); setError(null)
    try {
      const params = new URLSearchParams({ page: p, limit: LIMIT })
      if (type   !== 'all') params.set('type',   type)
      if (result !== 'all') params.set('result', result)
      const res  = await apiFetch(`${API}/api/games/history?${params}`, { credentials: 'include' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.message || 'Failed to load history')
      setSessions(json.data.sessions)
      setTotal(json.data.total)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [API])

  useEffect(() => {
    if (!user) { navigate('/login'); return }
    fetchHistory(page, typeFilter, resultFilter)
  }, [user, page, typeFilter, resultFilter, fetchHistory, navigate])

  const changeTypeFilter = (val) => { setTypeFilter(val); setPage(1) }
  const changeResultFilter = (val) => { setResultFilter(val); setPage(1) }

  const totalPages = Math.ceil(total / LIMIT)

  return (
    <div className="max-w-lg mx-auto">
      <SEO title="Game History" description="Review your past game results." noIndex={true} />

      {/* Header */}
      <div className="mb-4">
        <button onClick={() => navigate('/profile')} className="text-sm text-slate-500 hover:text-slate-700 transition-colors mb-3 flex items-center gap-1">
          ← Back
        </button>
        <h1 className="text-2xl font-extrabold text-slate-900">Game History</h1>
        <p className="text-sm text-slate-500 mt-0.5">{total} session{total !== 1 ? 's' : ''} on record.</p>
      </div>

      {/* Filters */}
      <div className="space-y-2 mb-4">
        <div className="flex flex-wrap gap-1.5">
          {[
            { val: 'all',             label: 'All Types' },
            { val: 'quiz',            label: '🎯 Quiz' },
            { val: 'order_of_battle', label: '📋 Battle of Order' },
            { val: 'wheres_aircraft', label: "✈️ Where's That Aircraft" },
            { val: 'flashcard',       label: '🃏 Flashcard' },
            { val: 'aptitude_sync',   label: '🧠 APTITUDE_SYNC' },
          ].map(({ val, label }) => (
            <button
              key={val}
              onClick={() => changeTypeFilter(val)}
              className={`text-[11px] font-bold px-2.5 py-1 rounded-full transition-all
                ${typeFilter === val
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
            { val: 'perfect',   label: '⭐ Perfect' },
            { val: 'passed',    label: '✓ Passed' },
            { val: 'failed',    label: '✗ Failed' },
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
              {label.startsWith('⭐ ')
                ? <><span className="star-silver">⭐</span>{label.slice(1)}</>
                : label}
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
          <div className="text-4xl mb-3">🎯</div>
          <p className="font-semibold">No game sessions yet.</p>
          <p className="text-sm mt-1">Complete quizzes and training drills to build your history.</p>
        </div>
      ) : (
        <div className="bg-surface rounded-2xl border border-slate-200 card-shadow overflow-hidden">
          {sessions.map((s, i) => (
            <SessionRow key={s._id} session={s} API={API} index={i} />
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
