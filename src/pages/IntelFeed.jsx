import { useState, useEffect } from 'react'
import IntelBriefSummary from '../components/IntelBriefSummary'
import { useAuth } from '../context/AuthContext'
import { CATEGORIES } from '../data/mockData'

const CATEGORY_ICONS = {
  All:         '🔍',
  News:        '📰',
  Aircrafts:   '✈️',
  Bases:       '🏔️',
  Ranks:       '🎖️',
  Squadrons:   '⚡',
  Training:    '🎯',
  Threats:     '⚠️',
  Allies:      '🤝',
  Missions:    '🚀',
  AOR:         '🌍',
  Tech:        '💡',
  Terminology: '📖',
  Treaties:    '📜',
}

const ALL_CATEGORIES = ['All', ...CATEGORIES]

export default function IntelFeed({ navigate }) {
  const { API } = useAuth()

  const [briefs,        setBriefs]        = useState([])
  const [loading,       setLoading]       = useState(true)
  const [searchInput,   setSearchInput]   = useState('')
  const [search,        setSearch]        = useState('')   // debounced
  const [category,      setCategory]      = useState('All')
  const [readFilter,    setReadFilter]    = useState('all')

  // Debounce search input by 400 ms
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 400)
    return () => clearTimeout(t)
  }, [searchInput])

  // Fetch whenever category or debounced search changes
  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (category !== 'All') params.set('category', category)
    if (search)             params.set('search', search)

    fetch(`${API}/api/briefs?${params}`)
      .then(r => r.json())
      .then(data => setBriefs(data?.data?.briefs ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [API, category, search])

  // Client-side read filter (read state requires auth — applied once real read-records are wired)
  const filtered = readFilter === 'all' ? briefs : briefs

  return (
    <main className="page intel-feed-page">

      {/* ── Header ───────────────────────────────────────── */}
      <div className="feed-header">
        <div className="section-inner">
          <h1 className="feed-title">Intelligence Briefs</h1>
          <p className="feed-subtitle">RAF news, aircraft, base, rank, and training briefs.</p>
        </div>
      </div>

      <div className="section-inner">

        {/* ── Search + read filter ──────────────────────── */}
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
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              aria-label="Search intelligence briefs"
            />
          </div>

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

        {/* ── Category pills ────────────────────────────── */}
        <div className="feed-categories" role="group" aria-label="Filter by category">
          {ALL_CATEGORIES.map(cat => (
            <button
              key={cat}
              className={`feed-cat-btn${category === cat ? ' feed-cat-btn--active' : ''}`}
              onClick={() => setCategory(cat)}
              aria-pressed={category === cat}
            >
              <span className="feed-cat-btn__icon" aria-hidden="true">{CATEGORY_ICONS[cat]}</span>
              <span className="feed-cat-btn__label">{cat}</span>
            </button>
          ))}
        </div>

        {/* ── Results count ─────────────────────────────── */}
        {!loading && (
          <p className="feed-count">
            {filtered.length} brief{filtered.length !== 1 ? 's' : ''}
            {category !== 'All' && ` in ${category}`}
          </p>
        )}

        {/* ── Brief grid ────────────────────────────────── */}
        {loading ? (
          <div className="feed-loading">
            <div className="app-loading__spinner" />
          </div>
        ) : filtered.length > 0 ? (
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
