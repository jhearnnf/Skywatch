import { useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import Overlay from '../../../components/ui/Overlay'

// Reports go to the admins only — they land in Admin › Intel › Reports tagged
// as chat moderation. Nothing is shown to the reported user, and the report is
// not visible to anyone else.
export default function ReportMessageDialog({ message, onClose, onReported }) {
  const { API, apiFetch } = useAuth()
  const [reason, setReason] = useState('')
  const [busy,   setBusy]   = useState(false)
  const [err,    setErr]    = useState('')

  const submit = async () => {
    if (busy) return
    setBusy(true); setErr('')
    try {
      const r = await apiFetch(`${API}/api/chat/messages/${message._id}/report`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok) throw new Error(d?.message || 'Could not send that report')
      onReported?.()
    } catch (e) {
      setErr(e.message || 'Could not send that report')
      setBusy(false)
    }
  }

  return (
    <Overlay onDismiss={onClose} className="flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-surface rounded-2xl border border-slate-200 card-shadow p-5">
        <p className="text-base font-extrabold text-slate-800 mb-1">Report this message</p>
        <p className="text-xs text-slate-500 mb-3">
          The SkyWatch team will review it. The sender is not told who reported them.
        </p>

        <div className="rounded-xl bg-slate-100 border border-slate-200 px-3 py-2 mb-3">
          <p className="text-[10px] font-semibold text-slate-500 mb-0.5">
            {message.senderDisplayName || 'Unknown agent'}
          </p>
          <p className="text-xs text-slate-700 whitespace-pre-wrap break-words line-clamp-4">
            {message.body}
          </p>
        </div>

        <textarea
          rows={3}
          value={reason}
          onChange={e => setReason(e.target.value)}
          maxLength={500}
          placeholder="What's wrong with it? (optional)"
          className="w-full resize-none px-3 py-2 rounded-xl border border-slate-200 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none text-sm"
        />

        {err && <p className="text-xs text-red-600 mt-2">{err}</p>}

        <div className="flex items-center gap-2 mt-4">
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="flex-1 px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-bold rounded-xl text-sm transition-colors"
          >
            {busy ? 'Sending…' : 'Send report'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-slate-600 hover:text-slate-700 border border-slate-200 hover:bg-slate-100 font-bold rounded-xl text-sm transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </Overlay>
  )
}
