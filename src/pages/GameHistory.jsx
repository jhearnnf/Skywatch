import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'

const TYPE_LABELS = {
  quiz:            'Intel Brief Quiz',
  whos_at_aircraft:"Who's That Aircraft",
  order_of_battle: 'Order of Battle',
  flashcard:       'Flashcard Recall',
}

const TYPE_ICONS = {
  quiz:            '🎯',
  whos_at_aircraft:'✈️',
  order_of_battle: '📋',
  flashcard:       '🃏',
}

function formatDate(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

function formatTime(secs) {
  if (!secs && secs !== 0) return '—'
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m ${secs % 60}s`
}

function StatusBadge({ session }) {
  if (session.type === 'quiz') {
    if (session.status === 'abandoned') return <span className="gh-badge gh-badge--abandoned">ABANDONED</span>
    if (session.percentageCorrect === 100) return <span className="gh-badge gh-badge--perfect">PERFECT</span>
    if (session.percentageCorrect >= 60) return <span className="gh-badge gh-badge--pass">PASSED</span>
    return <span className="gh-badge gh-badge--fail">FAILED</span>
  }
  if (session.type === 'flashcard') {
    if (session.status === 'perfect') return <span className="gh-badge gh-badge--perfect">PERFECT RECALL</span>
    return <span className="gh-badge gh-badge--pass">COMPLETED</span>
  }
  if (session.isCorrect) return <span className="gh-badge gh-badge--pass">CORRECT</span>
  return <span className="gh-badge gh-badge--fail">INCORRECT</span>
}

function QuizDrillDown({ attemptId, API }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    setLoading(true)
    fetch(`${API}/api/games/history/quiz/${attemptId}`, { credentials: 'include' })
      .then(r => r.json())
      .then(json => {
        if (json.status === 'success') setData(json.data)
        else throw new Error(json.message || 'Failed to load')
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [attemptId, API])

  if (loading) return <div className="gh-drill-loading">RETRIEVING INTEL…</div>
  if (error)   return <div className="gh-drill-error">Error: {error}</div>
  if (!data)   return null

  return (
    <div className="gh-drill">
      <p className="gh-drill__header">QUESTION BREAKDOWN — {data.questions.length} QUESTIONS</p>
      <ol className="gh-drill__list">
        {data.questions.map((q, i) => (
          <li key={i} className={`gh-drill__q ${q.isCorrect ? 'gh-drill__q--correct' : 'gh-drill__q--wrong'}`}>
            <div className="gh-drill__q-header">
              <span className="gh-drill__q-num">Q{i + 1}</span>
              <span className="gh-drill__q-result">{q.isCorrect ? '✓ CORRECT' : '✗ INCORRECT'}</span>
              <span className="gh-drill__q-time">{formatTime(q.timeTakenSeconds)}</span>
            </div>
            <p className="gh-drill__q-text">{q.questionText}</p>
            <div className="gh-drill__answers">
              {q.displayedAnswers.map((a, j) => (
                <span
                  key={j}
                  className={`gh-drill__ans ${a.isCorrect ? 'gh-drill__ans--correct' : ''} ${a.isSelected && !a.isCorrect ? 'gh-drill__ans--wrong' : ''}`}
                >
                  {a.isCorrect ? '✓' : a.isSelected ? '✗' : '·'} {a.title}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function SessionRow({ session, API }) {
  const [expanded, setExpanded] = useState(false)

  const scoreText = () => {
    if (session.type === 'quiz')       return `${session.correctAnswers}/${session.totalQuestions} (${session.percentageCorrect}%)`
    if (session.type === 'flashcard')  return `${session.recalled}/${session.cardCount} recalled`
    if (session.type === 'whos_at_aircraft') return session.userAnswer ? `"${session.userAnswer}"` : '—'
    return '—'
  }

  return (
    <li className={`gh-item ${expanded ? 'gh-item--expanded' : ''}`}>
      <div
        className={`gh-item__row ${session.canDrillDown ? 'gh-item__row--clickable' : ''}`}
        onClick={() => session.canDrillDown && setExpanded(e => !e)}
        role={session.canDrillDown ? 'button' : undefined}
        tabIndex={session.canDrillDown ? 0 : undefined}
        onKeyDown={e => session.canDrillDown && (e.key === 'Enter' || e.key === ' ') && setExpanded(v => !v)}
        aria-expanded={session.canDrillDown ? expanded : undefined}
      >
        <span className="gh-item__icon" aria-hidden="true">{TYPE_ICONS[session.type]}</span>

        <div className="gh-item__body">
          <div className="gh-item__top">
            <span className="gh-item__type">{TYPE_LABELS[session.type]}</span>
            {session.difficulty && <span className="gh-item__diff">{session.difficulty.toUpperCase()}</span>}
            <StatusBadge session={session} />
            {session.aircoinsEarned > 0 && (
              <span className="gh-item__coins">+{session.aircoinsEarned} ⬡</span>
            )}
          </div>

          {session.briefTitle && (
            <span className="gh-item__brief">{session.briefTitle}</span>
          )}

          <div className="gh-item__meta">
            {scoreText() !== '—' && <span className="gh-item__score">{scoreText()}</span>}
            {session.timeTakenSeconds != null && <span className="gh-item__time">{formatTime(session.timeTakenSeconds)}</span>}
            <span className="gh-item__date">{formatDate(session.date)}</span>
          </div>
        </div>

        {session.canDrillDown && (
          <span className="gh-item__chevron" aria-hidden="true">{expanded ? '▲' : '▼'}</span>
        )}
      </div>

      {expanded && session.canDrillDown && (
        <QuizDrillDown attemptId={session._id} API={API} />
      )}
    </li>
  )
}

export default function GameHistory({ navigate }) {
  const { user, API } = useAuth()
  const [sessions, setSessions] = useState([])
  const [total, setTotal]       = useState(0)
  const [page, setPage]         = useState(1)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)

  const LIMIT = 20

  const fetchHistory = useCallback(async (p) => {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch(`${API}/api/games/history?page=${p}&limit=${LIMIT}`, { credentials: 'include' })
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
    if (!user) { navigate('login'); return }
    fetchHistory(page)
  }, [user, page, fetchHistory, navigate])

  const totalPages = Math.ceil(total / LIMIT)

  return (
    <main className="gh-page">
      <div className="gh-inner">

        <header className="ach-header">
          <button className="ach-back" onClick={() => navigate('profile')} aria-label="Back">
            ← Back
          </button>
          <div className="ach-title-row">
            <span className="ach-hex-icon" aria-hidden="true">🎯</span>
            <div>
              <h1 className="ach-title">Game History</h1>
              <p className="ach-subtitle">CLASSIFIED — AGENT TRAINING RECORD</p>
            </div>
          </div>
          <div className="ach-total-badge">
            <span className="ach-total-label">Total Sessions</span>
            <span className="ach-total-value">{total}</span>
          </div>
        </header>

        {error && <p className="ach-error">{error}</p>}

        {loading ? (
          <div className="ach-loading">
            <div className="ach-loading__bar" />
            <p>RETRIEVING RECORDS…</p>
          </div>
        ) : sessions.length === 0 ? (
          <div className="ach-empty">
            <span className="ach-empty__icon" aria-hidden="true">🎯</span>
            <p>No game sessions on record yet.</p>
            <p className="ach-empty__hint">Complete quizzes and training drills to build your history.</p>
          </div>
        ) : (
          <>
            <p className="ach-count">{total} session{total !== 1 ? 's' : ''} on record</p>

            <ul className="gh-list" role="list">
              {sessions.map(s => (
                <SessionRow key={s._id} session={s} API={API} />
              ))}
            </ul>

            {totalPages > 1 && (
              <div className="ach-pagination">
                <button
                  className="ach-page-btn"
                  disabled={page <= 1}
                  onClick={() => setPage(p => p - 1)}
                >
                  ← Prev
                </button>
                <span className="ach-page-info">Page {page} / {totalPages}</span>
                <button
                  className="ach-page-btn"
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => p + 1)}
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}

      </div>
    </main>
  )
}
