import { useRef, useState } from 'react'
import MentionPicker from './MentionPicker'
import { activeMention } from '../mentions'
import { senderName } from '../senderName'
import { enterShouldSend } from '../enterSends'
import { useAutoGrow } from '../autoGrow'

export default function ComposeBox({
  disabled, busy, onSend, placeholder, replyTo, onCancelReply,
  // Live sender profiles for the thread, so "Replying to X" uses the name the
  // author goes by now rather than the one stored on the message.
  senders,
  // Enables the @ autocomplete. Absent in support threads, where there is
  // nobody to mention.
  mentionConversationId,
  // The guide bot's display name, in the rooms that offer the one-tap ask
  // button. Null everywhere else and the button is simply not drawn — the
  // server decides which rooms those are, not this component.
  botName,
}) {
  const [body, setBody] = useState('')
  const [caret, setCaret] = useState(0)
  // The offset of an "@" the user pressed Escape on, so dismissing stays
  // dismissed until they start a different mention.
  const [dismissed, setDismissed] = useState(null)
  const inputRef = useRef(null)

  const mention = mentionConversationId ? activeMention(body, caret) : null
  const showPicker = Boolean(mention) && mention.start !== dismissed

  useAutoGrow(inputRef, body)

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

  // Put "@Guide Bot " in front of whatever is typed and hand the box back.
  //
  // It fills the composer rather than sending: the button is there to save
  // people typing a name they have to spell exactly, not to send an empty
  // question. Idempotent, so a second press does not stack the mention.
  const askBot = () => {
    if (!botName) return
    const next = body.includes(`@${botName}`) ? body : `@${botName} ${body}`.trim() + ' '
    setBody(next)
    setCaret(next.length)
    setDismissed(null)
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(next.length, next.length)
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
            {senderName(replyTo.senderUserId, senders, replyTo.senderDisplayName) || 'Unknown agent'}
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
      {botName && (
        <button
          type="button"
          onClick={askBot}
          disabled={disabled}
          title={`Ask ${botName} a question`}
          aria-label={`Ask ${botName} a question`}
          className="shrink-0 px-2.5 py-2 rounded-xl border border-slate-200 text-sm text-slate-500 hover:text-brand-600 hover:border-brand-400 disabled:opacity-50 transition-colors"
        >
          🤖
        </button>
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
          if (enterShouldSend(e)) { e.preventDefault(); handleSend() }
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
