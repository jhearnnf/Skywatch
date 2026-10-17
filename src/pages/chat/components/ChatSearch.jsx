import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { formatStamp } from '../format'
import { senderName } from '../senderName'
import { excerptAround } from '../searchExcerpt'

// Search a conversation's history, Discord-style: type, get a list of matching
// messages newest first, pick one and the thread jumps to it (see the `around`
// paging on GET /conversations/:id/messages).
//
// One component for both places it lives. Community searches the room you are
// in, so it gets one room and no picker. The CBAT lounge widget searches
// several public rooms at once, so it gets a row of toggles and every result
// says which room it came from.

const MIN_CHARS = 2
// Long enough that a normal typist only fires once per word.
const DEBOUNCE_MS = 300

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The magnifying glass on the buttons that open search. Drawn rather than the
// 🔍 emoji, which renders tiny and blurry at header sizes and in a different
// style on every platform.
export function SearchIcon({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  )
}

function Highlighted({ text, query }) {
  if (!query) return text
  const parts = text.split(new RegExp(`(${escapeRe(query)})`, 'ig'))
  return parts.map((part, i) => (
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i} className="bg-amber-400/30 text-inherit rounded-sm px-px">{part}</mark>
      : part
  ))
}

export default function ChatSearch({
  // [{ key, conversationId, title }]. More than one draws the room toggles.
  rooms,
  // Keys switched on at open. Defaults to every room.
  initialSelected = null,
  onPick,
  onClose,
  // The lounge widget is a few hundred pixels wide; the type steps down a size.
  compact = false,
}) {
  const { API } = useAuth()
  const [query, setQuery]       = useState('')
  const [selected, setSelected] = useState(() => new Set(initialSelected ?? rooms.map(r => r.key)))
  const [results, setResults]   = useState([])
  const [senders, setSenders]   = useState({})
  const [hasMore, setHasMore]   = useState(false)
  const [loading, setLoading]   = useState(false)
  const [err, setErr]           = useState('')
  // The query the results on screen answer, so highlighting and "no matches"
  // never describe a newer query that is still in flight.
  const [answered, setAnswered] = useState('')
  const inputRef = useRef(null)
  const seqRef   = useRef(0)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const ids = rooms.filter(r => selected.has(r.key)).map(r => String(r.conversationId))
  const idsKey = ids.join(',')
  const q = query.trim()

  // Plain fetch rather than apiFetch: the wrapper puts a loading overlay over
  // the whole page after 400ms, which is wrong for search-as-you-type.
  const run = async ({ before = null } = {}) => {
    const seq = ++seqRef.current
    setLoading(true); setErr('')
    try {
      const params = new URLSearchParams({ q, in: idsKey })
      if (before) params.set('before', before)
      const r = await fetch(`${API}/api/chat/search?${params}`, { credentials: 'include' })
      const d = await r.json().catch(() => null)
      if (seq !== seqRef.current) return
      if (!r.ok) throw new Error(d?.message || 'Search failed. Try again.')
      const data = d?.data ?? {}
      setResults(prev => (before ? [...prev, ...(data.results ?? [])] : (data.results ?? [])))
      setSenders(prev => ({ ...(before ? prev : {}), ...(data.senders ?? {}) }))
      setHasMore(Boolean(data.hasMore))
      setAnswered(q)
    } catch (e) {
      if (seq === seqRef.current) setErr(e.message)
    } finally {
      if (seq === seqRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    if (q.length < MIN_CHARS || !idsKey) {
      seqRef.current++
      setResults([]); setHasMore(false); setAnswered(''); setLoading(false); setErr('')
      return
    }
    const id = setTimeout(() => { run() }, DEBOUNCE_MS)
    return () => clearTimeout(id)
    // `run` reads q and idsKey, which are the dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, idsKey])

  const toggle = (key) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(key)) {
      // Never none: a search across no rooms can only ever say "no matches".
      if (next.size > 1) next.delete(key)
    } else next.add(key)
    return next
  })

  const roomFor = (id) => rooms.find(r => String(r.conversationId) === String(id))
  const text = compact ? 'text-[11px]' : 'text-xs'

  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="chat-search">
      <div className="shrink-0 p-2 space-y-2 border-b border-slate-200">
        <div className="flex items-center gap-1.5">
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search messages"
            aria-label="Search messages"
            maxLength={100}
            className={`flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-surface border border-slate-200 focus:border-brand-400 outline-none ${text} text-slate-800 placeholder:text-slate-500`}
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className={`shrink-0 px-2 py-1.5 rounded-lg border border-slate-200 hover:border-brand-400 ${text} text-slate-500 hover:text-slate-700 transition-colors`}
          >
            ✕
          </button>
        </div>
        {rooms.length > 1 && (
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Rooms to search">
            <span className="text-[10px] text-slate-500 mr-0.5">Search in</span>
            {rooms.map(r => {
              const on = selected.has(r.key)
              return (
                <button
                  key={r.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(r.key)}
                  className={`px-2 py-0.5 rounded-md border text-[10px] font-bold transition-colors ${on
                    ? 'border-brand-400/70 bg-brand-600 text-white'
                    : 'border-slate-200 text-slate-500 hover:border-brand-400 hover:text-brand-700'}`}
                >
                  {r.title}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-inset p-1.5">
        {q.length < MIN_CHARS ? (
          <p className={`${text} text-slate-500 text-center py-6 px-4`}>
            Type a word or phrase to find messages that mention it.
          </p>
        ) : err ? (
          <p className={`${text} text-red-400 text-center py-6 px-4`}>{err}</p>
        ) : loading && !results.length ? (
          <p className={`${text} text-slate-500 text-center py-6`}>Searching…</p>
        ) : answered && !results.length ? (
          <p className={`${text} text-slate-500 text-center py-6 px-4`}>No messages match "{answered}".</p>
        ) : (
          <ul className="space-y-0.5">
            {results.map(m => {
              const room = roomFor(m.conversationId)
              return (
                <li key={m._id}>
                  <button
                    type="button"
                    onClick={() => onPick?.(m, room)}
                    data-testid="search-result"
                    className="w-full text-left rounded-lg px-2 py-1.5 hover:bg-brand-500/[0.08] focus:bg-brand-500/[0.08] outline-none transition-colors"
                  >
                    <span className="flex items-baseline gap-1.5 min-w-0">
                      <span className={`${text} font-bold text-slate-700 truncate`}>
                        {senderName(m.senderUserId, senders, m.senderDisplayName) || 'Unknown agent'}
                      </span>
                      {rooms.length > 1 && room && (
                        <span className="shrink-0 text-[9px] font-bold text-brand-600">{room.title}</span>
                      )}
                      <span className="ml-auto shrink-0 text-[9px] text-slate-500">{formatStamp(m.createdAt)}</span>
                    </span>
                    <span className={`block ${text} text-slate-600 leading-snug break-words`}>
                      <Highlighted text={excerptAround(m.body, answered)} query={answered} />
                    </span>
                  </button>
                </li>
              )
            })}
            {hasMore && (
              <li className="flex justify-center py-1.5">
                <button
                  type="button"
                  onClick={() => run({ before: results[results.length - 1]?.createdAt })}
                  disabled={loading}
                  className="text-[11px] font-semibold text-brand-600 hover:text-brand-700 px-2 py-1 rounded-lg border border-slate-200 hover:border-brand-400 disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Loading…' : 'Show older matches'}
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  )
}
