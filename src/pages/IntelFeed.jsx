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

export default function IntelFeed({ navigate, initialCategory }) {
  const { API, user } = useAuth()

  const [briefs,        setBriefs]        = useState([])
  const [loading,       setLoading]       = useState(true)
  const [searchInput,   setSearchInput]   = useState('')
  const [search,        setSearch]        = useState('')   // debounced
  const [category,      setCategory]      = useState(initialCategory || 'All')
  const [readFilter,    setReadFilter]    = useState('all')
  const [passedIds,     setPassedIds]     = useState(new Set())
  const [catCounts,     setCatCounts]     = useState({})

  // Debounce search input by 400 ms
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 400)
    return () => clearTimeout(t)
  }, [searchInput])

  // Fetch category counts (to disable empty categories)
  useEffect(() => {
    fetch(`${API}/api/briefs/category-counts`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setCatCounts(d.data?.counts ?? {}))
      .catch(() => {})
  }, [API, user?.subscriptionTier])

  // Fetch completed quiz brief IDs once when user logs in
  useEffect(() => {
    if (!user) { setPassedIds(new Set()); return }
    fetch(`${API}/api/games/quiz/completed-brief-ids`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => setPassedIds(new Set(data?.data?.ids ?? [])))
      .catch(() => {})
  }, [API, user])

  // Fetch whenever category or debounced search changes
  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (category !== 'All') params.set('category', category)
    if (search)             params.set('search', search)

    fetch(`${API}/api/briefs?${params}`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => setBriefs(data?.data?.briefs ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [API, category, search, user?.subscriptionTier])

  const filtered = readFilter === 'all'    ? briefs
    : readFilter === 'read'  ? briefs.filter(b => b.isRead)
    :                          briefs.filter(b => !b.isRead)

  return (
    <main className="page intel-feed-page">

      {/* ── Header ───────────────────────────────────────── */}
      <div className="feed-header">
        <div className="section-inner">
          <div className="feed-header__eyebrow">
            <span className="feed-header__eyebrow-dot" aria-hidden="true" />
            <span>CLASSIFICATION: RESTRICTED</span>
            <span className="feed-header__eyebrow-divider" aria-hidden="true">|</span>
            <span>SKYWATCH INTEL DIVISION</span>
          </div>
          <h1 className="feed-title">
            <span className="feed-title__bracket" aria-hidden="true">[</span>
            INTELLIGENCE BRIEFS
            <span className="feed-title__bracket" aria-hidden="true">]</span>
          </h1>
          <p className="feed-subtitle">
            <span className="feed-subtitle__tag" aria-hidden="true">// </span>
            RAF news, aircraft, bases, ranks &amp; training — classified operational data.
          </p>
        </div>
      </div>

      <div className="section-inner">

        {/* ── Search + read filter ──────────────────────── */}
        <div className="feed-controls">
          <div className="feed-search-wrap">
            <span className="feed-search-prompt" aria-hidden="true">&gt;_</span>
            <input
              className="feed-search"
              type="search"
              placeholder="QUERY INTEL DATABASE…"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              aria-label="Search intelligence briefs"
              spellCheck={false}
              autoComplete="off"
            />
          </div>

          {user && (
            <div className="feed-filter-group" role="group" aria-label="Filter by read status">
              {[
                { value: 'all',    label: 'ALL BRIEFS', icon: '◈' },
                { value: 'unread', label: 'UNREAD',     icon: '◎' },
                { value: 'read',   label: 'ACCESSED',   icon: '◉' },
              ].map(({ value, label, icon }) => (
                <button
                  key={value}
                  className={`feed-filter-btn${readFilter === value ? ' feed-filter-btn--active' : ''}`}
                  onClick={() => setReadFilter(value)}
                  aria-pressed={readFilter === value}
                >
                  <span className="feed-filter-btn__icon" aria-hidden="true">{icon}</span>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Category pills ────────────────────────────── */}
        <div className="feed-categories" role="group" aria-label="Filter by category">
          {ALL_CATEGORIES.map(cat => {
            const isEmpty = cat !== 'All' && !catCounts[cat]
            return (
              <button
                key={cat}
                className={`feed-cat-btn${category === cat ? ' feed-cat-btn--active' : ''}${isEmpty ? ' feed-cat-btn--empty' : ''}`}
                onClick={() => !isEmpty && setCategory(cat)}
                aria-pressed={category === cat}
                aria-disabled={isEmpty}
                tabIndex={isEmpty ? -1 : 0}
              >
                <span className="feed-cat-btn__icon" aria-hidden="true">{CATEGORY_ICONS[cat]}</span>
                <span className="feed-cat-btn__label">{cat}</span>
              </button>
            )
          })}
        </div>

        {/* ── Results count ─────────────────────────────── */}
        {!loading && (
          <p className="feed-count">
            <span className="feed-count__prefix">// </span>
            {filtered.length} RESULT{filtered.length !== 1 ? 'S' : ''}
            {category !== 'All' && ` — ${category.toUpperCase()}`}
            {search && ` — QUERY: "${search.toUpperCase()}"`}
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
                isRead={!!brief.isRead}
                isLocked={!!brief.isLocked}
                quizPassed={passedIds.has(brief._id)}
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
