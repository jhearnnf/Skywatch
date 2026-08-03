import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'
import { PAGE_OPTIONS, pageLabelForValue } from '../../constants/pages'
import { TARGET_OS_OPTIONS, osSummary } from '../../constants/targetOs'
import Overlay from '../../components/ui/Overlay'
import RichTextEditor from '../../components/ui/RichTextEditor'
import renderNotificationBody from '../../utils/renderNotificationBody'
import { isRichHtml, sanitizeRichHtml, htmlToPlainText, escapeHtml } from '../../utils/richText'

function resolvePreviewImageSrc(notif) {
  if (!notif) return null
  if (notif.imageMode === 'placeholder') return '/images/placeholder-brief.svg'
  if (notif.imageMode === 'custom' || notif.imageMode === 'upload') return notif.imageUrl || null
  return null
}

const EMPTY_DRAFT = {
  title:      '',
  body:       '',
  imageMode:  'none',
  imageUrl:   '',
  enabled:    true,
  validFrom:  '',
  expiresAt:  '',
  targetPath: '',
  responsesEnabled: false,
  applyToExistingOnly: false,
  // Both default to empty, which means "no narrowing": every OS, everyone.
  targetOs:    [],
  targetUsers: [], // populated { _id, email, agentNumber, displayName } objects
}

// Best label we have for a user in a chip or a search hit.
function userLabel(u) {
  return u?.displayName || u?.email || u?.agentNumber || '(unknown user)'
}

// Convert an ISO date string (or null) to the value expected by
// <input type="datetime-local"> — yyyy-MM-ddTHH:mm in local time.
function toLocalInput(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fmtDate(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

export default function UpdateNotificationsEditor({ API, ConfirmModal, Toast }) {
  const { apiFetch } = useAuth()

  const [list,        setList]        = useState([])
  const [loading,     setLoading]     = useState(false)
  const [editorOpen,  setEditorOpen]  = useState(false)
  const [editingId,   setEditingId]   = useState(null)
  const [draft,       setDraft]       = useState(EMPTY_DRAFT)
  const [savedDraft,  setSavedDraft]  = useState(EMPTY_DRAFT) // snapshot to detect unsaved edits
  const [discardOpen, setDiscardOpen] = useState(false)
  const [aiBusy,      setAiBusy]      = useState(false)
  const [aiOutput,    setAiOutput]    = useState('')
  const [uploadBusy,  setUploadBusy]  = useState(false)
  const [confirmOp,   setConfirmOp]   = useState(null) // { label, run }
  const [viewersFor,  setViewersFor]  = useState(null) // { notif, viewers }
  const [responsesFor, setResponsesFor] = useState(null) // { notif, responses }
  const [previewNotif, setPreviewNotif] = useState(null)
  const [toast,       setToast]       = useState('')

  const load = useCallback(() => {
    setLoading(true)
    apiFetch(`${API}/api/admin/update-notifications`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setList(d?.data?.notifications ?? []))
      .catch(() => setToast('✗ Failed to load notifications'))
      .finally(() => setLoading(false))
  }, [API, apiFetch])

  useEffect(() => { load() }, [load])

  function openNew() {
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
    setSavedDraft(EMPTY_DRAFT)
    setAiOutput('')
    setEditorOpen(true)
  }

  function openEdit(n) {
    setEditingId(n._id)
    const next = {
      title:      n.title ?? '',
      // Edit the rich version when there is one; fall back to the plain body
      // (older notifications, or ones with no formatting).
      body:       n.richBody || n.body || '',
      imageMode:  n.imageMode ?? 'none',
      imageUrl:   n.imageUrl ?? '',
      enabled:    n.enabled !== false,
      validFrom:  toLocalInput(n.validFrom),
      expiresAt:  toLocalInput(n.expiresAt),
      targetPath: n.targetPath ?? '',
      responsesEnabled: !!n.responsesEnabled,
      applyToExistingOnly: !!n.applyToExistingOnly,
      targetOs:    Array.isArray(n.targetOs) ? [...n.targetOs] : [],
      // The list endpoint populates these, but tolerate bare ids so a row
      // fetched from anywhere else still renders a (minimal) chip.
      targetUsers: Array.isArray(n.targetUsers)
        ? n.targetUsers.map(u => (typeof u === 'string' ? { _id: u } : u)).filter(Boolean)
        : [],
    }
    setDraft(next)
    setSavedDraft(next)
    setAiOutput('')
    setEditorOpen(true)
  }

  // Tracks whether a mousedown actually started on the backdrop. Without this,
  // drag-resizing the body textarea and releasing the mouse over the backdrop
  // fires a click on the backdrop (its common ancestor with the textarea) and
  // wrongly closes the editor. We only treat it as a backdrop click when the
  // press both began and ended on the backdrop itself.
  const backdropDownRef = useRef(false)
  function onBackdropMouseDown(e) {
    backdropDownRef.current = e.target === e.currentTarget
  }
  function onBackdropClick(e) {
    if (e.target === e.currentTarget && backdropDownRef.current) attemptClose()
    backdropDownRef.current = false
  }

  // True when the form has edits that would be lost on close.
  const isDirty = JSON.stringify(draft) !== JSON.stringify(savedDraft)

  // Guarded close: a clean form closes immediately; a dirty one asks first so a
  // stray backdrop click can't wipe everything the admin just typed.
  function attemptClose() {
    if (isDirty) setDiscardOpen(true)
    else setEditorOpen(false)
  }

  function confirmDiscard() {
    setDiscardOpen(false)
    setEditorOpen(false)
  }

  async function handleFileUpload(file) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setToast('✗ Selected file is not an image')
      return
    }
    // Cap at ~8MB to stay under the 10MB express.json limit once base64-encoded.
    if (file.size > 8 * 1024 * 1024) {
      setToast('✗ Image too large (max 8MB)')
      return
    }
    setUploadBusy(true)
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(new Error('Failed to read file'))
        reader.readAsDataURL(file)
      })
      const res = await apiFetch(`${API}/api/admin/update-notifications/upload-image`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message || 'Upload failed')
      setDraft(d => ({ ...d, imageMode: 'upload', imageUrl: data?.data?.url || '' }))
      setToast('✓ Image uploaded')
    } catch (err) {
      setToast(`✗ ${err.message}`)
    } finally {
      setUploadBusy(false)
    }
  }

  async function generateAiSummary() {
    setAiBusy(true)
    setAiOutput('')
    try {
      const res = await apiFetch(`${API}/api/admin/update-notifications/ai-summarize`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sinceDays: 14 }),
      })
      const data = await res.json()
      if (res.ok) {
        setAiOutput(data?.data?.summary || '(no summary)')
      } else {
        setToast(`✗ ${data?.message || 'AI summarize failed'}`)
      }
    } catch (err) {
      setToast(`✗ ${err.message}`)
    } finally {
      setAiBusy(false)
    }
  }

  async function copyAiToBody() {
    if (!aiOutput) return
    // Body is now rich HTML, so append the plain AI text as escaped HTML with
    // newlines turned into <br> (and a blank line between existing content).
    const asHtml = escapeHtml(aiOutput).replace(/\n/g, '<br>')
    setDraft(d => ({ ...d, body: d.body ? `${d.body}<br><br>${asHtml}` : asHtml }))
    try { await navigator.clipboard?.writeText(aiOutput) } catch { /* ignore */ }
    setToast('✓ Summary copied into body and clipboard')
  }

  function saveDraft() {
    // The editor holds rich HTML. Store the sanitized HTML as `richBody` and a
    // derived plain-text `body` so older clients (which only read `body`) still
    // get a clean, link-preserving fallback. Plain content ships as `body` with
    // an empty `richBody`.
    const isRich = isRichHtml(draft.body)
    const richBody  = isRich ? sanitizeRichHtml(draft.body) : ''
    const plainBody = isRich ? htmlToPlainText(richBody)    : draft.body

    if (!draft.title.trim() || !plainBody.trim()) {
      setToast('✗ Title and body are required')
      return
    }
    if (draft.imageMode === 'custom' && !draft.imageUrl.trim()) {
      setToast('✗ Image URL is required for custom image')
      return
    }
    if (draft.imageMode === 'upload' && !draft.imageUrl.trim()) {
      setToast('✗ Upload an image before saving')
      return
    }
    setConfirmOp({
      label: editingId ? 'Save changes to this update notification' : 'Create a new update notification',
      run: async (reason) => {
        const url = editingId
          ? `${API}/api/admin/update-notifications/${editingId}`
          : `${API}/api/admin/update-notifications`
        const method = editingId ? 'PUT' : 'POST'
        const body = {
          ...draft,
          body: plainBody,
          richBody,
          // datetime-local emits 'yyyy-MM-ddTHH:mm' with no zone — let Date() interpret as local.
          validFrom: draft.validFrom ? new Date(draft.validFrom).toISOString() : '',
          expiresAt: draft.expiresAt ? new Date(draft.expiresAt).toISOString() : '',
          // Chips carry full user objects for display; the API stores ids.
          targetUsers: draft.targetUsers.map(u => u._id),
          reason,
        }
        const res = await apiFetch(url, {
          method, credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.message || 'Save failed')
        setToast(editingId ? '✓ Notification updated' : '✓ Notification created')
        setEditorOpen(false)
        load()
      },
    })
  }

  function askDelete(n) {
    setConfirmOp({
      label: `Delete "${n.title}"`,
      run: async (reason) => {
        const res = await apiFetch(`${API}/api/admin/update-notifications/${n._id}`, {
          method: 'DELETE', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.message || 'Delete failed')
        setToast('✓ Deleted')
        load()
      },
    })
  }

  function askResetAll(n) {
    setConfirmOp({
      label: `Reset "${n.title}" for ALL users`,
      run: async (reason) => {
        const res = await apiFetch(`${API}/api/admin/update-notifications/${n._id}/reset`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.message || 'Reset failed')
        setToast('✓ Reset for all users')
        load()
        if (viewersFor && String(viewersFor.notif._id) === String(n._id)) openViewers(n)
      },
    })
  }

  async function openResponses(n) {
    try {
      const res = await apiFetch(`${API}/api/admin/update-notifications/${n._id}/viewers`, { credentials: 'include' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message || 'Failed')
      const responses = (data?.data?.viewers ?? []).filter(v => v.response)
      setResponsesFor({ notif: n, responses })
    } catch (err) {
      setToast(`✗ ${err.message}`)
    }
  }

  async function openViewers(n) {
    try {
      const res = await apiFetch(`${API}/api/admin/update-notifications/${n._id}/viewers`, { credentials: 'include' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message || 'Failed')
      setViewersFor({ notif: n, viewers: data?.data?.viewers ?? [] })
    } catch (err) {
      setToast(`✗ ${err.message}`)
    }
  }

  function askResetUser(viewer) {
    const n = viewersFor.notif
    setConfirmOp({
      label: `Reset "${n.title}" for ${viewer.user?.email || viewer.user?.agentNumber || 'this user'}`,
      run: async (reason) => {
        const res = await apiFetch(`${API}/api/admin/update-notifications/${n._id}/reset-user`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: viewer.user._id, reason }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.message || 'Reset failed')
        setToast('✓ Reset for user')
        openViewers(n)
        load()
      },
    })
  }

  return (
    <div>
      <AnimatePresence>{toast && <Toast msg={toast} onClear={() => setToast('')} />}</AnimatePresence>

      <div className="flex items-center justify-end pb-2">
        <button
          onClick={openNew}
          className="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-xs font-bold hover:brightness-110"
        >
          + New update
        </button>
      </div>

      {loading ? (
        <p className="text-slate-500 text-sm py-4">Loading…</p>
      ) : list.length === 0 ? (
        <p className="text-slate-500 text-sm py-4">No update notifications yet.</p>
      ) : (
        <div className="space-y-2">
          {list.map(n => (
            <div key={n._id} className="rounded-xl border border-slate-200 bg-surface-raised p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    {n.enabled
                      ? <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">on</span>
                      : <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-slate-50 text-slate-700">off</span>}
                    {n.applyToExistingOnly && (
                      <span
                        className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-sky-50 text-sky-700"
                        title="Only users registered before the cutoff see this"
                      >
                        existing only
                      </span>
                    )}
                    {(n.targetOs?.length > 0) && (
                      <span
                        className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700"
                        title={`Only shows on ${osSummary(n.targetOs)}`}
                      >
                        {osSummary(n.targetOs)}
                      </span>
                    )}
                    {(n.targetUsers?.length > 0) && (
                      <span
                        className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-brand-50 text-brand-700"
                        title={n.targetUsers.map(userLabel).join(', ')}
                      >
                        {n.targetUsers.length} user{n.targetUsers.length === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                  <span className="block text-sm font-bold text-text truncate">{n.title}</span>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {pageLabelForValue(n.targetPath)} · views {n.viewersCount}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Valid: {fmtDate(n.validFrom)} → {fmtDate(n.expiresAt)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1 justify-end">
                  <button onClick={() => openEdit(n)}     className="text-[11px] font-bold px-2 py-1 rounded bg-brand-50 text-brand-700 hover:bg-brand-100">Edit</button>
                  <button onClick={() => setPreviewNotif(n)} className="text-[11px] font-bold px-2 py-1 rounded bg-sky-50 text-sky-700 hover:bg-sky-100">Preview</button>
                  <button onClick={() => openViewers(n)}  className="text-[11px] font-bold px-2 py-1 rounded bg-slate-50 text-slate-700 hover:bg-slate-100">Viewers</button>
                  <button onClick={() => askResetAll(n)}  className="text-[11px] font-bold px-2 py-1 rounded bg-amber-50 text-amber-700 hover:bg-amber-100">Reset all</button>
                  <button onClick={() => askDelete(n)}    className="text-[11px] font-bold px-2 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100">Delete</button>
                </div>
              </div>
              {/* Reply count — only meaningful when "have your say" is enabled. */}
              {n.responsesEnabled && (
                <div className="flex justify-end mt-1">
                  <button
                    onClick={() => openResponses(n)}
                    title={`${n.responsesCount ?? 0} ${(n.responsesCount ?? 0) === 1 ? 'user has' : 'users have'} had their say — click to view`}
                    className="inline-flex items-center gap-1 text-[11px] font-bold px-1.5 py-0.5 rounded bg-brand-50 text-brand-700 hover:bg-brand-100"
                  >
                    💬 {n.responsesCount ?? 0}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Editor modal */}
      <AnimatePresence>
        {editorOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onMouseDown={onBackdropMouseDown}
            onClick={onBackdropClick}
          >
            <motion.div
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="bg-surface-raised border border-slate-200 rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-5"
              onClick={e => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-text mb-3">
                {editingId ? 'Edit update notification' : 'New update notification'}
              </h3>

              <Field label="Title">
                <input
                  type="text" value={draft.title}
                  onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-surface text-text outline-none focus:ring-2 focus:ring-brand-600/40"
                />
              </Field>

              <Field label="Body (emojis ok)">
                <RichTextEditor
                  ariaLabel="Notification body"
                  value={draft.body}
                  onChange={val => setDraft(d => ({ ...d, body: val }))}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-surface text-text outline-none focus:ring-2 focus:ring-brand-600/40 resize-y overflow-auto min-h-32 max-h-96 whitespace-pre-wrap"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Select text, then use the toolbar or <kbd className="text-slate-600">Ctrl</kbd>+<kbd className="text-slate-600">B</kbd> / <kbd className="text-slate-600">I</kbd> / <kbd className="text-slate-600">U</kbd> to format, or a swatch to colour it.
                  Links work too: paste a URL (https://…) or write <code className="text-slate-600">[label](https://…)</code>.
                </p>
              </Field>

              <Field label="Image" dimmed={draft.imageMode === 'none'}>
                <div className="space-y-1.5">
                  {[
                    { v: 'none',        label: 'None' },
                    { v: 'placeholder', label: 'Use placeholder image' },
                    { v: 'upload',      label: 'Upload image' },
                    { v: 'custom',      label: 'Custom image URL' },
                  ].map(opt => (
                    <label key={opt.v} className="flex items-center gap-2 text-sm text-text">
                      <input
                        type="radio" name="imageMode"
                        checked={draft.imageMode === opt.v}
                        onChange={() => setDraft(d => ({ ...d, imageMode: opt.v }))}
                      />
                      <span>{opt.label}</span>
                      {opt.v === 'placeholder' && (
                        <img src="/images/placeholder-brief.svg" alt="" className="h-6 w-10 object-cover rounded" />
                      )}
                    </label>
                  ))}
                  {draft.imageMode === 'upload' && (
                    <div className="mt-2">
                      <input
                        type="file"
                        accept="image/*"
                        disabled={uploadBusy}
                        onChange={e => handleFileUpload(e.target.files?.[0])}
                        data-testid="update-notification-image-upload"
                        className="w-full text-xs text-slate-600 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-brand-600 file:text-white file:font-bold file:cursor-pointer disabled:opacity-50"
                      />
                      {uploadBusy && <p className="text-xs text-slate-500 mt-1">Uploading…</p>}
                      {draft.imageUrl && !uploadBusy && (
                        <img src={draft.imageUrl} alt="" className="mt-2 max-h-32 rounded object-cover" />
                      )}
                    </div>
                  )}
                  {draft.imageMode === 'custom' && (
                    <div className="mt-2">
                      <input
                        type="url"
                        value={draft.imageUrl}
                        placeholder="https://example.com/banner.png"
                        onChange={e => setDraft(d => ({ ...d, imageUrl: e.target.value }))}
                        className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-surface text-text outline-none focus:ring-2 focus:ring-brand-600/40"
                      />
                      <p className="text-[11px] text-slate-500 mt-1">
                        Direct link to an image file (jpg, png, gif, webp) — not a web page. It shows as the banner at the top of the notification.
                      </p>
                    </div>
                  )}
                  {(draft.imageMode === 'custom' && draft.imageUrl) && (
                    <img src={draft.imageUrl} alt="" className="mt-2 max-h-32 rounded object-cover" />
                  )}
                </div>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Valid from" dimmed={!draft.validFrom}>
                  <input
                    type="datetime-local" value={draft.validFrom}
                    onChange={e => setDraft(d => ({ ...d, validFrom: e.target.value }))}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-surface text-text outline-none focus:ring-2 focus:ring-brand-600/40"
                  />
                </Field>
                <Field label="Expires" dimmed={!draft.expiresAt}>
                  <input
                    type="datetime-local" value={draft.expiresAt}
                    onChange={e => setDraft(d => ({ ...d, expiresAt: e.target.value }))}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-surface text-text outline-none focus:ring-2 focus:ring-brand-600/40"
                  />
                </Field>
              </div>

              {/* Empty targetPath is the "any page" default, same as an empty
                  targeting array — so the dim test is the same shape. */}
              <Field label="Target page" dimmed={!draft.targetPath}>
                <select
                  value={draft.targetPath}
                  onChange={e => setDraft(d => ({ ...d, targetPath: e.target.value }))}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-surface text-text outline-none focus:ring-2 focus:ring-brand-600/40"
                >
                  {PAGE_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </Field>

              <Field label="Operating systems" dimmed={draft.targetOs.length === 0}>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {TARGET_OS_OPTIONS.map(opt => (
                    <label key={opt.value} className="flex items-center gap-2 text-sm text-text">
                      <input
                        type="checkbox"
                        checked={draft.targetOs.includes(opt.value)}
                        onChange={e => setDraft(d => ({
                          ...d,
                          targetOs: e.target.checked
                            ? [...d.targetOs, opt.value]
                            : d.targetOs.filter(v => v !== opt.value),
                        }))}
                      />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  {draft.targetOs.length === 0
                    ? 'None selected — shows on every operating system.'
                    : `Only shows to readers currently on ${osSummary(draft.targetOs)}.`}
                </p>
              </Field>

              <Field label="Specific users" dimmed={draft.targetUsers.length === 0}>
                <UserTargetPicker
                  API={API}
                  apiFetch={apiFetch}
                  selected={draft.targetUsers}
                  onChange={next => setDraft(d => ({ ...d, targetUsers: next }))}
                />
              </Field>

              <label className="flex items-center gap-2 mt-2 text-sm text-text">
                <input
                  type="checkbox" checked={draft.enabled}
                  onChange={e => setDraft(d => ({ ...d, enabled: e.target.checked }))}
                />
                <span>Enabled</span>
              </label>

              <label className="flex items-center gap-2 mt-2 text-sm text-text">
                <input
                  type="checkbox" checked={draft.responsesEnabled}
                  onChange={e => setDraft(d => ({ ...d, responsesEnabled: e.target.checked }))}
                />
                <span>Allow user responses ("have your say" text input)</span>
              </label>

              <label className="flex items-start gap-2 mt-2 text-sm text-text">
                <input
                  type="checkbox" checked={draft.applyToExistingOnly}
                  onChange={e => setDraft(d => ({ ...d, applyToExistingOnly: e.target.checked }))}
                  className="mt-0.5"
                />
                <span>
                  Apply to existing users only
                  <span className="block text-[11px] text-slate-500 mt-0.5">
                    Users registered after {draft.validFrom ? '"Valid from"' : 'this notification is saved'} won't see it.
                  </span>
                </span>
              </label>

              {/* AI summary helper */}
              <div className="mt-4 border-t border-slate-200 pt-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">AI summary from GitHub</p>
                  <button
                    onClick={generateAiSummary} disabled={aiBusy}
                    className="text-[11px] font-bold px-2 py-1 rounded bg-brand-600 text-white disabled:opacity-50"
                  >
                    {aiBusy ? 'Summarizing…' : 'Generate'}
                  </button>
                </div>
                {aiOutput && (
                  <div className="mt-2 p-2 rounded bg-surface border border-slate-200 text-sm text-text whitespace-pre-wrap">
                    {aiOutput}
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={copyAiToBody}
                        className="text-[11px] font-bold px-2 py-1 rounded bg-emerald-50 text-emerald-700"
                      >
                        Copy into body
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-5 flex justify-end gap-2">
                <button onClick={attemptClose} className="px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold">Cancel</button>
                <button onClick={saveDraft} className="px-3 py-2 rounded-xl bg-brand-600 text-white text-sm font-bold">Save</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Discard-changes guard — blocks accidental data loss on backdrop click */}
      <AnimatePresence>
        {discardOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setDiscardOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="bg-surface-raised border border-slate-200 rounded-2xl max-w-sm w-full p-5"
              onClick={e => e.stopPropagation()}
            >
              <h3 className="text-base font-bold text-text">Discard unsaved changes?</h3>
              <p className="text-sm text-slate-500 mt-1">
                You have edits that haven’t been saved. Closing now will lose them.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button onClick={() => setDiscardOpen(false)} className="px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold">Keep editing</button>
                <button onClick={confirmDiscard} className="px-3 py-2 rounded-xl bg-red-600 text-white text-sm font-bold hover:brightness-110">Discard</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Viewers modal */}
      <AnimatePresence>
        {viewersFor && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setViewersFor(null)}
          >
            <motion.div
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="bg-surface-raised border border-slate-200 rounded-2xl max-w-md w-full max-h-[80vh] overflow-y-auto p-5"
              onClick={e => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-text mb-2 truncate">Viewers: {viewersFor.notif.title}</h3>
              {viewersFor.viewers.length === 0 ? (
                <p className="text-slate-500 text-sm py-3">No one has viewed this yet.</p>
              ) : (
                <ul className="divide-y divide-slate-200">
                  {viewersFor.viewers.map((v, i) => (
                    <li key={(v.user?._id || '') + i} className="py-2 flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-text truncate">{v.user?.email || v.user?.agentNumber || '(unknown)'}</p>
                        <p className="text-[11px] text-slate-400">{fmtDate(v.viewedAt)}</p>
                        {v.response && (
                          <p className="mt-1 p-2 rounded bg-surface border border-slate-200 text-xs text-text whitespace-pre-wrap break-words">
                            {v.response}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => askResetUser(v)}
                        className="text-[11px] font-bold px-2 py-1 rounded bg-amber-50 text-amber-700 shrink-0"
                      >
                        Reset
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4 flex justify-end">
                <button onClick={() => setViewersFor(null)} className="px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold">Close</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Responses modal — each user's "have your say" reply */}
      <AnimatePresence>
        {responsesFor && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setResponsesFor(null)}
          >
            <motion.div
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="bg-surface-raised border border-slate-200 rounded-2xl max-w-md w-full max-h-[80vh] overflow-y-auto p-5"
              onClick={e => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-text mb-2 truncate">Responses: {responsesFor.notif.title}</h3>
              {responsesFor.responses.length === 0 ? (
                <p className="text-slate-500 text-sm py-3">No responses yet.</p>
              ) : (
                <ul className="divide-y divide-slate-200">
                  {responsesFor.responses.map((v, i) => (
                    <li key={(v.user?._id || '') + i} className="py-2">
                      <p className="text-sm text-text truncate">{v.user?.email || v.user?.agentNumber || '(unknown)'}</p>
                      <p className="text-[11px] text-slate-400">{fmtDate(v.viewedAt)}</p>
                      <p className="mt-1 p-2 rounded bg-surface border border-slate-200 text-xs text-text whitespace-pre-wrap break-words">
                        {v.response}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4 flex justify-end">
                <button onClick={() => setResponsesFor(null)} className="px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold">Close</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Preview (read-only — does not mark as viewed) */}
      {previewNotif && (() => {
        const imgSrc = resolvePreviewImageSrc(previewNotif)
        return (
          <Overlay
            zIndex={70}
            backdrop="rgba(8, 14, 30, 0.78)"
            lockBodyScroll
            onDismiss={() => setPreviewNotif(null)}
            className="backdrop-blur-sm flex items-center justify-center p-4"
            data-testid="update-notification-preview-overlay"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1,    y: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="relative bg-surface-raised border border-slate-300 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
              onClick={e => e.stopPropagation()}
            >
              <div className="absolute top-3 left-3 z-10 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">
                Preview
              </div>
              {imgSrc && (
                <img src={imgSrc} alt="" className="w-full max-h-48 object-cover rounded-t-2xl" />
              )}
              <div className="p-5 sm:p-6">
                <button
                  aria-label="Close preview"
                  onClick={() => setPreviewNotif(null)}
                  className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 text-slate-600 hover:bg-slate-200"
                >
                  ×
                </button>
                <h2 className="text-xl font-extrabold text-brand-700 pr-8">{previewNotif.title}</h2>
                <p className="mt-3 text-sm leading-relaxed text-text whitespace-pre-wrap">
                  {renderNotificationBody(previewNotif.richBody || previewNotif.body)}
                </p>
                {previewNotif.responsesEnabled && (
                  <div className="mt-4">
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">
                      Have your say (optional)
                    </label>
                    <textarea
                      rows={3}
                      disabled
                      placeholder="Type your thoughts…"
                      className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-surface text-text outline-none resize-none opacity-70"
                    />
                  </div>
                )}
                <button
                  onClick={() => setPreviewNotif(null)}
                  className="mt-5 w-full px-4 py-2.5 rounded-xl bg-brand-600 text-white font-bold text-sm hover:brightness-110"
                >
                  Got it
                </button>
              </div>
            </motion.div>
          </Overlay>
        )
      })()}

      {/* Reason-gated confirm */}
      {confirmOp && (
        <ConfirmModal
          title={confirmOp.label}
          onConfirm={async (reason) => {
            try {
              await confirmOp.run(reason)
              setConfirmOp(null)
            } catch (err) {
              setToast(`✗ ${err.message}`)
              setConfirmOp(null)
            }
          }}
          onCancel={() => setConfirmOp(null)}
        />
      )}
    </div>
  )
}

// Type-ahead for narrowing a notification to named users. Selected users are
// held as full objects (chips need something to render); the parent maps them
// down to ids on save. Kept at module scope, not inlined in the editor's
// render, so typing here doesn't remount the input on every keystroke.
function UserTargetPicker({ API, apiFetch, selected, onChange }) {
  const [query,    setQuery]    = useState('')
  const [results,  setResults]  = useState([])
  const [busy,     setBusy]     = useState(false)
  const [searched, setSearched] = useState(false)

  const selectedIds = useMemo(
    () => new Set((selected ?? []).map(u => String(u._id))),
    [selected],
  )

  // Debounced lookup. `cancelled` guards against an in-flight response for an
  // older query landing after a newer one and overwriting the results.
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults([])
      setSearched(false)
      setBusy(false)
      return
    }
    let cancelled = false
    setBusy(true)
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch(
          `${API}/api/admin/users/lookup?q=${encodeURIComponent(q)}`,
          { credentials: 'include' },
        )
        const data = await res.json()
        if (!cancelled) setResults(data?.data?.users ?? [])
      } catch {
        if (!cancelled) setResults([])
      } finally {
        if (!cancelled) {
          setSearched(true)
          setBusy(false)
        }
      }
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [query, API, apiFetch])

  function addUser(u) {
    if (selectedIds.has(String(u._id))) return
    onChange([...(selected ?? []), u])
    setQuery('')
  }

  function removeUser(id) {
    onChange((selected ?? []).filter(u => String(u._id) !== String(id)))
  }

  return (
    <div>
      <input
        type="search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search by name, email or agent number…"
        aria-label="Search users"
        className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-surface text-text outline-none focus:ring-2 focus:ring-brand-600/40"
      />

      {query.trim() && (
        <div className="mt-1.5 rounded-xl border border-slate-200 bg-surface max-h-40 overflow-y-auto">
          {busy ? (
            <p className="text-xs text-slate-500 px-3 py-2">Searching…</p>
          ) : results.length === 0 ? (
            <p className="text-xs text-slate-500 px-3 py-2">{searched ? 'No users found.' : 'Type to search.'}</p>
          ) : (
            <ul className="divide-y divide-slate-200">
              {results.map(u => {
                const already = selectedIds.has(String(u._id))
                return (
                  <li key={u._id}>
                    <button
                      type="button"
                      disabled={already}
                      onClick={() => addUser(u)}
                      className="w-full text-left px-3 py-1.5 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      <span className="block text-sm text-text truncate">{userLabel(u)}</span>
                      <span className="block text-[11px] text-slate-400 truncate">
                        Agent {u.agentNumber || '—'}{u.email ? ` · ${u.email}` : ''}{already ? ' · already added' : ''}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {(selected ?? []).length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {selected.map(u => (
            <span
              key={u._id}
              className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full bg-brand-50 text-brand-700"
            >
              {userLabel(u)}
              <button
                type="button"
                aria-label={`Remove ${userLabel(u)}`}
                onClick={() => removeUser(u._id)}
                className="text-brand-700 hover:text-red-700"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <p className="text-[11px] text-slate-500 mt-1">
        {(selected ?? []).length === 0
          ? 'None selected — shows to everyone.'
          : selected.length === 1
            ? 'Only this user will see it.'
            : `Only these ${selected.length} users will see it.`}
      </p>
    </div>
  )
}

// A labelled block in the editor form.
//
// `dimmed` fades the whole block back so the eye lands on the title and body,
// which are the only two things every notification needs. It's presentation
// only — nothing is disabled, and the block returns to full strength on hover
// or as soon as anything inside it takes focus, so a dimmed control is never
// harder to use than an undimmed one. Callers pass the field's own "am I still
// at my default?" test, so a field un-dims the moment it's actually set.
function Field({ label, children, dimmed = false }) {
  return (
    <div
      data-field={label}
      data-dimmed={dimmed ? 'true' : 'false'}
      className={`py-2 transition-opacity duration-200 ${
        dimmed ? 'opacity-40 hover:opacity-100 focus-within:opacity-100' : ''
      }`}
    >
      <label className="block text-xs font-semibold text-slate-500 mb-1">{label}</label>
      {children}
    </div>
  )
}
