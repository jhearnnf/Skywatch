import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useChatUnread } from '../../context/ChatUnreadContext'
import { getCachedThread, setCachedThread } from '../../utils/chatCache'
import MessageList from './components/MessageList'
import ComposeBox from './components/ComposeBox'
import DisplayNameGate from './components/DisplayNameGate'
import UserCard from './components/UserCard'
import ReportMessageDialog from './components/ReportMessageDialog'
import SeenByDialog from './components/SeenByDialog'
import ReactorsDialog from './components/ReactorsDialog'
import AnnouncementDrafter from './components/AnnouncementDrafter'

const POLL_MS = 5_000

// The right-hand pane. Owns its own messages and polling; everything it knows
// about the wider chat (its title, whether the viewer still needs a display
// name) comes from ChatShell, which already has the overview.
export default function ChatThread({
  conversationId, title, displayNameRequired, onChanged,
  // Admin-only presence, owned and polled by ChatShell so the rail and the
  // thread mark the same people online off one request.
  onlineIds = null,
}) {
  const { user, API, apiFetch } = useAuth()
  const { refresh: refreshUnread } = useChatUnread()
  const navigate = useNavigate()

  // Whatever this thread last looked like, so switching back to a channel you
  // have already opened paints instantly instead of blanking. ChatShell keys
  // this component on the conversation, so these initialisers re-run per thread
  // and each one gets its own cached copy or nothing.
  //
  // The read state below is deliberately NOT seeded: it is frozen at entry to
  // place the "new messages" divider, and a divider drawn from the last visit
  // would sit in the wrong place until the fetch corrected it. Better to draw
  // it once, late, than to draw it wrong first.
  const cached = getCachedThread(conversationId)

  const [messages,     setMessages]     = useState(cached?.messages     ?? [])
  const [senders,      setSenders]      = useState(cached?.senders      ?? {})
  const [conversation, setConversation] = useState(cached?.conversation ?? null)
  const [loading,      setLoading]      = useState(!cached)
  const [busy,         setBusy]         = useState(false)
  const [err,          setErr]          = useState('')
  const [needsName,    setNeedsName]    = useState(false)
  const [cardUserId,   setCardUserId]   = useState(null)
  const [reporting,    setReporting]    = useState(null)
  const [reportDone,   setReportDone]   = useState(false)
  // Set when the block action is used from a message rather than from a name:
  // the card is the confirm step, so the message action simply opens it on the
  // sender instead of duplicating the explanation.
  const [blockDone,    setBlockDone]    = useState(false)
  const [replyTo,      setReplyTo]      = useState(null)
  const [seenByMsg,    setSeenByMsg]    = useState(null)
  const [reactorsMsg,  setReactorsMsg]  = useState(null)
  // Both frozen at entry. The server's answers change the moment we mark the
  // conversation read, so if these tracked the polls the "new" line would creep
  // down the screen and the mention banner would vanish while being read.
  const [entryState,   setEntryState]   = useState(null)
  const [highlightId,  setHighlightId]  = useState(null)
  const [jumping,      setJumping]      = useState(false)
  // Two sources: the server's own flag, picked up by the poll, and an
  // optimistic local one set the moment you send a message that asks the bot
  // something — otherwise the indicator would not appear for up to a poll,
  // which is most of the wait it exists to explain.
  const [botTyping,    setBotTyping]    = useState(null)
  const [askedBot,     setAskedBot]     = useState(null)

  const fetchMessages = useCallback(async ({ limit } = {}) => {
    const qs = limit ? `?limit=${limit}` : ''
    const r = await apiFetch(`${API}/api/chat/conversations/${conversationId}/messages${qs}`, {
      credentials: 'include',
    })
    const d = await r.json().catch(() => null)
    if (!r.ok) throw new Error(d?.message || 'Could not load this conversation')
    const data = d?.data ?? { messages: [], conversation: null, senders: {} }
    // Cached here rather than at each call site so every path that refreshes
    // the thread — the poll, a moderator delete, the mention jump — leaves the
    // cache agreeing with the screen.
    setCachedThread(conversationId, {
      messages:     data.messages,
      senders:      data.senders ?? {},
      conversation: data.conversation,
    })
    return data
  }, [API, apiFetch, conversationId])

  const markRead = useCallback(() => {
    apiFetch(`${API}/api/chat/conversations/${conversationId}/read`, {
      method: 'POST', credentials: 'include',
    }).then(() => refreshUnread()).catch(() => {})
  }, [API, apiFetch, conversationId, refreshUnread])

  useEffect(() => {
    let cancelled = false
    setLoading(true); setErr('')
    fetchMessages()
      .then(d => {
        if (cancelled) return
        setMessages(d.messages)
        setSenders(d.senders ?? {})
        setConversation(d.conversation)
        setEntryState({
          lastReadAt:         d.lastReadAt ?? null,
          unreadMentionCount: d.unreadMentionCount ?? 0,
          firstUnreadMention: d.firstUnreadMention ?? null,
        })
        setLoading(false)
        markRead()
      })
      .catch(e => { if (!cancelled) { setErr(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [fetchMessages, markRead])

  // Compares a signature rather than just the length, so a moderator deleting
  // or editing a message — either of which changes the content without changing
  // the count — still refreshes the view. `editedAt` rather than the `edited`
  // flag, so a second edit of an already-edited message lands too.
  useEffect(() => {
    const signature = (list) => list
      .map(m => `${m._id}:${m.deleted ? 'x' : ''}${m.editedAt ?? ''}`)
      .join(',')

    const tick = async () => {
      if (document.hidden) return
      try {
        const d = await fetchMessages()
        setMessages(prev => (signature(prev) === signature(d.messages) ? prev : d.messages))
        setSenders(d.senders ?? {})
        setBotTyping(d.botTyping ?? null)
        // The server is now authoritative again, so drop the optimistic flag.
        // A poll that reports no reply in flight means the bot either answered
        // or decided to stay quiet — either way the indicator has done its job.
        if (!d.botTyping) setAskedBot(null)
        const newest = d.messages[d.messages.length - 1]
        if (newest && String(newest.senderUserId) !== String(user?._id)) markRead()
      } catch { /* transient — the next tick retries */ }
    }
    const id = setInterval(tick, POLL_MS)
    return () => clearInterval(id)
  }, [fetchMessages, markRead, user])

  // Backstop for the optimistic flag. Normally the next poll takes it down;
  // this covers a run of failed polls, so the indicator can never be left
  // running forever on a bot that already gave up.
  useEffect(() => {
    if (!askedBot) return
    const id = setTimeout(() => setAskedBot(null), 45_000)
    return () => clearTimeout(id)
  }, [askedBot])

  const handleSend = async (text) => {
    setBusy(true); setErr('')
    try {
      const r = await apiFetch(`${API}/api/chat/conversations/${conversationId}/messages`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text, replyToId: replyTo?._id ?? null }),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok) {
        // The server is the authority on whether a name is needed — a user can
        // arrive here with a stale client state.
        if (d?.code === 'DISPLAY_NAME_REQUIRED') { setNeedsName(true); return }
        throw new Error(d?.message || 'Failed to send')
      }
      // The POST already returns the created message, so appending it beats
      // re-downloading the whole thread. The 5s poll reconciles anything that
      // arrived from someone else in the meantime.
      setReplyTo(null)
      if (d?.data?.botReplyingName) setAskedBot(d.data.botReplyingName)
      if (d?.data?.message) {
        setMessages(prev => [...prev, d.data.message])
        // Your first message in a thread wouldn't be in the sender map yet, so
        // your avatar would pop in a poll later. Seed it from the live user.
        setSenders(prev => prev[String(user?._id)] ? prev : {
          ...prev,
          [String(user?._id)]: {
            _id:           user?._id,
            displayName:   user?.displayName ?? null,
            agentNumber:   user?.agentNumber ?? null,
            selectedBadge: user?.selectedBadge ?? null,
            rank:          user?.rank ?? null,
          },
        })
      }
      onChanged?.()
    } catch (e) {
      setErr(e.message || 'Failed to send')
    } finally {
      setBusy(false)
    }
  }

  const handleClose = async () => {
    if (!window.confirm('Close this chat? You can start a new one anytime.')) return
    setBusy(true)
    try {
      await apiFetch(`${API}/api/chat/conversations/${conversationId}/close`, {
        method: 'POST', credentials: 'include',
      })
      const fresh = await fetchMessages()
      setMessages(fresh.messages)
      setSenders(fresh.senders ?? {})
      setConversation(fresh.conversation)
      onChanged?.()
    } finally {
      setBusy(false)
    }
  }

  // Reactions are the only way to interact with a bot feed, so they work even
  // where the composer is hidden. Swap the single message in place rather than
  // refetching the thread — the response carries the updated counts.
  const handleReact = async (message, emoji) => {
    const r = await apiFetch(`${API}/api/chat/messages/${message._id}/reactions`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji }),
    }).catch(() => null)
    const d = await r?.json().catch(() => null)
    if (!r?.ok) { setErr(d?.message || 'Could not add that reaction'); return }
    setMessages(prev => prev.map(m => (m._id === d.data.message._id ? d.data.message : m)))
  }

  // Scroll to the oldest message that mentioned the viewer.
  //
  // It may well be older than the 50 messages on screen — which is the whole
  // reason this control exists rather than leaving people to scroll. When it is
  // not loaded, pull a bigger page first and then jump.
  const jumpToMention = async () => {
    const target = entryState?.firstUnreadMention
    if (!target) return

    const scroll = (id) => {
      const el = document.getElementById(`msg-${id}`)
      if (!el) return false
      el.scrollIntoView({ block: 'center' })
      setHighlightId(id)
      return true
    }

    if (scroll(target._id)) return

    setJumping(true)
    try {
      const d = await fetchMessages({ limit: 200 })
      setMessages(d.messages)
      setSenders(d.senders ?? {})
      // The DOM has not painted the new rows yet, so the scroll waits a frame.
      requestAnimationFrame(() => { scroll(target._id) })
    } catch {
      setErr('Could not load far enough back to find that message.')
    } finally {
      setJumping(false)
    }
  }

  // Admin correction. The response carries the updated message, so swap it in
  // place rather than refetching — the 5s poll would otherwise briefly show the
  // old text back again on a slow round trip.
  const handleEdit = async (message, body) => {
    setErr('')
    const r = await apiFetch(`${API}/api/chat/admin/messages/${message._id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    }).catch(() => null)
    const d = await r?.json().catch(() => null)
    if (!r?.ok) { setErr(d?.message || 'Could not edit that message'); return }
    setMessages(prev => prev.map(m => (m._id === d.data.message._id ? d.data.message : m)))
    onChanged?.()
  }

  const handleDelete = async (message) => {
    if (!window.confirm('Remove this message for everyone? Admins can still see it.')) return
    await apiFetch(`${API}/api/chat/admin/messages/${message._id}`, {
      method: 'DELETE', credentials: 'include',
    }).catch(() => {})
    const fresh = await fetchMessages()
    setMessages(fresh.messages)
    setSenders(fresh.senders ?? {})
    onChanged?.()
  }

  const type       = conversation?.type ?? 'support'
  const isClosed   = type === 'support' && conversation?.status === 'closed'
  const isArchived = Boolean(conversation?.isArchived)
  // Announcements board: everyone reads, only staff post.
  const postPolicy  = conversation?.postPolicy ?? 'everyone'
  const isAdminOnly = Boolean(conversation?.adminOnly)
  // A feed nobody can reply to — offering reply would suggest a conversation
  // that will not happen.
  const canPost = postPolicy === 'everyone' || (postPolicy === 'admin' && user?.isAdmin)
  // Support never asks for a display name — see postRefusal() in routes/chat.js.
  const gateOnName = (needsName || displayNameRequired) && type !== 'support'

  const heading = title || conversation?.title || 'Chat'
  const mentionCount = entryState?.firstUnreadMention ? (entryState.unreadMentionCount ?? 0) : 0

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-surface rounded-2xl border border-slate-200 card-shadow overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
        <div className="min-w-0 flex items-center gap-2">
          {/* Desktop keeps the rail on screen, so there is nothing to go back
              to — the control is mobile-only. */}
          <button
            type="button"
            onClick={() => navigate('/chat')}
            className="md:hidden shrink-0 text-slate-500 hover:text-slate-700 px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 transition-colors text-xs font-semibold"
            aria-label="Back to chat list"
          >
            ← Back
          </button>
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-700 truncate">{heading}</p>
            <p className="text-[11px] text-slate-400">
              {isArchived ? 'Archived channel'
                : isClosed ? 'This chat is closed'
                  : postPolicy === 'bot' ? 'Automatic feed - react rather than reply'
                  : isAdminOnly ? 'Updates from the SkyWatch team'
                    : type === 'channel' ? 'Everyone can see this channel'
                      : type === 'dm' ? 'Direct message'
                        : 'Usually replies within a few hours'}
            </p>
          </div>
        </div>
        {type === 'support' && !isClosed && (
          <button
            type="button"
            onClick={handleClose}
            disabled={busy}
            className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 transition-colors shrink-0"
          >
            Close chat
          </button>
        )}
      </div>

      {/* Someone addressed you while you were away. Shown on entry and
          dismissible, because the mention may be far enough up the channel that
          scrolling to find it is not obvious. */}
      {mentionCount > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-100/60 border-b border-amber-200">
          <span className="text-xs font-semibold text-amber-800">
            {mentionCount === 1
              ? 'You were mentioned while you were away'
              : `You were mentioned ${mentionCount} times while you were away`}
          </span>
          <button
            type="button"
            onClick={jumpToMention}
            disabled={jumping}
            className="ml-auto shrink-0 text-[11px] font-bold px-2 py-1 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white transition-colors"
          >
            {jumping ? 'Finding…' : 'Scroll up to it'}
          </button>
          <button
            type="button"
            onClick={() => setEntryState(s => ({ ...s, unreadMentionCount: 0 }))}
            className="shrink-0 text-amber-700 hover:text-amber-800 px-1"
            aria-label="Dismiss mention notice"
          >
            ✕
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-sm text-slate-400">Loading…</div>
      ) : err && !conversation ? (
        <div className="flex-1 flex items-center justify-center text-sm text-red-600 px-6 text-center">{err}</div>
      ) : (
        <MessageList
          messages={messages}
          currentUserId={user?._id}
          conversationType={type}
          viewerIsAdmin={Boolean(user?.isAdmin)}
          senders={senders}
          onlineIds={onlineIds}
          onOpenUser={setCardUserId}
          onReply={canPost ? setReplyTo : undefined}
          onReact={handleReact}
          onReport={m => { setReportDone(false); setReporting(m) }}
          onBlock={m => { setBlockDone(false); setCardUserId(m.senderUserId) }}
          onDelete={user?.isAdmin ? handleDelete : undefined}
          onEdit={user?.isAdmin ? handleEdit : undefined}
          onSeenBy={setSeenByMsg}
          // Admin-only. MessageList gates the button on viewerIsAdmin too; this
          // just keeps the handler off every other viewer's rows entirely.
          onShowReactors={user?.isAdmin ? setReactorsMsg : undefined}
          dividerAfter={entryState?.lastReadAt ?? null}
          highlightId={highlightId}
          typingName={botTyping || askedBot}
          // A feed is a log, not a conversation: every entry is from the same
          // poster, so each one keeps its own name and timestamp. That covers
          // the bot feeds and the announcements board alike — grouping two
          // announcements posted a fortnight apart under one heading would hide
          // when the second one went up.
          groupRuns={postPolicy === 'everyone'}
          // Announcements are dated records, so they carry the full stamp.
          datedStamps={postPolicy === 'admin'}
          emptyLabel={type === 'channel'
            ? 'Nothing here yet — be the first to post.'
            : 'No messages yet — say hi to get started.'}
        />
      )}

      {err && conversation && (
        <p className="text-xs text-red-600 bg-red-50 border-t border-red-200 px-3 py-2">{err}</p>
      )}
      {reportDone && (
        <p className="text-xs text-emerald-700 bg-emerald-50 border-t border-emerald-200 px-3 py-2">
          Thanks — the SkyWatch team will review that message.
        </p>
      )}
      {blockDone && (
        <p className="text-xs text-slate-600 bg-slate-100 border-t border-slate-200 px-3 py-2">
          Blocked. You can undo this under Blocked Agents in your profile.
        </p>
      )}

      {isArchived ? (
        <div className="border-t border-slate-200 p-3 text-center">
          <p className="text-xs text-slate-500">This channel has been archived.</p>
        </div>
      ) : isClosed ? (
        <div className="border-t border-slate-200 p-3 text-center">
          <p className="text-xs text-slate-500">This chat has been closed. Start a new one from Support.</p>
        </div>
      ) : postPolicy === 'bot' ? (
        <div className="border-t border-slate-200 p-3 text-center">
          <p className="text-xs text-slate-500">
            This channel is a feed. React to a message to join in.
          </p>
        </div>
      ) : isAdminOnly ? (
        user?.isAdmin ? (
          <AnnouncementDrafter
            conversationId={conversationId}
            onPosted={async () => {
              const fresh = await fetchMessages()
              setMessages(fresh.messages)
              onChanged?.()
            }}
          />
        ) : (
          <div className="border-t border-slate-200 p-3 text-center">
            <p className="text-xs text-slate-500">
              Only the SkyWatch team posts here. Head to a channel to join the conversation.
            </p>
          </div>
        )
      ) : gateOnName ? (
        <DisplayNameGate onDone={() => { setNeedsName(false); onChanged?.() }} />
      ) : (
        <ComposeBox
          disabled={loading}
          busy={busy}
          onSend={handleSend}
          replyTo={replyTo}
          senders={senders}
          onCancelReply={() => setReplyTo(null)}
          // No @ picker in support: it is a private thread with staff, so there
          // is nobody to mention and no bot to summon.
          mentionConversationId={type === 'support' ? null : conversationId}
        />
      )}

      {cardUserId && (
        <UserCard
          userId={cardUserId}
          onClose={() => setCardUserId(null)}
          onOpenDm={(id) => { setCardUserId(null); navigate(`/chat/${id}`); onChanged?.() }}
          // Their messages have just left (or rejoined) this thread server-side,
          // so refetch rather than waiting up to 5s for the poll to notice.
          onBlockChanged={(blocked) => {
            setBlockDone(blocked)
            fetchMessages()
              .then(d => { setMessages(d.messages); setSenders(d.senders ?? {}) })
              .catch(() => {})
            onChanged?.()
          }}
        />
      )}
      {seenByMsg && (
        <SeenByDialog key={seenByMsg._id} message={seenByMsg} onClose={() => setSeenByMsg(null)} />
      )}
      {reactorsMsg && (
        <ReactorsDialog key={reactorsMsg._id} message={reactorsMsg} onClose={() => setReactorsMsg(null)} />
      )}
      {reporting && (
        <ReportMessageDialog
          message={reporting}
          senders={senders}
          onClose={() => setReporting(null)}
          onReported={() => { setReporting(null); setReportDone(true) }}
        />
      )}
    </div>
  )
}
