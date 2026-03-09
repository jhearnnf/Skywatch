import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { useTutorial } from '../context/TutorialContext'
import { playSound, invalidateSoundSettings } from '../utils/sound'
import { CATEGORY_ICONS, SUBCATEGORIES } from '../data/mockData'

const DEFAULT_BRIEF_IMAGE     = '/images/placeholder-brief.svg'

// Returns true if an existing brief already covers the same topic as a headline.
// Matches on 2+ significant words (5+ chars) shared between headline and brief title/subtitle.
function headlineAlreadyCovered(headline, briefs) {
  const keyWords = str =>
    str.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length >= 5)
  const headlineWords = new Set(keyWords(headline))
  return briefs.some(b => {
    const briefWords = keyWords((b.title ?? '') + ' ' + (b.subtitle ?? ''))
    return briefWords.filter(w => headlineWords.has(w)).length >= 2
  })
}

const ALL_CATEGORIES = [
  'News', 'Aircrafts', 'Bases', 'Ranks', 'Squadrons', 'Training',
  'Threats', 'Allies', 'Missions', 'AOR', 'Tech', 'Terminology', 'Treaties',
]

// ── Reason Modal ──────────────────────────────────────────────────────────────
// Every state-changing admin action requires a written reason before executing.

function ReasonModal({ action, onConfirm, onCancel }) {
  const [reason, setReason] = useState('')
  const [busy,   setBusy]   = useState(false)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const confirm = async () => {
    if (!reason.trim()) return
    setBusy(true)
    await onConfirm(reason.trim())
    setBusy(false)
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal__header">
          <div>
            <span className="modal__eyebrow">Reason Required</span>
            <h3 className="modal__title">{action}</h3>
          </div>
          <button className="modal__close" onClick={onCancel} aria-label="Close">✕</button>
        </div>
        <div className="modal__body">
          <label className="form-label" htmlFor="admin-reason">Reason for this action</label>
          <textarea
            id="admin-reason"
            className="form-textarea"
            rows={3}
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Briefly describe why you are taking this action…"
            autoFocus
          />
        </div>
        <div className="modal__footer">
          <button className="btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn-primary" onClick={confirm} disabled={!reason.trim() || busy}>
            {busy ? 'Working…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Reset Stats Modal ─────────────────────────────────────────────────────────

const RESET_FIELDS = [
  { key: 'aircoins',        label: 'Aircoins',          desc: 'Zero out totalAircoins & reset rank to Unranked' },
  { key: 'gameHistory',     label: 'Game History',      desc: 'Delete quiz results & clear gameTypesSeen' },
  { key: 'intelBriefsRead', label: 'Intel Briefs Read', desc: 'Delete all brief-read records (resets ammo too)' },
  { key: 'tutorials',       label: 'Tutorials',         desc: 'Mark all tutorials as unseen so they replay from scratch' },
]

function ResetStatsModal({ agentNumber, userId, API, onDone, onCancel }) {
  const [selected, setSelected] = useState({ aircoins: true, gameHistory: true, intelBriefsRead: true, tutorials: true })
  const [reason,   setReason]   = useState('')
  const [busy,     setBusy]     = useState(false)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const toggle = (key) => setSelected(s => ({ ...s, [key]: !s[key] }))
  const fields = RESET_FIELDS.filter(f => selected[f.key]).map(f => f.key)

  const confirm = async () => {
    if (!reason.trim() || fields.length === 0) return
    setBusy(true)
    await fetch(`${API}/api/admin/users/${userId}/reset-stats`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason.trim(), fields }),
    })
    setBusy(false)
    onDone()
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal__header">
          <div>
            <span className="modal__eyebrow">Reason Required</span>
            <h3 className="modal__title">Reset Stats — Agent {agentNumber}</h3>
          </div>
          <button className="modal__close" onClick={onCancel} aria-label="Close">✕</button>
        </div>
        <div className="modal__body">
          <p className="admin-section-sub" style={{ marginBottom: '0.75rem' }}>Select which stats to reset:</p>
          <div className="reset-stats-checks">
            {RESET_FIELDS.map(f => (
              <label key={f.key} className={`reset-stats-check ${selected[f.key] ? 'reset-stats-check--on' : ''}`}>
                <input
                  type="checkbox"
                  checked={selected[f.key]}
                  onChange={() => toggle(f.key)}
                />
                <span className="reset-stats-check__label">{f.label}</span>
                <span className="reset-stats-check__desc">{f.desc}</span>
              </label>
            ))}
          </div>
          <label className="form-label" htmlFor="reset-reason" style={{ marginTop: '1rem', display: 'block' }}>
            Reason for this action
          </label>
          <textarea
            id="reset-reason"
            className="form-textarea"
            rows={3}
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Briefly describe why you are resetting these stats…"
            autoFocus
          />
        </div>
        <div className="modal__footer">
          <button className="btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button
            className="btn-primary"
            onClick={confirm}
            disabled={!reason.trim() || fields.length === 0 || busy}
          >
            {busy ? 'Working…' : `Reset ${fields.length} stat${fields.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Lead Picker Modal ─────────────────────────────────────────────────────────

function LeadPickerModal({ API, onConfirm, onCancel }) {
  const [step,     setStep]     = useState('prompt') // 'prompt' | 'loading' | 'pick'
  const [leads,    setLeads]    = useState([])
  const [selected, setSelected] = useState(null)
  const [search,   setSearch]   = useState('')

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const fetchLeads = async () => {
    setStep('loading')
    try {
      const res  = await fetch(`${API}/api/admin/intel-leads`, { credentials: 'include' })
      const data = await res.json()
      const all  = data.data?.leads ?? []
      setLeads(all)
      setSelected(all[Math.floor(Math.random() * all.length)] ?? null)
      setStep('pick')
    } catch {
      setStep('prompt')
    }
  }

  const shuffle = () => {
    const others = leads.filter(l => l !== selected)
    if (others.length) setSelected(others[Math.floor(Math.random() * others.length)])
  }

  const sectionLabel = (s) => s.replace(/^SECTION \d+:\s*/i, '')

  const filtered = search
    ? leads.filter(l => {
        const q = search.toLowerCase()
        return l.text.toLowerCase().includes(q)
          || l.subsection.toLowerCase().includes(q)
          || sectionLabel(l.section).toLowerCase().includes(q)
      })
    : leads

  // Group filtered leads by section for display
  const grouped = filtered.reduce((acc, lead) => {
    const key = lead.section || 'Other'
    if (!acc[key]) acc[key] = []
    acc[key].push(lead)
    return acc
  }, {})

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className={`modal lead-picker-modal${step === 'pick' ? ' lead-picker-modal--wide' : ''}`} onClick={e => e.stopPropagation()}>

        {/* ── Step 1: prompt ── */}
        {step === 'prompt' && (
          <>
            <div className="modal__header">
              <div>
                <span className="modal__eyebrow">New Intel Brief</span>
                <h3 className="modal__title">Generate from Intel Brief Lead?</h3>
              </div>
              <button className="modal__close" onClick={onCancel} aria-label="Close">✕</button>
            </div>
            <div className="modal__body">
              <p className="lead-prompt-text">
                Select a topic from the Intel Brief Leads list and let AI generate the brief content automatically, or start with a blank form.
              </p>
            </div>
            <div className="modal__footer">
              <button className="btn-ghost" onClick={onCancel}>No — blank form</button>
              <button className="btn-primary" onClick={fetchLeads}>Yes — pick a lead</button>
            </div>
          </>
        )}

        {/* ── Step 2: loading ── */}
        {step === 'loading' && (
          <div className="modal__body" style={{ textAlign: 'center', padding: '2rem' }}>
            <div className="app-loading__spinner" style={{ margin: '0 auto 1rem' }} />
            <p style={{ color: '#64748b', fontSize: '0.85rem' }}>Loading leads…</p>
          </div>
        )}

        {/* ── Step 3: pick ── */}
        {step === 'pick' && (
          <>
            <div className="modal__header">
              <div>
                <span className="modal__eyebrow">Intel Brief Lead</span>
                <h3 className="modal__title">Select a Topic</h3>
              </div>
              <button className="modal__close" onClick={onCancel} aria-label="Close">✕</button>
            </div>

            <div className="modal__body lead-picker-body">

              {/* Current selection card */}
              {selected && (
                <div className="lead-selected-card">
                  <div className="lead-selected-card__inner">
                    <div>
                      <span className="lead-selected-card__eyebrow">{selected.subsection || selected.section.replace(/^SECTION \d+:\s*/i, '')}</span>
                      <p className="lead-selected-card__text">{selected.text}</p>
                    </div>
                    <button className="lead-shuffle-btn" onClick={shuffle} title="Pick another at random">↻ Shuffle</button>
                  </div>
                </div>
              )}

              {/* Search */}
              <input
                className="feed-search lead-search"
                type="search"
                placeholder="Search leads…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />

              {/* Scrollable lead list */}
              <div className="lead-list">
                {Object.entries(grouped).map(([section, items]) => (
                  <div key={section}>
                    <div className="lead-list-section">{sectionLabel(section)}</div>
                    {items.map((lead, i) => (
                      <button
                        key={i}
                        type="button"
                        className={`lead-list-item${selected === lead ? ' lead-list-item--active' : ''}`}
                        onClick={() => setSelected(lead)}
                      >
                        {lead.subsection && <span className="lead-list-item__sub">{lead.subsection}</span>}
                        <span className="lead-list-item__text">{lead.text}</span>
                      </button>
                    ))}
                  </div>
                ))}
                {filtered.length === 0 && (
                  <p style={{ padding: '1rem', color: '#94a3b8', fontSize: '0.8rem' }}>No leads match your search.</p>
                )}
              </div>
            </div>

            <div className="modal__footer">
              <span className="lead-count">{leads.length} leads available</span>
              <button className="btn-ghost" onClick={onCancel}>Cancel</button>
              <button className="btn-primary" onClick={() => selected && onConfirm(selected)} disabled={!selected}>
                Use this lead →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── App Stats tab ─────────────────────────────────────────────────────────────

function fmtSeconds(s) {
  if (s == null || s === 0) return '—'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

function fmtNum(n) {
  if (n == null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function StatsTab({ API }) {
  const [stats,   setStats]   = useState(null)
  const [error,   setError]   = useState('')

  useEffect(() => {
    fetch(`${API}/api/admin/stats`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (d.status === 'success') setStats(d.data); else setError('Failed to load stats') })
      .catch(() => setError('Failed to load stats'))
  }, [API])

  if (error) return <p className="admin-error">{error}</p>
  if (!stats) return <p className="admin-loading">Loading stats…</p>

  return (
    <div>
      <div className="admin-section">
        <h3 className="admin-section-title">Users</h3>
        <div className="admin-stats-grid">
          <AdminStat label="Total Users"      value={stats.users.totalUsers} />
          <AdminStat label="Free Tier"        value={stats.users.freeUsers} />
          <AdminStat label="Trial Tier"       value={stats.users.trialUsers} />
          <AdminStat label="Subscribed"       value={stats.users.subscribedUsers} />
          <AdminStat label="On Easy"          value={stats.users.easyPlayers} />
          <AdminStat label="On Medium"        value={stats.users.mediumPlayers} />
          <AdminStat label="Total Logins"     value={fmtNum(stats.users.totalLogins)} />
          <AdminStat label="Combined Streaks" value={fmtNum(stats.users.combinedStreaks)} />
        </div>
      </div>
      <div className="admin-section">
        <h3 className="admin-section-title">Quiz Games</h3>
        <div className="admin-stats-grid">
          <AdminStat label="Quizzes Played"    value={stats.games.totalGamesPlayed} />
          <AdminStat label="Perfect Score"     value={stats.games.totalGamesCompleted > 0 ? `${Math.round((stats.games.totalPerfectScores / stats.games.totalGamesCompleted) * 100)}%` : '—'} title="% of completed (non-abandoned) quizzes where the user scored 100%" />
          <AdminStat label="Quizzes Lost"      value={stats.games.totalGamesCompleted > 0 ? `${Math.round((stats.games.totalGamesLost    / stats.games.totalGamesCompleted) * 100)}%` : '—'} title={`% of completed (non-abandoned) quizzes where the user scored below the pass threshold (Easy: ${stats.games.passThresholdEasy}%, Medium: ${stats.games.passThresholdMedium}%)`} />
          <AdminStat label="Quizzes Abandoned" value={stats.games.totalGamesPlayed > 0 ? `${Math.round((stats.games.totalGamesAbandoned / stats.games.totalGamesPlayed) * 100)}%` : '—'} />
          <AdminStat label="Time Played" value={fmtSeconds(stats.games.quizTotalSeconds)} title="Total time across all quiz attempts" />
        </div>
      </div>
      <div className="admin-section">
        <h3 className="admin-section-title">Battle of Order — Mini Game</h3>
        <div className="admin-stats-grid">
          <AdminStat label="Games Played"  value={stats.games.boo.total} />
          <AdminStat label="Perfect Score" value={stats.games.boo.total > 0 ? `${Math.round((stats.games.boo.won      / stats.games.boo.total) * 100)}%` : '—'} title="% of all BOO games where the user won" />
          <AdminStat label="Defeated"      value={stats.games.boo.total > 0 ? `${Math.round((stats.games.boo.defeated / stats.games.boo.total) * 100)}%` : '—'} title="% of all BOO games where the user was defeated (not abandoned)" />
          <AdminStat label="Abandoned"     value={stats.games.boo.total > 0 ? `${Math.round((stats.games.boo.abandoned / stats.games.boo.total) * 100)}%` : '—'} />
          <AdminStat label="Time Played"   value={fmtSeconds(stats.games.boo.totalSeconds)} title="Total time across all BOO games (including abandoned)" />
        </div>
      </div>
      <div className="admin-section">
        <h3 className="admin-section-title">Aircoins</h3>
        <div className="admin-stats-grid">
          <AdminStat label="Aircoins in System" value={fmtNum(stats.games.totalAircoinsEarned)} title="Total aircoins earned across all users" />
        </div>
      </div>
      <div className="admin-section">
        <h3 className="admin-section-title">Intel Briefs</h3>
        <div className="admin-stats-grid">
          <AdminStat label="Total Briefs Read" value={stats.briefs.totalBrifsRead} />
        </div>
      </div>
      <div className="admin-section">
        <h3 className="admin-section-title">Tutorials</h3>
        <div className="admin-stats-grid">
          <AdminStat label="Tutorials Read"    value={stats.tutorials.viewed}  title="Total tutorial steps marked as viewed across all users" />
          <AdminStat label="Tutorials Skipped" value={stats.tutorials.skipped} title="Total tutorial steps skipped across all users" />
        </div>
      </div>
    </div>
  )
}

function AdminStat({ label, value, mock, title }) {
  return (
    <div className={`admin-stat-item${mock ? ' admin-stat-item--mock' : ''}`} title={title}>
      <span className="admin-stat-item__value">{value ?? '—'}</span>
      <span className="admin-stat-item__label">{label}{title && <span className="admin-stat-item__hint" aria-hidden="true"> ⓘ</span>}</span>
    </div>
  )
}

// ── Problems tab ──────────────────────────────────────────────────────────────

function ProblemsTab({ API }) {
  const [problems,     setProblems]    = useState([])
  const [search,       setSearch]      = useState('')
  const [filter,       setFilter]      = useState('unsolved')
  const [sortOrder,    setSortOrder]   = useState('newest')
  const [loading,      setLoading]     = useState(true)
  const [fetchError,   setFetchError]  = useState(null)
  const [tick,         setTick]        = useState(0) // bump to force reload
  const [expanded,     setExpanded]    = useState(null)
  const [updateTexts,  setUpdateTexts] = useState({})
  const [busy,         setBusy]        = useState(null)

  useEffect(() => {
    setLoading(true)
    setFetchError(null)
    const params = new URLSearchParams()
    if (filter !== 'all') params.set('solved', filter === 'solved' ? 'true' : 'false')

    fetch(`${API}/api/admin/problems?${params}`, { credentials: 'include' })
      .then(r => r.json().then(d => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) throw new Error(d.message || 'Unknown error')
        setProblems(d.data?.problems ?? [])
      })
      .catch(err => { setFetchError(err.message); setProblems([]) })
      .finally(() => setLoading(false))
  }, [API, filter, tick])

  // Client-side filter + sort (backend always returns newest-first)
  const filtered = search.trim()
    ? problems.filter(p =>
        p.description.toLowerCase().includes(search.toLowerCase()) ||
        p.pageReported?.toLowerCase().includes(search.toLowerCase())
      )
    : problems
  const visible = sortOrder === 'oldest' ? [...filtered].reverse() : filtered

  const postUpdate = async (id, description, markSolved) => {
    if (!description?.trim()) return
    setBusy(id)
    const body = { description }
    if (markSolved !== undefined) body.solved = markSolved
    await fetch(`${API}/api/admin/problems/${id}/update`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setUpdateTexts(prev => ({ ...prev, [id]: '' }))
    setBusy(null)
    setTick(t => t + 1)
  }

  return (
    <div>
      <div className="admin-search-bar">
        <input
          className="feed-search"
          style={{ maxWidth: 300 }}
          placeholder="Filter descriptions or pages…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="feed-filter" value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="unsolved">Unsolved</option>
          <option value="solved">Solved</option>
          <option value="all">All</option>
        </select>
        <select className="feed-filter" value={sortOrder} onChange={e => setSortOrder(e.target.value)}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </div>

      {loading && <p className="admin-loading">Loading…</p>}
      {fetchError && <p className="form-error">Failed to load: {fetchError}</p>}
      {!loading && !fetchError && visible.length === 0 && <p className="empty-state">No problems found.</p>}

      <div className="admin-list">
        {visible.map(p => (
          <div key={p._id} className={`admin-card ${p.solved ? 'admin-card--solved' : ''}`}>
            <div
              className="admin-card__header"
              onClick={() => setExpanded(expanded === p._id ? null : p._id)}
              role="button"
              tabIndex={0}
            >
              <div className="admin-card__meta">
                <span className={`admin-badge ${p.solved ? 'admin-badge--green' : 'admin-badge--red'}`}>
                  {p.solved ? 'Solved' : 'Unsolved'}
                </span>
                <span className="admin-card__sub">
                  Agent {p.userId?.agentNumber ?? '?'} · {p.pageReported} · {new Date(p.time).toLocaleDateString()}
                </span>
              </div>
              <span className="admin-card__toggle">{expanded === p._id ? '▲' : '▼'}</span>
            </div>

            <p className="admin-card__desc">{p.description}</p>

            {expanded === p._id && (
              <div className="admin-card__expanded">
                {p.updates?.length > 0 && (
                  <div className="admin-updates">
                    <p className="admin-updates__label">Updates</p>
                    {p.updates.map((u, i) => (
                      <div key={i} className="admin-update-item">
                        <span className="admin-update-item__time">
                          {new Date(u.time).toLocaleDateString()}
                          {' · '}
                          <span className="admin-update-item__agent">
                            Agent {u.adminUserId?.agentNumber ?? '?'}
                          </span>
                        </span>
                        <p className="admin-update-item__text">{u.description}</p>
                      </div>
                    ))}
                  </div>
                )}

                {!p.solved && (
                  <div className="admin-update-form">
                    <textarea
                      className="form-textarea"
                      rows={2}
                      placeholder="Add an update note…"
                      value={updateTexts[p._id] ?? ''}
                      onChange={e => setUpdateTexts(prev => ({ ...prev, [p._id]: e.target.value }))}
                    />
                    <div className="admin-update-form__actions">
                      <button
                        className="btn-ghost"
                        disabled={!updateTexts[p._id]?.trim() || busy === p._id}
                        onClick={() => postUpdate(p._id, updateTexts[p._id])}
                      >
                        Add Update
                      </button>
                      <button
                        className="btn-primary"
                        disabled={busy === p._id}
                        onClick={() => postUpdate(p._id, updateTexts[p._id] || 'Marked as solved.', true)}
                      >
                        {busy === p._id ? 'Saving…' : 'Mark Solved'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Users tab ─────────────────────────────────────────────────────────────────

function UsersTab({ API, navigate }) {
  const { user: currentUser, setUser } = useAuth()
  const [q,              setQ]              = useState('')
  const [users,          setUsers]          = useState([])
  const [loading,        setLoading]        = useState(true)
  const [isSearchMode,   setIsSearchMode]   = useState(false)
  const [reasonModal,    setReasonModal]    = useState(null) // { label, endpoint }
  const [resetStatsUser, setResetStatsUser] = useState(null) // { _id, agentNumber }
  const [feedback,       setFeedback]       = useState('')

  const loadAll = useCallback(async () => {
    setLoading(true)
    setIsSearchMode(false)
    const res  = await fetch(`${API}/api/admin/users`, { credentials: 'include' })
    const data = await res.json()
    setUsers(data.data?.users ?? [])
    setLoading(false)
  }, [API])

  useEffect(() => { loadAll() }, [loadAll])

  const runSearch = useCallback(async () => {
    if (!q.trim()) { loadAll(); return }
    setLoading(true)
    setIsSearchMode(true)
    const res  = await fetch(`${API}/api/admin/users/search?q=${encodeURIComponent(q.trim())}`, { credentials: 'include' })
    const data = await res.json()
    setUsers(data.data?.users ?? [])
    setLoading(false)
  }, [API, q, loadAll])

  const refreshSelf = useCallback(async () => {
    const res  = await fetch(`${API}/api/auth/me`, { credentials: 'include' })
    const data = await res.json()
    if (data?.data?.user) setUser(data.data.user)
  }, [API, setUser])

  const triggerAction = (label, endpoint, method = 'POST') => setReasonModal({ label, endpoint, method })

  const confirmAction = async (reason) => {
    await fetch(`${API}${reasonModal.endpoint}`, {
      method: reasonModal.method ?? 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    })
    setReasonModal(null)
    setFeedback('Action completed.')
    setTimeout(() => setFeedback(''), 3000)
    isSearchMode ? runSearch() : loadAll()
  }

  const handleResetDone = useCallback(async (targetUserId) => {
    setResetStatsUser(null)
    setFeedback('Stats reset.')
    setTimeout(() => setFeedback(''), 3000)
    isSearchMode ? runSearch() : loadAll()
    if (currentUser && targetUserId === currentUser._id.toString()) {
      refreshSelf()
    }
  }, [isSearchMode, runSearch, loadAll, refreshSelf, currentUser])

  return (
    <div>
      {reasonModal && (
        <ReasonModal
          action={reasonModal.label}
          onConfirm={confirmAction}
          onCancel={() => setReasonModal(null)}
        />
      )}
      {resetStatsUser && (
        <ResetStatsModal
          agentNumber={resetStatsUser.agentNumber}
          userId={resetStatsUser._id}
          API={API}
          onDone={() => handleResetDone(resetStatsUser._id)}
          onCancel={() => setResetStatsUser(null)}
        />
      )}

      <form className="admin-search-bar" onSubmit={e => { e.preventDefault(); runSearch() }}>
        <input
          className="feed-search"
          style={{ maxWidth: 340 }}
          placeholder="Search by email or agent number…"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        <button type="submit" className="btn-primary">Search</button>
        {isSearchMode && (
          <button type="button" className="btn-ghost" onClick={() => { setQ(''); loadAll() }}>Clear</button>
        )}
      </form>

      {feedback && <p className="admin-feedback">{feedback}</p>}
      {loading  && <p className="admin-loading">{isSearchMode ? 'Searching…' : 'Loading users…'}</p>}
      {!loading && isSearchMode && users.length === 0 && (
        <p className="empty-state">No users found for "{q}".</p>
      )}

      <div className="admin-list">
        {users.map(u => (
          <div key={u._id} className="admin-card">
            <div className="admin-card__header" style={{ cursor: 'default' }}>
              <div>
                <span className="admin-card__title">Agent {u.agentNumber}</span>
                <span className="admin-card__sub"> · {u.email}</span>
              </div>
              <span className={`admin-badge admin-badge--${u.subscriptionTier}`}>
                {u.subscriptionTier}
              </span>
            </div>

            <div className="admin-user-stats">
              <div className="admin-user-stat"><span>Created</span><strong>{new Date(u.createdAt).toLocaleDateString()}</strong></div>
              <div className="admin-user-stat"><span>Logins</span><strong>{u.logins?.length ?? 0}</strong></div>
              <div className="admin-user-stat"><span>Login Streak</span><strong>{u.loginStreak ?? 0}</strong></div>
              <div className="admin-user-stat">
                <span>Aircoins</span>
                <button
                  className="admin-user-stat__link"
                  onClick={() => navigate('aircoin-history', { targetUser: { _id: u._id, agentNumber: u.agentNumber, totalAircoins: u.totalAircoins ?? 0 } })}
                  title="View aircoin history"
                >
                  {(u.totalAircoins ?? 0).toLocaleString()} ⬡
                </button>
              </div>
              <div className="admin-user-stat"><span>Difficulty</span><strong style={{ textTransform: 'capitalize' }}>{u.difficultySetting ?? 'easy'}</strong></div>
              <div className="admin-user-stat"><span>Admin</span><strong>{u.isAdmin ? 'Yes' : 'No'}</strong></div>
              <div className="admin-user-stat"><span>Banned</span><strong>{u.isBanned ? 'Yes' : 'No'}</strong></div>
            </div>

            {u.profileStats && (
              <div className="admin-user-stats admin-user-stats--profile">
                <div className="admin-user-stat"><span>Briefs Read</span><strong>{u.profileStats.brifsRead}</strong></div>
                <div className="admin-user-stat"><span>Quizzes Played</span><strong>{u.profileStats.quizzesPlayed}</strong></div>
                <div className="admin-user-stat"><span>Quizzes Passed</span><strong>{u.profileStats.quizzesCompleted}</strong></div>
                <div className="admin-user-stat"><span>Quizzes Abandoned</span><strong>{u.profileStats.quizzesAbandoned}</strong></div>
                <div className="admin-user-stat"><span>BOO Played</span><strong>{u.profileStats.booPlayed}</strong></div>
                <div className="admin-user-stat"><span>BOO Won</span><strong>{u.profileStats.booWon}</strong></div>
                <div className="admin-user-stat"><span>BOO Abandoned</span><strong>{u.profileStats.booAbandoned}</strong></div>
              </div>
            )}

            <div className="admin-card__actions">
              {!u.isAdmin && (
                <button
                  className="admin-action-btn admin-action-btn--primary"
                  onClick={() => triggerAction(`Grant admin access to Agent ${u.agentNumber}`, `/api/admin/users/${u._id}/make-admin`)}
                >
                  Make Admin
                </button>
              )}
              {u.isAdmin && u._id !== currentUser?._id && (
                <button
                  className="admin-action-btn admin-action-btn--danger"
                  onClick={() => triggerAction(`Remove admin access from Agent ${u.agentNumber} (${u.email})`, `/api/admin/users/${u._id}/remove-admin`)}
                >
                  Remove Admin
                </button>
              )}
              <button
                className="admin-action-btn admin-action-btn--warning"
                onClick={() => setResetStatsUser({ _id: u._id, agentNumber: u.agentNumber })}
              >
                Reset Stats
              </button>
              {!u.isBanned && (
                <button
                  className="admin-action-btn admin-action-btn--danger"
                  onClick={() => triggerAction(`Ban Agent ${u.agentNumber} (${u.email})`, `/api/admin/users/${u._id}/ban`)}
                >
                  Ban User
                </button>
              )}
              {u._id !== currentUser?._id && (
                <button
                  className="admin-action-btn admin-action-btn--danger"
                  onClick={() => triggerAction(`Permanently delete Agent ${u.agentNumber} (${u.email}) and all their data`, `/api/admin/users/${u._id}`, 'DELETE')}
                >
                  Delete Account
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Sound row ─────────────────────────────────────────────────────────────────

const SOUND_FILES = {
  intel_brief_opened:    ['intel_brief_opened.mp3'],
  target_locked:         ['target_locked.mp3'],
  stand_down:            ['stand_down.mp3'],
  target_locked_keyword: ['target_locked_keyword.mp3'],
  battle_of_order_won:       ['battle_of_order_won.mp3'],
  battle_of_order_lost:      ['battle_of_order_lost.mp3'],
  battle_of_order_selection: ['battle_of_order_selection.mp3'],
  fire:                  ['fire.mp3'],
  out_of_ammo:           ['out_of_ammo_1.mp3', 'out_of_ammo_2.mp3', 'out_of_ammo_3.mp3'],
  aircoin:               ['aircoin.mp3'],
  level_up:              ['level_up.mp3'],
  rank_promotion:        ['rank_promotion.mp3'],
  quiz_complete_win:     ['quiz_complete_win.mp3'],
  quiz_complete_lose:    ['quiz_complete_lose.mp3'],
}

const SOUND_GROUPS = [
  {
    title: 'Targeting System',
    sub: 'Plays on the Intel Brief page during focus/targeting mode',
    sounds: [
      { key: 'volumeTargetLocked',        enabledKey: 'soundEnabledTargetLocked',        label: 'Targeting Engaged',    sound: 'target_locked'           },
      { key: 'volumeStandDown',           enabledKey: 'soundEnabledStandDown',           label: 'Targeting Disengaged', sound: 'stand_down'              },
      { key: 'volumeTargetLockedKeyword', enabledKey: 'soundEnabledTargetLockedKeyword', label: 'Keyword Scan',         sound: 'target_locked_keyword'   },
      { key: 'volumeFire',                enabledKey: 'soundEnabledFire',                label: 'Keyword Fired',        sound: 'fire'                    },
      { key: 'volumeOutOfAmmo',           enabledKey: 'soundEnabledOutOfAmmo',           label: 'Out of Ammo',          sound: 'out_of_ammo'             },
    ],
  },
  {
    title: 'Intel Brief',
    sub: 'Plays during general Intel Brief interactions',
    sounds: [
      { key: 'volumeIntelBriefOpened', enabledKey: 'soundEnabledIntelBriefOpened', label: 'Brief Opened', sound: 'intel_brief_opened' },
    ],
  },
  {
    title: 'Rewards & Progression',
    sub: 'Plays when earning aircoins, levelling up or being promoted',
    sounds: [
      { key: 'volumeAircoin',       enabledKey: 'soundEnabledAircoin',       label: 'Aircoins Earned', sound: 'aircoin'        },
      { key: 'volumeLevelUp',       enabledKey: 'soundEnabledLevelUp',       label: 'Level Up',        sound: 'level_up'       },
      { key: 'volumeRankPromotion', enabledKey: 'soundEnabledRankPromotion', label: 'Rank Promotion',  sound: 'rank_promotion' },
    ],
  },
  {
    title: 'Quiz',
    sub: 'Plays at the end of a quiz attempt',
    sounds: [
      { key: 'volumeQuizCompleteWin',  enabledKey: 'soundEnabledQuizCompleteWin',  label: 'Quiz Complete — Win',  sound: 'quiz_complete_win'  },
      { key: 'volumeQuizCompleteLose', enabledKey: 'soundEnabledQuizCompleteLose', label: 'Quiz Complete — Fail', sound: 'quiz_complete_lose' },
    ],
  },
  {
    title: 'Battle of Order',
    sub:   'Plays during the Battle of Order game',
    sounds: [
      { key: 'volumeBattleOfOrderSelection', enabledKey: 'soundEnabledBattleOfOrderSelection', label: 'Reel Selection', sound: 'battle_of_order_selection' },
      { key: 'volumeBattleOfOrderWon',       enabledKey: 'soundEnabledBattleOfOrderWon',       label: 'Game Won',       sound: 'battle_of_order_won'       },
      { key: 'volumeBattleOfOrderLost',      enabledKey: 'soundEnabledBattleOfOrderLost',      label: 'Game Lost',      sound: 'battle_of_order_lost'      },
    ],
  },
]

const ALL_SOUND_KEYS = SOUND_GROUPS.flatMap(g => g.sounds.flatMap(s => [s.key, s.enabledKey]))

function SoundRow({ label, sound, value, onChange, enabled, onToggle }) {
  const previewRef = useRef(null)

  const preview = () => {
    if (previewRef.current) { previewRef.current.pause(); previewRef.current = null }
    invalidateSoundSettings()
    const list = SOUND_FILES[sound] ?? ['']
    const file = list[Math.floor(Math.random() * list.length)]
    const audio = new Audio(`/sounds/${file}`)
    audio.volume = Math.min(1, Math.max(0, value / 100))
    audio.play().catch(() => {})
    previewRef.current = audio
  }

  return (
    <div className={`sound-row${!enabled ? ' sound-row--disabled' : ''}`}>
      <button
        className={`sound-row__toggle${enabled ? ' sound-row__toggle--on' : ' sound-row__toggle--off'}`}
        onClick={onToggle}
        title={enabled ? 'Disable sound' : 'Enable sound'}
        aria-label={enabled ? 'Disable' : 'Enable'}
      >
        {enabled ? 'ON' : 'OFF'}
      </button>
      <span className="sound-row__label">{label}</span>
      <button className="sound-row__play" onClick={preview} title="Preview">▶</button>
      <input
        type="range"
        className="sound-row__slider"
        min={0} max={100} step={1}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        disabled={!enabled}
      />
      <input
        type="number"
        className="sound-row__num"
        min={0} max={100}
        value={value}
        onChange={e => onChange(Math.min(100, Math.max(0, Number(e.target.value))))}
        disabled={!enabled}
      />
      <span className="sound-row__pct">%</span>
    </div>
  )
}

// ── Settings tab ──────────────────────────────────────────────────────────────

function SettingsTab({ API }) {
  const { awardAircoins } = useAuth()
  const [settings,        setSettings]        = useState(null)
  const [draft,           setDraft]           = useState({})
  const [reasonModal,     setReasonModal]     = useState(null)
  const [feedback,        setFeedback]        = useState('')
  const [testCoinsAmount, setTestCoinsAmount] = useState('')
  const [coinsBusy,       setCoinsBusy]       = useState(false)

  const loadSettings = useCallback(() => {
    fetch(`${API}/api/admin/settings`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { const s = d.data?.settings; if (s) { setSettings(s); setDraft(s) } })
  }, [API])

  useEffect(() => { loadSettings() }, [loadSettings])

  const awardTestCoins = async () => {
    const amount = parseInt(testCoinsAmount, 10)
    if (!amount || amount <= 0) return
    setCoinsBusy(true)
    try {
      const res  = await fetch(`${API}/api/admin/award-coins`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      })
      const data = await res.json()
      if (data.status === 'success') {
        awardAircoins(data.awarded, 'Test Coins', { cycleAfter: data.cycleAircoins, totalAfter: data.totalAircoins, rankPromotion: data.rankPromotion })
        setFeedback(`✓ Awarded ${data.awarded} test coins.`)
        setTestCoinsAmount('')
      } else {
        setFeedback(`Error: ${data.message}`)
      }
    } catch {
      setFeedback('Failed to award coins.')
    }
    setCoinsBusy(false)
    setTimeout(() => setFeedback(''), 4000)
  }

  const saveSection = (label, fields) => {
    const updates = {}
    fields.forEach(f => { updates[f] = draft[f] })

    setReasonModal({
      label,
      onConfirm: async (reason) => {
        await fetch(`${API}/api/admin/settings`, {
          method: 'PATCH', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...updates, reason }),
        })
        setReasonModal(null)
        invalidateSoundSettings()
        setFeedback(`${label} saved.`)
        setTimeout(() => setFeedback(''), 3000)
        loadSettings()
      },
    })
  }

  const pctSliderField = (key, label) => {
    const val = draft[key] ?? 60
    const steps = [0, 20, 40, 60, 80, 100]
    return (
      <div className="settings-field settings-field--pct">
        <label className="settings-field__label">{label}</label>
        <div className="pct-slider-wrap">
          <input
            type="range"
            className="pct-slider"
            min={0} max={100} step={20}
            value={val}
            onChange={e => setDraft(prev => ({ ...prev, [key]: Number(e.target.value) }))}
          />
          <div className="pct-slider-ticks">
            {steps.map(v => (
              <span key={v} className={`pct-slider-tick ${val === v ? 'pct-slider-tick--active' : ''}`}>{v}%</span>
            ))}
          </div>
        </div>
      </div>
    )
  }

  const numField = (key, label, min = 0, max = 999) => (
    <div className="settings-field">
      <label className="settings-field__label">{label}</label>
      <input
        type="number"
        className="settings-field__input"
        min={min}
        max={max}
        value={draft[key] ?? ''}
        onChange={e => setDraft(prev => ({ ...prev, [key]: Number(e.target.value) }))}
      />
    </div>
  )

  const toggleCategory = (cat) => {
    setDraft(prev => {
      const cats = prev.silverCategories ?? []
      return {
        ...prev,
        silverCategories: cats.includes(cat)
          ? cats.filter(c => c !== cat)
          : [...cats, cat],
      }
    })
  }

  if (!settings) return <p className="admin-loading">Loading settings…</p>

  return (
    <div>
      {reasonModal && (
        <ReasonModal
          action={reasonModal.label}
          onConfirm={reasonModal.onConfirm}
          onCancel={() => setReasonModal(null)}
        />
      )}

      {feedback && <p className="admin-feedback">{feedback}</p>}

      {/* Subscription settings */}
      <div className="admin-section">
        <h3 className="admin-section-title">Subscription Settings</h3>
        {numField('trialDurationDays', 'Trial subscription duration (days)', 1, 365)}

        <p className="admin-section-sub" style={{ marginTop: '1.25rem' }}>
          Free tier accessible categories
          <span className="settings-tier-badge settings-tier-badge--free">Free</span>
        </p>
        <div className="settings-categories">
          {ALL_CATEGORIES.map(cat => (
            <label key={cat} className="settings-cat-label">
              <input
                type="checkbox"
                checked={draft.freeCategories?.includes(cat) ?? false}
                onChange={() => setDraft(prev => {
                  const cats = prev.freeCategories ?? []
                  return { ...prev, freeCategories: cats.includes(cat) ? cats.filter(c => c !== cat) : [...cats, cat] }
                })}
              />
              {cat}
            </label>
          ))}
        </div>

        <p className="admin-section-sub" style={{ marginTop: '1.25rem' }}>
          Silver tier accessible categories
          <span className="settings-tier-badge settings-tier-badge--silver">Silver</span>
        </p>
        <div className="settings-categories">
          {ALL_CATEGORIES.map(cat => (
            <label key={cat} className="settings-cat-label">
              <input
                type="checkbox"
                checked={draft.silverCategories?.includes(cat) ?? false}
                onChange={() => toggleCategory(cat)}
              />
              {cat}
            </label>
          ))}
        </div>
        <p className="settings-tier-note">
          <span className="settings-tier-badge settings-tier-badge--gold">Gold</span>
          Gold tier always has access to all categories.
        </p>
        <button
          className="btn-primary settings-save"
          onClick={() => saveSection('Update Subscription Settings', ['trialDurationDays', 'freeCategories', 'silverCategories'])}
        >
          Save Subscription Settings
        </button>
      </div>

      {/* Aircoin options */}
      <div className="admin-section">
        <h3 className="admin-section-title">Aircoin Options</h3>
        {numField('aircoinsPerWinEasy',    'Aircoins per correct answer — Easy quiz')}
        {numField('aircoinsPerWinMedium',  'Aircoins per correct answer — Medium quiz')}
        {numField('aircoinsPerBriefRead', 'Aircoins awarded per brief read (first time)')}
        {numField('aircoinsFirstLogin',   'Bonus Aircoins on first daily login')}
        {numField('aircoinsStreakBonus',  'Bonus Aircoins per streak login day')}
        {numField('aircoins100Percent',   'Bonus Aircoins for 100% correct quiz')}
          <div className="settings-field">
            <label className="settings-label">Aircoins — Battle of Order (Easy)</label>
            <input type="number" className="settings-input" min={0} value={draft.aircoinsOrderOfBattleEasy ?? 8}
              onChange={e => setDraft(p => ({ ...p, aircoinsOrderOfBattleEasy: Number(e.target.value) }))} />
          </div>
          <div className="settings-field">
            <label className="settings-label">Aircoins — Battle of Order (Medium)</label>
            <input type="number" className="settings-input" min={0} value={draft.aircoinsOrderOfBattleMedium ?? 18}
              onChange={e => setDraft(p => ({ ...p, aircoinsOrderOfBattleMedium: Number(e.target.value) }))} />
          </div>
        <button
          className="btn-primary settings-save"
          onClick={() => saveSection('Update Aircoin Options', ['aircoinsPerWinEasy', 'aircoinsPerWinMedium', 'aircoinsPerBriefRead', 'aircoinsFirstLogin', 'aircoinsStreakBonus', 'aircoins100Percent', 'aircoinsOrderOfBattleEasy', 'aircoinsOrderOfBattleMedium'])}
        >
          Save Aircoin Options
        </button>
      </div>

      {/* Game / ammo options */}
      <div className="admin-section">
        <h3 className="admin-section-title">Game Options</h3>

        <p className="admin-section-sub">Intel Brief Ammunition (per tier)</p>
        {numField('ammoFree',   'Ammo per brief — Free tier',   0, 99)}
        {numField('ammoSilver', 'Ammo per brief — Silver / Trial tier', 0, 99)}
        <p className="settings-tier-note">
          <span className="settings-tier-badge settings-tier-badge--gold">Gold</span>
          Gold tier always receives unlimited ammunition.
        </p>

        <p className="admin-section-sub" style={{ marginTop: '1.25rem' }}>Quiz answer display count</p>
        {numField('easyAnswerCount',   'Answers shown — Easy difficulty',   2, 10)}
        {numField('mediumAnswerCount', 'Answers shown — Medium difficulty', 2, 10)}

        <p className="admin-section-sub" style={{ marginTop: '1.25rem' }}>Quiz pass threshold (% correct to count as a win)</p>
        {pctSliderField('passThresholdEasy',   'Pass threshold — Easy difficulty')}
        {pctSliderField('passThresholdMedium', 'Pass threshold — Medium difficulty')}

        <button
          className="btn-primary settings-save"
          onClick={() => saveSection('Update Game Options', ['ammoFree', 'ammoSilver', 'easyAnswerCount', 'mediumAnswerCount', 'passThresholdEasy', 'passThresholdMedium'])}
        >
          Save Game Options
        </button>
      </div>

      {/* Sound Effects */}
      <div className="admin-section">
        <h3 className="admin-section-title">Sound Effects</h3>
        <p className="admin-section-sub">Toggle sounds on/off, adjust volume, and preview each effect.</p>

        {SOUND_GROUPS.map(group => (
          <div key={group.title} className="sound-group">
            <div className="sound-group__header">
              <span className="sound-group__title">{group.title}</span>
              <span className="sound-group__sub">{group.sub}</span>
            </div>
            {group.sounds.map(({ key, enabledKey, label, sound }) => (
              <SoundRow
                key={key}
                label={label}
                sound={sound}
                value={draft[key] ?? 100}
                onChange={v => setDraft(prev => ({ ...prev, [key]: v }))}
                enabled={draft[enabledKey] !== false}
                onToggle={() => setDraft(prev => ({ ...prev, [enabledKey]: prev[enabledKey] === false ? true : false }))}
              />
            ))}
          </div>
        ))}

        <button
          className="btn-primary settings-save"
          onClick={() => saveSection('Update Sound Settings', ALL_SOUND_KEYS)}
        >
          Save Sound Settings
        </button>
      </div>

      {/* Feature flags */}
      <div className="admin-section">
        <h3 className="admin-section-title">Feature Flags</h3>
        <p className="admin-section-sub">Enable or disable features that are under development or awaiting real data.</p>

        <div className="settings-flag">
          <div className="settings-flag__info">
            <span className="settings-flag__name">Live Leaderboard</span>
            <span className="settings-flag__desc">
              When enabled, the Profile page leaderboard reads from the database.
              When disabled, mock placeholder data is shown instead.
            </span>
          </div>
          <label className="settings-flag__toggle">
            <input
              type="checkbox"
              checked={draft.useLiveLeaderboard ?? false}
              onChange={e => setDraft(prev => ({ ...prev, useLiveLeaderboard: e.target.checked }))}
            />
            <span className={`settings-flag__pill ${draft.useLiveLeaderboard ? 'settings-flag__pill--on' : ''}`}>
              {draft.useLiveLeaderboard ? 'Live' : 'Mock'}
            </span>
          </label>
        </div>

        <div className="settings-flag">
          <div className="settings-flag__info">
            <span className="settings-flag__name">Disable Loading Bar</span>
            <span className="settings-flag__desc">
              Skip the intel brief loading sequence entirely. Useful for testing — page reveals instantly with no sound or progress bar.
            </span>
          </div>
          <label className="settings-flag__toggle">
            <input
              type="checkbox"
              checked={draft.disableLoadingBar ?? false}
              onChange={e => setDraft(prev => ({ ...prev, disableLoadingBar: e.target.checked }))}
            />
            <span className={`settings-flag__pill ${draft.disableLoadingBar ? 'settings-flag__pill--on' : ''}`}>
              {draft.disableLoadingBar ? 'Disabled' : 'Enabled'}
            </span>
          </label>
        </div>

        <button
          className="btn-primary settings-save"
          onClick={() => saveSection('Update Feature Flags', ['useLiveLeaderboard', 'disableLoadingBar'])}
        >
          Save Feature Flags
        </button>
      </div>

      {/* Award Test Coins */}
      <div className="admin-section">
        <h3 className="admin-section-title">Award Test Coins</h3>
        <p className="admin-section-sub">Award aircoins directly to your admin account. Logged as "Test Coins".</p>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="form-input"
            type="number"
            min="1"
            placeholder="Amount…"
            value={testCoinsAmount}
            onChange={e => setTestCoinsAmount(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && awardTestCoins()}
            style={{ width: 140 }}
          />
          <button
            className="btn-primary"
            onClick={awardTestCoins}
            disabled={coinsBusy || !testCoinsAmount || parseInt(testCoinsAmount, 10) <= 0}
          >
            {coinsBusy ? 'Awarding…' : 'Award Coins'}
          </button>
        </div>
      </div>

    </div>
  )
}

// ── Intel Briefs tab ──────────────────────────────────────────────────────────

const LIMIT = 20

function BriefsTab({ API }) {
  const [view,         setView]         = useState('list')   // 'list' | 'edit'
  const [briefs,       setBriefs]       = useState([])
  const [total,        setTotal]        = useState(0)
  const [search,       setSearch]       = useState('')
  const [catFilter,    setCatFilter]    = useState('')
  const [page,         setPage]         = useState(1)
  const [loading,      setLoading]      = useState(true)
  const [editing,      setEditing]      = useState(null)      // populated brief doc or {} for new
  const [isNew,        setIsNew]        = useState(false)
  const [draft,        setDraft]        = useState({})
  const [reasonModal,  setReasonModal]  = useState(null)
  const [feedback,     setFeedback]     = useState('')
  const [busy,         setBusy]         = useState(false)
  const [mediaUrl,     setMediaUrl]     = useState('')
  const [mediaType,    setMediaType]    = useState('picture')
  const [aiMediaSearching, setAiMediaSearching] = useState(false)
  const [generatedImages,  setGeneratedImages]  = useState([]) // [{ url, term, wikiPage, selected }]
  const [aiGenerating,     setAiGenerating]     = useState(false)
  const [pendingMedia, setPendingMedia] = useState([])  // media queued before first save
  const [leadModal,    setLeadModal]    = useState(false)
  const [pendingLead,  setPendingLead]  = useState(null) // lead text to mark [DB] after save
  const originalMediaRef = useRef([])                   // snapshot of media at open-time for diffing

  // Quiz question state
  const [draftQuizEasy,   setDraftQuizEasy]   = useState([])
  const [draftQuizMedium, setDraftQuizMedium] = useState([])
  const [quizView,        setQuizView]        = useState('list') // 'list' | 'answers'
  const [quizSelected,    setQuizSelected]    = useState(null)   // { difficulty, index }
  const [quizGenerating,      setQuizGenerating]      = useState(false)
  const [booGenerating,       setBooGenerating]       = useState(false)
  const [kwGenerating,        setKwGenerating]        = useState(false)
  const [aiRegenDesc,         setAiRegenDesc]         = useState(false)
  const [bulkActionsOpen, setBulkActionsOpen] = useState(false)
  const [backfillStatus,  setBackfillStatus]  = useState(null)   // null | { done, msg }

  // ── Live RAF news (list view) — manual fetch only ────────
  const [rafNews,     setRafNews]     = useState([])
  const [newsLoading, setNewsLoading] = useState(false)
  const [newsError,   setNewsError]   = useState('')
  const [newsFetched, setNewsFetched] = useState(false)

  const fetchLatestIntel = useCallback(() => {
    setNewsLoading(true)
    setNewsError('')
    const timestamp = new Date().toLocaleString('en-GB', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    })
    fetch(`${API}/api/admin/ai/news-headlines`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timestamp }),
    })
      .then(r => r.json())
      .then(data => {
        setRafNews(data.data?.headlines ?? [])
        setNewsFetched(true)
      })
      .catch(() => setNewsError('Could not load news headlines.'))
      .finally(() => setNewsLoading(false))
  }, [])

  const loadBriefs = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ page, limit: LIMIT })
    if (search.trim())  params.set('search',   search.trim())
    if (catFilter)      params.set('category', catFilter)
    const res  = await fetch(`${API}/api/admin/briefs?${params}`, { credentials: 'include' })
    const data = await res.json()
    setBriefs(data.data?.briefs ?? [])
    setTotal(data.data?.total   ?? 0)
    setLoading(false)
  }, [API, search, catFilter, page])

  useEffect(() => { if (view === 'list') loadBriefs() }, [loadBriefs, view])

  const openEdit = async (brief) => {
    setGeneratedImages([])
    setEditing(brief)
    setDraft({
      title:       brief.title       ?? '',
      subtitle:    brief.subtitle    ?? '',
      description: brief.description ?? '',
      category:    brief.category    ?? ALL_CATEGORIES[0],
      subcategory: brief.subcategory ?? '',
      historic:    brief.historic    ?? false,
      dateAdded:   brief.dateAdded   ? brief.dateAdded.slice(0, 10) : new Date().toISOString().slice(0, 10),
      sources:     brief.sources  ? brief.sources.map(s => ({ ...s }))  : [],
      keywords:    brief.keywords ? brief.keywords.map(k => ({ ...k })) : [],
      gameData:    brief.gameData ?? {},
    })
    setIsNew(false)
    setDraftQuizEasy([])
    setDraftQuizMedium([])
    setQuizView('list')
    setQuizSelected(null)
    setView('edit')
    setFeedback('')

    // Fetch full brief to get populated quiz questions
    if (brief._id) {
      try {
        const res  = await fetch(`${API}/api/admin/briefs/${brief._id}`, { credentials: 'include' })
        const data = await res.json()
        if (data.status === 'success') {
          const fullBrief = data.data.brief
          setEditing(fullBrief)
          originalMediaRef.current = fullBrief.media ?? []
          const toLocal = q => ({
            question: q.question,
            answers:  q.answers.map(a => ({
              title:    a.title,
              isCorrect: String(a._id) === String(q.correctAnswerId),
            })),
          })
          if (fullBrief.quizQuestionsEasy?.length   > 0) setDraftQuizEasy(fullBrief.quizQuestionsEasy.map(toLocal))
          if (fullBrief.quizQuestionsMedium?.length > 0) setDraftQuizMedium(fullBrief.quizQuestionsMedium.map(toLocal))
        }
      } catch { /* proceed with empty quiz state */ }
    }
  }

  const openNew = () => {
    setEditing({ media: [] })
    setDraft({
      title: '', subtitle: '', description: '',
      category: ALL_CATEGORIES[0],
      subcategory: '',
      historic: false,
      dateAdded: new Date().toISOString().slice(0, 10),
      sources: [], keywords: [],
      gameData: {},
    })
    setPendingLead(null)
    setGeneratedImages([])
    setIsNew(true)
    setDraftQuizEasy([])
    setDraftQuizMedium([])
    setQuizView('list')
    setQuizSelected(null)
    setView('edit')
    setFeedback('')
    setPendingMedia([{ mediaType: 'picture', mediaUrl: DEFAULT_BRIEF_IMAGE }])
  }

  const backToList = () => {
    setView('list')
    setEditing(null)
    setPendingMedia([])
    setGeneratedImages([])
    setDraftQuizEasy([])
    setDraftQuizMedium([])
    setQuizView('list')
    setQuizSelected(null)
  }

  // Map intel_brief_leads.txt section headers → category + subcategory
  const leadSectionToCategory = (section) => {
    if (/SECTION 1/i.test(section))           return 'Ranks'
    if (/SECTION 2/i.test(section))           return 'Squadrons'
    if (/SECTION 3|SECTION 4/i.test(section)) return 'Aircrafts'
    if (/SECTION 5|SECTION 6/i.test(section)) return 'Bases'
    if (/SECTION 7/i.test(section))           return 'Training'
    if (/SECTION 8/i.test(section))           return 'Threats'
    if (/SECTION 9/i.test(section))           return 'Allies'
    if (/SECTION 10/i.test(section))          return 'Missions'
    if (/SECTION 11/i.test(section))          return 'Tech'
    if (/SECTION 12/i.test(section))          return 'Terminology'
    if (/SECTION 13/i.test(section))          return 'Treaties'
    if (/SECTION 14/i.test(section))          return 'AOR'
    return ALL_CATEGORIES[0]
  }

  const leadSubsectionToSubcategory = (subsection) => {
    const map = {
      'FAST JET':                               'Fast Jet',
      'INTELLIGENCE, SURVEILLANCE & RECONNAISSANCE (ISR)': 'ISR & Surveillance',
      'MARITIME PATROL':                        'Maritime Patrol',
      'TRANSPORT & TANKER':                     'Transport & Tanker',
      'ROTARY WING':                            'Rotary Wing',
      'TRAINING (FIXED WING)':                  'Training Aircraft',
      'GROUND-BASED AIR DEFENCE (RAF REGIMENT)':'Ground-Based Air Defence',
      'WWII ERA':                               'Historic — WWII',
      'PRE-WWII / INTERWAR':                    'Historic — WWII',
      'COLD WAR ERA':                           'Historic — Cold War',
      'PANAVIA TORNADO FAMILY':                 'Historic — Cold War',
      'BAE HARRIER FAMILY':                     'Historic — Cold War',
      'POST-COLD WAR / RECENT RETIREMENTS':     'Historic — Post-Cold War',
      'MAIN OPERATING BASES':                   'UK Active',
      'SUPPORT, INTELLIGENCE & SPECIALIST SITES':'UK Active',
      'FORMER / RECENTLY CLOSED UK BASES':      'UK Former',
      'PERMANENT OVERSEAS BASES':               'Overseas Permanent',
      'DEPLOYED / FORWARD OPERATING LOCATIONS': 'Overseas Deployed / FOL',
      'COMMISSIONED OFFICER RANKS':             'Commissioned Officer',
      'NON-COMMISSIONED RANKS':                 'Non-Commissioned',
      'SPECIALIST ROLES & DESIGNATIONS':        'Specialist Role',
      'ACTIVE FRONT-LINE SQUADRONS':            'Active Front-Line',
      'TRAINING SQUADRONS':                     'Training',
      'ROYAL AUXILIARY AIR FORCE (RAuxAF) SQUADRONS': 'Royal Auxiliary Air Force',
      'HISTORIC / FAMOUS SQUADRONS':            'Historic',
      'INITIAL TRAINING':                       'Initial Training',
      'FLYING TRAINING PIPELINE':               'Flying Training',
      'GROUND TRAINING & PROFESSIONAL MILITARY EDUCATION': 'Ground Training & PME',
      'AIR COMBAT & TACTICAL TRAINING':         'Tactical & Combat Training',
      'STATE ACTOR AIR THREATS':                'State Actor Air',
      'SURFACE-TO-AIR MISSILE (SAM) THREATS':  'Surface-to-Air Missiles',
      'ASYMMETRIC / NON-STATE THREATS':         'Asymmetric & Non-State',
      'MISSILE & STAND-OFF THREATS':            'Missiles & Stand-Off',
      'ELECTRONIC & CYBER THREATS':             'Electronic & Cyber',
      'NATO ALLIES (KEY)':                      'NATO',
      'FIVE EYES PARTNERS':                     'Five Eyes',
      'AUKUS PARTNERS':                         'AUKUS',
      'BILATERAL & FRAMEWORK PARTNERS':         'Bilateral & Framework Partners',
      'WEAPONS SYSTEMS':                        'Weapons Systems',
      'SENSORS & AVIONICS':                     'Sensors & Avionics',
      'ELECTRONIC WARFARE':                     'Electronic Warfare',
      'FUTURE TECHNOLOGY & PROGRAMMES':         'Future Programmes',
      'COMMAND & CONTROL / COMMS':              'Command, Control & Comms',
      'OPERATIONAL CONCEPTS':                   'Operational Concepts',
      'FLYING & TACTICAL TERMINOLOGY':          'Flying & Tactical',
      'AIR TRAFFIC & NAVIGATION':               'Air Traffic & Navigation',
      'INTELLIGENCE & PLANNING':                'Intelligence & Planning',
      'MAINTENANCE & SUPPORT':                  'Maintenance & Support',
      'FOUNDING & CORE ALLIANCES':              'Founding & Core Alliances',
      'BILATERAL & DEFENCE AGREEMENTS':         'Bilateral Defence Agreements',
      'ARMS CONTROL & NON-PROLIFERATION':       'Arms Control & Non-Proliferation',
      'OPERATIONAL & STATUS AGREEMENTS':        'Operational & Status Agreements',
    }
    return map[subsection] || ''
  }

  const handleLeadConfirm = (lead) => {
    setLeadModal(false)
    openNew() // resets form; also clears pendingLead via setPendingLead(null)
    setPendingLead(lead.text)

    const category    = leadSectionToCategory(lead.section)
    const subcategory = leadSubsectionToSubcategory(lead.subsection)

    setDraft(p => ({ ...p, category, subcategory }))
    setAiGenerating(true)
    setPendingMedia([{ mediaType: 'picture', mediaUrl: DEFAULT_BRIEF_IMAGE }])

    fetch(`${API}/api/admin/ai/generate-brief`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: lead.text }),
    })
      .then(r => r.json())
      .then(async data => {
        const generated  = data.data?.brief ?? {}
        const sources    = Array.isArray(generated.sources)
          ? generated.sources.filter(s => s.url && s.url.startsWith('http'))
          : []
        const briefTitle = generated.title || lead.text
        const briefDesc  = generated.description || ''
        setDraft(p => ({
          ...p,
          title:       briefTitle,
          subtitle:    generated.subtitle || '',
          description: briefDesc,
          keywords:    Array.isArray(generated.keywords) ? generated.keywords : [],
          sources,
          historic:    typeof generated.historic === 'boolean' ? generated.historic : p.historic,
        }))
        setFeedback('Brief populated — generating quiz questions…')
        try {
          setQuizGenerating(true)
          const qRes  = await fetch(`${API}/api/admin/ai/generate-quiz`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: briefTitle, description: briefDesc }),
          })
          const qData  = await qRes.json()
          const fromAI = (qs) => (Array.isArray(qs) ? qs : []).map(q => ({
            question: q.question ?? '',
            answers: (q.answers ?? []).map((a, ai) => ({
              title: a.title ?? '', isCorrect: ai === q.correctAnswerIndex,
            })),
          }))
          if (Array.isArray(qData.data?.easyQuestions))   setDraftQuizEasy(fromAI(qData.data.easyQuestions))
          if (Array.isArray(qData.data?.mediumQuestions)) setDraftQuizMedium(fromAI(qData.data.mediumQuestions))
          setFeedback('Brief and quiz questions generated — review carefully before saving.')

          // Auto-generate Battle of Order data for eligible categories (skip historic ranks)
          const generatedHistoric = typeof generated.historic === 'boolean' ? generated.historic : draft.historic
          if (['Aircrafts','Ranks','Training','Missions','Tech','Treaties'].includes(category) && !(category === 'Ranks' && generatedHistoric)) {
            try {
              setBooGenerating(true)
              const booRes  = await fetch(`${API}/api/admin/ai/generate-battle-order-data`, {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: briefTitle, description: briefDesc, category }),
              })
              const booData = await booRes.json()
              if (booData.data?.gameData) setDraft(p => ({ ...p, gameData: { ...p.gameData, ...booData.data.gameData } }))
            } catch { /* non-fatal */ } finally {
              setBooGenerating(false)
            }
          }
        } catch {
          setFeedback('Brief populated — quiz generation failed, add questions manually.')
        } finally {
          setQuizGenerating(false)
        }
        setTimeout(() => setFeedback(''), 7000)
      })
      .catch(() => {
        setFeedback('AI generation failed — fill in the form manually.')
        setTimeout(() => setFeedback(''), 5000)
      })
      .finally(() => setAiGenerating(false))
  }

  const doSave = async (reason) => {
    const wasNew = isNew
    setBusy(true)
    setReasonModal(null)

    // ── For existing briefs: stage new media items first so we have their IDs ──
    // Items without _id were added to editing.media in state but never POSTed yet.
    let stagedMedia = wasNew ? [] : [...(editing.media ?? [])]
    if (!wasNew) {
      for (let i = 0; i < stagedMedia.length; i++) {
        const m = stagedMedia[i]
        if (m._id) continue
        const r = await fetch(`${API}/api/admin/briefs/${editing._id}/media`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mediaType: m.mediaType, mediaUrl: m.mediaUrl }),
        }).then(r => r.json()).catch(() => null)
        const newItem = r?.data?.brief?.media?.slice(-1)[0]
        if (newItem?._id) stagedMedia[i] = { ...m, _id: newItem._id }
      }
    }

    const url    = wasNew ? `${API}/api/admin/briefs` : `${API}/api/admin/briefs/${editing._id}`
    const method = wasNew ? 'POST' : 'PATCH'
    const res    = await fetch(url, {
      method, credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...draft,
        reason,
        ...(!wasNew ? { media: stagedMedia.map(m => m._id).filter(Boolean) } : {}),
      }),
    })
    const data = await res.json()
    if (data.status === 'success') {
      let savedBrief = data.data.brief

      // ── New brief: flush all queued pendingMedia in order ──────────────────
      if (wasNew && pendingMedia.length > 0) {
        for (const item of pendingMedia) {
          const mediaRes = await fetch(`${API}/api/admin/briefs/${savedBrief._id}/media`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item),
          }).then(r => r.json()).catch(() => null)
          if (mediaRes?.status === 'success') savedBrief = mediaRes.data.brief
        }
        setPendingMedia([])
      }

      // ── Existing brief: delete removed items + patch changed URLs ──────────
      if (!wasNew) {
        const origIds    = new Set((originalMediaRef.current ?? []).map(m => String(m._id)))
        const currentIds = new Set(stagedMedia.filter(m => m._id).map(m => String(m._id)))

        // Delete media documents for items removed from the list
        for (const id of origIds) {
          if (!currentIds.has(id)) {
            await fetch(`${API}/api/admin/briefs/${editing._id}/media/${id}`, {
              method: 'DELETE', credentials: 'include',
            }).catch(() => null)
          }
        }

        // Patch URLs/types that changed
        for (const m of stagedMedia.filter(m => m._id)) {
          const orig = (originalMediaRef.current ?? []).find(o => String(o._id) === String(m._id))
          if (orig && (orig.mediaUrl !== m.mediaUrl || orig.mediaType !== m.mediaType)) {
            await fetch(`${API}/api/admin/media/${m._id}`, {
              method: 'PATCH', credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ mediaUrl: m.mediaUrl, mediaType: m.mediaType }),
            }).catch(() => null)
          }
        }

        originalMediaRef.current = stagedMedia.filter(m => m._id)
      }

      // ── Save quiz questions ────────────────────────────────────────────────
      if (draftQuizEasy.length > 0 || draftQuizMedium.length > 0) {
        await fetch(`${API}/api/admin/briefs/${savedBrief._id}/questions/bulk`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            easyQuestions:   toApiFormat(draftQuizEasy),
            mediumQuestions: toApiFormat(draftQuizMedium),
            reason,
          }),
        }).catch(() => null)
      }

      setEditing(savedBrief)
      setIsNew(false)
      setFeedback('Saved successfully.')
      setTimeout(() => setFeedback(''), 3000)
      if (pendingLead) {
        fetch(`${API}/api/admin/intel-leads/mark-complete`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lead: pendingLead }),
        }).catch(() => {})
        setPendingLead(null)
      }
    } else {
      setFeedback(`Error: ${data.message}`)
    }
    setBusy(false)
  }

  const doDelete = async (reason) => {
    setBusy(true)
    setReasonModal(null)
    await fetch(`${API}/api/admin/briefs/${editing._id}`, {
      method: 'DELETE', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    })
    setBusy(false)
    backToList()
  }

  const addMedia = () => {
    if (!mediaUrl.trim()) return
    setEditing(prev => ({ ...prev, media: [...(prev.media ?? []), { mediaType, mediaUrl: mediaUrl.trim() }] }))
    setMediaUrl('')
  }

  const removeMedia = (idx) => {
    const item = editing.media?.[idx]
    if (item?.mediaUrl?.startsWith('/uploads/brief-images/')) {
      fetch(`${API}/api/admin/media/brief-image`, {
        method: 'DELETE', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: item.mediaUrl }),
      }).catch(() => {})
    }
    setEditing(prev => ({ ...prev, media: prev.media.filter((_, i) => i !== idx) }))
  }

  const movePendingMedia = (idx, dir) => {
    setPendingMedia(prev => {
      const arr  = [...prev]
      const swap = idx + dir
      if (swap < 0 || swap >= arr.length) return prev
      ;[arr[idx], arr[swap]] = [arr[swap], arr[idx]]
      return arr
    })
  }

  const moveMedia = (idx, dir) => {
    setEditing(prev => {
      const media = [...prev.media]
      const swap  = idx + dir
      if (swap < 0 || swap >= media.length) return prev
      ;[media[idx], media[swap]] = [media[swap], media[idx]]
      return { ...prev, media }
    })
  }

  const findMediaWithAI = async () => {
    const isVideo = mediaType === 'video'

    // Videos: open a YouTube search — <video> tags can't embed YouTube directly
    if (isVideo) {
      const q = encodeURIComponent((draft.title || draft.subtitle || '').slice(0, 120) || 'RAF aircraft')
      window.open(`https://www.youtube.com/results?search_query=${q}`, '_blank', 'noopener')
      setFeedback('YouTube search opened in a new tab — find a direct video URL (.mp4) and paste it here.')
      setTimeout(() => setFeedback(''), 6000)
      return
    }

    setAiMediaSearching(true)
    setFeedback('Identifying subject and fetching Wikipedia image…')
    try {
      const saveRes  = await fetch(`${API}/api/admin/ai/generate-image`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: draft.title || 'Royal Air Force', subtitle: draft.subtitle || '' }),
      })
      const saveData = await saveRes.json()

      if (saveData.status === 'success') {
        const images = (saveData.data.images ?? []).map(img => ({ ...img, selected: true }))
        setGeneratedImages(images)
        setFeedback(`${images.length} image${images.length !== 1 ? 's' : ''} found — select which to add.`)
        setTimeout(() => setFeedback(''), 8000)
      } else {
        setFeedback(`Image fetch failed: ${saveData.message}`)
        setTimeout(() => setFeedback(''), 6000)
      }
    } catch (err) {
      console.error('[generateImage] error:', err)
      setFeedback(`Image generation failed: ${err.message}`)
      setTimeout(() => setFeedback(''), 6000)
    } finally {
      setAiMediaSearching(false)
    }
  }

  const addSelectedImages = () => {
    const toAdd = generatedImages
      .filter(img => img.selected)
      .map(img => ({ mediaType: 'picture', mediaUrl: img.url }))
    if (isNew) {
      setPendingMedia(prev => [...prev, ...toAdd])
    } else {
      setEditing(prev => ({ ...prev, media: [...(prev.media ?? []), ...toAdd] }))
    }
    setGeneratedImages([])
  }

  const addSource    = () => setDraft(p => ({ ...p, sources:  [...p.sources,  { url: '', articleDate: '', siteName: '' }] }))
  const removeSource = (i) => setDraft(p => ({ ...p, sources:  p.sources.filter((_, idx) => idx !== i) }))
  const updateSource = (i, field, val) => setDraft(p => {
    const sources = p.sources.map((s, idx) => idx === i ? { ...s, [field]: val } : s)
    return { ...p, sources }
  })

  const addKeyword    = () => setDraft(p => ({ ...p, keywords: [...p.keywords, { keyword: '', generatedDescription: '' }] }))
  const removeKeyword = (i) => setDraft(p => ({ ...p, keywords: p.keywords.filter((_, idx) => idx !== i) }))
  const updateKeyword = (i, field, val) => setDraft(p => {
    const keywords = p.keywords.map((k, idx) => idx === i ? { ...k, [field]: val } : k)
    return { ...p, keywords }
  })

  const generateKeywords = async () => {
    if (!draft.description) return
    const needed = 10 - (draft.keywords?.length ?? 0)
    if (needed <= 0) return
    setKwGenerating(true)
    try {
      const existing = (draft.keywords ?? []).map(k => k.keyword).filter(Boolean)
      const res  = await fetch(`${API}/api/admin/ai/generate-keywords`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: draft.description, existingKeywords: existing, needed }),
      })
      const data = await res.json()
      if (data.status === 'success' && data.data.keywords.length > 0) {
        setDraft(p => ({ ...p, keywords: [...p.keywords, ...data.data.keywords] }))
      } else {
        setFeedback('No additional keywords found in the description.')
        setTimeout(() => setFeedback(''), 4000)
      }
    } catch {
      setFeedback('Keyword generation failed — please try again.')
      setTimeout(() => setFeedback(''), 4000)
    } finally {
      setKwGenerating(false)
    }
  }

  // ── Quiz question helpers ──────────────────────────────────────────────────

  const generateQuizQuestions = async () => {
    if (!draft.title && !draft.description) return
    setQuizGenerating(true)
    try {
      const res = await fetch(`${API}/api/admin/ai/generate-quiz`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: draft.title, description: draft.description ?? '' }),
      })
      const data = await res.json()
      const generated = data.data ?? {}
      const fromAI = (qs) => (Array.isArray(qs) ? qs : []).map(q => ({
        question: q.question ?? '',
        answers: (q.answers ?? []).map((a, ai) => ({
          title:    a.title ?? '',
          isCorrect: ai === q.correctAnswerIndex,
        })),
      }))
      if (Array.isArray(generated.easyQuestions))   setDraftQuizEasy(fromAI(generated.easyQuestions))
      if (Array.isArray(generated.mediumQuestions)) setDraftQuizMedium(fromAI(generated.mediumQuestions))
    } catch {
      setFeedback('Quiz generation failed — please try again.')
      setTimeout(() => setFeedback(''), 4000)
    } finally {
      setQuizGenerating(false)
    }
  }

  const BOO_ELIGIBLE_CATEGORIES = ['Aircrafts', 'Ranks', 'Training', 'Missions', 'Tech', 'Treaties']

  const generateBOOData = async () => {
    if (!draft.title && !draft.description) return
    setBooGenerating(true)
    try {
      const res = await fetch(`${API}/api/admin/ai/generate-battle-order-data`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: draft.title, description: draft.description ?? '', category: draft.category }),
      })
      const data = await res.json()
      if (data.data?.gameData) {
        setDraft(p => ({ ...p, gameData: { ...p.gameData, ...data.data.gameData } }))
      }
    } catch {
      setFeedback('BOO data generation failed — fill in manually.')
      setTimeout(() => setFeedback(''), 4000)
    } finally {
      setBooGenerating(false)
    }
  }

  const regenerateDescription = async () => {
    if (!draft.title) return
    setAiRegenDesc(true)
    setFeedback('')
    try {
      const res  = await fetch(`${API}/api/admin/ai/generate-brief`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: draft.title }),
      })
      const data = await res.json()
      const generated = data.data?.brief ?? {}
      const newDesc = generated.description ?? draft.description
      const newKeywords = Array.isArray(generated.keywords)
        ? generated.keywords.filter(k => k.keyword && newDesc.toLowerCase().includes(k.keyword.toLowerCase()))
        : draft.keywords
      setDraft(p => ({ ...p, description: newDesc, keywords: newKeywords }))
      setFeedback('Description and keywords regenerated — regenerating quiz questions…')
      // Regenerate quiz questions with new description
      setQuizGenerating(true)
      try {
        const qRes  = await fetch(`${API}/api/admin/ai/generate-quiz`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: draft.title, description: newDesc }),
        })
        const qData = await qRes.json()
        const qGenerated = qData.data ?? {}
        const fromAI = (qs) => (Array.isArray(qs) ? qs : []).map(q => ({
          question: q.question ?? '',
          answers: (q.answers ?? []).map((a, ai) => ({
            title:    a.title ?? '',
            isCorrect: ai === q.correctAnswerIndex,
          })),
        }))
        if (Array.isArray(qGenerated.easyQuestions))   setDraftQuizEasy(fromAI(qGenerated.easyQuestions))
        if (Array.isArray(qGenerated.mediumQuestions)) setDraftQuizMedium(fromAI(qGenerated.mediumQuestions))
        setFeedback('Description, keywords, and quiz questions regenerated.')
      } catch {
        setFeedback('Description and keywords updated — quiz regeneration failed.')
      } finally {
        setQuizGenerating(false)
      }
    } catch {
      setFeedback('AI regeneration failed — please try again.')
    } finally {
      setAiRegenDesc(false)
      setTimeout(() => setFeedback(''), 6000)
    }
  }

  const updateQuizQuestion = (difficulty, i, value) => {
    const setter = difficulty === 'easy' ? setDraftQuizEasy : setDraftQuizMedium
    setter(prev => prev.map((q, idx) => idx === i ? { ...q, question: value } : q))
  }

  const updateQuizAnswer = (difficulty, qi, ai, field, value) => {
    const setter = difficulty === 'easy' ? setDraftQuizEasy : setDraftQuizMedium
    setter(prev => prev.map((q, idx) => {
      if (idx !== qi) return q
      return { ...q, answers: q.answers.map((a, aidx) => aidx === ai ? { ...a, [field]: value } : a) }
    }))
  }

  const toggleCorrectAnswer = (difficulty, qi, ai) => {
    const setter = difficulty === 'easy' ? setDraftQuizEasy : setDraftQuizMedium
    setter(prev => prev.map((q, idx) => {
      if (idx !== qi) return q
      return { ...q, answers: q.answers.map((a, aidx) => ({ ...a, isCorrect: aidx === ai })) }
    }))
  }

  const addQuizAnswer = (difficulty, qi) => {
    const setter = difficulty === 'easy' ? setDraftQuizEasy : setDraftQuizMedium
    setter(prev => prev.map((q, idx) => {
      if (idx !== qi || q.answers.length >= 10) return q
      return { ...q, answers: [...q.answers, { title: '', isCorrect: false }] }
    }))
  }

  const removeQuizAnswer = (difficulty, qi, ai) => {
    const setter = difficulty === 'easy' ? setDraftQuizEasy : setDraftQuizMedium
    setter(prev => prev.map((q, idx) => {
      if (idx !== qi) return q
      const wasCorrect = q.answers[ai]?.isCorrect
      const answers = q.answers.filter((_, aidx) => aidx !== ai)
      if (wasCorrect && answers.length > 0) answers[0] = { ...answers[0], isCorrect: true }
      return { ...q, answers }
    }))
  }

  const addQuizQuestion = (difficulty) => {
    const currentList = difficulty === 'easy' ? draftQuizEasy : draftQuizMedium
    const newIndex = currentList.length
    const setter = difficulty === 'easy' ? setDraftQuizEasy : setDraftQuizMedium
    setter(prev => [...prev, {
      question: '',
      answers: Array.from({ length: 10 }, (_, i) => ({ title: '', isCorrect: i === 0 })),
    }])
    setQuizSelected({ difficulty, index: newIndex })
    setQuizView('answers')
  }

  // Convert draft format (isCorrect boolean per answer) → API format (correctAnswerIndex)
  const toApiFormat = (qs) => qs.map(q => ({
    question: q.question,
    answers:  q.answers.map(({ title }) => ({ title })),
    correctAnswerIndex: Math.max(0, q.answers.findIndex(a => a.isCorrect)),
  }))

  const deleteQuizQuestion = (difficulty, i) => {
    const setter = difficulty === 'easy' ? setDraftQuizEasy : setDraftQuizMedium
    setter(prev => prev.filter((_, idx) => idx !== i))
    setQuizView('list')
  }

  const runBackfill = async (reason) => {
    setBackfillStatus({ done: false, msg: 'Fetching briefs…' })
    let allBriefs = []
    let pg = 1
    while (true) {
      const res  = await fetch(`${API}/api/admin/briefs?page=${pg}&limit=50`, { credentials: 'include' })
      const data = await res.json()
      const batch = data.data?.briefs ?? []
      allBriefs = [...allBriefs, ...batch]
      if (batch.length < 50) break
      pg++
    }
    const needsQuestions = allBriefs.filter(b => (b.quizQuestionsEasy?.length ?? 0) === 0)
    if (needsQuestions.length === 0) {
      setBackfillStatus({ done: true, msg: 'All briefs already have quiz questions.' })
      return
    }
    let done = 0
    for (const brief of needsQuestions) {
      setBackfillStatus({ done: false, msg: `Generating: ${done + 1} / ${needsQuestions.length} briefs…` })
      try {
        const aiRes  = await fetch(`${API}/api/admin/ai/generate-quiz`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: brief.title, description: brief.description ?? '' }),
        })
        const aiData = await aiRes.json()
        const generated = aiData.data ?? {}
        if (generated.easyQuestions?.length > 0 || generated.mediumQuestions?.length > 0) {
          await fetch(`${API}/api/admin/briefs/${brief._id}/questions/bulk`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              easyQuestions:   generated.easyQuestions   ?? [],
              mediumQuestions: generated.mediumQuestions ?? [],
              reason,
            }),
          })
        }
      } catch { /* skip failed brief */ }
      done++
    }
    setBackfillStatus({ done: true, msg: `Done — questions generated for ${done} briefs.` })
  }

  // ── List view ──────────────────────────────────────────────────────────────
  if (view === 'list') {
    // Filter out headlines already covered by an existing brief
    const newHeadlines = rafNews.filter(h => !headlineAlreadyCovered(h, briefs))

    return (
      <div>
        {reasonModal && (
          <ReasonModal
            action={reasonModal.label}
            onConfirm={reasonModal.onConfirm}
            onCancel={() => setReasonModal(null)}
          />
        )}
        {leadModal && (
          <LeadPickerModal
            API={API}
            onConfirm={handleLeadConfirm}
            onCancel={() => { setLeadModal(false); openNew() }}
          />
        )}

        {/* ── Live RAF news panel ──────────────────────────── */}
        <div className="raf-news-panel" style={{ margin: '0 0 1.5rem', borderRadius: 8 }}>
          <div className="raf-news-header">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="raf-news-icon">
              <circle cx="7" cy="7" r="3" fill="currentColor"/>
              <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" fill="none"/>
            </svg>
            <span className="raf-news-label">LIVE INTEL</span>
            <span className="raf-news-sub">Real RAF headlines from the last 24 hours — click to create a brief</span>
          </div>

          {!newsFetched && !newsLoading && (
            <button className="btn-primary" style={{ alignSelf: 'flex-start' }} onClick={fetchLatestIntel}>
              Fetch Latest Intel
            </button>
          )}

          {newsLoading && (
            <div className="raf-news-loading">
              <div className="app-loading__spinner" style={{ width: 16, height: 16 }} />
              <span>Searching for today's RAF news…</span>
            </div>
          )}

          {newsError && !newsLoading && (
            <>
              <p className="raf-news-error">{newsError}</p>
              <button className="btn-ghost" style={{ marginTop: '0.5rem' }} onClick={fetchLatestIntel}>Retry</button>
            </>
          )}

          {newsFetched && !newsLoading && !newsError && newHeadlines.length === 0 && rafNews.length > 0 && (
            <p className="raf-news-error" style={{ color: '#64748b' }}>
              All of today's RAF stories already have briefs created.
            </p>
          )}

          {newsFetched && !newsLoading && !newsError && rafNews.length === 0 && (
            <p className="raf-news-error" style={{ color: '#64748b' }}>No RAF news found in the last 24 hours.</p>
          )}

          {newsFetched && !newsLoading && !newsError && newHeadlines.length > 0 && (
            <ul className="raf-news-list">
              {newHeadlines.map((headline, i) => (
                <li key={i} className="raf-news-item">
                  <span className="raf-news-item__text">{headline}</span>
                  <button
                    className="raf-news-item__btn"
                    onClick={() => {
                      setEditing({ media: [] })
                      setDraft({
                        title: headline, subtitle: '', description: '',
                        category: ALL_CATEGORIES[0],
                        subcategory: '',
                        historic: false,
                        dateAdded: new Date().toISOString().slice(0, 10),
                        sources: [], keywords: [],
                      })
                      setIsNew(true)
                      setView('edit')
                      setFeedback('')
                      setAiGenerating(true)
                      setPendingMedia([{ mediaType: 'picture', mediaUrl: DEFAULT_BRIEF_IMAGE }])

                      fetch(`${API}/api/admin/ai/generate-brief`, {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ headline }),
                      })
                        .then(r => r.json())
                        .then(async data => {
                          const generated = data.data?.brief ?? {}
                          const sources = Array.isArray(generated.sources)
                            ? generated.sources.filter(s => s.url && s.url.startsWith('http'))
                            : []
                          const briefTitle = generated.title || headline
                          const briefDesc  = generated.description || ''
                          setDraft({
                            title:       briefTitle,
                            subtitle:    generated.subtitle || '',
                            description: briefDesc,
                            category:    'News',
                            keywords:    Array.isArray(generated.keywords) ? generated.keywords : [],
                            sources,
                            dateAdded:   new Date().toISOString().slice(0, 10),
                            gameData:    {},
                          })
                          setFeedback('Brief populated — generating quiz questions…')

                          // Auto-generate quiz questions using the brief content
                          try {
                            setQuizGenerating(true)
                            const qRes  = await fetch(`${API}/api/admin/ai/generate-quiz`, {
                              method: 'POST', credentials: 'include',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ title: briefTitle, description: briefDesc }),
                            })
                            const qData = await qRes.json()
                            const fromAI = (qs) => (Array.isArray(qs) ? qs : []).map(q => ({
                              question: q.question ?? '',
                              answers: (q.answers ?? []).map((a, ai) => ({
                                title: a.title ?? '', isCorrect: ai === q.correctAnswerIndex,
                              })),
                            }))
                            if (Array.isArray(qData.data?.easyQuestions))   setDraftQuizEasy(fromAI(qData.data.easyQuestions))
                            if (Array.isArray(qData.data?.mediumQuestions)) setDraftQuizMedium(fromAI(qData.data.mediumQuestions))
                            setFeedback('Brief and quiz questions generated — review carefully before saving.')
                          } catch {
                            setFeedback('Brief populated — quiz generation failed, add questions manually.')
                          } finally {
                            setQuizGenerating(false)
                          }
                          setTimeout(() => setFeedback(''), 7000)
                        })
                        .catch(() => {
                          setFeedback('AI generation failed — please fill in the form manually.')
                          setTimeout(() => setFeedback(''), 5000)
                        })
                        .finally(() => setAiGenerating(false))
                    }}
                  >
                    Create Brief →
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="admin-search-bar">
          <input
            className="feed-search"
            style={{ maxWidth: 300 }}
            placeholder="Search title or subtitle…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
          />
          <button className="btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setLeadModal(true)}>+ New Brief</button>
        </div>

        <div className="admin-cat-pills" style={{ marginBottom: '1.25rem' }} role="group" aria-label="Filter by category">
          {[{ value: '', label: 'All' }, ...ALL_CATEGORIES.map(c => ({ value: c, label: c }))].map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className={`admin-cat-btn${catFilter === value ? ' admin-cat-btn--active' : ''}`}
              onClick={() => { setCatFilter(value); setPage(1) }}
              aria-pressed={catFilter === value}
            >
              {value ? <span className="admin-cat-btn__icon" aria-hidden="true">{CATEGORY_ICONS[value]}</span> : null}
              {label}
            </button>
          ))}
        </div>

        {loading && <p className="admin-loading">Loading…</p>}
        {!loading && briefs.length === 0 && <p className="empty-state">No briefs found.</p>}

        <div className="admin-list">
          {briefs.map(b => (
            <div
              key={b._id}
              className="admin-card admin-brief-row"
              onClick={() => openEdit(b)}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && openEdit(b)}
            >
              <div className="admin-card__header">
                {(() => { const img = b.media?.find(m => m.mediaType === 'picture'); return img ? <img src={img.mediaUrl} alt="" className="admin-brief-row__thumb" /> : <div className="admin-brief-row__thumb admin-brief-row__thumb--empty" /> })()}
                <div className="admin-card__meta">
                  <span className="admin-badge admin-badge--free">{b.category}</span>
                  <span className="admin-card__title">{b.title}</span>
                  {b.subtitle && <span className="admin-card__sub">— {b.subtitle}</span>}
                </div>
                <span className="admin-card__sub" style={{ flexShrink: 0 }}>
                  {new Date(b.dateAdded).toLocaleDateString()}
                </span>
              </div>
            </div>
          ))}
        </div>

        {total > LIMIT && (
          <div className="admin-pagination">
            <button className="btn-ghost" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
            <span className="admin-pagination__info">Page {page} of {Math.ceil(total / LIMIT)}</span>
            <button className="btn-ghost" disabled={page >= Math.ceil(total / LIMIT)} onClick={() => setPage(p => p + 1)}>Next →</button>
          </div>
        )}

        {/* ── Bulk Actions ──────────────────────────────────── */}
        <div className="admin-section" style={{ marginTop: '1.5rem' }}>
          <div
            className="admin-section-title"
            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', userSelect: 'none' }}
            onClick={() => setBulkActionsOpen(o => !o)}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && setBulkActionsOpen(o => !o)}
          >
            Bulk Actions {bulkActionsOpen ? '▲' : '▼'}
          </div>
          {bulkActionsOpen && (
            <div style={{ marginTop: '0.75rem' }}>
              <p className="admin-section-sub">
                Generate 10 easy + 10 medium quiz questions for every brief that doesn't have any yet.
              </p>
              {backfillStatus && (
                <p className="quiz-generating" style={{ marginBottom: '0.75rem' }}>
                  {backfillStatus.done ? '✓ ' : (
                    <span className="app-loading__spinner" style={{ width: 13, height: 13, display: 'inline-block' }} />
                  )}
                  {backfillStatus.msg}
                </p>
              )}
              <button
                className="btn-primary"
                disabled={!!backfillStatus && !backfillStatus.done}
                onClick={() => {
                  setBackfillStatus(null)
                  setReasonModal({
                    label: 'Generate Quiz Questions for All Briefs',
                    onConfirm: async (reason) => {
                      setReasonModal(null)
                      runBackfill(reason)
                    },
                  })
                }}
              >
                Generate Quiz Questions for All Briefs
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Edit view ──────────────────────────────────────────────────────────────
  return (
    <div>
      {reasonModal && (
        <ReasonModal
          action={reasonModal.label}
          onConfirm={reasonModal.onConfirm}
          onCancel={() => setReasonModal(null)}
        />
      )}

      <div className="admin-brief-toolbar">
        <button className="btn-ghost" onClick={backToList}>← All Briefs</button>
        <div className="admin-brief-toolbar__actions">
          {!isNew && (
            <button
              className="admin-action-btn admin-action-btn--danger"
              onClick={() => setReasonModal({ label: `Delete "${editing.title || 'brief'}"`, onConfirm: doDelete })}
              disabled={busy}
            >
              Delete Brief
            </button>
          )}
          <button
            className="btn-primary"
            onClick={() => setReasonModal({ label: isNew ? 'Create Intel Brief' : `Save "${draft.title || 'brief'}"`, onConfirm: doSave })}
            disabled={busy}
          >
            {busy ? 'Saving…' : isNew ? 'Create Brief' : 'Save Changes'}
          </button>
        </div>
      </div>

      {aiGenerating && (
        <div className="ai-generating-banner">
          <div className="app-loading__spinner" style={{ width: 16, height: 16, flexShrink: 0 }} />
          <span>AI is generating brief content from your headline — this will take a moment…</span>
        </div>
      )}

      {feedback && <p className="admin-feedback">{feedback}</p>}

      {/* Core details */}
      <div className="admin-section">
        <h3 className="admin-section-title">
          Core Details
          {!isNew && editing?._id && (
            <span style={{ fontSize: '0.7rem', fontWeight: 400, color: '#94a3b8', marginLeft: '0.75rem', letterSpacing: '0.03em' }}>
              ID: {editing._id}
            </span>
          )}
        </h3>

        <div className="brief-form-field">
          <label className="form-label">Title</label>
          <input
            className="form-input"
            value={draft.title}
            onChange={e => setDraft(p => ({ ...p, title: e.target.value }))}
            placeholder="Brief title"
          />
        </div>

        <div className="brief-form-field">
          <label className="form-label">Subtitle</label>
          <input
            className="form-input"
            value={draft.subtitle}
            onChange={e => setDraft(p => ({ ...p, subtitle: e.target.value }))}
            placeholder="Optional subtitle"
          />
        </div>

        <div className="brief-form-field">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem' }}>
            <label className="form-label" style={{ margin: 0 }}>Description</label>
            {!isNew && (
              <button
                className="admin-action-btn"
                style={{ fontSize: '0.72rem', padding: '2px 9px' }}
                onClick={regenerateDescription}
                disabled={aiRegenDesc || quizGenerating || !draft.title}
                title={!draft.title ? 'Add a title first' : 'Regenerate description, keywords, and quiz questions with AI'}
              >
                {aiRegenDesc ? (
                  <span className="quiz-generating">
                    <span className="app-loading__spinner" style={{ width: 12, height: 12 }} />
                    Regenerating…
                  </span>
                ) : '✦ Regenerate with AI'}
              </button>
            )}
          </div>
          <textarea
            className="form-textarea"
            rows={7}
            value={draft.description}
            onChange={e => setDraft(p => ({ ...p, description: e.target.value }))}
            placeholder="~200 word brief description…"
          />
        </div>

        <div className="brief-form-field">
          <label className="form-label">Category</label>
          <div className="admin-cat-pills" role="group" aria-label="Select category">
            {ALL_CATEGORIES.map(cat => (
              <button
                key={cat}
                type="button"
                className={`admin-cat-btn${draft.category === cat ? ' admin-cat-btn--active' : ''}`}
                onClick={() => setDraft(p => ({ ...p, category: cat, subcategory: '' }))}
                aria-pressed={draft.category === cat}
              >
                <span className="admin-cat-btn__icon" aria-hidden="true">{CATEGORY_ICONS[cat]}</span>
                {cat}
              </button>
            ))}
          </div>
        </div>

        {SUBCATEGORIES[draft.category]?.length > 0 && (
          <div className="brief-form-field">
            <label className="form-label">Subcategory</label>
            <div className="admin-cat-pills" role="group" aria-label="Select subcategory">
              {SUBCATEGORIES[draft.category].map(sub => (
                <button
                  key={sub}
                  type="button"
                  className={`admin-cat-btn admin-cat-btn--sub${draft.subcategory === sub ? ' admin-cat-btn--active' : ''}`}
                  onClick={() => setDraft(p => ({ ...p, subcategory: p.subcategory === sub ? '' : sub }))}
                  aria-pressed={draft.subcategory === sub}
                >
                  {sub}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="brief-form-row">
          <div className="brief-form-field" style={{ flex: 1 }}>
            <label className="form-label">Date Added</label>
            <input
              type="date"
              className="form-input"
              value={draft.dateAdded}
              onChange={e => setDraft(p => ({ ...p, dateAdded: e.target.value }))}
            />
          </div>
          <div className="brief-form-field admin-historic-field" style={{ flex: 1 }}>
            <label className="form-label">Flags</label>
            <label className="admin-historic-label">
              <input
                type="checkbox"
                checked={!!draft.historic}
                onChange={e => setDraft(p => ({ ...p, historic: e.target.checked }))}
              />
              <span>Historic brief</span>
            </label>
          </div>
        </div>
      </div>

      {/* Media */}
      <div className="admin-section">
        <h3 className="admin-section-title">Images / Media</h3>
        {isNew ? (
          <>
            {pendingMedia.length === 0 && (
              <p className="admin-loading" style={{ marginBottom: '1rem' }}>No media added yet — will be attached when you save.</p>
            )}
            <div className="brief-media-grid">
              {pendingMedia.map((m, idx) => (
                <div key={idx} className="brief-media-item">
                  <img
                    src={m.mediaUrl}
                    alt=""
                    className="brief-media-item__img"
                    onError={e => { e.currentTarget.style.display = 'none' }}
                  />
                  <div className="brief-media-item__info">
                    <span className="brief-media-item__type">{m.mediaType}</span>
                    <input
                      className="brief-media-item__url-input"
                      value={m.mediaUrl}
                      onChange={e => setPendingMedia(prev => prev.map((item, i) => i === idx ? { ...item, mediaUrl: e.target.value } : item))}
                      placeholder="URL"
                    />
                    <label className="media-summary-toggle">
                      <input
                        type="checkbox"
                        checked={m.showOnSummary !== false}
                        onChange={e => setPendingMedia(prev => prev.map((item, i) => i === idx ? { ...item, showOnSummary: e.target.checked } : item))}
                      />
                      Show on brief summary
                    </label>
                  </div>
                  <div className="brief-media-item__controls">
                    <button className="brief-media-item__move-btn" onClick={() => movePendingMedia(idx, -1)} disabled={idx === 0} title="Move up">▲</button>
                    <button className="brief-media-item__move-btn" onClick={() => movePendingMedia(idx, 1)} disabled={idx === pendingMedia.length - 1} title="Move down">▼</button>
                    <button className="brief-media-item__remove" onClick={() => {
                      const item = pendingMedia[idx]
                      if (item?.mediaUrl?.startsWith('/uploads/brief-images/')) {
                        fetch(`${API}/api/admin/media/brief-image`, {
                          method: 'DELETE', credentials: 'include',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ url: item.mediaUrl }),
                        }).catch(() => {})
                      }
                      setPendingMedia(prev => prev.filter((_, i) => i !== idx))
                    }} title="Remove">✕</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="brief-media-add">
              <select
                className="feed-filter"
                style={{ width: 110, flexShrink: 0 }}
                value={mediaType}
                onChange={e => setMediaType(e.target.value)}
              >
                <option value="picture">Picture</option>
                <option value="video">Video</option>
              </select>
              <input
                className="form-input"
                placeholder="Image or video URL…"
                value={mediaUrl}
                onChange={e => setMediaUrl(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && mediaUrl.trim()) {
                    setPendingMedia(prev => [...prev, { mediaType, mediaUrl: mediaUrl.trim(), showOnSummary: true }])
                    setMediaUrl('')
                  }
                }}
              />
              <button
                className="btn-ghost"
                style={{ flexShrink: 0 }}
                onClick={findMediaWithAI}
                disabled={aiMediaSearching}
              >
                {aiMediaSearching ? 'Searching…' : 'Generate 3 Images'}
              </button>
              <button
                className="btn-ghost"
                style={{ flexShrink: 0 }}
                onClick={() => setPendingMedia(prev => [...prev, { mediaType: 'picture', mediaUrl: DEFAULT_BRIEF_IMAGE }])}
                disabled={pendingMedia.some(m => m.mediaUrl === DEFAULT_BRIEF_IMAGE)}
              >
                Add Placeholder
              </button>
              <button
                className="btn-primary"
                style={{ flexShrink: 0 }}
                disabled={!mediaUrl.trim()}
                onClick={() => {
                  setPendingMedia(prev => [...prev, { mediaType, mediaUrl: mediaUrl.trim(), showOnSummary: true }])
                  setMediaUrl('')
                }}
              >
                Add
              </button>
            </div>
          </>
        ) : (
          <>
            {(editing.media ?? []).length === 0 && (
              <p className="admin-loading" style={{ marginBottom: '1rem' }}>No media attached yet.</p>
            )}
            <div className="brief-media-grid">
              {(editing.media ?? []).map((m, idx, arr) => (
                <div key={m._id} className="brief-media-item">
                  <img
                    src={m.mediaUrl}
                    alt=""
                    className="brief-media-item__img"
                    onError={e => { e.currentTarget.style.display = 'none' }}
                  />
                  <div className="brief-media-item__info">
                    <span className="brief-media-item__type">{m.mediaType}</span>
                    <input
                      className="brief-media-item__url-input"
                      value={m.mediaUrl}
                      onChange={e => setEditing(prev => ({
                        ...prev,
                        media: prev.media.map((item, i) => i === idx ? { ...item, mediaUrl: e.target.value } : item),
                      }))}
                      placeholder="URL"
                    />
                    <label className="media-summary-toggle">
                      <input
                        type="checkbox"
                        checked={m.showOnSummary !== false}
                        onChange={e => {
                          const checked = e.target.checked
                          setEditing(prev => ({
                            ...prev,
                            media: prev.media.map((item, i) => i === idx ? { ...item, showOnSummary: checked } : item),
                          }))
                          if (m._id) {
                            fetch(`${API}/api/admin/media/${m._id}`, {
                              method: 'PATCH', credentials: 'include',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ showOnSummary: checked }),
                            }).catch(() => {})
                          }
                        }}
                      />
                      Show on brief summary
                    </label>
                  </div>
                  <div className="brief-media-item__controls">
                    <button className="brief-media-item__move-btn" onClick={() => moveMedia(idx, -1)} disabled={idx === 0} title="Move up">▲</button>
                    <button className="brief-media-item__move-btn" onClick={() => moveMedia(idx, 1)} disabled={idx === arr.length - 1} title="Move down">▼</button>
                    <button className="brief-media-item__remove" onClick={() => removeMedia(idx)} title="Remove image">✕</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="brief-media-add">
              <select
                className="feed-filter"
                style={{ width: 110, flexShrink: 0 }}
                value={mediaType}
                onChange={e => setMediaType(e.target.value)}
              >
                <option value="picture">Picture</option>
                <option value="video">Video</option>
              </select>
              <input
                className="form-input"
                placeholder="Image or video URL…"
                value={mediaUrl}
                onChange={e => setMediaUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addMedia()}
              />
              <button
                className="btn-ghost"
                style={{ flexShrink: 0 }}
                onClick={findMediaWithAI}
                disabled={aiMediaSearching}
              >
                {aiMediaSearching ? 'Searching…' : 'Generate 3 Images'}
              </button>
              <button
                className="btn-ghost"
                style={{ flexShrink: 0 }}
                onClick={() => setEditing(prev => ({ ...prev, media: [...(prev.media ?? []), { mediaType: 'picture', mediaUrl: DEFAULT_BRIEF_IMAGE }] }))}
                disabled={(editing.media ?? []).some(m => m.mediaUrl === DEFAULT_BRIEF_IMAGE)}
              >
                Add Placeholder
              </button>
              <button className="btn-primary" style={{ flexShrink: 0 }} onClick={addMedia} disabled={!mediaUrl.trim()}>
                Add
              </button>
            </div>
          </>
        )}

        {/* Generated image picker — appears after clicking Generate Image */}
        {generatedImages.length > 0 && (
          <div className="gen-img-picker">
            <div className="gen-img-picker__header">
              <span className="gen-img-picker__title">Select images to add</span>
              <button className="gen-img-picker__close" onClick={() => setGeneratedImages([])}>✕</button>
            </div>
            <div className="gen-img-picker__grid">
              {generatedImages.map((img, i) => (
                <label
                  key={i}
                  className={`gen-img-card${img.selected ? ' gen-img-card--selected' : ''}`}
                >
                  <img
                    src={`${API}${img.url}`}
                    alt={img.term}
                    className="gen-img-card__img"
                    onError={e => { e.currentTarget.style.opacity = '0.3' }}
                  />
                  <div className="gen-img-card__info">
                    <span className="gen-img-card__term">{img.term}</span>
                    <span className="gen-img-card__wiki">{img.wikiPage}</span>
                  </div>
                  <input
                    type="checkbox"
                    className="gen-img-card__check"
                    checked={img.selected}
                    onChange={() => setGeneratedImages(prev =>
                      prev.map((g, j) => j === i ? { ...g, selected: !g.selected } : g)
                    )}
                  />
                </label>
              ))}
            </div>
            <div className="gen-img-picker__footer">
              <button
                className="btn-primary"
                onClick={addSelectedImages}
                disabled={!generatedImages.some(g => g.selected)}
              >
                Add {generatedImages.filter(g => g.selected).length} image{generatedImages.filter(g => g.selected).length !== 1 ? 's' : ''}
              </button>
              <button className="btn-ghost" onClick={() => setGeneratedImages([])}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Sources */}
      <div className="admin-section">
        <h3 className="admin-section-title">Sources</h3>
        {draft.sources.map((src, i) => (
          <div key={i} className="brief-array-row">
            <div className="brief-array-row__fields">
              <input
                className="form-input"
                placeholder="URL"
                value={src.url}
                onChange={e => updateSource(i, 'url', e.target.value)}
                style={{ flex: 2 }}
              />
              <input
                className="form-input"
                placeholder="Site name"
                value={src.siteName}
                onChange={e => updateSource(i, 'siteName', e.target.value)}
              />
              <input
                type="date"
                className="form-input"
                value={src.articleDate ? src.articleDate.slice(0, 10) : ''}
                onChange={e => updateSource(i, 'articleDate', e.target.value)}
                style={{ flex: '0 0 150px' }}
              />
            </div>
            <button className="brief-array-row__remove" onClick={() => removeSource(i)} title="Remove source">✕</button>
          </div>
        ))}
        <button className="admin-action-btn admin-action-btn--primary" onClick={addSource}>+ Add Source</button>
      </div>

      {/* Keywords */}
      <div className="admin-section">
        <h3 className="admin-section-title">Keywords</h3>
        <p className="admin-section-sub">Keywords appear as interactive hotspots inside the brief. The description is the tooltip shown on click.</p>
        {draft.keywords.map((kw, i) => (
          <div key={i} className="brief-array-row">
            <div className="brief-array-row__fields">
              <input
                className="form-input"
                placeholder="Keyword"
                value={kw.keyword}
                onChange={e => updateKeyword(i, 'keyword', e.target.value)}
                style={{ flex: '0 0 180px' }}
              />
              <input
                className="form-input"
                placeholder="Tooltip / description shown on click…"
                value={kw.generatedDescription}
                onChange={e => updateKeyword(i, 'generatedDescription', e.target.value)}
              />
            </div>
            <button className="brief-array-row__remove" onClick={() => removeKeyword(i)} title="Remove keyword">✕</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="admin-action-btn admin-action-btn--primary" onClick={addKeyword}>+ Add Keyword</button>
          {(draft.keywords?.length ?? 0) < 10 && (
            <button
              className="admin-action-btn"
              onClick={generateKeywords}
              disabled={kwGenerating || !draft.description}
              title={!draft.description ? 'Add a description first' : `Generate ${10 - (draft.keywords?.length ?? 0)} more keyword(s) from description`}
            >
              {kwGenerating ? (
                <span className="quiz-generating">
                  <span className="app-loading__spinner" style={{ width: 13, height: 13 }} />
                  Generating…
                </span>
              ) : `✦ Generate Keywords with AI (${10 - (draft.keywords?.length ?? 0)} remaining)`}
            </button>
          )}
          {(draft.keywords?.length ?? 0) >= 10 && (
            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Maximum 10 keywords reached</span>
          )}
        </div>
      </div>

      {/* Battle of Order Data */}
      {['Aircrafts','Ranks','Training','Missions','Tech','Treaties'].includes(draft.category) && (
        <div className="admin-section">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <h3 className="admin-section-title" style={{ marginBottom: 0 }}>Battle of Order Data</h3>
            {(
              (draft.category === 'Aircrafts' && !draft.gameData?.topSpeedKph && !draft.gameData?.yearIntroduced) ||
              (draft.category === 'Ranks' && !draft.historic && !draft.gameData?.rankHierarchyOrder) ||
              (draft.category === 'Training' && !draft.gameData?.trainingWeekStart) ||
              (['Missions','Tech','Treaties'].includes(draft.category) && !draft.gameData?.startYear)
            ) && (
              <button
                className="btn-ghost"
                onClick={generateBOOData}
                disabled={booGenerating || aiGenerating || !draft.title}
                style={{ fontSize: '0.78rem', padding: '3px 10px' }}
              >
                {booGenerating
                  ? <span className="quiz-generating"><span className="app-loading__spinner" style={{ width: 12, height: 12 }} />Generating…</span>
                  : '✦ Generate with AI'}
              </button>
            )}
          </div>
          <p className="admin-section-sub">
            Fill in the fields relevant to this category so this brief can appear in generated Battle of Order games.
          </p>
          {draft.category === 'Aircrafts' && (<>
            <div className="settings-field">
              <label className="settings-label">Top Speed (kph)</label>
              <input type="number" className="settings-input" min={0} placeholder="e.g. 2400"
                value={draft.gameData?.topSpeedKph ?? ''}
                onChange={e => setDraft(p => ({ ...p, gameData: { ...p.gameData, topSpeedKph: e.target.value === '' ? null : Number(e.target.value) } }))} />
            </div>
            <div className="settings-field">
              <label className="settings-label">Year Introduced</label>
              <input type="number" className="settings-input" min={1900} max={2100} placeholder="e.g. 1976"
                value={draft.gameData?.yearIntroduced ?? ''}
                onChange={e => setDraft(p => ({ ...p, gameData: { ...p.gameData, yearIntroduced: e.target.value === '' ? null : Number(e.target.value) } }))} />
            </div>
            <div className="settings-field">
              <label className="settings-label">Year Retired <span className="settings-hint">Leave blank if still in service</span></label>
              <input type="number" className="settings-input" min={1900} max={2100} placeholder="e.g. 2003"
                value={draft.gameData?.yearRetired ?? ''}
                onChange={e => setDraft(p => ({ ...p, gameData: { ...p.gameData, yearRetired: e.target.value === '' ? null : Number(e.target.value) } }))} />
            </div>
          </>)}
          {draft.category === 'Ranks' && (
            <div
              className="settings-field"
              style={draft.historic ? { opacity: 0.4, pointerEvents: 'none' } : undefined}
              title={draft.historic ? 'Not applicable — this is a historic rank and is no longer in use' : undefined}
            >
              <label className="settings-label">
                Hierarchy Order <span className="settings-hint">1 = most senior (e.g. Marshal of the RAF)</span>
                {draft.historic && <span className="settings-hint" style={{ color: '#f87171', marginLeft: '0.4rem' }}>— Historic rank: not applicable</span>}
              </label>
              <input type="number" className="settings-input" min={1} placeholder="e.g. 1"
                value={draft.gameData?.rankHierarchyOrder ?? ''}
                disabled={draft.historic}
                onChange={e => setDraft(p => ({ ...p, gameData: { ...p.gameData, rankHierarchyOrder: e.target.value === '' ? null : Number(e.target.value) } }))} />
            </div>
          )}
          {draft.category === 'Training' && (<>
            <div className="settings-field">
              <label className="settings-label">Training Week Start</label>
              <input type="number" className="settings-input" min={1} placeholder="e.g. 3"
                value={draft.gameData?.trainingWeekStart ?? ''}
                onChange={e => setDraft(p => ({ ...p, gameData: { ...p.gameData, trainingWeekStart: e.target.value === '' ? null : Number(e.target.value) } }))} />
            </div>
            <div className="settings-field">
              <label className="settings-label">Training Week End</label>
              <input type="number" className="settings-input" min={1} placeholder="e.g. 5"
                value={draft.gameData?.trainingWeekEnd ?? ''}
                onChange={e => setDraft(p => ({ ...p, gameData: { ...p.gameData, trainingWeekEnd: e.target.value === '' ? null : Number(e.target.value) } }))} />
            </div>
          </>)}
          {['Missions','Tech','Treaties'].includes(draft.category) && (<>
            <div className="settings-field">
              <label className="settings-label">Start Year</label>
              <input type="number" className="settings-input" min={1000} max={2100} placeholder="e.g. 1939"
                value={draft.gameData?.startYear ?? ''}
                onChange={e => setDraft(p => ({ ...p, gameData: { ...p.gameData, startYear: e.target.value === '' ? null : Number(e.target.value) } }))} />
            </div>
            <div className="settings-field">
              <label className="settings-label">End Year <span className="settings-hint">Leave blank if ongoing</span></label>
              <input type="number" className="settings-input" min={1000} max={2100} placeholder="e.g. 1945"
                value={draft.gameData?.endYear ?? ''}
                onChange={e => setDraft(p => ({ ...p, gameData: { ...p.gameData, endYear: e.target.value === '' ? null : Number(e.target.value) } }))} />
            </div>
          </>)}
        </div>
      )}

      {/* Quiz Questions */}
      <div className="admin-section quiz-section">
        <h3 className="admin-section-title">Quiz Questions</h3>

        {quizView === 'list' ? (
          <>
            <div className="quiz-toolbar">
              {!isNew && draftQuizEasy.length === 0 && draftQuizMedium.length === 0 && (
                <button
                  className="btn-ghost"
                  onClick={generateQuizQuestions}
                  disabled={quizGenerating || aiGenerating}
                >
                  {quizGenerating ? (
                    <span className="quiz-generating">
                      <span className="app-loading__spinner" style={{ width: 13, height: 13 }} />
                      Generating…
                    </span>
                  ) : 'Generate 20 Questions with AI'}
                </button>
              )}
            </div>

            {draftQuizEasy.length === 0 && draftQuizMedium.length === 0 && !quizGenerating && (
              <p className="admin-section-sub">
                {isNew
                  ? 'Add questions manually using the buttons below. They will be saved automatically when you create the brief.'
                  : 'No questions yet — click "Generate 20 Questions with AI" or add them manually below.'}
              </p>
            )}

            <div className="quiz-cols">
              {[['easy', draftQuizEasy], ['medium', draftQuizMedium]].map(([diff, qs]) => (
                <div key={diff} className="quiz-col">
                  <div className="quiz-col-header">{diff.toUpperCase()} ({qs.length})</div>
                  {qs.map((q, i) => (
                    <div
                      key={i}
                      className="quiz-q-row"
                      onClick={() => { setQuizSelected({ difficulty: diff, index: i }); setQuizView('answers') }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => e.key === 'Enter' && (setQuizSelected({ difficulty: diff, index: i }), setQuizView('answers'))}
                    >
                      <span className="quiz-q-row__num">{i + 1}.</span>
                      <span className="quiz-q-row__text">{q.question || <em style={{ color: '#94a3b8' }}>Untitled question</em>}</span>
                      <span className="quiz-q-row__chevron">›</span>
                    </div>
                  ))}
                  <button
                    className="quiz-add-q-btn"
                    onClick={() => addQuizQuestion(diff)}
                  >
                    + Add Question
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : (() => {
          const { difficulty, index } = quizSelected
          const q = difficulty === 'easy' ? draftQuizEasy[index] : draftQuizMedium[index]
          if (!q) return null
          return (
            <>
              <div className="quiz-drill-back">
                <button className="btn-ghost" onClick={() => setQuizView('list')}>← Back to Questions</button>
                <span className="quiz-drill-badge">{difficulty.toUpperCase()} · Q{index + 1}</span>
                <button
                  className="admin-action-btn admin-action-btn--danger"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => deleteQuizQuestion(difficulty, index)}
                >
                  Delete Question
                </button>
              </div>

              <textarea
                className="form-textarea"
                rows={3}
                value={q.question}
                onChange={e => updateQuizQuestion(difficulty, index, e.target.value)}
                placeholder="Question text…"
                style={{ marginBottom: '1rem' }}
              />

              <p className="admin-section-sub" style={{ marginBottom: '0.5rem' }}>
                Click a radio button to mark the correct answer.
              </p>

              <div className="quiz-answers-list">
                {q.answers.map((a, ai) => (
                  <div
                    key={ai}
                    className={`quiz-answer-row${a.isCorrect ? ' quiz-answer-row--correct' : ''}`}
                  >
                    <button
                      className={`quiz-correct-switch${a.isCorrect ? ' quiz-correct-switch--on' : ''}`}
                      onClick={() => toggleCorrectAnswer(difficulty, index, ai)}
                      title={a.isCorrect ? 'Correct answer' : 'Mark as correct'}
                    >
                      {a.isCorrect ? 'true' : 'false'}
                    </button>
                    <div className="quiz-answer-row__content" style={{ flex: 1 }}>
                      <input
                        className="form-input"
                        value={a.title}
                        onChange={e => updateQuizAnswer(difficulty, index, ai, 'title', e.target.value)}
                        placeholder="Answer text…"
                      />
                    </div>
                    {q.answers.length > 2 && (
                      <button
                        className="brief-array-row__remove"
                        onClick={() => removeQuizAnswer(difficulty, index, ai)}
                        title="Remove answer"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {q.answers.length < 10 && (
                <button
                  className="admin-action-btn admin-action-btn--primary"
                  style={{ marginTop: '0.75rem' }}
                  onClick={() => addQuizAnswer(difficulty, index)}
                >
                  + Add Answer
                </button>
              )}
            </>
          )
        })()}
      </div>
    </div>
  )
}

// ── Tutorials tab ─────────────────────────────────────────────────────────────

// Mirrors the hardcoded TUTORIALS structure in TutorialContext for display purposes.
// Admin overrides are saved per-step; empty fields fall back to the hardcoded defaults.
const TUTORIAL_DEFS = [
  {
    id: 'welcome', label: 'Welcome Tutorial',
    desc: 'Shown to any user (guest or logged-in) on their first dashboard visit.',
    steps: [
      { index: 0, label: 'Step 1 — Welcome to SkyWatch',
        defaults: { title: 'Welcome to SkyWatch', body: 'On the dashboard you can view the latest news intel, and keep up to date with recommended categories.' } },
      { index: 1, label: 'Step 2 — Intel Feed',
        defaults: { title: 'Intel Feed', body: 'Grab the latest intel briefs, from news to aircraft and more.' } },
    ],
  },
  {
    id: 'intel_brief', label: 'Intel Brief Tutorial',
    desc: 'Shown to any user on their first visit to an intel brief page.',
    steps: [
      { index: 0, label: 'Step 1 — First Briefing',
        defaults: { title: 'First Briefing', body: 'Here you can learn about a piece of RAF intel. Media, stats, info and even classified games to test your knowledge.' } },
    ],
  },
  {
    id: 'user', label: 'User Tutorial',
    desc: 'Shown to logged-in users when they first visit their profile page.',
    steps: [
      { index: 0, label: 'Step 1 — Your Profile',
        defaults: { title: 'Your Profile', body: 'Here you can see your level and current rank, the leaderboards, profile stats and your daily login streak.' } },
      { index: 1, label: 'Step 2 — Stay Aware',
        defaults: { title: 'Stay Aware', body: 'Any issues or incorrect info? Please report it to us — the link is at the bottom of this page.' } },
    ],
  },
  {
    id: 'load_up', label: 'Load Up Tutorial',
    desc: 'Triggered when a user first engages targeting mode on an intel brief. Has separate text for guests.',
    steps: [
      { index: 0, label: 'Step 1 — Load Up', hasGuestBody: true,
        defaults: {
          title: 'Load Up',
          body: 'Each intel brief gives you a daily ammo allocation based on your subscription tier. Use that ammo to unlock classified keyword dossiers within the brief — no Aircoins spent. Aircoins are earned separately by reading briefs and completing games.',
          guestBody: "You've engaged the targeting system! Each intel brief comes with a daily ammo allocation for unlocking classified keyword dossiers — no Aircoins needed for this. Sign up to receive your ammo allocation and start earning Aircoins.",
        } },
    ],
  },
]

function TutorialStepEditor({ tutorialId, step, override, API, onSaved }) {
  const { refreshOverrides } = useTutorial()
  const dbKey = `${tutorialId}_${step.index}`

  // Effective text = whatever is stored in DB (if non-empty), else the hardcoded default.
  // This is what the fields are pre-filled with and what gets compared for isDirty.
  const effectiveTitle     = override?.title?.trim()     || step.defaults.title
  const effectiveBody      = override?.body?.trim()      || step.defaults.body
  const effectiveGuestBody = override?.guestBody?.trim() || (step.defaults.guestBody ?? '')

  const [title,       setTitle]       = useState(effectiveTitle)
  const [body,        setBody]        = useState(effectiveBody)
  const [guestBody,   setGuestBody]   = useState(effectiveGuestBody)
  const [busy,        setBusy]        = useState(false)
  const [saved,       setSaved]       = useState(false)
  const [reasonModal, setReasonModal] = useState(null) // { action, payload }

  // Sync fields when the override prop changes (e.g. after parent re-fetches post-save)
  useEffect(() => {
    setTitle(override?.title?.trim()     || step.defaults.title)
    setBody(override?.body?.trim()       || step.defaults.body)
    setGuestBody(override?.guestBody?.trim() || (step.defaults.guestBody ?? ''))
  }, [override]) // eslint-disable-line react-hooks/exhaustive-deps

  const isDirty =
    title.trim()     !== effectiveTitle     ||
    body.trim()      !== effectiveBody      ||
    (step.hasGuestBody && guestBody.trim() !== effectiveGuestBody)

  const doFetch = async (payload, reason) => {
    setBusy(true)
    await fetch(`${API}/api/admin/tutorials/content`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, reason }),
    })
    refreshOverrides()
    setBusy(false)
  }

  const save = () => {
    if (!title.trim() || !body.trim()) return
    const payload = { key: dbKey, title: title.trim(), body: body.trim() }
    if (step.hasGuestBody) payload.guestBody = guestBody.trim()
    setReasonModal({
      action: `Update Tutorial Step — ${step.label}`,
      onConfirm: async (reason) => {
        setReasonModal(null)
        await doFetch(payload, reason)
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
        onSaved?.()
      },
    })
  }

  // Reset to hardcoded defaults (saves empty strings → TutorialContext falls back to defaults)
  const resetToDefault = () => {
    const payload = { key: dbKey, title: '', body: '' }
    if (step.hasGuestBody) payload.guestBody = ''
    setReasonModal({
      action: `Reset Tutorial Step to Default — ${step.label}`,
      onConfirm: async (reason) => {
        setReasonModal(null)
        await doFetch(payload, reason)
        onSaved?.()
      },
    })
  }

  const isCustomised =
    (override?.title?.trim()     && override.title.trim()     !== step.defaults.title) ||
    (override?.body?.trim()      && override.body.trim()      !== step.defaults.body)  ||
    (step.hasGuestBody && override?.guestBody?.trim() && override.guestBody.trim() !== step.defaults.guestBody)

  return (
    <div className="tut-step-editor">
      {reasonModal && (
        <ReasonModal
          action={reasonModal.action}
          onConfirm={reasonModal.onConfirm}
          onCancel={() => setReasonModal(null)}
        />
      )}

      <p className="tut-step-editor__label">{step.label}</p>

      <div className="settings-field">
        <label className="form-label">Title</label>
        <input
          className="form-input"
          value={title}
          onChange={e => setTitle(e.target.value)}
        />
      </div>

      <div className="settings-field">
        <label className="form-label">Body</label>
        <textarea
          className="form-textarea"
          rows={4}
          value={body}
          onChange={e => setBody(e.target.value)}
        />
      </div>

      {step.hasGuestBody && (
        <div className="settings-field">
          <label className="form-label">
            Guest Body <span className="settings-hint">(shown to non-logged-in users)</span>
          </label>
          <textarea
            className="form-textarea"
            rows={4}
            value={guestBody}
            onChange={e => setGuestBody(e.target.value)}
          />
        </div>
      )}

      <div className="tut-step-editor__actions">
        <button className="btn-primary" onClick={save} disabled={busy || !isDirty || !title.trim() || !body.trim()}>
          {busy ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
        </button>
        {isCustomised && (
          <button className="btn-ghost" onClick={resetToDefault} disabled={busy} title="Restore hardcoded defaults">
            Reset to Default
          </button>
        )}
      </div>
    </div>
  )
}

function TutorialsTab({ API }) {
  const [overrides, setOverrides] = useState(null) // null = loading
  const [error,     setError]     = useState('')

  const load = useCallback(async () => {
    try {
      const res  = await fetch(`${API}/api/admin/settings`, { credentials: 'include' })
      const data = await res.json()
      setOverrides(data.data?.settings?.tutorialContent ?? {})
    } catch {
      setError('Failed to load tutorial content.')
    }
  }, [API])

  useEffect(() => { load() }, [load])

  if (error)         return <p className="admin-error">{error}</p>
  if (!overrides)    return <p className="admin-loading">Loading…</p>

  return (
    <div>
      <p className="admin-section-sub" style={{ marginBottom: '1.5rem' }}>
        Override the title and body text for each tutorial step. Leave a field blank to use the hardcoded default (shown as placeholder text).
      </p>
      {TUTORIAL_DEFS.map(tut => (
        <div key={tut.id} className="admin-section">
          <h3 className="admin-section-title">{tut.label}</h3>
          <p className="admin-section-sub">{tut.desc}</p>
          {tut.steps.map(step => (
            <TutorialStepEditor
              key={`${tut.id}_${step.index}`}
              tutorialId={tut.id}
              step={step}
              override={overrides[`${tut.id}_${step.index}`] ?? null}
              API={API}
              onSaved={load}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

// ── Content tab ───────────────────────────────────────────────────────────────
// Editable copy: welcome email + combat readiness screen text

const COMBAT_READINESS_DEFAULTS = {
  combatReadinessTitle:          'Select Combat Readiness',
  combatReadinessSubtitle:       'Choose your quiz difficulty. You can change this anytime from your profile.',
  combatReadinessEasyLabel:      'Recruit',
  combatReadinessEasyTag:        'EASY',
  combatReadinessEasyFlavor:     'Three answer choices. Training wheels on. No shame in it, Airman.',
  combatReadinessEasyStars:      '★★★☆☆',
  combatReadinessMediumLabel:    'Operative',
  combatReadinessMediumTag:      'MEDIUM',
  combatReadinessMediumFlavor:   'Five choices. The real RAF quiz. Separate the rookies from the veterans.',
  combatReadinessMediumStars:    '★★★★☆',
}

const WELCOME_EMAIL_DEFAULTS = {
  welcomeEmailSubject: 'Welcome to Skywatch — Mission Briefing',
  welcomeEmailHeading: 'Welcome to Skywatch',
  welcomeEmailBody:    'Your intelligence briefings are ready. Study RAF aircraft, ranks, bases, squadrons, and doctrine. Test your recall through gamified knowledge checks and earn Aircoins to climb the Intelligence Corps rank ladder.',
  welcomeEmailCta:     'Begin Mission',
  welcomeEmailFooter:  'Skywatch — Intelligence Study Platform for RAF Applicants & Enthusiasts.\nIf you didn\'t create this account, you can safely ignore this email.',
}

function ContentTab({ API }) {
  const [settings,    setSettings]    = useState(null)
  const [draft,       setDraft]       = useState({})
  const [reasonModal, setReasonModal] = useState(null)
  const [feedback,    setFeedback]    = useState('')

  const loadSettings = useCallback(() => {
    fetch(`${API}/api/admin/settings`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { const s = d.data?.settings; if (s) { setSettings(s); setDraft(s) } })
  }, [API])

  useEffect(() => { loadSettings() }, [loadSettings])

  const saveSection = (label, fields) => {
    const updates = {}
    fields.forEach(f => { updates[f] = draft[f] })
    setReasonModal({
      label,
      onConfirm: async (reason) => {
        await fetch(`${API}/api/admin/settings`, {
          method: 'PATCH', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...updates, reason }),
        })
        setReasonModal(null)
        setFeedback(`${label} saved.`)
        setTimeout(() => setFeedback(''), 3000)
        loadSettings()
      },
    })
  }

  const textField = (key, label, defaultText, rows) => (
    <div className="settings-field" key={key}>
      <label className="settings-field__label">{label}</label>
      {rows ? (
        <textarea
          className="form-textarea"
          rows={rows}
          placeholder={defaultText}
          value={draft[key] ?? ''}
          onChange={e => setDraft(prev => ({ ...prev, [key]: e.target.value }))}
        />
      ) : (
        <input
          type="text"
          className="settings-field__input"
          placeholder={defaultText}
          value={draft[key] ?? ''}
          onChange={e => setDraft(prev => ({ ...prev, [key]: e.target.value }))}
        />
      )}
    </div>
  )

  if (!settings) return <p className="admin-loading">Loading…</p>

  return (
    <div>
      {reasonModal && (
        <ReasonModal
          action={reasonModal.label}
          onConfirm={reasonModal.onConfirm}
          onCancel={() => setReasonModal(null)}
        />
      )}
      {feedback && <p className="admin-feedback">{feedback}</p>}

      {/* Welcome Email */}
      <div className="admin-section">
        <h3 className="admin-section-title">Welcome Email</h3>
        <p className="admin-section-sub">
          Customise the new-account welcome email. Leave any field blank to use the default text (shown as placeholder).
        </p>
        {textField('welcomeEmailSubject', 'Subject line',    WELCOME_EMAIL_DEFAULTS.welcomeEmailSubject)}
        {textField('welcomeEmailHeading', 'Heading',         WELCOME_EMAIL_DEFAULTS.welcomeEmailHeading)}
        {textField('welcomeEmailBody',    'Body text',       WELCOME_EMAIL_DEFAULTS.welcomeEmailBody, 4)}
        {textField('welcomeEmailCta',     'CTA button text', WELCOME_EMAIL_DEFAULTS.welcomeEmailCta)}
        {textField('welcomeEmailFooter',  'Footer text',     WELCOME_EMAIL_DEFAULTS.welcomeEmailFooter, 3)}
        <p className="admin-section-sub" style={{ marginTop: '0.5rem' }}>
          HTML is supported in the footer (e.g. <code>&lt;br&gt;</code>, <code>&amp;amp;</code>).
        </p>
        <button
          className="btn-primary settings-save"
          onClick={() => saveSection('Update Welcome Email', ['welcomeEmailSubject', 'welcomeEmailHeading', 'welcomeEmailBody', 'welcomeEmailCta', 'welcomeEmailFooter'])}
        >
          Save Welcome Email
        </button>
      </div>

      {/* Combat Readiness screen */}
      <div className="admin-section">
        <h3 className="admin-section-title">Select Combat Readiness Screen</h3>
        <p className="admin-section-sub">
          Customise the difficulty selection screen shown after new account registration. Leave any field blank to use the default text (shown as placeholder).
        </p>

        <p className="admin-section-sub" style={{ marginTop: '1rem' }}>Screen header</p>
        {textField('combatReadinessTitle',    'Title',    COMBAT_READINESS_DEFAULTS.combatReadinessTitle)}
        {textField('combatReadinessSubtitle', 'Subtitle', COMBAT_READINESS_DEFAULTS.combatReadinessSubtitle)}

        <p className="admin-section-sub" style={{ marginTop: '1rem' }}>
          Easy option <span className="settings-tier-badge settings-tier-badge--free">Easy</span>
        </p>
        {textField('combatReadinessEasyLabel',  'Label (name)',    COMBAT_READINESS_DEFAULTS.combatReadinessEasyLabel)}
        {textField('combatReadinessEasyTag',    'Tag (e.g. EASY)', COMBAT_READINESS_DEFAULTS.combatReadinessEasyTag)}
        {textField('combatReadinessEasyStars',  'Stars',           COMBAT_READINESS_DEFAULTS.combatReadinessEasyStars)}
        {textField('combatReadinessEasyFlavor', 'Flavour text',    COMBAT_READINESS_DEFAULTS.combatReadinessEasyFlavor, 2)}

        <p className="admin-section-sub" style={{ marginTop: '1rem' }}>
          Medium option <span className="settings-tier-badge settings-tier-badge--silver">Medium</span>
        </p>
        {textField('combatReadinessMediumLabel',  'Label (name)',      COMBAT_READINESS_DEFAULTS.combatReadinessMediumLabel)}
        {textField('combatReadinessMediumTag',    'Tag (e.g. MEDIUM)', COMBAT_READINESS_DEFAULTS.combatReadinessMediumTag)}
        {textField('combatReadinessMediumStars',  'Stars',             COMBAT_READINESS_DEFAULTS.combatReadinessMediumStars)}
        {textField('combatReadinessMediumFlavor', 'Flavour text',      COMBAT_READINESS_DEFAULTS.combatReadinessMediumFlavor, 2)}

        <button
          className="btn-primary settings-save"
          onClick={() => saveSection('Update Combat Readiness Screen', [
            'combatReadinessTitle', 'combatReadinessSubtitle',
            'combatReadinessEasyLabel', 'combatReadinessEasyTag', 'combatReadinessEasyFlavor', 'combatReadinessEasyStars',
            'combatReadinessMediumLabel', 'combatReadinessMediumTag', 'combatReadinessMediumFlavor', 'combatReadinessMediumStars',
          ])}
        >
          Save Combat Readiness Screen
        </button>
      </div>
    </div>
  )
}

// ── Main Admin page ───────────────────────────────────────────────────────────

const TABS = [
  { id: 'stats',    label: 'App Stats'    },
  { id: 'briefs',   label: 'Intel Briefs' },
  { id: 'problems', label: 'Problems'     },
  { id: 'users',    label: 'Users'        },
  { id: 'settings', label: 'Settings'    },
  { id: 'tutorials', label: 'Tutorials'  },
  { id: 'content',  label: 'Content'     },
]

// ── Admin subscription emulator ───────────────────────────────────────────────

const TIER_LABELS = { free: 'Free', trial: 'Trial', silver: 'Silver', gold: 'Gold' }
const TIER_ORDER  = ['free', 'trial', 'silver', 'gold']

function AdminSubscriptionBar({ user, API, onTierChange }) {
  const [busy, setBusy] = useState(false)
  const [msg,  setMsg]  = useState('')

  const setTier = async (tier) => {
    if (tier === user.subscriptionTier || busy) return
    setBusy(true)
    try {
      const res  = await fetch(`${API}/api/admin/self/subscription`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier }),
      })
      const data = await res.json()
      if (data.status === 'success') {
        onTierChange(data.data.user)
        setMsg(`Now emulating ${TIER_LABELS[tier]} subscription.`)
        setTimeout(() => setMsg(''), 3000)
      }
    } finally { setBusy(false) }
  }

  return (
    <div className="admin-sub-bar">
      <div className="admin-sub-bar__info">
        <span className="admin-sub-bar__eyebrow">Subscription Emulator</span>
        <span className="admin-sub-bar__desc">
          Switch your account tier to test how different subscriptions experience the app.
          Ammo, access, and features all reflect the selected tier.
        </span>
      </div>
      <div className="admin-sub-bar__tiers">
        {TIER_ORDER.map(tier => (
          <button
            key={tier}
            className={`admin-sub-tier-btn admin-sub-tier-btn--${tier}${user.subscriptionTier === tier ? ' admin-sub-tier-btn--active' : ''}`}
            onClick={() => setTier(tier)}
            disabled={busy}
          >
            {TIER_LABELS[tier]}
          </button>
        ))}
      </div>
      {msg && <p className="admin-sub-bar__msg">{msg}</p>}
    </div>
  )
}

export default function Admin({ navigate }) {
  const { user, setUser, loading, API } = useAuth()
  const [tab, setTab] = useState('stats')

  // Auth guard — redirect non-admins immediately
  if (loading) return null
  if (!user)          { navigate('login');     return null }
  if (!user.isAdmin)  { navigate('dashboard'); return null }

  return (
    <main className="page admin-page">
      <div className="section-inner">

        <div className="admin-header">
          <span className="static-eyebrow admin-eyebrow">Restricted Access</span>
          <h1 className="admin-title">Admin Panel</h1>
        </div>

        <AdminSubscriptionBar user={user} API={API} onTierChange={setUser} />

        {/* Tab navigation */}
        <div className="admin-tabs" role="tablist">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`admin-tab-btn ${tab === t.id ? 'admin-tab-btn--active' : ''}`}
              onClick={() => setTab(t.id)}
              role="tab"
              aria-selected={tab === t.id}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="admin-tab-content">
          {tab === 'stats'    && <StatsTab    API={API} />}
          {tab === 'briefs'   && <BriefsTab   API={API} />}
          {tab === 'problems' && <ProblemsTab API={API} />}
          {tab === 'users'    && <UsersTab    API={API} navigate={navigate} />}
          {tab === 'settings'  && <SettingsTab  API={API} />}
          {tab === 'tutorials' && <TutorialsTab API={API} />}
          {tab === 'content'   && <ContentTab   API={API} />}
        </div>

      </div>
    </main>
  )
}
