import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { playSound, invalidateSoundSettings } from '../utils/sound'

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
  { key: 'aircoins',        label: 'Aircoins',          desc: 'Zero out totalAircoins' },
  { key: 'gameHistory',     label: 'Game History',      desc: 'Delete quiz results & clear gameTypesSeen' },
  { key: 'intelBriefsRead', label: 'Intel Briefs Read', desc: 'Delete all brief-read records (resets ammo too)' },
]

function ResetStatsModal({ agentNumber, userId, API, onDone, onCancel }) {
  const [selected, setSelected] = useState({ aircoins: true, gameHistory: true, intelBriefsRead: true })
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

// ── App Stats tab ─────────────────────────────────────────────────────────────

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
        <h3 className="admin-section-title">Games</h3>
        <div className="admin-stats-grid">
          <AdminStat label="Quizzes Played"    value={stats.games.totalGamesPlayed} />
          <AdminStat label="Perfect Score"     value={stats.games.totalGamesWon} />
          <AdminStat label="Quizzes Lost"      value={stats.games.totalGamesLost} />
          <AdminStat label="Aircoins in System" value={fmtNum(stats.games.totalAircoinsEarned)} />
        </div>
      </div>
      <div className="admin-section">
        <h3 className="admin-section-title">Intel Briefs</h3>
        <div className="admin-stats-grid">
          <AdminStat label="Total Briefs Read" value={stats.briefs.totalBrifsRead} />
        </div>
      </div>
    </div>
  )
}

function AdminStat({ label, value, mock }) {
  return (
    <div className={`admin-stat-item${mock ? ' admin-stat-item--mock' : ''}`}>
      <span className="admin-stat-item__value">{value ?? '—'}</span>
      <span className="admin-stat-item__label">{label}</span>
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
  const [tick,         setTick]        = useState(0) // bump to force reload
  const [expanded,     setExpanded]    = useState(null)
  const [updateTexts,  setUpdateTexts] = useState({})
  const [busy,         setBusy]        = useState(null)

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (filter !== 'all') params.set('solved', filter === 'solved' ? 'true' : 'false')

    fetch(`${API}/api/admin/problems?${params}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setProblems(d.data?.problems ?? []))
      .catch(() => {})
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
      {!loading && visible.length === 0 && <p className="empty-state">No problems found.</p>}

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
                        <span className="admin-update-item__time">{new Date(u.time).toLocaleDateString()}</span>
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

function UsersTab({ API }) {
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

  const triggerAction = (label, endpoint) => setReasonModal({ label, endpoint })

  const confirmAction = async (reason) => {
    await fetch(`${API}${reasonModal.endpoint}`, {
      method: 'POST', credentials: 'include',
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
              <div className="admin-user-stat"><span>Aircoins</span><strong>{u.totalAircoins ?? 0}</strong></div>
              <div className="admin-user-stat"><span>Difficulty</span><strong style={{ textTransform: 'capitalize' }}>{u.difficultySetting ?? 'easy'}</strong></div>
              <div className="admin-user-stat"><span>Admin</span><strong>{u.isAdmin ? 'Yes' : 'No'}</strong></div>
              <div className="admin-user-stat"><span>Banned</span><strong>{u.isBanned ? 'Yes' : 'No'}</strong></div>
            </div>

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
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Sound row ─────────────────────────────────────────────────────────────────

function SoundRow({ label, sound, value, onChange }) {
  const previewRef = useRef(null)

  const preview = () => {
    // Play at the current draft volume without saving
    if (previewRef.current) { previewRef.current.pause(); previewRef.current = null }
    invalidateSoundSettings()
    // Temporarily override with draft value by playing directly
    const files = {
      intel_brief_opened: ['intel_brief_opened.mp3'],
      target_locked:      ['target_locked.mp3'],
      fire:               ['fire.mp3'],
      aircoin:            ['aircoin.mp3'],
      out_of_ammo:        ['out_of_ammo_1.mp3', 'out_of_ammo_2.mp3', 'out_of_ammo_3.mp3'],
    }
    const list = files[sound] ?? ['']
    const file = list[Math.floor(Math.random() * list.length)]
    const audio = new Audio(`/sounds/${file}`)
    audio.volume = Math.min(1, Math.max(0, value / 100))
    audio.play().catch(() => {})
    previewRef.current = audio
  }

  return (
    <div className="sound-row">
      <span className="sound-row__label">{label}</span>
      <button className="sound-row__play" onClick={preview} title="Preview">▶</button>
      <input
        type="range"
        className="sound-row__slider"
        min={0} max={100} step={1}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
      />
      <input
        type="number"
        className="sound-row__num"
        min={0} max={100}
        value={value}
        onChange={e => onChange(Math.min(100, Math.max(0, Number(e.target.value))))}
      />
      <span className="sound-row__pct">%</span>
    </div>
  )
}

// ── Settings tab ──────────────────────────────────────────────────────────────

function SettingsTab({ API }) {
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
        <button
          className="btn-primary settings-save"
          onClick={() => saveSection('Update Aircoin Options', ['aircoinsPerWinEasy', 'aircoinsPerWinMedium', 'aircoinsPerBriefRead', 'aircoinsFirstLogin', 'aircoinsStreakBonus', 'aircoins100Percent'])}
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
        <p className="admin-section-sub">Adjust volume for each sound effect. Use the play button to preview.</p>

        {[
          { key: 'volumeIntelBriefOpened', label: 'Intel Brief Opened', sound: 'intel_brief_opened' },
          { key: 'volumeTargetLocked',     label: 'Target Locked',      sound: 'target_locked'      },
          { key: 'volumeFire',             label: 'Keyword Fire',        sound: 'fire'               },
          { key: 'volumeAircoin',          label: 'Aircoins Earned',     sound: 'aircoin'            },
          { key: 'volumeOutOfAmmo',        label: 'Out of Ammo',        sound: 'out_of_ammo'        },
        ].map(({ key, label, sound }) => (
          <SoundRow
            key={key}
            label={label}
            sound={sound}
            value={draft[key] ?? 100}
            onChange={v => setDraft(prev => ({ ...prev, [key]: v }))}
          />
        ))}

        <button
          className="btn-primary settings-save"
          onClick={() => saveSection('Update Sound Volumes', ['volumeIntelBriefOpened', 'volumeTargetLocked', 'volumeFire', 'volumeAircoin', 'volumeOutOfAmmo'])}
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

        <button
          className="btn-primary settings-save"
          onClick={() => saveSection('Update Feature Flags', ['useLiveLeaderboard'])}
        >
          Save Feature Flags
        </button>
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
  const [aiGenerating,     setAiGenerating]     = useState(false)
  const [pendingMedia, setPendingMedia] = useState([])  // media queued before first save
  const originalMediaRef = useRef([])                   // snapshot of media at open-time for diffing

  // Quiz question state
  const [draftQuizEasy,   setDraftQuizEasy]   = useState([])
  const [draftQuizMedium, setDraftQuizMedium] = useState([])
  const [quizView,        setQuizView]        = useState('list') // 'list' | 'answers'
  const [quizSelected,    setQuizSelected]    = useState(null)   // { difficulty, index }
  const [quizGenerating,  setQuizGenerating]  = useState(false)
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
    setEditing(brief)
    setDraft({
      title:       brief.title       ?? '',
      subtitle:    brief.subtitle    ?? '',
      description: brief.description ?? '',
      category:    brief.category    ?? ALL_CATEGORIES[0],
      dateAdded:   brief.dateAdded   ? brief.dateAdded.slice(0, 10) : new Date().toISOString().slice(0, 10),
      sources:     brief.sources  ? brief.sources.map(s => ({ ...s }))  : [],
      keywords:    brief.keywords ? brief.keywords.map(k => ({ ...k })) : [],
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
      dateAdded: new Date().toISOString().slice(0, 10),
      sources: [], keywords: [],
    })
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
    setDraftQuizEasy([])
    setDraftQuizMedium([])
    setQuizView('list')
    setQuizSelected(null)
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
    setFeedback('Generating image… this may take 20–30 seconds.')
    try {
      const saveRes  = await fetch(`${API}/api/admin/ai/generate-image`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: draft.title || draft.subtitle || 'Royal Air Force' }),
      })
      const saveData = await saveRes.json()

      if (saveData.status === 'success') {
        setMediaUrl(`${API}${saveData.data.url}`)
        setFeedback('Image generated — click Add to attach it.')
        setTimeout(() => setFeedback(''), 5000)
      } else {
        setFeedback(`Failed to save image: ${saveData.message}`)
        setTimeout(() => setFeedback(''), 5000)
      }
    } catch (err) {
      console.error('[generateImage] error:', err)
      setFeedback(`Image generation failed: ${err.message}`)
      setTimeout(() => setFeedback(''), 6000)
    } finally {
      setAiMediaSearching(false)
    }
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
                        .then(data => {
                          const generated = data.data?.brief ?? {}
                          const sources = Array.isArray(generated.sources)
                            ? generated.sources.filter(s => s.url && s.url.startsWith('http'))
                            : []
                          setDraft({
                            title:       generated.title       || headline,
                            subtitle:    generated.subtitle    || '',
                            description: generated.description || '',
                            category:    'News',
                            keywords:    Array.isArray(generated.keywords) ? generated.keywords : [],
                            sources,
                            dateAdded:   new Date().toISOString().slice(0, 10),
                          })
                          setFeedback('Brief populated from verified sources — review carefully before saving.')
                          setTimeout(() => setFeedback(''), 6000)
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
          <select className="feed-filter" value={catFilter} onChange={e => { setCatFilter(e.target.value); setPage(1) }}>
            <option value="">All Categories</option>
            {ALL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="btn-primary" style={{ marginLeft: 'auto' }} onClick={openNew}>+ New Brief</button>
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
        <h3 className="admin-section-title">Core Details</h3>

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
          <label className="form-label">Description</label>
          <textarea
            className="form-textarea"
            rows={7}
            value={draft.description}
            onChange={e => setDraft(p => ({ ...p, description: e.target.value }))}
            placeholder="~200 word brief description…"
          />
        </div>

        <div className="brief-form-row">
          <div className="brief-form-field" style={{ flex: 1 }}>
            <label className="form-label">Category</label>
            <select
              className="feed-filter"
              style={{ width: '100%' }}
              value={draft.category}
              onChange={e => setDraft(p => ({ ...p, category: e.target.value }))}
            >
              {ALL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="brief-form-field" style={{ flex: 1 }}>
            <label className="form-label">Date Added</label>
            <input
              type="date"
              className="form-input"
              value={draft.dateAdded}
              onChange={e => setDraft(p => ({ ...p, dateAdded: e.target.value }))}
            />
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
                  </div>
                  <div className="brief-media-item__controls">
                    <button className="brief-media-item__move-btn" onClick={() => movePendingMedia(idx, -1)} disabled={idx === 0} title="Move up">▲</button>
                    <button className="brief-media-item__move-btn" onClick={() => movePendingMedia(idx, 1)} disabled={idx === pendingMedia.length - 1} title="Move down">▼</button>
                    <button className="brief-media-item__remove" onClick={() => setPendingMedia(prev => prev.filter((_, i) => i !== idx))} title="Remove">✕</button>
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
                    setPendingMedia(prev => [...prev, { mediaType, mediaUrl: mediaUrl.trim() }])
                    setMediaUrl('')
                  }
                }}
              />
              <button
                className="btn-ghost"
                style={{ flexShrink: 0 }}
                disabled
                title="Feature not working for now"
                style={{ flexShrink: 0, opacity: 0.4, cursor: 'not-allowed' }}
              >
                Generate Image
              </button>
              <button
                className="btn-primary"
                style={{ flexShrink: 0 }}
                disabled={!mediaUrl.trim()}
                onClick={() => {
                  setPendingMedia(prev => [...prev, { mediaType, mediaUrl: mediaUrl.trim() }])
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
                disabled
                title="Feature not working for now"
                style={{ flexShrink: 0, opacity: 0.4, cursor: 'not-allowed' }}
              >
                Generate Image
              </button>
              <button className="btn-primary" style={{ flexShrink: 0 }} onClick={addMedia} disabled={!mediaUrl.trim()}>
                Add
              </button>
            </div>
          </>
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
        <button className="admin-action-btn admin-action-btn--primary" onClick={addKeyword}>+ Add Keyword</button>
      </div>

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

// ── Main Admin page ───────────────────────────────────────────────────────────

const TABS = [
  { id: 'stats',    label: 'App Stats'     },
  { id: 'briefs',   label: 'Intel Briefs'  },
  { id: 'problems', label: 'Problems'      },
  { id: 'users',    label: 'Users'         },
  { id: 'settings', label: 'Settings'      },
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
          {tab === 'users'    && <UsersTab    API={API} />}
          {tab === 'settings' && <SettingsTab API={API} />}
        </div>

      </div>
    </main>
  )
}
