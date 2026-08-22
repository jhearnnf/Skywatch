import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useChatUnread } from '../../context/ChatUnreadContext'
import { useGameBodyClass } from '../../hooks/useGameBodyClass'
import useChatPresence from '../../hooks/useChatPresence'
import { fetchOverview, getCachedOverview, syncChatCacheOwner } from '../../utils/chatCache'
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
  const { refresh: refreshUnread, totalUnreadConversations: supportQueueUnread = 0 } = useChatUnread()
  const navigate = useNavigate()

  // Seeded from the last copy of the rail — either the one this session already
  // fetched, or the one the nav prefetched when you hovered Community. The load
  // below still runs and still wins; this only decides whether you look at the
  // rail or at a spinner while it does. Read once, at mount, before any effect:
  // the owner check has to happen before a stale rail can reach the screen.
  const [data,    setData]    = useState(() => {
    syncChatCacheOwner(user?._id)
    return getCachedOverview()
  })
  const [loading, setLoading] = useState(() => !data)
  const [err,     setErr]     = useState('')

  useGameBodyClass('chat-wide')

  // Admin only, and gated here rather than inside the hook so a normal member
  // never issues the request at all — see GET /api/chat/presence for why members
  // do not get this yet.
  const presence = useChatPresence(Boolean(user?.isAdmin))

  const load = useCallback(() => fetchOverview(API, apiFetch), [API, apiFetch])

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

  // Open a DM with someone, creating the thread if this is the first one.
  // Shared by the bot rows and the admin search, since POST /dm coalesces on
  // the participant key either way.
  const openDm = async (userId) => {
    const r = await apiFetch(`${API}/api/chat/dm`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
    const d = await r.json().catch(() => null)
    if (!r.ok || !d?.data?.conversation) {
      throw new Error(d?.message || 'Could not open that conversation')
    }
    refreshOverview()
    navigate(`/chat/${d.data.conversation._id}`)
  }

  // The bot rows have nowhere to show an error, and never had one — a failure
  // there just leaves the rail as it was.
  const openBot = (botUserId) => openDm(botUserId).catch(() => {})

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

  // Only a genuinely cold rail — nothing cached, nothing prefetched — gets the
  // whole page. With a copy to show, a failed refresh keeps the rail on screen
  // rather than replacing it with an error, which is what the 30s poll above
  // has always done with its own failures.
  if (err && !data) {
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
          // Only true on a cold rail. Without it the empty lists would render
          // as "No channels yet" — an answer, and the wrong one, to a question
          // the request has not come back with.
          loading={loading && !data}
          activeId={conversationId}
          isAdmin={Boolean(user?.isAdmin)}
          // Support threads waiting on a staff reply. They are what an admin's
          // navbar badge is often counting, and they live in the console rather
          // than in this rail — so the rail has to say where to go, or the badge
          // points at a page that looks empty.
          supportQueueUnread={supportQueueUnread}
          presence={presence}
          onStartSupport={startSupport}
          onOpenBot={openBot}
          onOpenDm={openDm}
        />
      </div>

      <div className={`flex-1 min-w-0 ${conversationId ? 'flex' : 'hidden md:flex'} flex-col`}>
        {conversationId ? (
          <ChatThread
            key={conversationId}
            conversationId={conversationId}
            title={activeTitle}
            displayNameRequired={Boolean(data?.viewer?.displayNameRequired)}
            onlineIds={presence.onlineIds}
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
