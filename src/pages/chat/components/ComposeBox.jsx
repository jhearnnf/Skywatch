import { useRef, useState } from 'react'
import MentionPicker from './MentionPicker'
import { activeMention } from '../mentions'
import { senderName } from '../senderName'
import { enterShouldSend } from '../enterSends'
import { useAutoGrow } from '../autoGrow'
import { AttachButton, AttachmentTray } from './ComposeAttachments'
import { useAttachmentTray } from './useAttachmentTray'
import { attachmentLabel } from '../attachmentLabel'
import { useOnline } from '../../../lib/useOnline'

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
  // The conversation photos and videos upload into, where this viewer may
  // send them (the server's `media.canAttach`). Null and there is no
  // paperclip at all.
  mediaConversationId = null,
}) {
  const [body, setBody] = useState('')
  const tray = useAttachmentTray(mediaConversationId)
  const online = useOnline()
  const [caret, setCaret] = useState(0)
  // The offset of an "@" the user pressed Escape on, so dismissing stays
  // dismissed until they start a different mention.
  const [dismissed, setDismissed] = useState(null)
  const inputRef = useRef(null)

  const mention = mentionConversationId ? activeMention(body, caret) : null
  const showPicker = Boolean(mention) && mention.start !== dismissed

  useAutoGrow(inputRef, body)

  const syncCaret = (e) => setCaret(e.target.selectionStart ?? 0)

  // Ready when there is something to send and no upload is still going. A
  // failed upload holds Send too: the person should retry or remove it rather
  // than have the message go without the file they meant to include.
  const hasFiles = tray.items.length > 0
  const canSend = (Boolean(body.trim()) || hasFiles) && !tray.busy && !tray.hasFailed

  const handleSend = () => {
    const text = body.trim()
    if (!canSend || disabled || busy) return
    const files = hasFiles ? tray.take() : []
    // The second argument only when there are files, so a text-only send is
    // exactly the call it always was.
    if (files.length) onSend(text, files)
    else onSend(text)
    setBody('')
    setDismissed(null)
  }

  // Paste a screenshot straight in, on desktop. Text pastes are left alone.
  const onPaste = (e) => {
    if (!mediaConversationId) return
    const files = Array.from(e.clipboardData?.files ?? []).filter(f => /^(image|video)\//.test(f.type))
    if (!files.length) return
    e.preventDefault()
    tray.add(files)
  }
  const onDrop = (e) => {
    if (!mediaConversationId || !e.dataTransfer?.files?.length) return
    e.preventDefault()
    tray.add(e.dataTransfer.files)
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
    <div
      className="border-t border-slate-200"
      onDragOver={mediaConversationId ? (e) => e.preventDefault() : undefined}
      onDrop={onDrop}
    >
      {/* Reply target, shown above the box so it is obvious what you are
          answering before you start typing. */}
      {replyTo && (
        <div className="flex items-center gap-2 px-3 pt-2 text-[11px]">
          <span className="text-slate-400 shrink-0">Replying to</span>
          <span className="font-semibold text-slate-600 shrink-0">
            {senderName(replyTo.senderUserId, senders, replyTo.senderDisplayName) || 'Unknown agent'}
          </span>
          <span className="text-slate-400 truncate">{replyTo.body || attachmentLabel(replyTo.attachments)}</span>
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
      {mediaConversationId && <AttachmentTray tray={tray} />}
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
      {mediaConversationId && (
        <AttachButton disabled={disabled} offline={!online} onFiles={tray.add} />
      )}
      <textarea
        ref={inputRef}
        onPaste={onPaste}
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
      {/* Pressing Send must not take focus off the box: on a phone that
          closes the keyboard after every message. Same as the CBAT Lounge. */}
      <button
        type="button"
        onMouseDown={e => e.preventDefault()}
        onClick={handleSend}
        disabled={disabled || busy || !canSend}
        className="px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-bold rounded-xl text-sm transition-colors"
      >
        Send
      </button>
      </div>
    </div>
  )
}
