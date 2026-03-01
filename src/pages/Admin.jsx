import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'

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

// ── App Stats tab ─────────────────────────────────────────────────────────────

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
          <AdminStat label="Total Users"     value={stats.users.totalUsers} />
          <AdminStat label="Free Tier"       value={stats.users.freeUsers} />
          <AdminStat label="Trial Tier"      value={stats.users.trialUsers} />
          <AdminStat label="Subscribed"      value={stats.users.subscribedUsers} />
        </div>
      </div>
      <div className="admin-section">
        <h3 className="admin-section-title">Games</h3>
        <div className="admin-stats-grid">
          <AdminStat label="Games Played" value={stats.games.totalGamesPlayed} />
          <AdminStat label="Games Won"    value={stats.games.totalGamesWon} />
          <AdminStat label="Games Lost"   value={stats.games.totalGamesLost} />
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

function AdminStat({ label, value }) {
  return (
    <div className="admin-stat-item">
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

  // Client-side text filter to avoid hammering the API on each keystroke
  const visible = search.trim()
    ? problems.filter(p =>
        p.description.toLowerCase().includes(search.toLowerCase()) ||
        p.pageReported?.toLowerCase().includes(search.toLowerCase())
      )
    : problems

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
  const [q,           setQ]           = useState('')
  const [users,       setUsers]       = useState([])
  const [loading,     setLoading]     = useState(false)
  const [searched,    setSearched]    = useState(false)
  const [reasonModal, setReasonModal] = useState(null) // { label, endpoint }
  const [feedback,    setFeedback]    = useState('')

  const runSearch = useCallback(async () => {
    if (!q.trim()) return
    setLoading(true); setSearched(true)
    const res  = await fetch(`${API}/api/admin/users/search?q=${encodeURIComponent(q.trim())}`, { credentials: 'include' })
    const data = await res.json()
    setUsers(data.data?.users ?? [])
    setLoading(false)
  }, [API, q])

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
    runSearch()
  }

  return (
    <div>
      {reasonModal && (
        <ReasonModal
          action={reasonModal.label}
          onConfirm={confirmAction}
          onCancel={() => setReasonModal(null)}
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
      </form>

      {feedback && <p className="admin-feedback">{feedback}</p>}
      {loading  && <p className="admin-loading">Searching…</p>}
      {searched && !loading && users.length === 0 && (
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
              <div className="admin-user-stat"><span>Admin</span><strong>{u.isAdmin ? 'Yes' : 'No'}</strong></div>
              <div className="admin-user-stat"><span>Banned</span><strong>{u.isBanned ? 'Yes' : 'No'}</strong></div>
            </div>

            <div className="admin-card__actions">
              {!u.isAdmin && (
                <button
                  className="admin-action-btn admin-action-btn--primary"
                  onClick={() => triggerAction(`Make Agent ${u.agentNumber} an admin`, `/api/admin/users/${u._id}/make-admin`)}
                >
                  Make Admin
                </button>
              )}
              <button
                className="admin-action-btn admin-action-btn--warning"
                onClick={() => triggerAction(`Reset stats for Agent ${u.agentNumber}`, `/api/admin/users/${u._id}/reset-stats`)}
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
        setFeedback(`${label} saved.`)
        setTimeout(() => setFeedback(''), 3000)
        loadSettings()
      },
    })
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

        <p className="admin-section-sub" style={{ marginTop: '1.25rem' }}>Silver tier accessible categories</p>
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
        <button
          className="btn-primary settings-save"
          onClick={() => saveSection('Update Subscription Settings', ['trialDurationDays', 'silverCategories'])}
        >
          Save Subscription Settings
        </button>
      </div>

      {/* Aircoin options */}
      <div className="admin-section">
        <h3 className="admin-section-title">Aircoin Options</h3>
        {numField('aircoinsPerWin',      'Aircoins awarded per game win')}
        {numField('aircoinsFirstLogin',  'Bonus Aircoins on first daily login')}
        {numField('aircoinsStreakBonus', 'Bonus Aircoins per streak login day')}
        {numField('aircoins100Percent',  'Bonus Aircoins for 100% correct quiz')}
        <button
          className="btn-primary settings-save"
          onClick={() => saveSection('Update Aircoin Options', ['aircoinsPerWin', 'aircoinsFirstLogin', 'aircoinsStreakBonus', 'aircoins100Percent'])}
        >
          Save Aircoin Options
        </button>
      </div>

      {/* Game / ammo options */}
      <div className="admin-section">
        <h3 className="admin-section-title">Game Options</h3>

        <p className="admin-section-sub">Intel Brief Ammunition (per tier)</p>
        {numField('ammoFree',   'Ammo per brief — Free tier',   0, 99)}
        {numField('ammoSilver', 'Ammo per brief — Silver tier', 0, 99)}
        {numField('ammoGold',   'Ammo per brief — Gold tier',   0, 99)}

        <p className="admin-section-sub" style={{ marginTop: '1.25rem' }}>Quiz answer display count</p>
        {numField('easyAnswerCount',   'Answers shown — Easy difficulty',   2, 10)}
        {numField('mediumAnswerCount', 'Answers shown — Medium difficulty', 2, 10)}

        <button
          className="btn-primary settings-save"
          onClick={() => saveSection('Update Game Options', ['ammoFree', 'ammoSilver', 'ammoGold', 'easyAnswerCount', 'mediumAnswerCount'])}
        >
          Save Game Options
        </button>
      </div>
    </div>
  )
}

// ── Main Admin page ───────────────────────────────────────────────────────────

const TABS = [
  { id: 'stats',    label: 'App Stats'  },
  { id: 'problems', label: 'Problems'   },
  { id: 'users',    label: 'Users'      },
  { id: 'settings', label: 'Settings'   },
]

export default function Admin({ navigate }) {
  const { user, loading, API } = useAuth()
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
          {tab === 'problems' && <ProblemsTab API={API} />}
          {tab === 'users'    && <UsersTab    API={API} />}
          {tab === 'settings' && <SettingsTab API={API} />}
        </div>

      </div>
    </main>
  )
}
