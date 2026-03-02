import { useState, useEffect, useRef, useCallback } from 'react'
import ReadyForBriefing from '../components/ReadyForBriefing'
import TargetDossierModal from '../components/TargetDossierModal'
import OutOfAmmo from '../components/OutOfAmmo'
import { useAuth } from '../context/AuthContext'

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function playSound(file) {
  const audio = new Audio(`/sounds/${file}`)
  audio.play().catch(() => {})
}

// ── Keyword-aware description renderer ───────────────────────────────────────

function DescriptionArea({ description, keywords, hasAmmo, onKeywordClick }) {
  const [reticlePos, setReticlePos] = useState({ x: 0, y: 0 })
  const [reticleOn,  setReticleOn]  = useState(false)
  const [hoveredKw,  setHoveredKw]  = useState(null)
  const areaRef = useRef(null)

  const handleMouseMove = (e) => setReticlePos({ x: e.clientX, y: e.clientY })

  // Parse description into text + keyword segments
  const segments = (() => {
    if (!keywords?.length) return [{ type: 'text', content: description }]
    const sorted  = [...keywords].sort((a, b) => b.keyword.length - a.keyword.length)
    const pattern = new RegExp(`\\b(${sorted.map(k => escapeRegex(k.keyword)).join('|')})\\b`, 'gi')
    const parts   = []
    let last = 0, match
    while ((match = pattern.exec(description)) !== null) {
      if (match.index > last) parts.push({ type: 'text', content: description.slice(last, match.index) })
      const kw = keywords.find(k => k.keyword.toLowerCase() === match[0].toLowerCase())
      parts.push({ type: 'keyword', content: match[0], keyword: kw })
      last = match.index + match[0].length
    }
    if (last < description.length) parts.push({ type: 'text', content: description.slice(last) })
    return parts
  })()

  return (
    <div
      ref={areaRef}
      className="description-area"
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setReticleOn(true)}
      onMouseLeave={() => { setReticleOn(false); setHoveredKw(null) }}
    >
      {/* Custom reticle cursor */}
      {reticleOn && (
        <div
          className={`custom-reticle ${hoveredKw ? 'custom-reticle--targeted' : ''} ${!hasAmmo ? 'custom-reticle--grey' : ''}`}
          style={{ left: reticlePos.x, top: reticlePos.y }}
          aria-hidden="true"
        >
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="5.5" stroke="currentColor" strokeWidth="1.5"/>
            <circle cx="16" cy="16" r="1.5" fill="currentColor"/>
            <path d="M16 2v6M16 24v6M2 16h6M24 16h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            {hoveredKw && <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="0.75" strokeDasharray="3 3" opacity="0.6"/>}
          </svg>
        </div>
      )}

      <p className={`description-text ${hoveredKw ? 'description-text--dimmed' : ''}`}>
        {segments.map((seg, i) => {
          if (seg.type === 'text') return <span key={i}>{seg.content}</span>
          const isHovered = hoveredKw?.keyword === seg.keyword?.keyword
          return (
            <span
              key={i}
              className={`kw-highlight ${isHovered ? 'kw-highlight--targeted' : ''}`}
              onMouseEnter={() => setHoveredKw(seg.keyword)}
              onMouseLeave={() => setHoveredKw(null)}
              onClick={(e) => onKeywordClick(e, seg.keyword)}
            >
              {seg.content}
            </span>
          )
        })}
      </p>
    </div>
  )
}

// ── Media carousel ────────────────────────────────────────────────────────────

function MediaCarousel({ media }) {
  const [idx, setIdx] = useState(0)
  if (!media?.length) return null
  const item = media[idx]

  return (
    <div className="media-carousel">
      {item.mediaType === 'picture'
        ? <img src={item.mediaUrl} alt="" className="carousel-img" />
        : <video src={item.mediaUrl} controls className="carousel-img" />
      }
      {media.length > 1 && (
        <div className="carousel-controls">
          <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0} aria-label="Previous">‹</button>
          <span>{idx + 1} / {media.length}</span>
          <button onClick={() => setIdx(i => Math.min(media.length - 1, i + 1))} disabled={idx === media.length - 1} aria-label="Next">›</button>
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function IntelligenceBrief({ briefId, navigate }) {
  const { user, API } = useAuth()

  const [brief,         setBrief]         = useState(null)
  const [ammoRemaining, setAmmoRemaining] = useState(0)
  const [loading,       setLoading]       = useState(true)
  const [notFound,      setNotFound]      = useState(false)
  const [dossier,       setDossier]       = useState(null)
  const [ammoItems,     setAmmoItems]     = useState([])
  const [quizOpen,      setQuizOpen]      = useState(false)

  // ── Time-spent-reading tracker ──────────────────────────────────────────────
  // Counts elapsed seconds in a ref and flushes to the API every 30s and on unmount/quiz-open.
  const readTimeRef      = useRef(0)
  const timerIntervalRef = useRef(null)

  // Always-current flush function stored in a ref so the timer interval
  // can call it without needing to be in its dependency array.
  const flushTimeRef = useRef(null)
  flushTimeRef.current = () => {
    if (!user || readTimeRef.current <= 0 || !briefId) return
    const secs = readTimeRef.current
    readTimeRef.current = 0
    fetch(`${API}/api/briefs/${briefId}/time`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seconds: secs }),
    }).catch(() => {})
  }

  // Start timer when brief loads and user is logged in.
  // Pause (flush + stop) when quiz opens, resume when quiz closes.
  // Flush remaining seconds when navigating away (effect cleanup / unmount).
  useEffect(() => {
    if (!brief || !user) return

    if (quizOpen) {
      clearInterval(timerIntervalRef.current)
      flushTimeRef.current()
      return
    }

    timerIntervalRef.current = setInterval(() => {
      readTimeRef.current += 1
      if (readTimeRef.current % 30 === 0) flushTimeRef.current()
    }, 1000)

    return () => {
      clearInterval(timerIntervalRef.current)
      flushTimeRef.current()
    }
  }, [brief, user, quizOpen])

  // ── Fetch brief ────────────────────────────────────────────────────────────
  // Uses optional auth — works for guests (no readRecord) and logged-in users.
  useEffect(() => {
    if (!briefId) { setNotFound(true); setLoading(false); return }
    setLoading(true)
    setNotFound(false)

    fetch(`${API}/api/briefs/${briefId}`, { credentials: 'include' })
      .then(r => {
        if (r.status === 404) { setNotFound(true); return null }
        return r.json()
      })
      .then(data => {
        if (!data) return
        setBrief(data?.data?.brief ?? null)
        setAmmoRemaining(data?.data?.readRecord?.ammunitionRemaining ?? 0)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [API, briefId])

  // Play open sound once brief data arrives
  useEffect(() => {
    if (brief) playSound('intel_brief_opened.mp3')
  }, [brief])

  // ── Keyword click ──────────────────────────────────────────────────────────
  const hasAmmo = ammoRemaining > 0

  const handleKeywordClick = useCallback((e, keyword) => {
    e.stopPropagation()
    if (hasAmmo) {
      playSound('target_locked.mp3')
      fetch(`${API}/api/briefs/${briefId}/use-ammo`, {
        method: 'POST',
        credentials: 'include',
      })
        .then(r => r.json())
        .then(data => {
          if (data?.data?.ammunitionRemaining !== undefined) {
            setAmmoRemaining(data.data.ammunitionRemaining)
          }
        })
        .catch(() => {})
      setDossier({ keyword, clickX: e.clientX, clickY: e.clientY })
    } else {
      setAmmoItems(prev => [...prev, { id: Date.now(), x: e.clientX, y: e.clientY }])
    }
  }, [API, briefId, hasAmmo])

  // ── Render states ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <main className="page brief-page">
        <div className="section-inner">
          <div className="feed-loading"><div className="app-loading__spinner" /></div>
        </div>
      </main>
    )
  }

  if (notFound || !brief) {
    return (
      <main className="page brief-page">
        <div className="section-inner">
          <p className="empty-state">Brief not found.</p>
          <button className="btn-ghost" onClick={() => navigate('intel-feed')}>← Back to Intel Feed</button>
        </div>
      </main>
    )
  }

  // ── Main render ────────────────────────────────────────────────────────────

  return (
    <main className="page brief-page">
      <div className="section-inner brief-layout">

        {/* ── Back nav ───────────────────────────────────── */}
        <button className="back-link" onClick={() => navigate('intel-feed')}>
          ← Intel Feed
        </button>

        {/* ── Category badge ─────────────────────────────── */}
        <span className="brief-category-badge">{brief.category}</span>

        {/* ── Title block ────────────────────────────────── */}
        <h1 className="brief-title">{brief.title}</h1>
        {brief.subtitle && <p className="brief-subtitle">{brief.subtitle}</p>}

        {/* ── Media ──────────────────────────────────────── */}
        <MediaCarousel media={brief.media} />

        {/* ── Description ────────────────────────────────── */}
        <DescriptionArea
          description={brief.description}
          keywords={brief.keywords}
          hasAmmo={hasAmmo}
          onKeywordClick={handleKeywordClick}
        />

        {/* ── Sources ────────────────────────────────────── */}
        {brief.sources?.length > 0 && (
          <div className="brief-sources">
            <h3 className="brief-sources__title">Sources</h3>
            <ul className="brief-sources__list">
              {brief.sources.map((src, i) => (
                <li key={i}>
                  <a href={src.url} target="_blank" rel="noreferrer" className="brief-source-link">
                    {src.siteName || src.url}
                    {src.articleDate && (
                      <span className="brief-source-date">
                        {' · '}{new Date(src.articleDate).toLocaleDateString('en-GB')}
                      </span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Ready for Briefing ─────────────────────────── */}
        <ReadyForBriefing
          briefId={brief._id}
          quizOpen={quizOpen}
          onQuizOpen={() => setQuizOpen(true)}
          onQuizClose={() => setQuizOpen(false)}
        />

      </div>

      {/* ── Overlays ──────────────────────────────────────── */}
      {dossier && (
        <TargetDossierModal
          keyword={dossier.keyword}
          clickX={dossier.clickX}
          clickY={dossier.clickY}
          onClose={() => setDossier(null)}
        />
      )}

      {ammoItems.map(item => (
        <OutOfAmmo
          key={item.id}
          x={item.x}
          y={item.y}
          onDone={() => setAmmoItems(prev => prev.filter(a => a.id !== item.id))}
        />
      ))}
    </main>
  )
}
