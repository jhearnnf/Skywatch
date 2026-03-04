import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { playSound, invalidateSoundSettings } from '../utils/sound'

const OPENROUTER_KEY          = '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'
const NEWS_MODEL              = 'perplexity/sonar'       // live web search — headlines + brief generation
const DEFAULT_BRIEF_IMAGE     = '/placeholder-brief.svg' // template image used on all intel briefs

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
          <AdminStat label="Games Played" value={stats.games.totalGamesPlayed} mock />
          <AdminStat label="Games Won"    value={stats.games.totalGamesWon}    mock />
          <AdminStat label="Games Lost"   value={stats.games.totalGamesLost}   mock />
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
        {numField('ammoSilver', 'Ammo per brief — Silver / Trial tier', 0, 99)}
        <p className="settings-tier-note">
          <span className="settings-tier-badge settings-tier-badge--gold">Gold</span>
          Gold tier always receives unlimited ammunition.
        </p>

        <p className="admin-section-sub" style={{ marginTop: '1.25rem' }}>Quiz answer display count</p>
        {numField('easyAnswerCount',   'Answers shown — Easy difficulty',   2, 10)}
        {numField('mediumAnswerCount', 'Answers shown — Medium difficulty', 2, 10)}

        <button
          className="btn-primary settings-save"
          onClick={() => saveSection('Update Game Options', ['ammoFree', 'ammoSilver', 'easyAnswerCount', 'mediumAnswerCount'])}
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
          onClick={() => saveSection('Update Sound Volumes', ['volumeIntelBriefOpened', 'volumeTargetLocked', 'volumeOutOfAmmo'])}
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
  const [addingMedia,  setAddingMedia]  = useState(false)
  const [aiGenerating, setAiGenerating] = useState(false)
  const [pendingMedia, setPendingMedia] = useState([])  // media queued before first save

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
    fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': window.location.origin,
        'X-Title': 'Skywatch',
      },
      body: JSON.stringify({
        model: NEWS_MODEL,
        messages: [{
          role: 'system',
          content: 'You are a factual news assistant. Only report real, verified news stories that have actually been published. Never invent or fabricate headlines.',
        }, {
          role: 'user',
          content: `The current date and time is ${timestamp}. Search the web right now for real UK Royal Air Force (RAF) news stories published in the last 24 hours only. Return ONLY a JSON array of up to 6 headline strings taken verbatim or closely paraphrased from actual published sources. No fabricated headlines, no citation markers like [1], no markdown, no code blocks, no extra text. If no real RAF stories exist from the last 24 hours, return an empty array []. Format: ["Headline one", "Headline two"]`,
        }],
      }),
    })
      .then(r => r.json())
      .then(data => {
        const raw = data.choices?.[0]?.message?.content ?? '[]'
        const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').replace(/\[\d+\]/g, '').trim()
        const parsed = JSON.parse(clean)
        setRafNews(Array.isArray(parsed) ? parsed : [])
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

  const openEdit = (brief) => {
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
    setView('edit')
    setFeedback('')
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
    setView('edit')
    setFeedback('')
    setPendingMedia([{ mediaType: 'picture', mediaUrl: DEFAULT_BRIEF_IMAGE }])
  }

  const backToList = () => { setView('list'); setEditing(null); setPendingMedia([]) }

  const doSave = async (reason) => {
    const wasNew = isNew
    setBusy(true)
    setReasonModal(null)
    const url    = wasNew ? `${API}/api/admin/briefs` : `${API}/api/admin/briefs/${editing._id}`
    const method = wasNew ? 'POST' : 'PATCH'
    const res    = await fetch(url, {
      method, credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...draft, reason }),
    })
    const data = await res.json()
    if (data.status === 'success') {
      let savedBrief = data.data.brief
      // Flush all queued media (includes template image pre-added to pendingMedia)
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

  const addMedia = async () => {
    if (!mediaUrl.trim()) return
    setAddingMedia(true)
    const res  = await fetch(`${API}/api/admin/briefs/${editing._id}/media`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaType, mediaUrl: mediaUrl.trim() }),
    })
    const data = await res.json()
    if (data.status === 'success') {
      setEditing(data.data.brief)
      setMediaUrl('')
    }
    setAddingMedia(false)
  }

  const removeMedia = async (mediaId) => {
    await fetch(`${API}/api/admin/briefs/${editing._id}/media/${mediaId}`, {
      method: 'DELETE', credentials: 'include',
    })
    setEditing(prev => ({ ...prev, media: prev.media.filter(m => m._id !== mediaId) }))
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

  // ── List view ──────────────────────────────────────────────────────────────
  if (view === 'list') {
    // Filter out headlines already covered by an existing brief
    const newHeadlines = rafNews.filter(h => !headlineAlreadyCovered(h, briefs))

    return (
      <div>

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

                      fetch('https://openrouter.ai/api/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                          'Authorization': `Bearer ${OPENROUTER_KEY}`,
                          'Content-Type': 'application/json',
                          'HTTP-Referer': window.location.origin,
                          'X-Title': 'Skywatch',
                        },
                        body: JSON.stringify({
                          model: NEWS_MODEL,
                          messages: [{
                            role: 'system',
                            content: 'You are a factual intelligence writer for a Royal Air Force training platform. You only write content based on verified, published facts retrieved from the web. You never invent, speculate, or fabricate any detail — not dates, names, figures, locations, or outcomes. If a fact cannot be confirmed from a real source, omit it.',
                          }, {
                            role: 'user',
                            content: `Search the web for this specific RAF news story: "${headline}"\n\nUsing only verified facts from published sources about this story, return a JSON object for an RAF trainee intelligence brief. Return ONLY valid JSON — no markdown, no code blocks, no extra text, no citation markers like [1]:\n{\n  "title": "factual title drawn from the story, max 70 characters",\n  "subtitle": "one factual sentence summarising the story",\n  "description": "200-250 word factual brief about this story written for RAF trainees — only include details confirmed by published sources, no speculation",\n  "keywords": [\n    {"keyword": "verified term from the story", "generatedDescription": "factual 2-3 sentence explanation from published sources"},\n    {"keyword": "second verified term", "generatedDescription": "factual explanation"},\n    {"keyword": "third verified term", "generatedDescription": "factual explanation"}\n  ],\n  "sources": [\n    {"url": "https://full-url-of-actual-article.com", "siteName": "Publication Name", "articleDate": "YYYY-MM-DD"},\n    {"url": "https://second-source-url.com", "siteName": "Publication Name", "articleDate": "YYYY-MM-DD"}\n  ]\n}`,
                          }],
                        }),
                      })
                        .then(r => r.json())
                        .then(data => {
                          let content = data.choices?.[0]?.message?.content ?? '{}'
                          content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').replace(/\[\d+\]/g, '').trim()
                          const generated = JSON.parse(content)
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
                    <span className="brief-media-item__url" title={m.mediaUrl}>{m.mediaUrl}</span>
                  </div>
                  <button
                    className="brief-media-item__remove"
                    onClick={() => setPendingMedia(prev => prev.filter((_, i) => i !== idx))}
                    title="Remove"
                  >
                    ✕
                  </button>
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
              {(editing.media ?? []).map(m => (
                <div key={m._id} className="brief-media-item">
                  <img
                    src={m.mediaUrl}
                    alt=""
                    className="brief-media-item__img"
                    onError={e => { e.currentTarget.style.display = 'none' }}
                  />
                  <div className="brief-media-item__info">
                    <span className="brief-media-item__type">{m.mediaType}</span>
                    <span className="brief-media-item__url" title={m.mediaUrl}>{m.mediaUrl}</span>
                  </div>
                  <button
                    className="brief-media-item__remove"
                    onClick={() => removeMedia(m._id)}
                    title="Remove image"
                  >
                    ✕
                  </button>
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
              <button className="btn-primary" style={{ flexShrink: 0 }} onClick={addMedia} disabled={!mediaUrl.trim() || addingMedia}>
                {addingMedia ? 'Adding…' : 'Add'}
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
