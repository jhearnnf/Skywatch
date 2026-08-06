import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'

const EMPTY_DRAFT = { name: '', description: '', emoji: '', order: 0, adminOnly: false }

function fmtDate(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

// Create, edit, archive and (deliberately separately) permanently delete chat
// channels.
//
// "Delete" in this UI archives: the channel vanishes for users but every
// message stays readable in the moderation console. Permanently destroying a
// transcript is a second, explicit action on an already-archived channel — the
// backend refuses to purge a live one.
export default function ChatChannelsEditor({ API, Toast }) {
  const { apiFetch } = useAuth()

  const [channels, setChannels] = useState([])
  const [loading,  setLoading]  = useState(false)
  const [draft,    setDraft]    = useState(EMPTY_DRAFT)
  const [editingId, setEditingId] = useState(null)
  const [busy,     setBusy]     = useState(false)
  const [err,      setErr]      = useState('')
  const [toast,    setToast]    = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await apiFetch(`${API}/api/chat/admin/channels?includeArchived=true`, {
        credentials: 'include',
      })
      const d = await r.json().catch(() => null)
      setChannels(d?.data?.channels ?? [])
    } finally {
      setLoading(false)
    }
  }, [API, apiFetch])

  useEffect(() => { load() }, [load])

  // Toast clears itself on a timer — no setTimeout needed here.
  const notify = (msg) => setToast(msg)

  const submit = async () => {
    const name = draft.name.trim()
    if (!name || busy) return
    setBusy(true); setErr('')
    try {
      const url = editingId
        ? `${API}/api/chat/admin/channels/${editingId}`
        : `${API}/api/chat/admin/channels`
      const r = await apiFetch(url, {
        method: editingId ? 'PATCH' : 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description: draft.description.trim(),
          emoji:       draft.emoji.trim(),
          order:       Number(draft.order) || 0,
          adminOnly:   Boolean(draft.adminOnly),
        }),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok) throw new Error(d?.message || 'Could not save that channel')
      setDraft(EMPTY_DRAFT)
      setEditingId(null)
      await load()
      notify(editingId ? 'Channel updated' : 'Channel created')
    } catch (e) {
      setErr(e.message || 'Could not save that channel')
    } finally {
      setBusy(false)
    }
  }

  const archive = async (channel) => {
    if (!window.confirm(
      `Archive "${channel.name}"?\n\nIt disappears for users straight away. Every message is kept and stays readable in the moderation console.`,
    )) return
    setBusy(true)
    try {
      await apiFetch(`${API}/api/chat/admin/channels/${channel._id}/archive`, {
        method: 'POST', credentials: 'include',
      })
      await load()
      notify('Channel archived')
    } finally { setBusy(false) }
  }

  const unarchive = async (channel) => {
    setBusy(true); setErr('')
    try {
      const r = await apiFetch(`${API}/api/chat/admin/channels/${channel._id}/unarchive`, {
        method: 'POST', credentials: 'include',
      })
      const d = await r.json().catch(() => null)
      if (!r.ok) throw new Error(d?.message || 'Could not restore that channel')
      await load()
      notify('Channel restored')
    } catch (e) {
      setErr(e.message || 'Could not restore that channel')
    } finally { setBusy(false) }
  }

  const purge = async (channel) => {
    if (!window.confirm(
      `Permanently delete "${channel.name}" and all ${channel.messageCount} of its messages?\n\nThis cannot be undone and the transcript will be gone for good.`,
    )) return
    if (!window.confirm('Last check — this destroys the transcript. Continue?')) return
    setBusy(true); setErr('')
    try {
      const r = await apiFetch(`${API}/api/chat/admin/channels/${channel._id}`, {
        method: 'DELETE', credentials: 'include',
      })
      const d = await r.json().catch(() => null)
      if (!r.ok) throw new Error(d?.message || 'Could not delete that channel')
      await load()
      notify('Channel permanently deleted')
    } catch (e) {
      setErr(e.message || 'Could not delete that channel')
    } finally { setBusy(false) }
  }

  const startEdit = (channel) => {
    setEditingId(channel._id)
    setDraft({
      name:        channel.name ?? '',
      description: channel.description ?? '',
      emoji:       channel.emoji ?? '',
      order:       channel.order ?? 0,
      adminOnly:   Boolean(channel.adminOnly),
    })
  }

  const live     = channels.filter(c => !c.isArchived)
  const archived = channels.filter(c => c.isArchived)

  const inputClass = 'w-full px-3 py-2 rounded-xl border border-slate-300 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none text-sm bg-transparent text-slate-800'

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-slate-400">
        Channels are open to every signed-in user. Users must set a display name before they
        can post. Chat is hidden inside the Android app.
      </p>

      {/* Create / edit */}
      <div className="rounded-xl border border-slate-300 p-3 space-y-2">
        <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">
          {editingId ? 'Edit channel' : 'New channel'}
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={draft.emoji}
            onChange={e => setDraft(p => ({ ...p, emoji: e.target.value }))}
            placeholder="🛩️"
            maxLength={8}
            className={`${inputClass} w-20 text-center`}
          />
          <input
            type="text"
            value={draft.name}
            onChange={e => setDraft(p => ({ ...p, name: e.target.value }))}
            placeholder="Channel name"
            maxLength={40}
            className={inputClass}
          />
          <input
            type="number"
            value={draft.order}
            onChange={e => setDraft(p => ({ ...p, order: e.target.value }))}
            title="Sort order — lower shows first"
            className={`${inputClass} w-24`}
          />
        </div>
        <input
          type="text"
          value={draft.description}
          onChange={e => setDraft(p => ({ ...p, description: e.target.value }))}
          placeholder="What is this channel for? (optional)"
          maxLength={200}
          className={inputClass}
        />
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(draft.adminOnly)}
            onChange={e => setDraft(p => ({ ...p, adminOnly: e.target.checked }))}
            className="mt-0.5"
          />
          <span>
            <span className="block text-xs font-bold text-slate-700">Announcements only</span>
            <span className="block text-[11px] text-slate-400">
              Everyone can read it, but only admins can post. Admin posting gets a
              "draft updates from GitHub" tool in the channel.
            </span>
          </span>
        </label>
        {err && <p className="text-xs text-red-600">{err}</p>}
        <div className="flex items-center gap-2">
          <button
            onClick={submit}
            disabled={busy || !draft.name.trim()}
            className="px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl transition-colors"
          >
            {editingId ? 'Save changes' : 'Create channel'}
          </button>
          {editingId && (
            <button
              onClick={() => { setEditingId(null); setDraft(EMPTY_DRAFT); setErr('') }}
              className="px-4 py-2 text-slate-600 hover:text-slate-700 border border-slate-300 hover:bg-slate-100 text-sm font-bold rounded-xl transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Live channels */}
      <div>
        <p className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
          Live channels
        </p>
        {loading && <p className="text-xs text-slate-400">Loading…</p>}
        {!loading && live.length === 0 && (
          <p className="text-xs text-slate-400">No channels yet.</p>
        )}
        <div className="space-y-2">
          {live.map(c => (
            <div key={c._id} className="rounded-xl border border-slate-300 px-3 py-2 flex items-center gap-3">
              <span className="text-lg shrink-0">{c.emoji || '#️⃣'}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-800 truncate">{c.name}</p>
                <p className="text-[11px] text-slate-400 truncate">
                  {c.adminOnly ? 'Announcements only · ' : ''}
                  {c.description || 'No description'} · {c.messageCount} message(s) · order {c.order}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => startEdit(c)}
                  className="text-xs text-brand-600 hover:text-brand-700 px-2 py-1 rounded-lg border border-brand-200 hover:bg-brand-100 transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => archive(c)}
                  disabled={busy}
                  className="text-xs text-slate-600 hover:text-slate-700 px-2 py-1 rounded-lg border border-slate-300 hover:bg-slate-100 transition-colors"
                >
                  Archive
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Archived */}
      {archived.length > 0 && (
        <div>
          <p className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
            Archived
          </p>
          <p className="text-[11px] text-slate-400 mb-2">
            Hidden from users. Transcripts are kept and stay readable in the moderation console.
          </p>
          <div className="space-y-2">
            {archived.map(c => (
              <div key={c._id} className="rounded-xl border border-slate-300 px-3 py-2 flex items-center gap-3 opacity-80">
                <span className="text-lg shrink-0">{c.emoji || '#️⃣'}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-800 truncate">{c.name}</p>
                  <p className="text-[11px] text-slate-400 truncate">
                    Archived {fmtDate(c.archivedAt)} · {c.messageCount} message(s)
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => unarchive(c)}
                    disabled={busy}
                    className="text-xs text-brand-600 hover:text-brand-700 px-2 py-1 rounded-lg border border-brand-200 hover:bg-brand-100 transition-colors"
                  >
                    Restore
                  </button>
                  <button
                    onClick={() => purge(c)}
                    disabled={busy}
                    className="text-xs text-red-600 hover:text-red-700 px-2 py-1 rounded-lg border border-red-200 hover:bg-red-50 transition-colors"
                  >
                    Delete for good
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {Toast && <Toast msg={toast} onClear={() => setToast('')} />}
    </div>
  )
}
