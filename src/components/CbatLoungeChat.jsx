import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useAppSettings } from '../context/AppSettingsContext'
import { nameColour } from '../pages/chat/nameColour'
import { formatTime } from '../pages/chat/format'
import { splitMentions, activeMention } from '../pages/chat/mentions'
import { senderName } from '../pages/chat/senderName'
import { REACTION_EMOJI } from '../pages/chat/reactionEmoji'
import DisplayNameGate from '../pages/chat/components/DisplayNameGate'
import SeenByDialog from '../pages/chat/components/SeenByDialog'
import EditHistoryDialog from '../pages/chat/components/EditHistoryDialog'
import MentionPicker from '../pages/chat/components/MentionPicker'
import UserCard from '../pages/chat/components/UserCard'

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
// The inactive My group tab has no EventSource of its own. This small status
// response keeps its badge live without holding a second chat stream open.
const GROUP_UNREAD_POLL_MS = 15_000

// How long a just-sent message is held over a load that has not caught up with
// it. See applyJustSent below.
const PENDING_MS = 30_000
// The activity counters are a 7-day and a same-day figure, so they barely move
// within a session. Slow on purpose.
const ACTIVITY_REFRESH_MS = 5 * 60_000
// How far off the bottom still counts as "parked at the bottom". A couple of
// pixels of slack, because sub-pixel row heights mean the scroll maths rarely
// lands on exactly zero.
const BOTTOM_SLACK_PX = 4
// How much of the viewport the panel has to reach into before it counts as
// being read. A band down the middle rather than a fraction of the panel:
// the panel is 60dvh on a phone but can be taller than the window in the
// desktop side column, and a ratio threshold is unreachable in that case.
const READ_BAND_MARGIN = '-20% 0px -20% 0px'

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
    <p className="shrink-0 px-4 py-1.5 border-b border-game-line text-[10px] text-slate-500 truncate">
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
              : 'bg-surface border-game-line text-slate-600 hover:border-brand-400'}`}
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
          className="px-1 py-px rounded text-xs bg-surface border border-game-line hover:border-brand-400 transition-colors"
        >
          {e}
        </button>
      ))}
    </span>
  )
}

export default function CbatLoungeChat({ open, onToggle, collapsible = true }) {
  const { user, API, apiFetch } = useAuth()
  const { settings } = useAppSettings()
  const navigate = useNavigate()
  const location = useLocation()

  const [lounge,    setLounge]    = useState(null)
  const [gone,      setGone]      = useState(false)
  const [messages,  setMessages]  = useState([])
  const [loading,   setLoading]   = useState(true)
  const [busy,      setBusy]      = useState(false)
  const [err,       setErr]       = useState('')
  const [draft,     setDraft]     = useState('')
  const [hasNew,    setHasNew]    = useState(false)
  const [groupUnreadCount, setGroupUnreadCount] = useState(0)
  const [allGroupsUnreadCount, setAllGroupsUnreadCount] = useState(0)
  const [selectedAdminGroupUnread, setSelectedAdminGroupUnread] = useState(0)
  const [needsName, setNeedsName] = useState(false)
  // Bumped to refetch /api/chat/lounge. Needed after the display-name gate:
  // the endpoint reports canPost:false while a name is missing, so clearing
  // `needsName` alone would leave the widget refusing to show a composer.
  const [loungeReload, setLoungeReload] = useState(0)
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
  // The message whose edit history is open, or null. Admin-only.
  const [editsMsg,  setEditsMsg]  = useState(null)
  // Tapping a name opens the same card as the full room: message, block, and
  // for an admin the profile. Nothing rebuilt here; UserCard does its own
  // fetching and the lounge only needs to know who was tapped.
  const [cardUserId, setCardUserId] = useState(null)
  // The message being edited in the composer, or null. The widget has one
  // input, so editing borrows it rather than growing a second one inside a
  // 40-message list that is already only a few hundred pixels tall.
  const [editing,   setEditing]   = useState(null)
  // The message whose emoji picker is open, if any. One at a time.
  const [picking,   setPicking]   = useState(null)
  // The message whose action bar is showing, or null. Exactly one at a time,
  // and held here rather than per row so opening one closes the last.
  const [openActionsId, setOpenActionsId] = useState(null)
  // Caret offset, for spotting the "@" being typed. Tracked rather than read
  // off the input on demand because the picker re-renders from it.
  const [caret,     setCaret]     = useState(0)
  // The offset of an "@" the user dismissed with Escape, so it stays dismissed
  // until they start a different mention.
  const [mentionDismissed, setMentionDismissed] = useState(null)
  const [room, setRoom] = useState('lounge')
  const [dateChoice, setDateChoice] = useState('')
  const [confirmingDate, setConfirmingDate] = useState(false)
  const [dateBusy, setDateBusy] = useState(false)
  const [dateError, setDateError] = useState('')
  const [adminGroupId, setAdminGroupId] = useState(null)

  const scrollRef = useRef(null)
  const inputRef  = useRef(null)
  // The panel element, held in state rather than a ref so the observer below
  // re-attaches when the collapsed tab is swapped for the open panel.
  const [panelEl,    setPanelEl]    = useState(null)
  const [onScreen,   setOnScreen]   = useState(false)
  const [tabVisible, setTabVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState !== 'hidden'
  )
  // Whether the list is parked at the bottom, updated as it scrolls. Read by
  // the picker effect below, which needs to know where you were BEFORE the
  // palette changed the list's height.
  const atBottomRef = useRef(true)
  // The stream handler is installed once and would otherwise close over the
  // sender map as it was when the connection opened. Same reason as readingRef
  // further down.
  const sendersRef = useRef(senders)
  sendersRef.current = senders

  // Messages this client appended straight from its own POST, held until a load
  // confirms the server has them.
  //
  // Every wholesale refresh in this widget — the stream's `refresh` event, the
  // mention refetch, the fallback poll — can have been issued a moment BEFORE
  // you hit Send, in which case it answers from before your message existed.
  // Applied as it stands it takes the message you just watched appear straight
  // back off the screen until the next refresh puts it back. Same guard, and
  // same reasoning, as pages/chat/ChatThread.jsx.
  const justSentRef = useRef(new Map())

  const applyJustSent = useCallback((serverMessages) => {
    const pending = justSentRef.current
    if (!pending.size) return serverMessages
    const now = Date.now()
    const ids = new Set(serverMessages.map(m => String(m._id)))
    const held = []
    for (const [id, entry] of pending) {
      // In the snapshot, or old enough that the server has plainly decided
      // otherwise. Either way stop holding it.
      if (ids.has(id) || now - entry.at > PENDING_MS) { pending.delete(id); continue }
      held.push(entry.message)
    }
    // They are by definition the newest, so they go on the end.
    return held.length ? [...serverMessages, ...held] : serverMessages
  }, [])

  // A held copy is a snapshot of the message as it was sent, so an edit or a
  // reaction in the meantime has to reach it too — otherwise a late refresh
  // could put the pre-edit text back for a moment. A removal drops it outright:
  // nothing should be able to bring back a message you have just withdrawn.
  const refreshJustSent = (message) => {
    const entry = justSentRef.current.get(String(message._id))
    if (entry) entry.message = message
  }
  const forgetJustSent = (message) => justSentRef.current.delete(String(message._id))

  const conversationId = lounge?.conversationId ?? null
  const enabled = Boolean(user) && settings?.chatEnabled !== false
  const roomEndpoint = room === 'group'
    ? '/api/chat/cbat-group'
    : room === 'groups'
      ? (adminGroupId ? `/api/chat/cbat-groups/${adminGroupId}` : '/api/chat/cbat-groups')
      : '/api/chat/lounge'

  const changeRoom = useCallback((next) => {
    if (next === room) return
    setRoom(next)
    setLounge(null)
    setMessages([])
    setSenders({})
    setLoading(true)
    setGone(false)
    setErr('')
    setHasNew(false)
    if (next !== 'groups') setAdminGroupId(null)
  }, [room])

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
    get(roomEndpoint).then(({ ok, status, data }) => {
      if (cancelled) return
      // 404 means an admin archived or deleted the room. The widget simply does
      // not appear; the hub carries on without it.
      if (!ok) { if (status === 404) setGone(true); setLoading(false); return }
      setLounge(data)
      setHasNew(Boolean(data.unread))
      if (room === 'group') setGroupUnreadCount(Number(data.unreadCount) || 0)
      if (room === 'groups') {
        if (Array.isArray(data.groups)) {
          setAllGroupsUnreadCount(data.groups.reduce((sum, group) => sum + (Number(group.unread) || 0), 0))
          setSelectedAdminGroupUnread(0)
        } else {
          setSelectedAdminGroupUnread(Number(data.unreadCount) || 0)
        }
      }
      setNeedsName(Boolean(data.displayNameRequired))
      // Setup and admin-list responses intentionally have no conversation, so
      // no message request will come along later to clear this state.
      if (!data.conversationId) setLoading(false)
    }).catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [enabled, get, loungeReload, roomEndpoint])

  // Keep the inactive My group pill current. Once that room is selected its
  // own load + stream take over, so there is never a duplicate polling path.
  useEffect(() => {
    if (!enabled || room === 'group') return
    let cancelled = false
    const load = () => {
      if (document.hidden) return
      get('/api/chat/cbat-group')
        .then(({ ok, data }) => {
          if (!cancelled && ok) setGroupUnreadCount(Number(data?.unreadCount) || 0)
        })
        .catch(() => {})
    }
    load()
    const id = setInterval(load, GROUP_UNREAD_POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [enabled, get, room])

  // Admins need the same signal one level up: the All groups pill aggregates
  // every cohort row while its list is not selected. The list response already
  // contains the per-group counts used by the red badges on each row.
  useEffect(() => {
    if (!enabled || !user?.isAdmin || room === 'groups') return
    let cancelled = false
    const load = () => {
      if (document.hidden) return
      get('/api/chat/cbat-groups')
        .then(({ ok, data }) => {
          if (!cancelled && ok && Array.isArray(data?.groups)) {
            setAllGroupsUnreadCount(data.groups.reduce((sum, group) => sum + (Number(group.unread) || 0), 0))
          }
        })
        .catch(() => {})
    }
    load()
    const id = setInterval(load, GROUP_UNREAD_POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [enabled, get, room, user?.isAdmin])

  const saveCbatDate = async () => {
    setDateBusy(true)
    setDateError('')
    try {
      const response = await fetch(`${API}/api/chat/cbat-group`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: dateChoice }),
      })
      const json = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(json.message || 'Could not save your CBAT date.')
      setLounge(json.data)
      setConfirmingDate(false)
      setLoading(false)
    } catch (error) {
      setDateError(error.message)
    } finally {
      setDateBusy(false)
    }
  }

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
    setMessages(applyJustSent(data.messages ?? []))
    setSenders(data.senders ?? {})
    setTypingName(data.botTyping ?? null)
    setLoading(false)
  }, [applyJustSent, conversationId, get])

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
      if (readingRef.current) {
        markRead()
        if (room === 'group') setGroupUnreadCount(0)
        if (room === 'groups' && selectedAdminGroupUnread > 0) {
          setAllGroupsUnreadCount(count => Math.max(0, count - selectedAdminGroupUnread))
          setSelectedAdminGroupUnread(0)
        }
      } else {
        setHasNew(true)
        if (room === 'group') setGroupUnreadCount(count => count + 1)
        if (room === 'groups') {
          setAllGroupsUnreadCount(count => count + 1)
          setSelectedAdminGroupUnread(count => count + 1)
        }
      }
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
  }, [API, conversationId, enabled, loadMessages, markRead, room, selectedAdminGroupUnread, user])

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

  // Whether the panel is genuinely in front of the user.
  //
  // "Open" is not enough. The panel defaults to open and, on a phone, is
  // mounted a swipe below the fold on /cbat — so loading the page used to mark
  // the room read for someone who never scrolled to it. That is not just a
  // wrong unread dot: seen-by is derived from the read marker
  // (GET /messages/:id/seen-by), so a sender was told their message had been
  // seen by people who had never laid eyes on it.
  useEffect(() => {
    if (!panelEl) { setOnScreen(false); return }
    // No observer (jsdom, and browsers old enough not to matter): fall back to
    // the old behaviour. Over-reporting a read is bad; never clearing an unread
    // dot at all is worse.
    if (typeof IntersectionObserver === 'undefined') { setOnScreen(true); return }
    const io = new IntersectionObserver(
      entries => setOnScreen(entries[entries.length - 1].isIntersecting),
      { rootMargin: READ_BAND_MARGIN },
    )
    io.observe(panelEl)
    return () => io.disconnect()
  }, [panelEl])

  // A backgrounded tab is not being read either, and the panel stays
  // "intersecting" the whole time it is in one.
  useEffect(() => {
    const onChange = () => setTabVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])

  const reading = open && onScreen && tabVisible
  // Read by the stream handler, which is installed once and would otherwise
  // close over whatever this was when the connection opened.
  const readingRef = useRef(reading)
  readingRef.current = reading

  // Having the panel in front of you is what counts as reading it. This fires
  // again when you scroll it into view or come back to the tab, so a room read
  // late still clears.
  useEffect(() => {
    if (!reading || !conversationId) return
    setHasNew(false)
    if (room === 'group') setGroupUnreadCount(0)
    if (room === 'groups' && selectedAdminGroupUnread > 0) {
      setAllGroupsUnreadCount(count => Math.max(0, count - selectedAdminGroupUnread))
      setSelectedAdminGroupUnread(0)
    }
    markRead()
  }, [reading, conversationId, markRead, room, selectedAdminGroupUnread])

  // Stick to the bottom, which is where a chat lives. useLayoutEffect so the
  // jump happens before paint rather than as a visible scroll.
  useLayoutEffect(() => {
    if (!open) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [open, messages, typingName])

  // The reaction picker opens INLINE (see Reactions), so on the last message it
  // makes that row taller. If you were parked at the bottom — which is exactly
  // where the message you just reached for lives — the palette is added below
  // the fold and looks like nothing happened. Re-pin to the bottom once it has
  // rendered.
  //
  // Only when you were already at the bottom: opening a picker on an older
  // message must not yank you down to the newest one.
  useLayoutEffect(() => {
    if (!open || !picking || !atBottomRef.current) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [open, picking])

  // Tapping anywhere that is not the open row puts the bar away. On the document
  // rather than the panel, because "elsewhere" includes the composer, the header
  // and the whole page behind the widget.
  //
  // pointerdown, not click: it fires before the browser decides whether the
  // gesture was a tap or a scroll, so flicking the list closed feels immediate
  // instead of waiting for the tap to resolve. The open row is excluded so its
  // own buttons still get their press — each action closes the bar itself.
  useEffect(() => {
    if (!openActionsId) return
    const onDown = (e) => {
      const row = e.target?.closest?.(`[data-msg-row="${openActionsId}"]`)
      if (!row) setOpenActionsId(null)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [openActionsId])

  // Same for the reaction palette, which otherwise sat there until you picked
  // an emoji or opened another message's picker.
  //
  // Scoped to the row rather than to the palette itself, because the ☺+ toggle
  // lives in that row's action bar: closing on any press outside the palette
  // would tear it down on pointerdown and the click would immediately put it
  // back, so the button would never appear to close anything.
  useEffect(() => {
    if (!picking) return
    const onDown = (e) => {
      const row = e.target?.closest?.(`[data-msg-row="${picking}"]`)
      if (!row) setPicking(null)
    }
    const onKey = (e) => { if (e.key === 'Escape') setPicking(null) }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [picking])

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
        justSentRef.current.set(String(d.data.message._id), {
          message: d.data.message,
          at:      Date.now(),
        })
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
  // Your own messages go to the self-service routes, anyone else's to the
  // moderation ones. The server enforces both — this only decides which record
  // the action leaves behind.
  const messageActionUrl = (message) => (
    String(message.senderUserId ?? '') === String(user?._id ?? '')
      ? `${API}/api/chat/messages/${message._id}`
      : `${API}/api/chat/admin/messages/${message._id}`
  )

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
    refreshJustSent(d.data.message)
    setMessages(prev => prev.map(m => (
      String(m._id) === String(d.data.message._id) ? d.data.message : m
    )))
  }

  const startReply = (message) => {
    setEditing(null)
    setReplyTo(message)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  // Editing borrows the composer: the body goes into the input, Send becomes
  // Save, and a banner above it says what is being changed. Replying and
  // editing are mutually exclusive for the same reason — one input, one job.
  const startEdit = (message) => {
    setReplyTo(null)
    setEditing(message)
    setDraft(message.body ?? '')
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    })
  }

  const cancelEdit = () => {
    setEditing(null)
    setDraft('')
  }

  // Save an edit. Own messages go to the self-service route, anyone else's to
  // the moderation one — see the same split in pages/chat/ChatThread.jsx.
  const saveEdit = async () => {
    const text = draft.trim()
    if (!text || busy || !editing) return
    if (text === editing.body) { cancelEdit(); return }
    setBusy(true); setErr('')
    try {
      const r = await apiFetch(messageActionUrl(editing), {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok) throw new Error(d?.message || 'Could not save that edit')
      if (d?.data?.message) {
        refreshJustSent(d.data.message)
        setMessages(prev => prev.map(m => (
          String(m._id) === String(d.data.message._id) ? d.data.message : m
        )))
      }
      cancelEdit()
    } catch (e) {
      setErr(e.message || 'Could not save that edit')
    } finally {
      setBusy(false)
    }
  }

  // Withdraw or moderate away a message. Deliberately NOT window.confirm: a
  // native dialog inside the app's WebView blocks the whole page, and this
  // widget is one tap from a game. The full room asks; here the action bar
  // takes two deliberate taps to reach on touch already.
  const removeMessage = async (message) => {
    setErr('')
    if (String(editing?._id ?? '') === String(message._id)) cancelEdit()
    const r = await apiFetch(messageActionUrl(message), {
      method: 'DELETE', credentials: 'include',
    }).catch(() => null)
    const d = await r?.json().catch(() => null)
    if (!r?.ok) { setErr(d?.message || 'Could not remove that message'); return }
    forgetJustSent(message)
    // An admin keeps the row (struck through, as the moderation record);
    // everyone else loses it entirely, which is what the server would send on
    // the next load anyway. Doing it here rather than waiting for the refetch
    // stops the message sitting there for a beat after you removed it.
    if (d?.data?.message && user?.isAdmin) {
      setMessages(prev => prev.map(m => (
        String(m._id) === String(d.data.message._id) ? d.data.message : m
      )))
    } else {
      setMessages(prev => prev.filter(m => String(m._id) !== String(message._id)))
    }
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
  if (collapsible && !open) {
    return (
      <button
        type="button"
        onClick={() => onToggle(true)}
        aria-expanded="false"
        className="shrink-0 mt-3 w-full flex items-center gap-2 px-4 py-2.5 rounded-xl bg-game-panel border border-game-line hover:border-brand-400 hover:bg-surface-raised transition-colors text-left"
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

  // Removed messages reach admins only — they are the moderation record, and
  // the server withholds them from everyone else (see the query filter in GET
  // /messages). This drops any that arrive from a cached response, so there is
  // no window where a withdrawn message is still on a member's screen.
  const visible = viewerIsAdmin ? messages : messages.filter(m => !m.deleted)

  // The "@" the caret is sitting in, if any, and whether to offer the picker
  // for it. Suppressed while a display name is still being asked for, since
  // there is no composer to complete into.
  const mention = canPost ? activeMention(draft, caret) : null
  const showMentionPicker = Boolean(mention) && mention.start !== mentionDismissed

  return (
    <div
      ref={setPanelEl}
      className="flex-[2] min-h-0 mt-3 flex flex-col bg-game-panel border border-game-line rounded-xl overflow-hidden shadow-[0_18px_50px_rgba(2,8,23,0.14)]"
    >
      <div className="shrink-0 px-4 py-3 border-b border-game-line flex items-center gap-2">
        <div className={`grid ${user?.isAdmin ? 'grid-cols-3' : 'grid-cols-2'} rounded-lg bg-game-arena/70 p-1 border border-game-line shadow-inner`} role="tablist" aria-label="CBAT chats">
          {['lounge', 'group', ...(user?.isAdmin ? ['groups'] : [])].map(key => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={room === key}
              onClick={() => changeRoom(key)}
              className={`min-w-[4.5rem] rounded-md border px-3 py-1.5 text-center text-[10px] font-extrabold tracking-wide transition-[color,background-color,border-color,box-shadow] duration-200
                ${room === key
                  ? 'border-brand-400/70 bg-brand-600 text-white shadow-[0_2px_8px_rgba(37,99,235,.24),inset_0_1px_0_rgba(255,255,255,.16)]'
                  : 'border-transparent text-slate-500 hover:bg-brand-500/8 hover:text-brand-700'}`}
            >
              <span className="inline-flex items-center justify-center gap-1.5">
                <span>{key === 'lounge' ? 'Lounge' : key === 'group' ? 'My group' : 'All groups'}</span>
                {key === 'group' && groupUnreadCount > 0 && (
                  <span
                    aria-label={`${groupUnreadCount} new group ${groupUnreadCount === 1 ? 'message' : 'messages'}`}
                    className="min-w-4 h-4 px-1 rounded-full grid place-items-center bg-red-500 text-white text-[8px] leading-none font-black shadow-[0_0_8px_rgba(239,68,68,.55)]"
                  >
                    {groupUnreadCount > 99 ? '99+' : groupUnreadCount}
                  </span>
                )}
                {key === 'groups' && allGroupsUnreadCount > 0 && (
                  <span
                    aria-label={`${allGroupsUnreadCount} new ${allGroupsUnreadCount === 1 ? 'message' : 'messages'} across CBAT groups`}
                    className="min-w-4 h-4 px-1 rounded-full grid place-items-center bg-red-500 text-white text-[8px] leading-none font-black shadow-[0_0_8px_rgba(239,68,68,.55)]"
                  >
                    {allGroupsUnreadCount > 99 ? '99+' : allGroupsUnreadCount}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
        {room !== 'lounge' && lounge?.conversationId && <Link
          to={`/chat/${lounge.conversationId}`}
          className="text-[10px] text-slate-500 no-underline hover:text-brand-600 hover:underline underline-offset-2 transition-colors"
          title="Open this group in Community"
        >Community</Link>}
        {collapsible && (
          <button
            type="button"
            onClick={() => onToggle(false)}
            aria-expanded="true"
            aria-label="Close the lounge"
            className="ml-auto text-[11px] text-slate-500 hover:text-slate-400 px-1.5 py-0.5 rounded-lg border border-game-line hover:border-brand-400 transition-colors"
          >
            Close
          </button>
        )}
      </div>

      {room === 'group' && lounge?.configured && (
        <div className="shrink-0 px-3 py-2 border-b border-game-line bg-brand-500/[0.06] flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,.75)]" aria-hidden="true" />
          <p className="text-[10px] font-bold text-game-text">
            {new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${lounge.date}T00:00:00Z`))}
          </p>
          {Number.isFinite(lounge.memberCount) && (
            <p className="text-[10px] text-slate-500" aria-label={`${lounge.memberCount} ${lounge.memberCount === 1 ? 'member' : 'members'} in your CBAT group`}>
              · <span className="font-bold text-game-text">{lounge.memberCount}</span> {lounge.memberCount === 1 ? 'member' : 'members'}
            </p>
          )}
          <p className="ml-auto text-[9px] text-slate-500">Private to this date + region</p>
        </div>
      )}

      {room === 'groups' && lounge?.configured && (
        <button type="button" onClick={() => { setAdminGroupId(null); setLounge(null); setMessages([]); setLoading(true) }} className="shrink-0 px-3 py-2 border-b border-game-line bg-brand-500/[0.06] flex items-center gap-2 text-left hover:bg-brand-500/10 transition-colors">
          <span className="text-brand-500" aria-hidden="true">←</span>
          <span className="text-[10px] font-bold text-game-text">All CBAT groups</span>
          <span className="ml-auto text-[9px] text-slate-500">{lounge.date} · {lounge.region}</span>
        </button>
      )}

      {room === 'groups' && lounge?.configured && lounge.members && (
        <div className="shrink-0 border-b border-game-line px-3 py-2 bg-surface/50">
          <p className="text-[9px] font-extrabold uppercase tracking-widest text-slate-500 mb-1.5">
            Members · {lounge.members.length}
          </p>
          <div className="max-h-20 overflow-y-auto flex flex-wrap gap-1.5">
            {lounge.members.length === 0 ? (
              <span className="text-[10px] text-slate-500">No members currently assigned.</span>
            ) : lounge.members.map(member => (
              <button key={member._id} type="button" onClick={() => setCardUserId(String(member._id))} className="rounded-full border border-game-line bg-game-panel px-2 py-1 text-[10px] font-bold text-game-text hover:border-brand-400 hover:text-brand-500 transition-colors">
                {member.displayName || `Agent #${member.agentNumber || '—'}`}{member.cbatPassed ? ' · Passed' : ''}
              </button>
            ))}
          </div>
        </div>
      )}

      {room === 'groups' && !loading && lounge?.groups ? (
        <div className="cbat-room-enter flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
          {lounge.groups.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-8">No CBAT groups have been created yet.</p>
          ) : lounge.groups.map(group => (
            <button key={group.conversationId} type="button" onClick={() => { setAdminGroupId(group.conversationId); setLounge(null); setLoading(true) }} className="w-full rounded-xl border border-game-line bg-surface/70 px-3 py-2.5 flex items-center gap-3 text-left hover:border-brand-400 hover:bg-brand-500/[0.06] hover:-translate-y-px transition-all">
              <span className="w-9 h-9 rounded-xl grid place-items-center bg-brand-500/10 text-brand-500">✈</span>
              <span className="min-w-0">
                <span className="block text-xs font-extrabold text-game-text">{new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${group.date}T00:00:00Z`))}</span>
                <span className="block text-[10px] text-slate-500">Region {group.region}</span>
              </span>
              <span className="ml-auto text-[10px] text-slate-500">
                {group.participantCount ?? 0} participant{group.participantCount === 1 ? '' : 's'} · {group.messageCount} messages
              </span>
              {group.unread > 0 && <span aria-label={`${group.unread} new ${group.unread === 1 ? 'message' : 'messages'} in this group`} className="min-w-5 h-5 px-1 rounded-full grid place-items-center bg-red-500 text-white text-[9px] font-black shadow-[0_0_12px_rgba(239,68,68,.45)]">{group.unread}</span>}
            </button>
          ))}
        </div>
      ) : room === 'group' && !loading && lounge && lounge.applicable === false ? (
        <div className="cbat-room-enter flex-1 min-h-0 px-6 py-8 flex flex-col items-center justify-center text-center">
          <div className="w-12 h-12 rounded-2xl grid place-items-center bg-emerald-500/10 text-emerald-500 text-xl mb-4">✓</div>
          <h3 className="text-base font-black text-game-text">You’ve already passed your CBAT</h3>
          <p className="text-xs text-slate-500 mt-2 max-w-xs">Upcoming-date groups are for applicants preparing to attend. If a CBAT date was previously recorded for you, your original group will appear here automatically.</p>
        </div>
      ) : room === 'group' && !loading && lounge && !lounge.configured ? (
        <div key="group-setup" className="cbat-room-enter flex-1 min-h-0 overflow-y-auto relative px-5 py-6 flex flex-col justify-center">
          <div aria-hidden="true" className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_80%_10%,rgba(59,130,246,.18),transparent_42%),radial-gradient(circle_at_10%_90%,rgba(99,102,241,.12),transparent_38%)]" />
          <div className="relative mx-auto w-full max-w-sm">
            <div className="w-12 h-12 mb-4 rounded-2xl grid place-items-center text-xl bg-brand-600 text-white shadow-[0_12px_30px_rgba(37,99,235,.32)]">✈</div>
            <p className="text-[10px] uppercase tracking-[0.2em] font-extrabold text-brand-500 mb-2">Private CBAT group</p>
            <h3 className="text-lg font-black text-game-text leading-tight mb-2">Meet applicants attending with you.</h3>
            <p className="text-xs leading-relaxed text-slate-500 mb-5">Enter your upcoming CBAT date to join people with the same date in your region. Your date is only visible to people in that private group.</p>
            {!lounge.regionAvailable ? (
              <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-xs text-amber-600">We could not determine your region yet. Refresh the app, then return here.</p>
            ) : !confirmingDate ? (
              <div className="space-y-3">
                <label className="block text-[11px] font-bold text-slate-500" htmlFor="upcoming-cbat-date">Upcoming CBAT date</label>
                <input id="upcoming-cbat-date" type="date" min={new Date().toISOString().slice(0, 10)} value={dateChoice} onChange={e => { setDateChoice(e.target.value); setDateError('') }} className="w-full rounded-xl bg-surface border border-game-line px-3 py-2.5 text-sm text-game-text outline-none focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 transition-all" />
                {dateChoice && (
                  <div key={dateChoice} role="alert" className="cbat-date-warning rounded-xl border border-amber-400/70 bg-gradient-to-r from-amber-500/8 via-amber-500/14 to-amber-500/8 px-3 py-2.5 shadow-[0_10px_30px_rgba(245,158,11,.14),inset_0_1px_0_rgba(251,191,36,.12)]">
                    <div className="relative z-10 flex items-center gap-2.5 text-left">
                      <span aria-hidden="true" className="cbat-date-warning-icon grid h-7 w-7 shrink-0 place-items-center rounded-full border border-amber-400/60 bg-amber-500/15 text-xs font-black text-amber-600">!</span>
                      <div>
                        <p className="text-xs font-black text-amber-600">Choose carefully — you cannot change this date.</p>
                        <p className="mt-0.5 text-[10px] font-semibold text-amber-600/90">Check it before you click Continue.</p>
                      </div>
                    </div>
                  </div>
                )}
                <button type="button" disabled={!dateChoice} onClick={() => setConfirmingDate(true)} className="w-full rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-xs font-extrabold py-2.5 shadow-[0_10px_24px_rgba(37,99,235,.22)] transition-all hover:-translate-y-0.5 active:translate-y-0">Continue</button>
              </div>
            ) : (
              <div className="cbat-room-enter rounded-2xl border border-brand-400/30 bg-surface/80 backdrop-blur px-4 py-4 shadow-xl">
                <p className="text-xs text-slate-500">Confirm your CBAT date</p>
                <p className="text-xl font-black text-game-text my-1">{new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${dateChoice}T00:00:00Z`))}</p>
                <p className="text-[11px] font-semibold text-amber-600 mb-4">This cannot be changed after you confirm.</p>
                <div className="flex gap-2">
                  <button type="button" disabled={dateBusy} onClick={() => setConfirmingDate(false)} className="flex-1 rounded-xl border border-game-line py-2 text-xs font-bold text-slate-500 hover:border-brand-400 transition-colors">Back</button>
                  <button type="button" disabled={dateBusy} onClick={saveCbatDate} className="flex-[1.5] rounded-xl bg-brand-600 py-2 text-xs font-extrabold text-white shadow-[0_10px_24px_rgba(37,99,235,.25)] transition-all hover:-translate-y-0.5 disabled:opacity-50">{dateBusy ? 'Joining…' : 'Confirm & join'}</button>
                </div>
              </div>
            )}
            {dateError && <p className="mt-3 text-xs text-red-400">{dateError}</p>}
          </div>
        </div>
      ) : <div key={room} className={`${room === 'group' ? 'cbat-room-enter-right' : 'cbat-room-enter-left'} flex-1 min-h-0 flex flex-col`}>

      {room === 'lounge' && <ActivityStrip activity={activity} />}

      <div
        ref={scrollRef}
        onScroll={e => {
          const el = e.currentTarget
          atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK_PX
        }}
        className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-1.5"
      >
        {loading ? (
          <p className="text-xs text-slate-500 text-center py-6">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-6">
            Nobody has said anything yet. Say hello.
          </p>
        ) : (
          visible.map(m => {
            const prof    = senders[String(m.senderUserId ?? '')]
            const name     = senderName(m.senderUserId, senders, m.senderDisplayName) || 'Unknown agent'
            const isBot   = prof
              ? Boolean(prof.isBot)
              : Boolean(lounge?.botName) && m.senderDisplayName === lounge.botName
            const mineTag = (m.mentions ?? []).some(id => String(id) === String(user?._id))
            const acting  = canPost && !m.deleted
            const mine    = String(m.senderUserId ?? '') === String(user?._id)
            const canOpenUser   = !mine && Boolean(m.senderUserId)
            const nameColourFor = isBot ? 'var(--color-game-accent)' : nameColour(m.senderUserId)
            // Exactly the rule the full room uses, enforced again by the
            // endpoint: your own messages, and admins on anyone's. Not gated on
            // canPost — being unable to speak is no reason to lose sight of who
            // read what you already said.
            const canSeen = viewerIsAdmin || (mine && !m.deleted)
            // Both decided by the server: an admin on anything, or the author
            // within an hour of posting. The rule has a clock in it, so the
            // client never tries to work it out — see serializeMessage.
            const canEdit   = Boolean(m.canEdit)
            const canDelete = Boolean(m.canDelete)
            const hasActions  = acting || canSeen || canEdit || canDelete
            const actionsOpen = openActionsId === String(m._id)
            // Every action puts the bar away behind it. Where it was opened by
            // a tap it would otherwise sit over the conversation until another
            // row was touched; where it was opened by hover it costs nothing.
            const act = (fn) => () => { setOpenActionsId(null); fn() }
            return (
              <div
                key={m._id}
                data-msg-row={String(m._id)}
                // The message itself is the tap target. The full room can afford
                // a dedicated "⋯" button in the corner of every row; at this
                // size that would be a 12px target competing with the text it
                // sits on, so the row does the job instead.
                //
                // Clicks that land on a button are left alone — the action bar,
                // the reaction pills and the emoji picker all live inside this
                // row, and toggling the bar out from under the thing you just
                // pressed would make every one of them a fight.
                onClick={(e) => {
                  if (!hasActions) return
                  if (e.target?.closest?.('button')) return
                  setOpenActionsId(cur => (cur === String(m._id) ? null : String(m._id)))
                }}
                className={`group relative text-xs leading-snug break-words ${
                  mineTag ? 'bg-brand-600/10 border-l-2 border-l-brand-400 -mx-1 px-1 rounded' : ''
                }`}
              >
                {m.replyTo && <ReplyQuote replyTo={m.replyTo} senders={senders} />}
                <p title={formatTime(m.createdAt)}>
                  {/* Same rule as the full room: anyone but yourself who still
                      has an id. A button so the row's own click handler leaves
                      it alone — a tap on a name should open the person, not
                      toggle the action bar underneath. */}
                  {canOpenUser ? (
                    <button
                      type="button"
                      onClick={() => setCardUserId(String(m.senderUserId))}
                      className="font-bold hover:underline"
                      style={{ color: nameColourFor }}
                    >
                      {name}
                    </button>
                  ) : (
                    <span className="font-bold" style={{ color: nameColourFor }}>
                      {name}
                    </span>
                  )}
                  {isBot && (
                    <span className="ml-1 px-1 py-px rounded bg-brand-600/15 text-brand-600 text-[8px] font-extrabold uppercase tracking-wide align-middle">
                      Bot
                    </span>
                  )}
                  <span className="text-slate-500">: </span>
                  <span className={`whitespace-pre-wrap ${m.deleted ? 'text-slate-500 line-through opacity-60' : 'text-game-text'}`}>
                    <MessageBody message={m} senders={senders} currentUserId={user?._id} />
                  </span>
                  {m.edited && !m.deleted && (
                    // Everyone sees the marker; only an admin can open what is
                    // behind it. The history is a moderation record, not a
                    // public diff — see `edits` in models/ChatMessage.js.
                    viewerIsAdmin ? (
                      <button
                        type="button"
                        onClick={() => setEditsMsg(m)}
                        title="Show edit history"
                        className="text-[9px] text-slate-500 hover:text-brand-600 underline underline-offset-2 ml-1"
                      >
                        (edited)
                      </button>
                    ) : (
                      <span className="text-[9px] text-slate-500 ml-1" title="This message was edited">(edited)</span>
                    )
                  )}
                </p>
                {/* Admin-only, because nobody else receives a removed message.
                    Which removal it was matters to a moderator: an author
                    tidying up after themselves is not an incident, and reading
                    every withdrawn message as one would bury the ones that are. */}
                {m.deleted && (
                  <p className="text-[9px] italic text-slate-500">
                    {String(m.deletedByUserId ?? '') === String(m.senderUserId ?? '')
                      ? 'Removed by the author'
                      : 'Removed by a moderator'}
                  </p>
                )}

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
                {hasActions && (
                  <span
                    data-testid={`lounge-actions-${m._id}`}
                    className={`absolute top-0 right-0 ${actionsOpen ? 'flex' : 'hidden'} group-hover:flex gap-0.5 rounded-md bg-game-panel border border-game-line px-0.5`}
                  >
                    {canSeen && (
                      <button
                        type="button"
                        onClick={act(() => setSeenByMsg(m))}
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
                        onClick={act(() => setPicking(p => (p === String(m._id) ? null : String(m._id))))}
                        aria-label="Add a reaction"
                        className="px-1 text-[11px] text-slate-500 hover:text-brand-600 transition-colors"
                      >
                        ☺+
                      </button>
                    )}
                    {acting && (
                      <button
                        type="button"
                        onClick={act(() => startReply(m))}
                        aria-label="Reply"
                        className="px-1 text-[11px] text-slate-500 hover:text-brand-600 transition-colors"
                      >
                        ↰
                      </button>
                    )}
                    {canEdit && (
                      <button
                        type="button"
                        onClick={act(() => startEdit(m))}
                        aria-label="Edit"
                        title="Edit"
                        className="px-1 text-[11px] text-slate-500 hover:text-brand-600 transition-colors"
                      >
                        ✎
                      </button>
                    )}
                    {/* Red, and last in the row: the one action here that
                        cannot be undone should not sit next to Reply looking
                        like the rest of them. */}
                    {canDelete && (
                      <button
                        type="button"
                        onClick={act(() => removeMessage(m))}
                        aria-label={mine ? 'Remove your message' : 'Remove this message'}
                        title={mine ? 'Remove your message' : 'Remove this message'}
                        className="px-1 text-[11px] text-red-400 hover:text-red-300 transition-colors"
                      >
                        ✕
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

      {err && <p className="shrink-0 text-[11px] text-red-400 px-3 py-1.5 border-t border-game-line">{err}</p>}

      {needsName ? (
        <div className="shrink-0 border-t border-game-line">
          <DisplayNameGate onDone={() => {
            // Optimistic so the composer appears the instant the name saves,
            // then confirmed by the refetch — which is also what catches any
            // other reason this user still cannot post.
            setNeedsName(false)
            setLounge(l => (l ? { ...l, canPost: true, displayNameRequired: false } : l))
            setLoungeReload(n => n + 1)
          }} />
        </div>
      ) : !canPost ? (
        <p className="shrink-0 text-[11px] text-slate-500 px-3 py-2.5 border-t border-game-line text-center">
          {lounge?.chatBanned
            ? 'You cannot post in chat.'
            : lounge?.postBlockedMessage || 'You cannot post here right now.'}
        </p>
      ) : (
        <div className="shrink-0 border-t border-game-line">
          {editing && (
            <div className="flex items-center gap-1.5 px-2 pt-1.5 text-[10px] min-w-0">
              <span className="text-brand-600 font-semibold shrink-0">Editing</span>
              <span className="text-slate-500 truncate">{editing.body}</span>
              <button
                type="button"
                onClick={cancelEdit}
                aria-label="Cancel edit"
                className="ml-auto shrink-0 px-1 text-slate-500 hover:text-slate-400"
              >
                ✕
              </button>
            </div>
          )}
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
                className="shrink-0 px-2 py-1.5 rounded-lg border border-game-line text-[11px] font-bold text-slate-500 hover:text-brand-600 hover:border-brand-400 transition-colors"
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
                if (e.key === 'Enter') { e.preventDefault(); editing ? saveEdit() : send() }
                // Only while editing. Escape on an empty composer would
                // otherwise have nothing to do, and on a half-typed message it
                // would throw the message away.
                if (e.key === 'Escape' && editing) { e.preventDefault(); cancelEdit() }
              }}
              placeholder={editing ? 'Edit your message…' : 'Message the lounge…'}
              className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-surface border border-game-line focus:border-brand-400 outline-none text-xs text-game-text placeholder:text-slate-500"
            />
            <button
              type="button"
              onClick={editing ? saveEdit : send}
              disabled={busy || !draft.trim()}
              className="shrink-0 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white font-bold rounded-lg text-xs transition-colors"
            >
              {editing ? 'Save' : 'Send'}
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
      {editsMsg && (
        <EditHistoryDialog
          key={editsMsg._id}
          message={editsMsg}
          senders={senders}
          onClose={() => setEditsMsg(null)}
        />
      )}
      {cardUserId && (
        <UserCard
          userId={cardUserId}
          onClose={() => setCardUserId(null)}
          // A DM has no home on the hub, so it opens in Community.
          onOpenDm={(id) => { setCardUserId(null); navigate(`/chat/${id}`) }}
          // Carries the hub so the profile's Back button returns here.
          onViewProfile={(id) => {
            setCardUserId(null)
            navigate(`/agent/${id}`, {
              state: { backTo: location.pathname, backLabel: 'Back to CBAT' },
            })
          }}
          // Their messages have just left (or rejoined) the room server-side.
          // The stream does not announce a block — it is private to the person
          // who did it — so refetch rather than waiting for the fallback poll.
          onBlockChanged={() => { loadMessages().catch(() => {}) }}
        />
      )}
      </div>}
    </div>
  )
}
