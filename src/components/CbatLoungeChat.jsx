import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useAppSettings } from '../context/AppSettingsContext'
import { nameColour } from '../pages/chat/nameColour'
import { formatTime } from '../pages/chat/format'
import { splitMentions, activeMention } from '../pages/chat/mentions'
import { senderName } from '../pages/chat/senderName'
import { REACTION_EMOJI } from '../pages/chat/reactionEmoji'
import DisplayNameGate from '../pages/chat/components/DisplayNameGate'
import SeenByDialog from '../pages/chat/components/SeenByDialog'
import MentionPicker from '../pages/chat/components/MentionPicker'

// The mini chat docked under Recent Scores on the CBAT hub.
//
// It is a second, smaller view of a real channel (slug 'cbat-lounge', seeded in
// backend/seeds/seedCbatLounge.js) rather than a store of its own, so moderation,
// reporting, mentions and the guide bot all work here without being rebuilt. The
// full-size room is in Community; this is the version you can keep an eye on
// while you pick a game.
//
// Live rather than polled: it holds one EventSource on the conversation and the
// server pushes. Polling is kept as a fallback for a stream that will not open
// (a proxy that buffers it, or the server's connection ceiling), because a chat
// that silently stops updating is worse than a slow one.

const MESSAGE_LIMIT = 40
// Only used when the stream is down. Deliberately slower than the main thread's
// 5s: this is a degraded mode on a page whose real job is the games.
const FALLBACK_POLL_MS = 10_000
// The activity counters are a 7-day and a same-day figure, so they barely move
// within a session. Slow on purpose.
const ACTIVITY_REFRESH_MS = 5 * 60_000

// How busy the site has been, under the lounge header.
//
// Both numbers are counted, never padded, and both are cumulative rather than a
// live "N online" — see backend/utils/cbatActivityStats.js for the reasoning. It
// renders nothing at all when the server reports a quiet week, because a real
// but tiny number answers "is anyone here" with a no.
function ActivityStrip({ activity }) {
  const plays7d = activity?.plays7d
  const agentsToday = activity?.agentsToday
  if (!Number.isFinite(plays7d) || activity.quiet) return null

  const parts = [`${plays7d.toLocaleString()} ${plays7d === 1 ? 'game' : 'games'} played this week`]
  if (agentsToday > 0) {
    parts.push(`${agentsToday.toLocaleString()} ${agentsToday === 1 ? 'agent' : 'agents'} today`)
  }

  return (
    <p className="shrink-0 px-4 py-1.5 border-b border-[#1a3a5c] text-[10px] text-slate-500 truncate">
      {parts.join(' · ')}
    </p>
  )
}

// What you are answering, above the message. The quote is the snapshot the
// server took at send time, so it still reads correctly when the parent has
// scrolled out of the 40-message window this panel holds — named live where
// the author still has an account (see ../pages/chat/senderName).
function ReplyQuote({ replyTo, senders }) {
  return (
    <span className="flex items-center gap-1 text-[10px] text-slate-500 min-w-0">
      <span className="shrink-0" aria-hidden="true">↰</span>
      <span className="font-semibold shrink-0">
        {senderName(replyTo.userId, senders, replyTo.displayName) || 'Unknown agent'}
      </span>
      <span className="truncate">{replyTo.excerpt || 'message unavailable'}</span>
    </span>
  )
}

// Message text with any @mentions picked out, exactly as the full room renders
// them: a mention of YOU is loud, a mention of someone else is only tinted.
function MessageBody({ message, senders, currentUserId }) {
  const mentioned = (message.mentions ?? []).map(id => senders[String(id)]).filter(Boolean)
  if (!mentioned.length) return <>{message.body}</>

  return splitMentions(message.body, mentioned).map((run, i) => {
    if (!run.user) return <span key={i}>{run.text}</span>
    const isMe = String(run.user._id) === String(currentUserId)
    return (
      <span
        key={i}
        className={`rounded px-0.5 font-semibold ${isMe ? 'bg-brand-200/70 text-brand-800' : 'text-brand-600'}`}
      >
        {run.text}
      </span>
    )
  })
}

// Reaction chips, plus the picker.
//
// The picker opens INLINE, replacing the hover bar, rather than as a popup: the
// message list is an `overflow-y-auto` box a few hundred pixels tall, so a
// floating palette would be clipped at whichever end of it you reached for —
// and the messages you actually react to sit at the bottom edge.
function Reactions({ message, onReact, picking, onPick }) {
  const list = message.reactions ?? []
  // `picking` is gated on being able to post, but the right to post can be
  // taken away mid-session — so the palette is tied to onReact, not to the
  // picker state that opened it.
  const offering = picking && Boolean(onReact)
  if (!list.length && !offering) return null

  return (
    <span className="flex flex-wrap items-center gap-1 mt-0.5">
      {list.map(r => (
        <button
          key={r.emoji}
          type="button"
          onClick={() => onReact?.(message, r.emoji)}
          disabled={!onReact}
          aria-label={`${r.emoji} ${r.count}`}
          aria-pressed={r.mine}
          className={`flex items-center gap-0.5 px-1 py-px rounded text-[10px] border transition-colors
            ${r.mine
              ? 'bg-brand-600/20 border-brand-400 text-brand-700'
              : 'bg-[#0c1829] border-[#1a3a5c] text-slate-600 hover:border-brand-400'}`}
        >
          <span>{r.emoji}</span>
          <span className="font-bold">{r.count}</span>
        </button>
      ))}

      {offering && REACTION_EMOJI.map(e => (
        <button
          key={e}
          type="button"
          onClick={() => { onPick(null); onReact(message, e) }}
          className="px-1 py-px rounded text-xs bg-[#0c1829] border border-[#1a3a5c] hover:border-brand-400 transition-colors"
        >
          {e}
        </button>
      ))}
    </span>
  )
}

export default function CbatLoungeChat({ open, onToggle }) {
  const { user, API, apiFetch } = useAuth()
  const { settings } = useAppSettings()

  const [lounge,    setLounge]    = useState(null)
  const [gone,      setGone]      = useState(false)
  const [messages,  setMessages]  = useState([])
  const [loading,   setLoading]   = useState(true)
  const [busy,      setBusy]      = useState(false)
  const [err,       setErr]       = useState('')
  const [draft,     setDraft]     = useState('')
  const [hasNew,    setHasNew]    = useState(false)
  const [needsName, setNeedsName] = useState(false)
  const [typingName, setTypingName] = useState(null)
  const [streaming, setStreaming] = useState(false)
  const [activity, setActivity] = useState(null)
  // Display names, badges and so on for everyone who has spoken here OR been
  // mentioned. Needed to render an @mention, which is a text match against the
  // mentioned person's name — see pages/chat/mentions.js.
  const [senders,   setSenders]   = useState({})
  const [replyTo,   setReplyTo]   = useState(null)
  // The message whose readership is being inspected, or null.
  const [seenByMsg, setSeenByMsg] = useState(null)
  // The message whose emoji picker is open, if any. One at a time.
  const [picking,   setPicking]   = useState(null)
  // Caret offset, for spotting the "@" being typed. Tracked rather than read
  // off the input on demand because the picker re-renders from it.
  const [caret,     setCaret]     = useState(0)
  // The offset of an "@" the user dismissed with Escape, so it stays dismissed
  // until they start a different mention.
  const [mentionDismissed, setMentionDismissed] = useState(null)

  const scrollRef = useRef(null)
  const inputRef  = useRef(null)
  // Read by the stream handler, which is set up once and would otherwise close
  // over the open state as it was when the connection opened.
  const openRef   = useRef(open)
  openRef.current = open
  // Same reason as openRef: the stream handler is installed once and would
  // otherwise close over the sender map as it was when the connection opened.
  const sendersRef = useRef(senders)
  sendersRef.current = senders

  const conversationId = lounge?.conversationId ?? null
  const enabled = Boolean(user) && settings?.chatEnabled !== false

  // ── Loading ────────────────────────────────────────────────────────────────

  // Plain fetch rather than apiFetch for everything that runs on its own: the
  // wrapper puts a loading overlay over the whole page after 400ms, which is
  // right for something you clicked and wrong for a background refresh.
  const get = useCallback((path) =>
    fetch(`${API}${path}`, { credentials: 'include' })
      .then(async r => ({ ok: r.ok, status: r.status, data: (await r.json().catch(() => null))?.data ?? null })),
  [API])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    get('/api/chat/lounge').then(({ ok, status, data }) => {
      if (cancelled) return
      // 404 means an admin archived or deleted the room. The widget simply does
      // not appear; the hub carries on without it.
      if (!ok) { if (status === 404) setGone(true); setLoading(false); return }
      setLounge(data)
      setHasNew(Boolean(data.unread))
      setNeedsName(Boolean(data.displayNameRequired))
    }).catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [enabled, get])

  // How busy the site has been lately, shown under the lounge header. Refreshed
  // on a slow timer rather than with the messages: the numbers move over days,
  // and the endpoint is cached server-side for a minute anyway. A failure leaves
  // `activity` null and the strip simply doesn't render.
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const load = () => get('/api/games/cbat/activity')
      .then(({ ok, data }) => { if (!cancelled && ok && data) setActivity(data) })
      .catch(() => {})
    load()
    const id = setInterval(load, ACTIVITY_REFRESH_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [enabled, get])

  const loadMessages = useCallback(async () => {
    if (!conversationId) return
    const { ok, data } = await get(`/api/chat/conversations/${conversationId}/messages?limit=${MESSAGE_LIMIT}`)
    if (!ok || !data) return
    setMessages(data.messages ?? [])
    setSenders(data.senders ?? {})
    setTypingName(data.botTyping ?? null)
    setLoading(false)
  }, [conversationId, get])

  useEffect(() => {
    if (!conversationId) return
    loadMessages().catch(() => setLoading(false))
  }, [conversationId, loadMessages])

  const markRead = useCallback(() => {
    if (!conversationId) return
    fetch(`${API}/api/chat/conversations/${conversationId}/read`, {
      method: 'POST', credentials: 'include',
    }).catch(() => {})
  }, [API, conversationId])

  // ── Live stream ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!conversationId || !enabled) return
    let source
    try {
      source = new EventSource(`${API}/api/chat/conversations/${conversationId}/stream`, {
        withCredentials: true,
      })
    } catch { return }

    const onMessage = (e) => {
      let incoming
      try { incoming = JSON.parse(e.data) } catch { return }
      // The stream carries the message but not the profile of anyone it
      // mentions, and a mention renders by matching that person's display name
      // against the body. When we cannot name them, refetch — which is also
      // what fills in a first-time speaker's avatar and colour.
      const unnamed = (incoming.mentions ?? []).some(id => !sendersRef.current[String(id)])
      if (unnamed) loadMessages().catch(() => {})
      setMessages(prev => (
        // The sender already appended this one from the POST response, and a
        // reconnect can replay nothing but is cheap to guard anyway.
        prev.some(m => String(m._id) === String(incoming._id)) ? prev : [...prev, incoming]
      ))
      const mine = String(incoming.senderUserId ?? '') === String(user?._id)
      if (mine) return
      if (openRef.current) markRead()
      else setHasNew(true)
    }

    source.addEventListener('ready',   () => { setStreaming(true); setErr('') })
    source.addEventListener('message', onMessage)
    source.addEventListener('refresh', () => { loadMessages().catch(() => {}) })
    source.addEventListener('typing',  (e) => {
      try { setTypingName(JSON.parse(e.data)?.name ?? null) } catch { /* ignore */ }
    })
    // The server is full. It has already closed the connection, so there is
    // nothing to retry — fall through to polling.
    source.addEventListener('unavailable', () => { setStreaming(false); source.close() })
    // EventSource reconnects itself, so an error is only worth acting on to the
    // extent of turning the fallback poll back on until 'ready' arrives again.
    source.onerror = () => setStreaming(false)

    return () => { source.close(); setStreaming(false) }
  }, [API, conversationId, enabled, loadMessages, markRead, user])

  // Fallback for a stream that will not stay up. Skips hidden tabs, like every
  // other poll in the app.
  useEffect(() => {
    if (streaming || !conversationId) return
    const id = setInterval(() => {
      if (document.hidden) return
      loadMessages().catch(() => {})
    }, FALLBACK_POLL_MS)
    return () => clearInterval(id)
  }, [streaming, conversationId, loadMessages])

  // ── Reading and scrolling ──────────────────────────────────────────────────

  // Opening the panel is what counts as reading it.
  useEffect(() => {
    if (!open || !conversationId) return
    setHasNew(false)
    markRead()
  }, [open, conversationId, markRead])

  // Stick to the bottom, which is where a chat lives. useLayoutEffect so the
  // jump happens before paint rather than as a visible scroll.
  useLayoutEffect(() => {
    if (!open) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [open, messages, typingName])

  // ── Sending ────────────────────────────────────────────────────────────────

  const syncCaret = (e) => setCaret(e.target.selectionStart ?? 0)

  const send = async () => {
    const text = draft.trim()
    if (!text || busy || !conversationId) return
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
        // The server is the authority on this, not the flag we loaded earlier.
        if (d?.code === 'DISPLAY_NAME_REQUIRED') { setNeedsName(true); return }
        throw new Error(d?.message || 'Could not send that')
      }
      setDraft('')
      setReplyTo(null)
      setMentionDismissed(null)
      if (d?.data?.botReplyingName) setTypingName(d.data.botReplyingName)
      if (d?.data?.message) {
        setMessages(prev => (
          prev.some(m => String(m._id) === String(d.data.message._id)) ? prev : [...prev, d.data.message]
        ))
      }
    } catch (e) {
      setErr(e.message || 'Could not send that')
    } finally {
      setBusy(false)
    }
  }

  // Toggle one of the whitelisted reactions. The response carries the updated
  // counts for this viewer, so the message is swapped in place rather than
  // refetching the room; everyone else finds out through the 'refresh' the
  // server publishes.
  const react = async (message, emoji) => {
    setErr('')
    const r = await apiFetch(`${API}/api/chat/messages/${message._id}/reactions`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji }),
    }).catch(() => null)
    const d = await r?.json().catch(() => null)
    if (!r?.ok) { setErr(d?.message || 'Could not add that reaction'); return }
    setMessages(prev => prev.map(m => (
      String(m._id) === String(d.data.message._id) ? d.data.message : m
    )))
  }

  const startReply = (message) => {
    setReplyTo(message)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  // Drop the half-typed "@fal" and put "@Falcon " in its place, caret after it
  // so typing carries straight on.
  const pickMention = (picked) => {
    const mention = activeMention(draft, caret)
    if (!mention) return
    const insert = `@${picked.displayName} `
    const next = draft.slice(0, mention.start) + insert + draft.slice(caret)
    const nextCaret = mention.start + insert.length
    setDraft(next)
    setCaret(nextCaret)
    setMentionDismissed(null)
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(nextCaret, nextCaret)
    })
  }

  // Prefill the composer with the mention rather than sending anything: the
  // question is still theirs to write, and the bot only answers when addressed.
  const askBot = () => {
    if (!lounge?.botName) return
    setDraft(d => (d.includes(`@${lounge.botName}`) ? d : `@${lounge.botName} ${d}`.trim() + ' '))
    setMentionDismissed(null)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  if (!enabled || gone) return null

  // ── Closed: a tab on the bottom edge of the column ─────────────────────────

  // The mt-3 on both states is deliberate, rather than a gap on the column:
  // the admin view toggle above Recent Scores is docked to that card's top
  // edge, and a column gap would detach it.
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => onToggle(true)}
        aria-expanded="false"
        className="shrink-0 mt-3 w-full flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0a1628] border border-[#1a3a5c] hover:border-brand-400 hover:bg-[#102040] transition-colors text-left"
      >
        <span className="text-[11px] font-extrabold tracking-wider uppercase text-slate-500">
          {lounge?.title ?? '🛩️ CBAT Lounge'}
        </span>
        {hasNew && (
          <span
            className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.9)]"
            aria-label="New messages"
          />
        )}
        <span className="ml-auto text-[11px] text-slate-500">Open</span>
      </button>
    )
  }

  // ── Open ───────────────────────────────────────────────────────────────────

  const canPost = lounge?.canPost && !needsName
  const viewerIsAdmin = Boolean(user?.isAdmin)

  // The "@" the caret is sitting in, if any, and whether to offer the picker
  // for it. Suppressed while a display name is still being asked for, since
  // there is no composer to complete into.
  const mention = canPost ? activeMention(draft, caret) : null
  const showMentionPicker = Boolean(mention) && mention.start !== mentionDismissed

  return (
    <div className="flex-[2] min-h-0 mt-3 flex flex-col bg-[#0a1628] border border-[#1a3a5c] rounded-xl overflow-hidden">
      <div className="shrink-0 px-4 py-3 border-b border-[#1a3a5c] flex items-center gap-2">
        <p className="text-[11px] font-extrabold tracking-wider uppercase text-slate-500">
          {lounge?.title ?? '🛩️ CBAT Lounge'}
        </p>
        <Link
          to="/chat"
          className="text-[10px] text-slate-500 no-underline hover:text-brand-600 hover:underline underline-offset-2 transition-colors"
          title="Open the full chat in Community"
        >
          Community
        </Link>
        <button
          type="button"
          onClick={() => onToggle(false)}
          aria-expanded="true"
          aria-label="Close the lounge"
          className="ml-auto text-[11px] text-slate-500 hover:text-slate-400 px-1.5 py-0.5 rounded-lg border border-[#1a3a5c] hover:border-brand-400 transition-colors"
        >
          Close
        </button>
      </div>

      <ActivityStrip activity={activity} />

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-1.5">
        {loading ? (
          <p className="text-xs text-slate-500 text-center py-6">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-6">
            Nobody has said anything yet. Say hello.
          </p>
        ) : (
          messages.map(m => {
            const prof    = senders[String(m.senderUserId ?? '')]
            const name     = senderName(m.senderUserId, senders, m.senderDisplayName) || 'Unknown agent'
            const isBot   = prof
              ? Boolean(prof.isBot)
              : Boolean(lounge?.botName) && m.senderDisplayName === lounge.botName
            const mineTag = (m.mentions ?? []).some(id => String(id) === String(user?._id))
            const acting  = canPost && !m.deleted
            const mine    = String(m.senderUserId ?? '') === String(user?._id)
            // Exactly the rule the full room uses, enforced again by the
            // endpoint: your own messages, and admins on anyone's. Not gated on
            // canPost — being unable to speak is no reason to lose sight of who
            // read what you already said.
            const canSeen = viewerIsAdmin || (mine && !m.deleted)
            return (
              <div
                key={m._id}
                className={`group relative text-xs leading-snug break-words ${
                  mineTag ? 'bg-brand-600/10 border-l-2 border-l-brand-400 -mx-1 px-1 rounded' : ''
                }`}
              >
                {m.replyTo && <ReplyQuote replyTo={m.replyTo} senders={senders} />}
                <p title={formatTime(m.createdAt)}>
                  <span
                    className="font-bold"
                    style={{ color: isBot ? '#5baaff' : nameColour(m.senderUserId) }}
                  >
                    {name}
                  </span>
                  {isBot && (
                    <span className="ml-1 px-1 py-px rounded bg-brand-600/15 text-brand-600 text-[8px] font-extrabold uppercase tracking-wide align-middle">
                      Bot
                    </span>
                  )}
                  <span className="text-slate-500">: </span>
                  <span className="text-[#ddeaf8] whitespace-pre-wrap">
                    <MessageBody message={m} senders={senders} currentUserId={user?._id} />
                  </span>
                </p>

                <Reactions
                  message={m}
                  onReact={acting ? react : undefined}
                  picking={picking === String(m._id)}
                  onPick={setPicking}
                />

                {/* Hover-reveal, so forty rows of buttons do not compete with
                    the conversation. `hover:` compiles to @media (hover: hover),
                    so on a touch screen it would never appear at all — the
                    panel is desktop-width only, but a touch laptop still lands
                    here, hence the touch: pair. focus-within covers the
                    keyboard. */}
                {(acting || canSeen) && (
                  <span className="absolute top-0 right-0 flex gap-0.5 rounded-md bg-[#0a1628] border border-[#1a3a5c] px-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 touch:opacity-100 transition-opacity">
                    {canSeen && (
                      <button
                        type="button"
                        onClick={() => setSeenByMsg(m)}
                        aria-label="Seen by"
                        title="Seen by"
                        className="px-1 text-[11px] text-slate-500 hover:text-brand-600 transition-colors"
                      >
                        👁
                      </button>
                    )}
                    {acting && (
                      <button
                        type="button"
                        onClick={() => setPicking(p => (p === String(m._id) ? null : String(m._id)))}
                        aria-label="Add a reaction"
                        className="px-1 text-[11px] text-slate-500 hover:text-brand-600 transition-colors"
                      >
                        ☺+
                      </button>
                    )}
                    {acting && (
                      <button
                        type="button"
                        onClick={() => startReply(m)}
                        aria-label="Reply"
                        className="px-1 text-[11px] text-slate-500 hover:text-brand-600 transition-colors"
                      >
                        ↰
                      </button>
                    )}
                  </span>
                )}
              </div>
            )
          })
        )}
        {typingName && (
          <p className="text-[11px] text-slate-500 italic">{typingName} is typing…</p>
        )}
      </div>

      {err && <p className="shrink-0 text-[11px] text-red-400 px-3 py-1.5 border-t border-[#1a3a5c]">{err}</p>}

      {needsName ? (
        <div className="shrink-0 border-t border-[#1a3a5c]">
          <DisplayNameGate onDone={() => setNeedsName(false)} />
        </div>
      ) : !canPost ? (
        <p className="shrink-0 text-[11px] text-slate-500 px-3 py-2.5 border-t border-[#1a3a5c] text-center">
          {lounge?.chatBanned
            ? 'You cannot post in chat.'
            : lounge?.postBlockedMessage || 'You cannot post here right now.'}
        </p>
      ) : (
        <div className="shrink-0 border-t border-[#1a3a5c]">
          {replyTo && (
            <div className="flex items-center gap-1.5 px-2 pt-1.5 text-[10px] min-w-0">
              <span className="text-slate-500 shrink-0">Replying to</span>
              <span className="font-semibold text-slate-600 shrink-0">
                {senderName(replyTo.senderUserId, senders, replyTo.senderDisplayName) || 'Unknown agent'}
              </span>
              <span className="text-slate-500 truncate">{replyTo.body}</span>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                aria-label="Cancel reply"
                className="ml-auto shrink-0 px-1 text-slate-500 hover:text-slate-400"
              >
                ✕
              </button>
            </div>
          )}
          <div className="relative p-2 flex items-center gap-1.5">
            {showMentionPicker && (
              <MentionPicker
                conversationId={conversationId}
                query={mention.query}
                onPick={pickMention}
                onDismiss={() => setMentionDismissed(mention.start)}
              />
            )}
            {lounge?.botName && (
              <button
                type="button"
                onClick={askBot}
                title={`Ask ${lounge.botName} a question`}
                className="shrink-0 px-2 py-1.5 rounded-lg border border-[#1a3a5c] text-[11px] font-bold text-slate-500 hover:text-brand-600 hover:border-brand-400 transition-colors"
              >
                🤖
              </button>
            )}
            <input
              ref={inputRef}
              type="text"
              value={draft}
              maxLength={4000}
              onChange={e => { setDraft(e.target.value); syncCaret(e) }}
              onSelect={syncCaret}
              onKeyUp={syncCaret}
              onClick={syncCaret}
              onKeyDown={e => {
                // While the picker is open it owns these keys — Enter completes
                // the mention rather than sending a half-typed name. Its own
                // capture-phase listener runs before this.
                if (showMentionPicker && ['Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'Escape'].includes(e.key)) return
                if (e.key === 'Enter') { e.preventDefault(); send() }
              }}
              placeholder="Message the lounge…"
              className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-[#0c1829] border border-[#1a3a5c] focus:border-brand-400 outline-none text-xs text-[#ddeaf8] placeholder:text-slate-500"
            />
            <button
              type="button"
              onClick={send}
              disabled={busy || !draft.trim()}
              className="shrink-0 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white font-bold rounded-lg text-xs transition-colors"
            >
              Send
            </button>
          </div>
        </div>
      )}

      {seenByMsg && (
        <SeenByDialog
          key={seenByMsg._id}
          message={seenByMsg}
          onClose={() => setSeenByMsg(null)}
        />
      )}
    </div>
  )
}
