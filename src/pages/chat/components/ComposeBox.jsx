import { useState } from 'react'

export default function ComposeBox({ disabled, busy, onSend, placeholder }) {
  const [body, setBody] = useState('')

  const handleSend = () => {
    const text = body.trim()
    if (!text || disabled || busy) return
    onSend(text)
    setBody('')
  }

  return (
    <div className="border-t border-slate-200 p-3 flex items-end gap-2">
      <textarea
        rows={1}
        disabled={disabled}
        value={body}
        onChange={e => setBody(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
        }}
        placeholder={placeholder ?? (disabled ? 'This chat is closed.' : 'Type a message…')}
        className="flex-1 resize-none px-3 py-2 rounded-xl border border-slate-200 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none text-sm disabled:opacity-50"
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
  )
}
