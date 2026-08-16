import { useLayoutEffect, useRef, useState } from 'react'
import MentionPicker from './MentionPicker'
import { activeMention } from '../mentions'

// Roughly eight lines of the composer's text size, after which it scrolls.
const MAX_HEIGHT = 160

export default function ComposeBox({
  disabled, busy, onSend, placeholder, replyTo, onCancelReply,
  // Enables the @ autocomplete. Absent in support threads, where there is
  // nobody to mention.
  mentionConversationId,
}) {
  const [body, setBody] = useState('')
  const [caret, setCaret] = useState(0)
  // The offset of an "@" the user pressed Escape on, so dismissing stays
  // dismissed until they start a different mention.
  const [dismissed, setDismissed] = useState(null)
  const inputRef = useRef(null)

  const mention = mentionConversationId ? activeMention(body, caret) : null
  const showPicker = Boolean(mention) && mention.start !== dismissed

  // A one-row textarea hides everything above the last line once the message
  // wraps, so grow the box to fit what has been typed. Past MAX_HEIGHT it stops
  // growing and scrolls instead, so the composer can never eat the thread.
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`
  }, [body])

  const syncCaret = (e) => setCaret(e.target.selectionStart ?? 0)

  const handleSend = () => {
    const text = body.trim()
    if (!text || disabled || busy) return
    onSend(text)
    setBody('')
    setDismissed(null)
  }

  // Replace the half-typed "@fal" with the full "@Falcon ", and put the caret
  // after it so typing carries straight on.
  const pickMention = (user) => {
    const insert = `@${user.displayName} `
    const next = body.slice(0, mention.start) + insert + body.slice(caret)
    const nextCaret = mention.start + insert.length
    setBody(next)
    setCaret(nextCaret)
    setDismissed(null)
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(nextCaret, nextCaret)
    })
  }

  return (
    <div className="border-t border-slate-200">
      {/* Reply target, shown above the box so it is obvious what you are
          answering before you start typing. */}
      {replyTo && (
        <div className="flex items-center gap-2 px-3 pt-2 text-[11px]">
          <span className="text-slate-400 shrink-0">Replying to</span>
          <span className="font-semibold text-slate-600 shrink-0">
            {replyTo.senderDisplayName || 'Unknown agent'}
          </span>
          <span className="text-slate-400 truncate">{replyTo.body}</span>
          <button
            type="button"
            onClick={onCancelReply}
            className="ml-auto shrink-0 text-slate-400 hover:text-slate-600 px-1"
            aria-label="Cancel reply"
          >
            ✕
          </button>
        </div>
      )}
      <div className="p-3 flex items-end gap-2 relative">
      {showPicker && (
        <MentionPicker
          conversationId={mentionConversationId}
          query={mention.query}
          onPick={pickMention}
          onDismiss={() => setDismissed(mention.start)}
        />
      )}
      <textarea
        ref={inputRef}
        rows={1}
        disabled={disabled}
        value={body}
        onChange={e => { setBody(e.target.value); syncCaret(e) }}
        onSelect={syncCaret}
        onKeyUp={syncCaret}
        onClick={syncCaret}
        onKeyDown={e => {
          // While the picker is open it owns Enter — it completes the mention
          // rather than sending a half-typed name. See its capture-phase
          // listener, which runs before this.
          if (showPicker && ['Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'Escape'].includes(e.key)) return
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
        }}
        placeholder={placeholder ?? (disabled ? 'This chat is closed.' : 'Type a message…')}
        className="flex-1 resize-none overflow-y-auto px-3 py-2 rounded-xl border border-slate-200 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none text-sm disabled:opacity-50"
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
    </div>
  )
}
