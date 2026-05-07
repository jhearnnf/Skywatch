import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useAppSettings } from '../context/AppSettingsContext'
import { useChatUnread } from '../context/ChatUnreadContext'
import SEO from '../components/SEO'

const POLL_MESSAGES_MS = 10_000
const SUPPORT_LABEL = 'Skywatch Support'

function formatTime(ts) {
  try {
    const d = new Date(ts)
    return d.toLocaleString([], { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' })
  } catch { return '' }
}

function MessageList({ messages, currentUserId, viewer }) {
  const scrollRef = useRef(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
      {messages.length === 0 && (
        <p className="text-center text-xs text-slate-400 py-8">
          No messages yet — say hi to get started.
        </p>
      )}
      {messages.map(m => {
        if (m.senderRole === 'system') {
          return (
            <div key={m._id} className="flex justify-center py-1">
              <span className="text-[11px] text-slate-400 italic px-2 py-1 rounded-full bg-slate-100">
                {m.body}
              </span>
            </div>
          )
        }

        // For the user view, all admin messages collapse to "Skywatch Support"
        const mine = viewer === 'user'
          ? m.senderRole === 'user'
          : (m.senderRole === 'admin' && m.senderUserId === currentUserId)
        const align = mine ? 'justify-end' : 'justify-start'
        const bubble = mine
          ? 'bg-brand-600 text-white'
          : 'bg-slate-100 text-slate-800 border border-slate-200'

        const senderLabel = viewer === 'admin' && m.senderRole === 'admin' && !mine
          ? (m.senderUser?.email || m.senderUser?.agentNumber || 'Admin')
          : null

        return (
          <div key={m._id} className={`flex ${align}`}>
            <div className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-sm ${bubble}`}>
              {senderLabel && (
                <p className="text-[10px] font-semibold opacity-70 mb-0.5">{senderLabel}</p>
              )}
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
              <p className={`text-[10px] mt-1 ${mine ? 'text-white/70' : 'text-slate-400'}`}>
                {formatTime(m.createdAt)}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ComposeBox({ disabled, busy, onSend }) {
  const [body, setBody] = useState('')
  const handleSend = () => {
    const text = body.trim()
    if (!text || disabled || busy) return
    onSend(text)
    setBody('')
  }
  return (
    <div className="border-t border-slate-200 p-3 flex items-end gap-2">
      <textarea
        rows={1}
        disabled={disabled}
        value={body}
        onChange={e => setBody(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
        }}
        placeholder={disabled ? 'This chat is closed.' : 'Type a message…'}
        className="flex-1 resize-none px-3 py-2 rounded-xl border border-slate-200 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none text-sm disabled:opacity-50"
      />
      <button
        type="button"
        onClick={handleSend}
        disabled={disabled || busy || !body.trim()}
        className="px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-bold rounded-xl text-sm transition-colors"
      >
        Send
      </button>
    </div>
  )
}

// ── User view ────────────────────────────────────────────────────────────────

function UserChatView() {
  const { user, API, apiFetch } = useAuth()
  const { refresh: refreshUnread } = useChatUnread()
  const [conversation, setConversation] = useState(null)
  const [messages,     setMessages]     = useState([])
  const [loading,      setLoading]      = useState(true)
  const [busy,         setBusy]         = useState(false)
  const [err,          setErr]          = useState('')

  const fetchConversation = useCallback(async () => {
    const r = await apiFetch(`${API}/api/chat/conversations/mine`, { credentials: 'include' })
    const d = await r.json().catch(() => null)
    const open = (d?.data?.conversations ?? []).find(c => c.status === 'open')
    return open ?? (d?.data?.conversations ?? [])[0] ?? null
  }, [API, apiFetch])

  const fetchMessages = useCallback(async (conversationId) => {
    if (!conversationId) return []
    const r = await apiFetch(`${API}/api/chat/conversations/${conversationId}/messages`, { credentials: 'include' })
    const d = await r.json().catch(() => null)
    return d?.data?.messages ?? []
  }, [API, apiFetch])

  // Initial load
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchConversation().then(async convo => {
      if (cancelled) return
      setConversation(convo)
      if (convo) {
        const msgs = await fetchMessages(convo._id)
        if (cancelled) return
        setMessages(msgs)
        // Mark read on open
        await apiFetch(`${API}/api/chat/conversations/${convo._id}/read`, {
          method: 'POST', credentials: 'include',
        }).catch(() => {})
        refreshUnread()
      }
      setLoading(false)
    }).catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [API, apiFetch, fetchConversation, fetchMessages, refreshUnread])

  // Active-thread polling (only while tab visible)
  useEffect(() => {
    if (!conversation) return
    const tick = async () => {
      if (document.hidden) return
      const msgs = await fetchMessages(conversation._id)
      setMessages(prev => msgs.length === prev.length ? prev : msgs)
      // If poll picked up a new admin message, mark read so the dot stays clear
      if (msgs.length && msgs[msgs.length - 1].senderRole === 'admin') {
        apiFetch(`${API}/api/chat/conversations/${conversation._id}/read`, {
          method: 'POST', credentials: 'include',
        }).catch(() => {})
        refreshUnread()
      }
    }
    const id = setInterval(tick, POLL_MESSAGES_MS)
    return () => clearInterval(id)
  }, [API, apiFetch, conversation, fetchMessages, refreshUnread])

  const handleSend = async (text) => {
    if (!conversation) return
    setBusy(true); setErr('')
    try {
      const r = await apiFetch(`${API}/api/chat/conversations/${conversation._id}/messages`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => null)
        throw new Error(d?.message || 'Failed to send')
      }
      const msgs = await fetchMessages(conversation._id)
      setMessages(msgs)
      refreshUnread()
    } catch (e) {
      setErr(e.message || 'Failed to send')
    } finally {
      setBusy(false)
    }
  }

  const handleClose = async () => {
    if (!conversation) return
    if (!window.confirm('Close this chat? You can start a new one anytime from the Help page.')) return
    setBusy(true)
    try {
      await apiFetch(`${API}/api/chat/conversations/${conversation._id}/close`, {
        method: 'POST', credentials: 'include',
      })
      const updated = await fetchConversation()
      setConversation(updated)
      const msgs = await fetchMessages(updated?._id ?? conversation._id)
      setMessages(msgs)
      refreshUnread()
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <div className="text-center py-12 text-sm text-slate-400">Loading…</div>
  }

  if (!conversation) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <div className="text-4xl mb-4">💬</div>
        <h1 className="text-2xl font-extrabold text-slate-900 mb-2">No active chat</h1>
        <p className="text-sm text-slate-500 mb-6">Start a chat with the Skywatch team from the Help page.</p>
        <Link to="/report" className="inline-flex px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors">
          Go to Help
        </Link>
      </div>
    )
  }

  const isClosed = conversation.status === 'closed'

  return (
    <div className="max-w-2xl mx-auto h-[calc(100vh-8rem)] flex flex-col bg-surface rounded-2xl border border-slate-200 card-shadow overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">{SUPPORT_LABEL}</p>
          <p className="text-[11px] text-slate-400">
            {isClosed ? 'This chat is closed' : 'Usually replies within a few hours'}
          </p>
        </div>
        {!isClosed && (
          <button
            type="button"
            onClick={handleClose}
            disabled={busy}
            className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 transition-colors"
          >
            Close chat
          </button>
        )}
      </div>

      <MessageList messages={messages} currentUserId={user?._id} viewer="user" />

      {err && (
        <p className="text-xs text-red-600 bg-red-50 border-t border-red-200 px-3 py-2">{err}</p>
      )}

      {isClosed ? (
        <div className="border-t border-slate-200 p-3 text-center">
          <p className="text-xs text-slate-500 mb-2">This chat has been closed.</p>
          <Link to="/report" className="inline-flex px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-xs transition-colors">
            Start a new chat
          </Link>
        </div>
      ) : (
        <ComposeBox disabled={isClosed} busy={busy} onSend={handleSend} />
      )}
    </div>
  )
}

// ── Admin view ───────────────────────────────────────────────────────────────

function AdminChatView({ initialUserId }) {
  const { user, API, apiFetch } = useAuth()
  const { refresh: refreshUnread } = useChatUnread()
  const [conversations, setConversations] = useState([])
  const [statusFilter,  setStatusFilter]  = useState('all')
  const [selectedId,    setSelectedId]    = useState(null)
  const [messages,      setMessages]      = useState([])
  const [busy,          setBusy]          = useState(false)
  const [err,           setErr]           = useState('')
  // Guards against React 18 StrictMode double-invoking the initialUserId effect
  // and creating two conversations before the first POST lands.
  const resolvedInitialRef = useRef(null)

  // User search (start a new conversation)
  const [search,        setSearch]        = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching,     setSearching]     = useState(false)

  const fetchConversations = useCallback(async () => {
    const url = `${API}/api/chat/admin/conversations?status=${statusFilter}&limit=100`
    const r = await apiFetch(url, { credentials: 'include' })
    const d = await r.json().catch(() => null)
    return d?.data?.conversations ?? []
  }, [API, apiFetch, statusFilter])

  const fetchMessages = useCallback(async (id) => {
    if (!id) return []
    const r = await apiFetch(`${API}/api/chat/conversations/${id}/messages`, { credentials: 'include' })
    const d = await r.json().catch(() => null)
    return d?.data?.messages ?? []
  }, [API, apiFetch])

  // Initial / filter-changed conversation list load
  useEffect(() => {
    let cancelled = false
    fetchConversations().then(rows => { if (!cancelled) setConversations(rows) })
    return () => { cancelled = true }
  }, [fetchConversations])

  // Resolve initialUserId → coalesced conversation, then select.
  // Ref-guarded so StrictMode's double-mount can't fire two POSTs in parallel.
  useEffect(() => {
    if (!initialUserId) return
    if (resolvedInitialRef.current === initialUserId) return
    resolvedInitialRef.current = initialUserId

    let cancelled = false
    apiFetch(`${API}/api/chat/admin/conversations`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: initialUserId }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(async d => {
        if (cancelled || !d?.data?.conversation) return
        setSelectedId(d.data.conversation._id)
        const rows = await fetchConversations()
        if (!cancelled) setConversations(rows)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [API, apiFetch, initialUserId, fetchConversations])

  // Load messages when a conversation is selected, and mark read
  useEffect(() => {
    if (!selectedId) { setMessages([]); return }
    let cancelled = false
    fetchMessages(selectedId).then(msgs => {
      if (cancelled) return
      setMessages(msgs)
      apiFetch(`${API}/api/chat/conversations/${selectedId}/read`, {
        method: 'POST', credentials: 'include',
      }).then(() => refreshUnread()).catch(() => {})
      // Refresh the list so hasAdminUnread flips
      fetchConversations().then(rows => { if (!cancelled) setConversations(rows) })
    })
    return () => { cancelled = true }
  }, [API, apiFetch, selectedId, fetchMessages, fetchConversations, refreshUnread])

  // Active-thread polling for the selected conversation
  useEffect(() => {
    if (!selectedId) return
    const tick = async () => {
      if (document.hidden) return
      const msgs = await fetchMessages(selectedId)
      setMessages(prev => msgs.length === prev.length ? prev : msgs)
      if (msgs.length && msgs[msgs.length - 1].senderRole === 'user') {
        apiFetch(`${API}/api/chat/conversations/${selectedId}/read`, {
          method: 'POST', credentials: 'include',
        }).catch(() => {})
        refreshUnread()
      }
    }
    const id = setInterval(tick, POLL_MESSAGES_MS)
    return () => clearInterval(id)
  }, [API, apiFetch, selectedId, fetchMessages, refreshUnread])

  // Search users (reuses existing admin endpoint)
  useEffect(() => {
    if (!search.trim()) { setSearchResults([]); return }
    setSearching(true)
    let cancelled = false
    const t = setTimeout(() => {
      apiFetch(`${API}/api/admin/users/search?q=${encodeURIComponent(search.trim())}`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (!cancelled) setSearchResults(d?.data?.users ?? []) })
        .catch(() => {})
        .finally(() => { if (!cancelled) setSearching(false) })
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [API, apiFetch, search])

  const handleSend = async (text) => {
    if (!selectedId) return
    setBusy(true); setErr('')
    try {
      const r = await apiFetch(`${API}/api/chat/conversations/${selectedId}/messages`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => null)
        throw new Error(d?.message || 'Failed to send')
      }
      const [msgs, rows] = await Promise.all([fetchMessages(selectedId), fetchConversations()])
      setMessages(msgs)
      setConversations(rows)
      refreshUnread()
    } catch (e) {
      setErr(e.message || 'Failed to send')
    } finally {
      setBusy(false)
    }
  }

  const handleClose = async () => {
    if (!selectedId) return
    if (!window.confirm('Close this chat? It will disappear from the user\'s navbar.')) return
    setBusy(true)
    try {
      await apiFetch(`${API}/api/chat/admin/conversations/${selectedId}/close`, {
        method: 'POST', credentials: 'include',
      })
      const [msgs, rows] = await Promise.all([fetchMessages(selectedId), fetchConversations()])
      setMessages(msgs)
      setConversations(rows)
      refreshUnread()
    } finally {
      setBusy(false)
    }
  }

  const handleReopen = async () => {
    if (!selectedId) return
    setBusy(true)
    try {
      await apiFetch(`${API}/api/chat/admin/conversations/${selectedId}/reopen`, {
        method: 'POST', credentials: 'include',
      })
      const [msgs, rows] = await Promise.all([fetchMessages(selectedId), fetchConversations()])
      setMessages(msgs)
      setConversations(rows)
      refreshUnread()
    } finally {
      setBusy(false)
    }
  }

  const handleStartWith = async (targetUserId) => {
    setBusy(true)
    try {
      const r = await apiFetch(`${API}/api/chat/admin/conversations`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: targetUserId }),
      })
      const d = await r.json().catch(() => null)
      if (d?.data?.conversation) {
        setSelectedId(d.data.conversation._id)
        const rows = await fetchConversations()
        setConversations(rows)
        setSearch('')
        setSearchResults([])
      }
    } finally {
      setBusy(false)
    }
  }

  const selected = useMemo(
    () => conversations.find(c => c._id === selectedId) ?? null,
    [conversations, selectedId],
  )

  return (
    <div className="max-w-6xl mx-auto h-[calc(100vh-8rem)] flex gap-3">
      {/* Left rail */}
      <div className="w-72 shrink-0 flex flex-col bg-surface rounded-2xl border border-slate-200 card-shadow overflow-hidden">
        <div className="px-3 py-3 border-b border-slate-200 space-y-2">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search user (email or agent #)…"
            className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none text-sm"
          />
          {search.trim() && (
            <div className="rounded-xl border border-slate-200 max-h-48 overflow-y-auto">
              {searching && <p className="text-xs text-slate-400 p-2">Searching…</p>}
              {!searching && searchResults.length === 0 && <p className="text-xs text-slate-400 p-2">No matches.</p>}
              {searchResults.map(u => (
                <button
                  key={u._id}
                  onClick={() => handleStartWith(u._id)}
                  className="w-full text-left px-2 py-1.5 hover:bg-slate-100 transition-colors"
                >
                  <p className="text-xs font-semibold text-slate-700 truncate">{u.email}</p>
                  <p className="text-[10px] text-slate-400">#{u.agentNumber || '—'}</p>
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-500">
            {['all', 'open', 'closed'].map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-2 py-1 rounded-lg ${statusFilter === s ? 'bg-brand-100 text-brand-600' : 'hover:bg-slate-100'}`}
              >
                {s[0].toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 && (
            <p className="text-xs text-slate-400 p-3 text-center">No chats yet.</p>
          )}
          {conversations.map(c => {
            const u = c.userId
            const label = u?.email || u?.agentNumber || 'Unknown user'
            return (
              <button
                key={c._id}
                onClick={() => setSelectedId(c._id)}
                className={`w-full text-left px-3 py-2 border-b border-slate-100 transition-colors ${selectedId === c._id ? 'bg-brand-100' : 'hover:bg-slate-100'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-700 truncate">{label}</p>
                  {c.hasAdminUnread && <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />}
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {c.status === 'closed' ? 'Closed · ' : ''}{formatTime(c.lastMessageAt)}
                </p>
              </button>
            )
          })}
        </div>
      </div>

      {/* Right pane */}
      <div className="flex-1 flex flex-col bg-surface rounded-2xl border border-slate-200 card-shadow overflow-hidden">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-sm text-slate-400">
            Select a conversation to begin.
          </div>
        ) : (
          <>
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wider truncate">
                  {selected.userId?.email || selected.userId?.agentNumber || 'Unknown user'}
                </p>
                <p className="text-[11px] text-slate-400">
                  {selected.status === 'closed' ? 'Closed' : 'Open'} ·
                  {' '}Started by {selected.startedByRole}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {selected.status === 'open' ? (
                  <button
                    type="button"
                    onClick={handleClose}
                    disabled={busy}
                    className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 transition-colors"
                  >
                    Close chat
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleReopen}
                    disabled={busy}
                    className="text-xs text-brand-600 hover:text-brand-700 px-2 py-1 rounded-lg border border-brand-200 hover:bg-brand-100 transition-colors"
                  >
                    Reopen
                  </button>
                )}
              </div>
            </div>

            <MessageList messages={messages} currentUserId={user?._id} viewer="admin" />

            {err && (
              <p className="text-xs text-red-600 bg-red-50 border-t border-red-200 px-3 py-2">{err}</p>
            )}

            <ComposeBox disabled={selected.status === 'closed'} busy={busy} onSend={handleSend} />
          </>
        )}
      </div>
    </div>
  )
}

// ── Page entry ───────────────────────────────────────────────────────────────

export default function Chat() {
  const { user } = useAuth()
  const { settings, loading: settingsLoading } = useAppSettings()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const initialUserId = searchParams.get('userId')

  // Redirect unauthenticated users to login (RequireAuth handles this in App.jsx,
  // but keep a defensive check for direct nav)
  useEffect(() => {
    if (!user) navigate('/login', { replace: true })
  }, [user, navigate])

  if (settingsLoading) return null

  if (settings && settings.chatEnabled === false) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <SEO title="Chat" description="Talk to the Skywatch team." />
        <div className="text-4xl mb-4">💬</div>
        <h1 className="text-2xl font-extrabold text-slate-900 mb-2">Chat is unavailable</h1>
        <p className="text-sm text-slate-500">The chat feature is currently disabled.</p>
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="px-2 py-4 md:py-6">
      <SEO title="Chat" description="Talk to the Skywatch team." />
      {user.isAdmin
        ? <AdminChatView initialUserId={initialUserId} />
        : <UserChatView />
      }
    </div>
  )
}
