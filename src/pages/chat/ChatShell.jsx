import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useChatUnread } from '../../context/ChatUnreadContext'
import { useGameBodyClass } from '../../hooks/useGameBodyClass'
import ChatSidebar from './ChatSidebar'
import ChatThread from './ChatThread'

const POLL_MS = 30_000

// Two-pane chat.
//
// Desktop shows the rail and the open conversation side by side, so switching
// channels is one click and you never lose your place. Mobile collapses to a
// single pane: the rail at /chat, the thread at /chat/:conversationId, with a
// back control in the thread header.
//
// Both panes live under the same two routes rather than separate pages, so a
// deep link, the browser back button and the desktop layout all agree on what
// "where am I" means. `hidden md:flex` on each pane is what does the collapsing
// — the same pattern AdminChatView uses.
//
// Note this needs the `chat-wide` body class to be worth anything: AppShell
// clamps every route to max-w-3xl, so a wider container here does nothing on
// its own. See the override in src/main.css.
export default function ChatShell() {
  const { conversationId } = useParams()
  const { API, apiFetch, user } = useAuth()
  const { refresh: refreshUnread } = useChatUnread()
  const navigate = useNavigate()

  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [err,     setErr]     = useState('')

  useGameBodyClass('chat-wide')

  const load = useCallback(async () => {
    const r = await apiFetch(`${API}/api/chat/overview`, { credentials: 'include' })
    const d = await r.json().catch(() => null)
    if (!r.ok) throw new Error(d?.message || 'Could not load chat')
    return d?.data ?? null
  }, [API, apiFetch])

  const refreshOverview = useCallback(() => {
    load().then(setData).catch(() => {})
    refreshUnread()
  }, [load, refreshUnread])

  useEffect(() => {
    let cancelled = false
    load()
      .then(d => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch(e => { if (!cancelled) { setErr(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [load])

  useEffect(() => {
    const tick = () => {
      if (document.hidden) return
      load().then(setData).catch(() => {})
    }
    const id = setInterval(tick, POLL_MS)
    return () => clearInterval(id)
  }, [load])

  // Deliberately no "refresh the badge whenever the overview changes" effect.
  // The badge is already refreshed at the two moments that actually change it:
  // ChatThread calls it after marking a conversation read, and refreshOverview
  // calls it after you send or delete. Firing it on every 30s overview poll as
  // well just doubled up on requests that return the same answer.

  // Opening a bot for the first time has no thread yet — create it, then go.
  const openBot = async (botUserId) => {
    const r = await apiFetch(`${API}/api/chat/dm`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: botUserId }),
    })
    const d = await r.json().catch(() => null)
    if (d?.data?.conversation) {
      refreshOverview()
      navigate(`/chat/${d.data.conversation._id}`)
    }
  }

  const startSupport = async () => {
    const r = await apiFetch(`${API}/api/chat/conversations`, {
      method: 'POST', credentials: 'include',
    })
    const d = await r.json().catch(() => null)
    if (d?.data?.conversation) navigate(`/chat/${d.data.conversation._id}`)
  }

  // The rail knows every conversation's human title; the messages endpoint only
  // knows a channel's own name. Resolving it here means the thread does not
  // need a second overview fetch just to render its header.
  const activeTitle = useMemo(() => {
    if (!conversationId || !data) return ''
    const all = [
      data.support,
      ...(data.channels ?? []),
      ...(data.dms ?? []),
      ...(data.bots ?? []).map(b => ({ _id: b.conversationId, title: b.title })),
    ].filter(Boolean)
    return all.find(c => String(c._id) === String(conversationId))?.title ?? ''
  }, [conversationId, data])

  if (loading) {
    return <div className="text-center py-12 text-sm text-slate-400">Loading…</div>
  }
  if (err) {
    return <div className="text-center py-12 text-sm text-red-600">{err}</div>
  }

  return (
    <div className="h-[calc(100dvh-11rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] flex md:gap-3">
      <div className={`w-full md:w-80 lg:w-96 md:shrink-0 ${conversationId ? 'hidden md:flex' : 'flex'} flex-col`}>
        <ChatSidebar
          support={data?.support}
          guides={data?.guides}
          channels={data?.channels}
          dms={data?.dms}
          bots={data?.bots}
          viewer={data?.viewer}
          activeId={conversationId}
          isAdmin={Boolean(user?.isAdmin)}
          onStartSupport={startSupport}
          onOpenBot={openBot}
        />
      </div>

      <div className={`flex-1 min-w-0 ${conversationId ? 'flex' : 'hidden md:flex'} flex-col`}>
        {conversationId ? (
          <ChatThread
            key={conversationId}
            conversationId={conversationId}
            title={activeTitle}
            displayNameRequired={Boolean(data?.viewer?.displayNameRequired)}
            onChanged={refreshOverview}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center bg-surface rounded-2xl border border-slate-200 card-shadow">
            <div className="text-center px-6">
              <div className="text-3xl mb-2">💬</div>
              <p className="text-sm font-bold text-slate-700">Pick a conversation</p>
              <p className="text-xs text-slate-400 mt-1">
                Channels are open to every agent. Tap a name in one to send a direct message.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
