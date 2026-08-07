import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'

const EMPTY_DRAFT = { title: '', url: '', description: '', emoji: '', order: 0 }

// The Guides section of the Community rail: links out to the best CBAT reading.
//
// Deliberately not channels. A guide has no messages and nothing to moderate,
// so there is no archive step — "Hide" takes it out of the rail while keeping
// the URL here, and Remove drops it for good.
export default function ChatGuidesEditor({ API, Toast }) {
  const { apiFetch } = useAuth()

  const [guides,    setGuides]    = useState([])
  const [loading,   setLoading]   = useState(false)
  const [draft,     setDraft]     = useState(EMPTY_DRAFT)
  const [editingId, setEditingId] = useState(null)
  const [busy,      setBusy]      = useState(false)
  const [err,       setErr]       = useState('')
  const [toast,     setToast]     = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await apiFetch(`${API}/api/chat/admin/guides`, { credentials: 'include' })
      const d = await r.json().catch(() => null)
      setGuides(d?.data?.guides ?? [])
    } finally {
      setLoading(false)
    }
  }, [API, apiFetch])

  useEffect(() => { load() }, [load])

  const submit = async () => {
    const title = draft.title.trim()
    const url   = draft.url.trim()
    if (!title || !url || busy) return
    setBusy(true); setErr('')
    try {
      const r = await apiFetch(
        editingId ? `${API}/api/chat/admin/guides/${editingId}` : `${API}/api/chat/admin/guides`,
        {
          method: editingId ? 'PATCH' : 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            url,
            description: draft.description.trim(),
            emoji:       draft.emoji.trim(),
            order:       Number(draft.order) || 0,
          }),
        },
      )
      const d = await r.json().catch(() => null)
      if (!r.ok) throw new Error(d?.message || 'Could not save that guide')
      setDraft(EMPTY_DRAFT)
      setEditingId(null)
      await load()
      setToast(editingId ? 'Guide updated' : 'Guide added')
    } catch (e) {
      setErr(e.message || 'Could not save that guide')
    } finally {
      setBusy(false)
    }
  }

  const setHidden = async (guide, isHidden) => {
    setBusy(true); setErr('')
    try {
      const r = await apiFetch(`${API}/api/chat/admin/guides/${guide._id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isHidden }),
      })
      if (!r.ok) throw new Error('Could not update that guide')
      await load()
      setToast(isHidden ? 'Guide hidden' : 'Guide shown')
    } catch (e) {
      setErr(e.message)
    } finally { setBusy(false) }
  }

  const remove = async (guide) => {
    if (!window.confirm(`Remove "${guide.title}" from Guides?\n\nThe link is deleted. Hide it instead if you only want it out of the rail.`)) return
    setBusy(true); setErr('')
    try {
      const r = await apiFetch(`${API}/api/chat/admin/guides/${guide._id}`, {
        method: 'DELETE', credentials: 'include',
      })
      if (!r.ok) throw new Error('Could not remove that guide')
      await load()
      setToast('Guide removed')
    } catch (e) {
      setErr(e.message)
    } finally { setBusy(false) }
  }

  const startEdit = (guide) => {
    setEditingId(guide._id)
    setErr('')
    setDraft({
      title:       guide.title ?? '',
      url:         guide.url ?? '',
      description: guide.description ?? '',
      emoji:       guide.emoji ?? '',
      order:       guide.order ?? 0,
    })
  }

  const live   = guides.filter(g => !g.isHidden)
  const hidden = guides.filter(g => g.isHidden)

  const inputClass = 'w-full px-3 py-2 rounded-xl border border-slate-300 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none text-sm bg-transparent text-slate-800'

  const row = (g) => (
    <div key={g._id} className={`rounded-xl border border-slate-300 px-3 py-2 flex items-center gap-3 ${g.isHidden ? 'opacity-80' : ''}`}>
      <span className="text-lg shrink-0">{g.emoji || '📖'}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-slate-800 truncate">{g.title}</p>
        <p className="text-[11px] text-slate-400 truncate">
          {g.url}{g.description ? ` · ${g.description}` : ''} · order {g.order}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <a
          href={g.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-slate-600 hover:text-slate-700 px-2 py-1 rounded-lg border border-slate-300 hover:bg-slate-100 transition-colors"
        >
          Open ↗
        </a>
        <button
          onClick={() => startEdit(g)}
          className="text-xs text-brand-600 hover:text-brand-700 px-2 py-1 rounded-lg border border-brand-200 hover:bg-brand-100 transition-colors"
        >
          Edit
        </button>
        <button
          onClick={() => setHidden(g, !g.isHidden)}
          disabled={busy}
          className="text-xs text-slate-600 hover:text-slate-700 px-2 py-1 rounded-lg border border-slate-300 hover:bg-slate-100 transition-colors"
        >
          {g.isHidden ? 'Show' : 'Hide'}
        </button>
        <button
          onClick={() => remove(g)}
          disabled={busy}
          className="text-xs text-red-600 hover:text-red-700 px-2 py-1 rounded-lg border border-red-200 hover:bg-red-50 transition-colors"
        >
          Remove
        </button>
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-slate-400">
        Links shown above Channels in the Community rail — the best places to read about CBAT.
        They open in a new tab. Only http:// and https:// addresses are accepted.
      </p>

      {/* Create / edit */}
      <div className="rounded-xl border border-slate-300 p-3 space-y-2">
        <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">
          {editingId ? 'Edit guide' : 'New guide'}
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={draft.emoji}
            onChange={e => setDraft(p => ({ ...p, emoji: e.target.value }))}
            placeholder="📖"
            maxLength={8}
            className={`${inputClass} w-20 text-center`}
          />
          <input
            type="text"
            value={draft.title}
            onChange={e => setDraft(p => ({ ...p, title: e.target.value }))}
            placeholder="Guide name"
            maxLength={60}
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
          type="url"
          value={draft.url}
          onChange={e => setDraft(p => ({ ...p, url: e.target.value }))}
          placeholder="https://cbatguide.com"
          maxLength={500}
          className={inputClass}
        />
        <input
          type="text"
          value={draft.description}
          onChange={e => setDraft(p => ({ ...p, description: e.target.value }))}
          placeholder="What is on it? (optional)"
          maxLength={200}
          className={inputClass}
        />
        {err && <p className="text-xs text-red-600">{err}</p>}
        <div className="flex items-center gap-2">
          <button
            onClick={submit}
            disabled={busy || !draft.title.trim() || !draft.url.trim()}
            className="px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl transition-colors"
          >
            {editingId ? 'Save changes' : 'Add guide'}
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

      <div>
        <p className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
          In the rail
        </p>
        {loading && <p className="text-xs text-slate-400">Loading…</p>}
        {!loading && live.length === 0 && (
          <p className="text-xs text-slate-400">
            No guides yet. The Guides section stays hidden until you add one.
          </p>
        )}
        <div className="space-y-2">{live.map(row)}</div>
      </div>

      {hidden.length > 0 && (
        <div>
          <p className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Hidden</p>
          <p className="text-[11px] text-slate-400 mb-2">Kept here, but not shown to users.</p>
          <div className="space-y-2">{hidden.map(row)}</div>
        </div>
      )}

      {Toast && <Toast msg={toast} onClear={() => setToast('')} />}
    </div>
  )
}
