import { useState } from 'react'
import { useAuth } from '../../../context/AuthContext'

// Admin composer for an announcements channel.
//
// "Draft from GitHub" reads recent commits and asks the AI for short
// player-facing update notes. Nothing is published by that step — each draft
// arrives as an editable card the admin posts or discards individually. Commit
// messages are written for developers and regularly describe things a player
// would not understand or should not be told, so a human approves every one.
export default function AnnouncementDrafter({ conversationId, onPosted }) {
  const { API, apiFetch } = useAuth()
  const [drafts,  setDrafts]  = useState(null)   // null = never run
  const [meta,    setMeta]    = useState(null)
  const [loading, setLoading] = useState(false)
  const [posting, setPosting] = useState(null)
  const [err,     setErr]     = useState('')
  const [manual,  setManual]  = useState('')

  const draftFromGithub = async () => {
    setLoading(true); setErr('')
    try {
      const r = await apiFetch(`${API}/api/chat/admin/channels/${conversationId}/draft-updates`, {
        method: 'POST', credentials: 'include',
      })
      const d = await r.json().catch(() => null)
      if (!r.ok) throw new Error(d?.message || 'Could not draft updates')
      setDrafts((d.data?.updates ?? []).map((u, i) => ({ ...u, key: `${Date.now()}-${i}` })))
      setMeta({ considered: d.data?.commitsConsidered ?? 0, skipped: d.data?.skipped ?? 0 })
    } catch (e) {
      setErr(e.message || 'Could not draft updates')
    } finally {
      setLoading(false)
    }
  }

  const post = async ({ text, shas, key }) => {
    const body = (text ?? '').trim()
    if (!body) return
    setPosting(key ?? 'manual'); setErr('')
    try {
      const r = await apiFetch(`${API}/api/chat/admin/channels/${conversationId}/announce`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, shas: shas ?? [] }),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok) throw new Error(d?.message || 'Could not post that update')
      if (key) setDrafts(prev => (prev ?? []).filter(x => x.key !== key))
      else setManual('')
      onPosted?.()
    } catch (e) {
      setErr(e.message || 'Could not post that update')
    } finally {
      setPosting(null)
    }
  }

  const editDraft = (key, text) =>
    setDrafts(prev => (prev ?? []).map(d => (d.key === key ? { ...d, text } : d)))

  const inputClass = 'w-full resize-none px-3 py-2 rounded-xl border border-slate-200 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none text-sm'

  return (
    <div className="border-t border-slate-200 p-3 space-y-3">
      {/* Drafts awaiting approval */}
      {drafts !== null && (
        drafts.length === 0 ? (
          <p className="text-xs text-slate-400">
            Nothing player-facing in the recent commits
            {meta?.skipped ? ` (${meta.skipped} already announced)` : ''}. Write one below instead.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              {drafts.length} draft{drafts.length === 1 ? '' : 's'} — edit, then post or discard
            </p>
            {drafts.map(d => (
              <div key={d.key} className="rounded-xl border border-slate-200 bg-slate-50 p-2 space-y-2">
                <textarea
                  rows={3}
                  value={d.text}
                  onChange={e => editDraft(d.key, e.target.value)}
                  className={inputClass}
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => post(d)}
                    disabled={posting === d.key || !d.text.trim()}
                    className="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-bold rounded-lg text-xs transition-colors"
                  >
                    {posting === d.key ? 'Posting…' : 'Approve & post'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDrafts(prev => (prev ?? []).filter(x => x.key !== d.key))}
                    className="px-3 py-1.5 text-slate-600 hover:text-slate-700 border border-slate-200 hover:bg-slate-100 font-bold rounded-lg text-xs transition-colors"
                  >
                    Discard
                  </button>
                  {d.shas?.length > 0 && (
                    <span className="text-[10px] text-slate-400 ml-auto truncate">
                      {d.shas.join(', ')}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {err && <p className="text-xs text-red-600">{err}</p>}

      {/* Write one by hand */}
      <div className="flex items-end gap-2">
        <textarea
          rows={1}
          value={manual}
          onChange={e => setManual(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); post({ text: manual }) }
          }}
          placeholder="Write an announcement…"
          className={inputClass}
        />
        <button
          type="button"
          onClick={() => post({ text: manual })}
          disabled={posting === 'manual' || !manual.trim()}
          className="px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-bold rounded-xl text-sm transition-colors shrink-0"
        >
          Post
        </button>
      </div>

      <button
        type="button"
        onClick={draftFromGithub}
        disabled={loading}
        className="w-full px-3 py-1.5 text-xs font-bold text-brand-600 hover:text-brand-700 border border-brand-200 hover:bg-brand-100 rounded-lg transition-colors disabled:opacity-50"
      >
        {loading ? 'Reading recent updates…' : '✨ Draft updates from GitHub'}
      </button>
    </div>
  )
}
