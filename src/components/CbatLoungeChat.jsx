import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useAppSettings } from '../context/AppSettingsContext'
import { NATIVE_APP } from '../utils/appMode'
import { nameColour } from '../pages/chat/nameColour'
import { formatTime } from '../pages/chat/format'
import DisplayNameGate from '../pages/chat/components/DisplayNameGate'

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

  const scrollRef = useRef(null)
  const inputRef  = useRef(null)
  // Read by the stream handler, which is set up once and would otherwise close
  // over the open state as it was when the connection opened.
  const openRef   = useRef(open)
  openRef.current = open

  const conversationId = lounge?.conversationId ?? null
  const enabled = Boolean(user) && !NATIVE_APP && settings?.chatEnabled !== false

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

  const loadMessages = useCallback(async () => {
    if (!conversationId) return
    const { ok, data } = await get(`/api/chat/conversations/${conversationId}/messages?limit=${MESSAGE_LIMIT}`)
    if (!ok || !data) return
    setMessages(data.messages ?? [])
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

  const send = async () => {
    const text = draft.trim()
    if (!text || busy || !conversationId) return
    setBusy(true); setErr('')
    try {
      const r = await apiFetch(`${API}/api/chat/conversations/${conversationId}/messages`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok) {
        // The server is the authority on this, not the flag we loaded earlier.
        if (d?.code === 'DISPLAY_NAME_REQUIRED') { setNeedsName(true); return }
        throw new Error(d?.message || 'Could not send that')
      }
      setDraft('')
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

  // Prefill the composer with the mention rather than sending anything: the
  // question is still theirs to write, and the bot only answers when addressed.
  const askBot = () => {
    if (!lounge?.botName) return
    setDraft(d => (d.includes(`@${lounge.botName}`) ? d : `@${lounge.botName} ${d}`.trim() + ' '))
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

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-1.5">
        {loading ? (
          <p className="text-xs text-slate-500 text-center py-6">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-6">
            Nobody has said anything yet. Say hello.
          </p>
        ) : (
          messages.map(m => {
            const isBot   = Boolean(lounge?.botName) && m.senderDisplayName === lounge.botName
            const mineTag = (m.mentions ?? []).some(id => String(id) === String(user?._id))
            return (
              <p
                key={m._id}
                className={`text-xs leading-snug break-words ${
                  mineTag ? 'bg-brand-600/10 border-l-2 border-l-brand-400 -mx-1 px-1 rounded' : ''
                }`}
                title={formatTime(m.createdAt)}
              >
                <span
                  className="font-bold"
                  style={{ color: isBot ? '#5baaff' : nameColour(m.senderUserId) }}
                >
                  {m.senderDisplayName || 'Unknown agent'}
                </span>
                {isBot && (
                  <span className="ml-1 px-1 py-px rounded bg-brand-600/15 text-brand-600 text-[8px] font-extrabold uppercase tracking-wide align-middle">
                    Bot
                  </span>
                )}
                <span className="text-slate-500">: </span>
                <span className="text-[#ddeaf8] whitespace-pre-wrap">{m.body}</span>
              </p>
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
        <div className="shrink-0 border-t border-[#1a3a5c] p-2 flex items-center gap-1.5">
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
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); send() } }}
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
      )}
    </div>
  )
}
