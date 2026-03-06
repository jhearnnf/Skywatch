import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'

const REASON_LABELS = {
  brief_read:      'Intel Brief Read',
  quiz:            'Quiz Completed',
  order_of_battle: 'Order of Battle',
  whos_at_aircraft:"Who's That Aircraft",
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

export default function AircoinHistory({ navigate }) {
  const { user, API } = useAuth()
  const [logs, setLogs]     = useState([])
  const [total, setTotal]   = useState(0)
  const [page, setPage]     = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)

  const LIMIT = 30

  const fetchHistory = useCallback(async (p) => {
    setLoading(true)
    setError(null)
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
    if (!user) { navigate('login'); return }
    fetchHistory(page)
  }, [user, page, fetchHistory, navigate])

  const totalPages = Math.ceil(total / LIMIT)

  return (
    <main className="ach-page">
      <div className="ach-inner">

        <header className="ach-header">
          <button className="ach-back" onClick={() => navigate('profile')} aria-label="Back">
            ← Back
          </button>
          <div className="ach-title-row">
            <span className="ach-hex-icon" aria-hidden="true">⬡</span>
            <div>
              <h1 className="ach-title">Aircoin Ledger</h1>
              <p className="ach-subtitle">CLASSIFIED — AGENT REWARD RECORD</p>
            </div>
          </div>
          <div className="ach-total-badge">
            <span className="ach-total-label">Total Balance</span>
            <span className="ach-total-value">⬡ {(user?.totalAircoins ?? 0).toLocaleString()}</span>
          </div>
        </header>

        {error && <p className="ach-error">{error}</p>}

        {loading ? (
          <div className="ach-loading">
            <div className="ach-loading__bar" />
            <p>RETRIEVING RECORDS…</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="ach-empty">
            <span className="ach-empty__icon" aria-hidden="true">⬡</span>
            <p>No aircoin awards on record yet.</p>
            <p className="ach-empty__hint">Read intel briefs and complete games to earn aircoins.</p>
          </div>
        ) : (
          <>
            <p className="ach-count">{total} award{total !== 1 ? 's' : ''} on record</p>

            <ul className="ach-list" role="list">
              {logs.map((log) => (
                <li key={log._id} className="ach-item">
                  <span className="ach-item__icon" aria-hidden="true">
                    {REASON_ICONS[log.reason] ?? '⬡'}
                  </span>
                  <div className="ach-item__body">
                    <span className="ach-item__reason">{REASON_LABELS[log.reason] ?? log.reason}</span>
                    {log.label && <span className="ach-item__label">{log.label}</span>}
                    <span className="ach-item__date">{formatDate(log.createdAt)}</span>
                  </div>
                  <span className="ach-item__amount">+{log.amount.toLocaleString()} ⬡</span>
                </li>
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
