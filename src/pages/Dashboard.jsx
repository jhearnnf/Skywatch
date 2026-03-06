import { useState, useEffect } from 'react'
import IntelBriefSummary from '../components/IntelBriefSummary'
import { useAuth } from '../context/AuthContext'

const CAT_ICONS = {
  News: '📰', Aircrafts: '✈️', Bases: '🏔️', Ranks: '🎖️',
  Squadrons: '⚡', Training: '🎯', Threats: '⚠️', Allies: '🤝',
  Missions: '🚀', AOR: '🌍', Tech: '💡', Terminology: '📖', Treaties: '📜',
}

function useTypewriter(text, speed = 35) {
  const [displayed, setDisplayed] = useState('')
  const [done, setDone]           = useState(false)
  useEffect(() => {
    setDisplayed(''); setDone(false)
    if (!text) return
    let i = 0
    const id = setInterval(() => {
      i++
      setDisplayed(text.slice(0, i))
      if (i >= text.length) { clearInterval(id); setDone(true) }
    }, speed)
    return () => clearInterval(id)
  }, [text, speed])
  return { displayed, done }
}

function CategorySuggestionsWidget({ navigate, API, user }) {
  const [categories, setCategories] = useState([])
  const [loading,    setLoading]    = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`${API}/api/briefs/unread-categories`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setCategories(d.data?.categories ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [API, user])

  const headerText = loading ? '' : categories.length === 0
    ? 'INTEL SWEEP COMPLETE — SIGNAL CLEAR. NO UNREAD BRIEFINGS DETECTED. STAND BY.'
    : `UNREAD INTELLIGENCE DETECTED ACROSS ${categories.length} VECTOR${categories.length !== 1 ? 'S' : ''}.`

  const { displayed, done } = useTypewriter(headerText)

  return (
    <section className="cat-suggestions">
      <div className="section-inner">
        <p className="cat-suggestions__eyebrow">◈ INTEL VECTOR ANALYSIS</p>
        <p className="cat-suggestions__typed" aria-live="polite">
          {displayed}
          <span className={`cat-suggestions__cursor${done ? ' cat-suggestions__cursor--done' : ''}`} aria-hidden="true" />
        </p>

        {done && categories.length > 0 && (
          <div className="cat-suggestions__grid">
            {categories.slice(0, 4).map((cat, i) => (
              <button
                key={cat.name}
                className="cat-suggestion-card"
                style={{ animationDelay: `${i * 80}ms` }}
                onClick={() => navigate('intel-feed', { category: cat.name })}
              >
                <span className="cat-card__icon">{CAT_ICONS[cat.name] ?? '📋'}</span>
                <span className="cat-card__name">{cat.name.toUpperCase()}</span>
                <span className="cat-card__count">{cat.unreadCount} UNREAD</span>
                <span className="cat-card__action">ACCESS FEED →</span>
              </button>
            ))}
          </div>
        )}

        {done && categories.length === 0 && (
          <p className="cat-suggestions__clear">Stand by for new intelligence.</p>
        )}
      </div>
    </section>
  )
}

export default function Dashboard({ navigate }) {
  const { API, user } = useAuth()
  const [briefs,    setBriefs]    = useState([])
  const [loading,   setLoading]   = useState(true)
  const [passedIds, setPassedIds] = useState(new Set())

  useEffect(() => {
    fetch(`${API}/api/briefs?category=News&limit=3`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => setBriefs(data?.data?.briefs ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [API, user])

  useEffect(() => {
    if (!user) { setPassedIds(new Set()); return }
    fetch(`${API}/api/games/quiz/completed-brief-ids`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => setPassedIds(new Set(data?.data?.ids ?? [])))
      .catch(() => {})
  }, [API, user])

  return (
    <main className="page dashboard-page">

      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="mission-control">
        <div className="mc-inner">
          <div className="mc-badge">
            <span className="mc-badge__dot" aria-hidden="true" />
            CLEARANCE ACTIVE · INTELLIGENCE CORPS
          </div>

          <h1 className="mc-title">
            <img src="/images/skywatch-logo.svg" alt="SkyWatch" className="mc-title__logo" />
            <span className="mc-title__sub">INTELLIGENCE PLATFORM</span>
          </h1>

          <div className="mc-rule" aria-hidden="true" />

          <p className="mc-subtitle">
            Monitor RAF operations. Analyse classified briefings.<br />
            Test your retention. Rise through the ranks.
          </p>

          <div className="mc-status" aria-hidden="true">
            <span className="mc-status__item mc-status__item--online">◉ SYSTEM ONLINE</span>
            <span className="mc-status__sep">·</span>
            <span className="mc-status__item">◈ BRIEFS LIVE</span>
            <span className="mc-status__sep">·</span>
            <span className="mc-status__item">◎ MISSION ACTIVE</span>
          </div>
        </div>
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
                  quizPassed={passedIds.has(brief._id)}
                  onClick={() => navigate('intelligence-brief', { briefId: brief._id })}
                />
              ))}
            </div>
          ) : (
            <p className="empty-state">No briefs available.</p>
          )}
        </div>
      </section>

      {/* ── Category Suggestions ──────────────────────────── */}
      <CategorySuggestionsWidget navigate={navigate} API={API} user={user} />

    </main>
  )
}
