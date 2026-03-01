import { useState, useMemo } from 'react'
import IntelBriefSummary from '../components/IntelBriefSummary'
import { MOCK_BRIEFS, CATEGORIES } from '../data/mockData'

export default function IntelFeed({ navigate }) {
  const [search, setSearch]         = useState('')
  const [category, setCategory]     = useState('All')
  const [readFilter, setReadFilter] = useState('all') // 'all' | 'read' | 'unread'

  const filtered = useMemo(() => {
    return MOCK_BRIEFS.filter(b => {
      const matchesSearch   = !search || b.title.toLowerCase().includes(search.toLowerCase()) || b.subtitle?.toLowerCase().includes(search.toLowerCase())
      const matchesCategory = category === 'All' || b.category === category
      // Read state requires auth — mock as all unread for now
      const matchesRead = readFilter === 'all' || readFilter === 'unread'
      return matchesSearch && matchesCategory && matchesRead
    })
  }, [search, category, readFilter])

  return (
    <main className="page intel-feed-page">
      <div className="feed-header">
        <div className="section-inner">
          <h1 className="feed-title">Intelligence Briefs</h1>
          <p className="feed-subtitle">RAF news, aircraft, base, rank, and training briefs.</p>
        </div>
      </div>

      <div className="section-inner">
        {/* ── Filters ────────────────────────────────────── */}
        <div className="feed-controls">
          <div className="feed-search-wrap">
            <svg className="feed-search-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <input
              className="feed-search"
              type="search"
              placeholder="Search briefs…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              aria-label="Search intelligence briefs"
            />
          </div>

          <select
            className="feed-filter"
            value={category}
            onChange={e => setCategory(e.target.value)}
            aria-label="Filter by category"
          >
            <option value="All">All Categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          <select
            className="feed-filter"
            value={readFilter}
            onChange={e => setReadFilter(e.target.value)}
            aria-label="Filter by read status"
          >
            <option value="all">All Briefs</option>
            <option value="unread">Unread</option>
            <option value="read">Read</option>
          </select>
        </div>

        {/* ── Results count ──────────────────────────────── */}
        <p className="feed-count">
          {filtered.length} brief{filtered.length !== 1 ? 's' : ''}
        </p>

        {/* ── Brief grid ─────────────────────────────────── */}
        {filtered.length > 0 ? (
          <div className="brief-grid">
            {filtered.map(brief => (
              <IntelBriefSummary
                key={brief._id}
                brief={brief}
                showDate
                onClick={() => navigate('intelligence-brief', { briefId: brief._id })}
              />
            ))}
          </div>
        ) : (
          <p className="empty-state">No briefs match your search.</p>
        )}
      </div>
    </main>
  )
}
