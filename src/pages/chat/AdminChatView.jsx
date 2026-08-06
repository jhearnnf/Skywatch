import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useChatUnread } from '../../context/ChatUnreadContext'
import MessageList from './components/MessageList'
import ComposeBox from './components/ComposeBox'
import { agentLabel, formatTime } from './format'

const POLL_MESSAGES_MS = 10_000

const TYPE_TABS = [
  { id: 'support', label: 'Support'  },
  { id: 'channel', label: 'Channels' },
  { id: 'dm',      label: 'DMs'      },
]

// The moderation console: every conversation of every type, readable by any
// admin. Regular chat use (posting in channels, DMs) happens in the ordinary
// ChatShell view — admins are participants there like anyone else.
export default function AdminChatView() {
  const { user, API, apiFetch } = useAuth()
  const { refresh: refreshUnread } = useChatUnread()
  const [searchParams] = useSearchParams()
  const initialUserId = searchParams.get('userId')

  // Deep link from a chat report in Admin › Intel › Reports.
  const initialConversationId = searchParams.get('conversationId')

  const [conversations, setConversations] = useState([])
  const [typeFilter,    setTypeFilter]    = useState('support')
  const [statusFilter,  setStatusFilter]  = useState('all')
  const [selectedId,    setSelectedId]    = useState(null)
  const [messages,      setMessages]      = useState([])
  const [senders,       setSenders]       = useState({})
  const [busy,          setBusy]          = useState(false)
  const [err,           setErr]           = useState('')
  // Guards against React 18 StrictMode double-invoking the initialUserId effect
  // and creating two conversations before the first POST lands.
  const resolvedInitialRef = useRef(null)

  const [search,        setSearch]        = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching,     setSearching]     = useState(false)

  const fetchConversations = useCallback(async () => {
    const params = new URLSearchParams({ type: typeFilter, limit: '100' })
    if (typeFilter === 'support') params.set('status', statusFilter)
    const r = await apiFetch(`${API}/api/chat/admin/conversations?${params}`, { credentials: 'include' })
    const d = await r.json().catch(() => null)
    return d?.data?.conversations ?? []
  }, [API, apiFetch, typeFilter, statusFilter])

  const fetchMessages = useCallback(async (id) => {
    if (!id) return { messages: [], conversation: null, senders: {} }
    const r = await apiFetch(`${API}/api/chat/conversations/${id}/messages`, { credentials: 'include' })
    const d = await r.json().catch(() => null)
    return d?.data ?? { messages: [], conversation: null, senders: {} }
  }, [API, apiFetch])

  useEffect(() => {
    let cancelled = false
    fetchConversations().then(rows => { if (!cancelled) setConversations(rows) })
    return () => { cancelled = true }
  }, [fetchConversations])

  // A reported message can live in any kind of conversation, so arriving with
  // ?conversationId= has to switch the type tab to the one that will list it —
  // otherwise the thread loads but its row is missing from the rail.
  useEffect(() => {
    if (!initialConversationId) return
    let cancelled = false
    apiFetch(`${API}/api/chat/conversations/${initialConversationId}/messages?limit=1`, {
      credentials: 'include',
    })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        const type = d?.data?.conversation?.type
        if (cancelled || !type) return
        setTypeFilter(type)
        setSelectedId(initialConversationId)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [API, apiFetch, initialConversationId])

  // Resolve ?userId= (from Admin › Users) into a coalesced support chat.
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
      .then(r => (r.ok ? r.json() : null))
      .then(async d => {
        if (cancelled || !d?.data?.conversation) return
        setSelectedId(d.data.conversation._id)
        const rows = await fetchConversations()
        if (!cancelled) setConversations(rows)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [API, apiFetch, initialUserId, fetchConversations])

  useEffect(() => {
    if (!selectedId) { setMessages([]); return }
    let cancelled = false
    fetchMessages(selectedId).then(d => {
      if (cancelled) return
      setMessages(d.messages)
      setSenders(d.senders ?? {})
      apiFetch(`${API}/api/chat/conversations/${selectedId}/read`, {
        method: 'POST', credentials: 'include',
      }).then(() => refreshUnread()).catch(() => {})
      fetchConversations().then(rows => { if (!cancelled) setConversations(rows) })
    })
    return () => { cancelled = true }
  }, [API, apiFetch, selectedId, fetchMessages, fetchConversations, refreshUnread])

  useEffect(() => {
    if (!selectedId) return
    const tick = async () => {
      if (document.hidden) return
      const d = await fetchMessages(selectedId)
      setMessages(prev => (prev.length === d.messages.length ? prev : d.messages))
      setSenders(d.senders ?? {})
    }
    const id = setInterval(tick, POLL_MESSAGES_MS)
    return () => clearInterval(id)
  }, [selectedId, fetchMessages])

  useEffect(() => {
    if (!search.trim()) { setSearchResults([]); return }
    setSearching(true)
    let cancelled = false
    const t = setTimeout(() => {
      apiFetch(`${API}/api/admin/users/search?q=${encodeURIComponent(search.trim())}`, { credentials: 'include' })
        .then(r => (r.ok ? r.json() : null))
        .then(d => { if (!cancelled) setSearchResults(d?.data?.users ?? []) })
        .catch(() => {})
        .finally(() => { if (!cancelled) setSearching(false) })
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [API, apiFetch, search])

  const refreshBoth = useCallback(async () => {
    const [d, rows] = await Promise.all([fetchMessages(selectedId), fetchConversations()])
    setMessages(d.messages)
    setSenders(d.senders ?? {})
    setConversations(rows)
  }, [fetchMessages, fetchConversations, selectedId])

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
      await refreshBoth()
      refreshUnread()
    } catch (e) {
      setErr(e.message || 'Failed to send')
    } finally {
      setBusy(false)
    }
  }

  const handleClose = async () => {
    if (!window.confirm('Close this chat? It will disappear from the user\'s navbar.')) return
    setBusy(true)
    try {
      await apiFetch(`${API}/api/chat/admin/conversations/${selectedId}/close`, {
        method: 'POST', credentials: 'include',
      })
      await refreshBoth()
      refreshUnread()
    } finally { setBusy(false) }
  }

  const handleReopen = async () => {
    setBusy(true)
    try {
      await apiFetch(`${API}/api/chat/admin/conversations/${selectedId}/reopen`, {
        method: 'POST', credentials: 'include',
      })
      await refreshBoth()
      refreshUnread()
    } finally { setBusy(false) }
  }

  const handleDelete = async (message) => {
    if (!window.confirm('Remove this message for everyone? You will still see it here.')) return
    await apiFetch(`${API}/api/chat/admin/messages/${message._id}`, {
      method: 'DELETE', credentials: 'include',
    }).catch(() => {})
    await refreshBoth()
  }

  const handleChatBan = async (targetUserId, targetLabel) => {
    const reason = window.prompt(`Ban ${targetLabel} from channels and DMs?\n\nReason (shown to them):`)
    if (reason === null) return
    await apiFetch(`${API}/api/chat/admin/users/${targetUserId}/chat-ban`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    }).catch(() => {})
    await refreshBoth()
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
        setTypeFilter('support')
        setSelectedId(d.data.conversation._id)
        setConversations(await fetchConversations())
        setSearch('')
        setSearchResults([])
      }
    } finally { setBusy(false) }
  }

  const selected = useMemo(
    () => conversations.find(c => c._id === selectedId) ?? null,
    [conversations, selectedId],
  )

  const rowLabel = (c) => {
    if (c.type === 'channel') return c.title || c.channel?.name || 'Channel'
    if (c.type === 'dm') {
      return (c.participantIds ?? []).map(p => agentLabel(p)).join(' ↔ ') || 'Direct message'
    }
    return c.userId?.email || c.userId?.displayName || c.userId?.agentNumber || 'Unknown user'
  }

  // The other party in a DM, or the owner of a support thread — whoever a ban
  // would apply to. Channels have no single subject, so no ban button there.
  const banTarget = (c) => {
    if (!c) return null
    if (c.type === 'support' && c.userId) return { _id: c.userId._id, label: agentLabel(c.userId) }
    if (c.type === 'dm') {
      const other = (c.participantIds ?? []).find(p => String(p._id) !== String(user?._id))
      return other ? { _id: other._id, label: agentLabel(other) } : null
    }
    return null
  }
  const target = banTarget(selected)

  return (
    <div className="h-[calc(100dvh-11rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] flex md:gap-3">
      <div className={`w-full md:w-72 md:shrink-0 ${selectedId ? 'hidden md:flex' : 'flex'} flex-col bg-surface rounded-2xl border border-slate-200 card-shadow overflow-hidden`}>
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
            {TYPE_TABS.map(t => (
              <button
                key={t.id}
                onClick={() => { setTypeFilter(t.id); setSelectedId(null) }}
                className={`px-2 py-1 rounded-lg ${typeFilter === t.id ? 'bg-brand-100 text-brand-600' : 'hover:bg-slate-100'}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {typeFilter === 'support' && (
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
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 && (
            <p className="text-xs text-slate-400 p-3 text-center">Nothing here.</p>
          )}
          {conversations.map(c => (
            <button
              key={c._id}
              onClick={() => setSelectedId(c._id)}
              className={`w-full text-left px-3 py-2 border-b border-slate-100 transition-colors ${selectedId === c._id ? 'bg-brand-100' : 'hover:bg-slate-100'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-slate-700 truncate">{rowLabel(c)}</p>
                {c.hasAdminUnread && <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />}
              </div>
              <p className="text-[10px] text-slate-400 mt-0.5">
                {c.type === 'support' && c.status === 'closed' ? 'Closed · ' : ''}
                {c.isArchived ? 'Archived · ' : ''}
                {formatTime(c.lastMessageAt)}
              </p>
            </button>
          ))}
        </div>
      </div>

      <div className={`flex-1 ${selected ? 'flex' : 'hidden md:flex'} flex-col bg-surface rounded-2xl border border-slate-200 card-shadow overflow-hidden`}>
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-sm text-slate-400">
            Select a conversation to begin.
          </div>
        ) : (
          <>
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
              <div className="min-w-0 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="md:hidden shrink-0 text-slate-500 hover:text-slate-700 px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 transition-colors text-xs font-semibold"
                  aria-label="Back to conversation list"
                >
                  ← Back
                </button>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-600 uppercase tracking-wider truncate">
                    {rowLabel(selected)}
                  </p>
                  <p className="text-[11px] text-slate-400 capitalize">
                    {selected.type}
                    {selected.type === 'support' ? ` · ${selected.status}` : ''}
                    {selected.isArchived ? ' · archived' : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {target && (
                  <button
                    type="button"
                    onClick={() => handleChatBan(target._id, target.label)}
                    disabled={busy}
                    className="text-xs text-red-600 hover:text-red-700 px-2 py-1 rounded-lg border border-red-200 hover:bg-red-50 transition-colors"
                  >
                    Chat ban
                  </button>
                )}
                {selected.type === 'support' && (selected.status === 'open' ? (
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
                ))}
              </div>
            </div>

            <MessageList
              messages={messages}
              currentUserId={user?._id}
              conversationType={selected.type}
              viewerIsAdmin
              senders={senders}
              onDelete={handleDelete}
              emptyLabel="No messages in this conversation."
            />

            {err && (
              <p className="text-xs text-red-600 bg-red-50 border-t border-red-200 px-3 py-2">{err}</p>
            )}

            {selected.type === 'support' ? (
              <ComposeBox disabled={selected.status === 'closed'} busy={busy} onSend={handleSend} />
            ) : (
              // Reading a channel or DM here is moderation, not participation —
              // admins post in channels from the ordinary chat view, under their
              // own name, and nobody should be able to inject a message into
              // someone else's DM.
              <div className="border-t border-slate-200 p-3 text-center">
                <p className="text-[11px] text-slate-400">
                  Read-only transcript. {selected.type === 'channel'
                    ? 'Post in this channel from the chat page.'
                    : 'Admins cannot post into a direct message.'}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
