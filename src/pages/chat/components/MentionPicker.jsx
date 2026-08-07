import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'

// The "@" autocomplete.
//
// With nothing typed after the "@" this lists only the bots — reaching for
// Guide Bot is what "@" is mostly for, and a default list of arbitrary
// strangers would be noise. Typing then searches agents by display name.
//
// Accounts with no display name are never offered: "Agent #1234567" is an
// account identifier, not a name someone chose, and listing those would turn
// the picker into a directory of everyone who has ever signed up.
const DEBOUNCE_MS = 150

export default function MentionPicker({ conversationId, query, onPick, onDismiss }) {
  const { API, apiFetch } = useAuth()
  const [items,  setItems]  = useState([])
  const [active, setActive] = useState(0)
  const seq = useRef(0)

  useEffect(() => {
    // Every keystroke changes the query, so responses can land out of order —
    // a slow request for "fa" must not overwrite the results for "falcon".
    const mine = ++seq.current
    const timer = setTimeout(() => {
      apiFetch(
        `${API}/api/chat/conversations/${conversationId}/mention-suggestions?q=${encodeURIComponent(query)}`,
        { credentials: 'include' },
      )
        .then(r => (r.ok ? r.json() : null))
        .then(d => {
          if (seq.current !== mine) return
          setItems(d?.data?.suggestions ?? [])
          setActive(0)
        })
        .catch(() => {})
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [API, apiFetch, conversationId, query])

  // Keyboard driving lives here rather than in ComposeBox so the arrow keys can
  // move the highlight without the textarea also moving the caret.
  useEffect(() => {
    const onKey = (e) => {
      if (!items.length) return
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (a + 1) % items.length) }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActive(a => (a - 1 + items.length) % items.length) }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); onPick(items[active]) }
      if (e.key === 'Escape')    { e.preventDefault(); onDismiss() }
    }
    // Capture, so this runs before the textarea's own Enter-to-send handler —
    // Enter while the picker is open completes the mention, it does not send.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [items, active, onPick, onDismiss])

  if (!items.length) return null

  return (
    <div className="absolute bottom-full left-3 right-3 mb-1 bg-surface border border-slate-200 rounded-xl card-shadow overflow-hidden z-20">
      <ul className="max-h-52 overflow-y-auto">
        {items.map((u, i) => (
          <li key={u._id}>
            <button
              type="button"
              // Mouse down rather than click: the textarea loses focus on
              // blur, and click would fire after the picker had already closed.
              onMouseDown={e => { e.preventDefault(); onPick(u) }}
              onMouseEnter={() => setActive(i)}
              className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-colors
                ${i === active ? 'bg-slate-100' : ''}`}
            >
              <span className="text-sm font-semibold text-slate-700 truncate">{u.displayName}</span>
              {u.isBot && (
                <span className="text-[9px] font-bold px-1 py-px rounded bg-brand-200/60 text-brand-700 uppercase tracking-wide shrink-0">
                  Bot
                </span>
              )}
              {u.isAdmin && !u.isBot && (
                <span className="text-[9px] font-semibold text-brand-600 shrink-0">Staff</span>
              )}
              {u.description && (
                <span className="text-[11px] text-slate-400 truncate ml-auto">{u.description}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
