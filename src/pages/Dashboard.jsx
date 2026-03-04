import { useState, useEffect } from 'react'
import IntelBriefSummary from '../components/IntelBriefSummary'
import { useAuth } from '../context/AuthContext'

export default function Dashboard({ navigate }) {
  const { API, user } = useAuth()
  const [briefs, setBriefs]   = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${API}/api/briefs?category=News&limit=3`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => setBriefs(data?.data?.briefs ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [API, user])

  return (
    <main className="page dashboard-page">

      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="mission-control">
        <span className="mc-eyebrow">Mission Control</span>
        <h1 className="mc-title">Welcome to Skywatch</h1>
        <p className="mc-subtitle">
          Stay informed on the latest RAF intelligence. Test your knowledge
          retention and climb the ranks of the Intelligence Corps.
        </p>
      </section>

      {/* ── Today's News ─────────────────────────────────── */}
      <section className="dashboard-news">
        <div className="section-inner">
          <div className="section-header">
            <h2 className="section-title">Latest News Briefs</h2>
            <button className="section-link" onClick={() => navigate('intel-feed')}>
              View all intel →
            </button>
          </div>

          {loading ? (
            <div className="feed-loading">
              <div className="app-loading__spinner" />
            </div>
          ) : briefs.length > 0 ? (
            <div className="brief-grid">
              {briefs.map(brief => (
                <IntelBriefSummary
                  key={brief._id}
                  brief={brief}
                  showDate
                  isRead={!!brief.isRead}
                  isLocked={!!brief.isLocked}
                  onClick={() => navigate('intelligence-brief', { briefId: brief._id })}
                />
              ))}
            </div>
          ) : (
            <p className="empty-state">No briefs available.</p>
          )}
        </div>
      </section>

    </main>
  )
}
