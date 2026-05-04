import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { CATEGORIES } from '../../../backend/constants/categories.json'

const POST_TYPE_OPTIONS = [
  { value: 'daily-recon',         label: 'Daily Recon (poll)' },
  { value: 'daily-recon-info',    label: 'Daily Recon (info)' },
  { value: 'latest-intel',        label: 'Latest Intel (news summary)' },
  { value: 'brand-transparency',  label: 'Brand Transparency (devlog)' },
]

const TONE_LABEL = {
  1: 'Military formal',
  2: 'Military formal',
  3: 'Authoritative',
  4: 'Professional',
  5: 'Clear & direct',
  6: 'Brand voice',
  7: 'Brand voice (default)',
  8: 'A little cheeky',
  9: 'Witty & ironic',
  10: 'Wild & carefree',
}

const X_LIMIT = 280
const VARIANT_COUNT = 3

function emptyDraft() {
  return { status: 'idle', text: '', draftText: '', poll: null, sourceMeta: null, error: '' }
}

export default function SocialsSection({ API }) {
  const { apiFetch } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [open, setOpen] = useState(false)

  // Connection state
  const [status, setStatus]         = useState(null)   // { configured, missing, connected, username, expiresAt, scopes }
  const [statusBusy, setStatusBusy] = useState(false)
  const [toast, setToast]           = useState('')

  // Source pickers
  const [briefs, setBriefs]               = useState([])
  const [latestNews, setLatestNews]       = useState(null) // { _id, title, isFreshToday }
  const [briefsLoaded, setBriefsLoaded]   = useState(false)

  // Form state
  const [postType, setPostType]   = useState('latest-intel')
  const [tone, setTone]           = useState(7)
  const [briefId, setBriefId]     = useState('')
  // 'none' | 'brief' | 'upload'
  const [imageSource, setImageSource] = useState('none')
  const [uploadedFileDataUrl, setUploadedFileDataUrl] = useState(null)
  const [briefCategoryFilter, setBriefCategoryFilter] = useState('') // daily-recon / daily-recon-info only; '' = all categories

  // Draft state — three parallel variants, each independently loading. The
  // carousel renders one card per slot and the user picks which one to post.
  const [drafts, setDrafts] = useState(() => Array.from({ length: VARIANT_COUNT }, emptyDraft))
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [imageUrl, setImageUrl]   = useState(null)
  const [draftError, setDraftError] = useState('')   // top-level error if all variants fail
  const mirrorRefs = useRef([])
  const carouselRef = useRef(null)
  const cardRefs = useRef([])

  const drafting = drafts.some(d => d.status === 'loading')
  const anyDraftReady = drafts.some(d => d.status === 'ready')
  const selectedDraft = drafts[selectedIndex] || emptyDraft()

  // Publish state
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState('')

  // History
  const [posts, setPosts] = useState([])
  const [postsLoaded, setPostsLoaded] = useState(false)
  // Per-row state for the "View image" expander on recent posts. A Set of
  // post _ids whose attached image is currently expanded.
  const [openImagePostIds, setOpenImagePostIds] = useState(() => new Set())

  // ── status / history loaders ──
  const loadStatus = useCallback(async () => {
    setStatusBusy(true)
    try {
      const res  = await apiFetch(`${API}/api/admin/social/x/status`, { credentials: 'include' })
      const data = await res.json()
      setStatus(data)
    } finally { setStatusBusy(false) }
  }, [API, apiFetch])

  const loadPosts = useCallback(async () => {
    const res  = await apiFetch(`${API}/api/admin/social/posts?limit=10`, { credentials: 'include' })
    const data = await res.json()
    setPosts(data.data || [])
    setPostsLoaded(true)
  }, [API, apiFetch])

  const loadBriefs = useCallback(async () => {
    const [briefsRes, newsRes] = await Promise.all([
      apiFetch(`${API}/api/admin/social/briefs-for-recon`, { credentials: 'include' }).then(r => r.json()),
      apiFetch(`${API}/api/admin/social/latest-news-brief`, { credentials: 'include' }).then(r => r.json()),
    ])
    setBriefs(briefsRes.data || [])
    setLatestNews(newsRes.data || null)
    setBriefsLoaded(true)
  }, [API, apiFetch])

  useEffect(() => { loadStatus() }, [loadStatus])

  useEffect(() => {
    if (!open) return
    if (!briefsLoaded) loadBriefs()
    if (!postsLoaded)  loadPosts()
  }, [open, briefsLoaded, postsLoaded, loadBriefs, loadPosts])

  // OAuth callback toast
  useEffect(() => {
    const sx = searchParams.get('socialX')
    if (!sx) return
    if (sx === 'connected')      setToast('✓ X account connected')
    else if (sx === 'denied')    setToast('✗ X authorization denied')
    else if (sx === 'expired')   setToast('✗ Authorization session expired — try again')
    else if (sx === 'invalid')   setToast('✗ Invalid OAuth callback')
    else                         setToast(`✗ X auth failed (${sx})`)
    setOpen(true)
    loadStatus()
    const next = new URLSearchParams(searchParams)
    next.delete('socialX')
    next.delete('reason')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams, loadStatus])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const selectedBrief = useMemo(
    () => briefs.find(b => b._id === briefId) || (latestNews?._id === briefId ? latestNews : null),
    [briefs, briefId, latestNews]
  )

  // Brief list shown in the picker, sorted per post type. For 'latest-intel'
  // the dropdown is labelled "News brief" so we sort by eventDate desc (latest
  // event at the top, oldest at the bottom). Briefs without an eventDate fall
  // back to dateAdded so non-News briefs end up after dated News briefs.
  const briefOptions = useMemo(() => {
    const merged = []
    if (postType === 'latest-intel' && latestNews) merged.push(latestNews)
    for (const b of briefs) {
      if (postType === 'latest-intel' && latestNews?._id === b._id) continue
      merged.push(b)
    }
    if (postType === 'latest-intel') {
      const ts = b => {
        if (b.eventDate) return new Date(b.eventDate).getTime()
        if (b.dateAdded) return new Date(b.dateAdded).getTime() - 1e15 // sink no-eventDate items below dated ones
        return -Infinity
      }
      merged.sort((a, b) => ts(b) - ts(a))
    }
    return merged
  }, [briefs, latestNews, postType])

  // Categories present in the loaded brief set, in canonical CATEGORIES order.
  // Used to populate the daily-recon category filter — we only show categories
  // that actually have briefs so the filter never has dead options.
  const availableBriefCategories = useMemo(() => {
    const present = new Set(briefs.map(b => b.category).filter(Boolean))
    return CATEGORIES.filter(c => present.has(c))
  }, [briefs])

  // Brief picker list after applying the daily-recon category filter. The
  // filter only applies to daily-recon — latest-intel has its own ordering and
  // brand-transparency hides the picker entirely.
  const filteredBriefOptions = useMemo(() => {
    if ((postType !== 'daily-recon' && postType !== 'daily-recon-info') || !briefCategoryFilter) return briefOptions
    return briefOptions.filter(b => b.category === briefCategoryFilter)
  }, [briefOptions, briefCategoryFilter, postType])

  // Default brief selection per postType. For 'latest-intel' we pick the top
  // of the sorted news-brief list (i.e. latest event date), not just the
  // dateAdded-newest news brief, so the default lines up with what the user
  // sees at the top of the dropdown. For 'daily-recon' the random pick honours
  // the active category filter.
  useEffect(() => {
    if (!briefsLoaded) return
    if ((postType === 'daily-recon' || postType === 'daily-recon-info') && !briefId && filteredBriefOptions.length) {
      setBriefId(filteredBriefOptions[Math.floor(Math.random() * filteredBriefOptions.length)]._id)
    } else if (postType === 'latest-intel' && !briefId && briefOptions.length) {
      setBriefId(briefOptions[0]._id)
    }
  }, [postType, briefsLoaded, filteredBriefOptions, briefOptions, briefId])

  // Image URL derived from the selected brief's media — mirrors the server's
  // selectBriefImageUrl helper so the preview shown before Generate matches
  // what publish will actually attach.
  const briefImageUrl = useMemo(() => {
    if (!selectedBrief?.media?.length) return null
    for (const m of selectedBrief.media) {
      if (!m?.mediaUrl) continue
      if (typeof m.mediaUrl === 'string' && m.mediaUrl.startsWith('/')) continue
      return m.mediaUrl
    }
    return null
  }, [selectedBrief])

  // Resolve a display name for the currently-attached image. Mirrors the brief
  // admin pattern (m.name ?? m.cloudinaryPublicId ?? filename-from-url) so the
  // preview shows the same label users see on the intel brief media list.
  const imageName = useMemo(() => {
    if (!imageUrl) return ''
    if (imageUrl.startsWith('data:')) return 'Uploaded image'
    const match = selectedBrief?.media?.find(m => m?.mediaUrl === imageUrl)
    if (match) {
      return match.name
        || match.cloudinaryPublicId
        || (typeof match.mediaUrl === 'string' ? match.mediaUrl.split('/').pop().replace(/\.[^.]+$/, '') : '')
    }
    return imageUrl.split('/').pop().replace(/\.[^.]+$/, '')
  }, [imageUrl, selectedBrief])

  // Keep imageUrl in sync with the image source selection.
  useEffect(() => {
    if (imageSource === 'brief') {
      setImageUrl(briefImageUrl || null)
    } else if (imageSource === 'upload') {
      setImageUrl(uploadedFileDataUrl || null)
    } else {
      setImageUrl(null)
    }
  }, [imageSource, briefImageUrl, uploadedFileDataUrl])

  const selectedCharCount = selectedDraft.text.length
  const selectedOverLimit = selectedCharCount > X_LIMIT

  // ── connection actions ──
  const connect = async () => {
    setDraftError(''); setPublishError('')
    const res  = await apiFetch(`${API}/api/admin/social/x/connect`, { credentials: 'include' })
    const data = await res.json()
    if (!res.ok) { setToast(`✗ ${data.message || 'connect failed'}`); return }
    window.location.href = data.authorizeUrl
  }

  const disconnect = async () => {
    if (!window.confirm('Disconnect the X account? You will need to re-authorize to post again.')) return
    await apiFetch(`${API}/api/admin/social/x/disconnect`, {
      method: 'DELETE', credentials: 'include',
    })
    setToast('✓ X account disconnected')
    setStatus(s => ({ ...(s || {}), connected: false, username: null }))
  }

  // ── draft actions ──
  const handleFileChange = useCallback((e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => setUploadedFileDataUrl(ev.target.result || null)
    reader.readAsDataURL(file)
  }, [])

  const randomBrief = () => {
    const pool = filteredBriefOptions
    if (!pool.length) return
    const next = pool[Math.floor(Math.random() * pool.length)]._id
    setBriefId(next)
  }

  // Fire 3 parallel /x/draft calls, one per variant. Each call resolves
  // independently — that variant's card unlocks as its response lands. We use
  // the functional setState form so overlapping resolutions don't clobber
  // each other's slot.
  const generateOne = useCallback(async (idx) => {
    setDrafts(d => d.map((slot, i) => i === idx
      ? { ...emptyDraft(), status: 'loading' }
      : slot))
    try {
      const body = { postType, tone, variantIndex: idx }
      if (postType !== 'brand-transparency') body.briefId = briefId
      const res  = await apiFetch(`${API}/api/admin/social/x/draft`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setDrafts(d => d.map((slot, i) => i === idx
          ? { ...emptyDraft(), status: 'error', error: data.message || 'draft failed' }
          : slot))
        return { ok: false, idx }
      }
      const t = data.data.text || ''
      setDrafts(d => d.map((slot, i) => i === idx
        ? {
            status: 'ready',
            text: t,
            draftText: t,
            poll: data.data.poll || null,
            sourceMeta: data.data.sourceMeta || null,
            error: '',
          }
        : slot))
      // Image URL is brief-derived and identical across variants — first
      // variant to land sets it (or refreshes it on regenerate). Rather than
      // race three identical writes, only idx 0 sets it.
      if (idx === 0 && imageSource === 'brief' && data.data.suggestedImageUrl) {
        setImageUrl(data.data.suggestedImageUrl)
      }
      return { ok: true, idx }
    } catch (err) {
      setDrafts(d => d.map((slot, i) => i === idx
        ? { ...emptyDraft(), status: 'error', error: err.message || 'draft failed' }
        : slot))
      return { ok: false, idx }
    }
  }, [API, apiFetch, postType, tone, briefId, imageSource])

  const generate = async () => {
    setDraftError('')
    setPublishError('')
    setSelectedIndex(0)
    setDrafts(Array.from({ length: VARIANT_COUNT }, () => ({ ...emptyDraft(), status: 'loading' })))
    const results = await Promise.all(
      Array.from({ length: VARIANT_COUNT }, (_, i) => generateOne(i))
    )
    if (results.every(r => !r.ok)) {
      setDraftError('All draft variants failed — check the API and try again.')
    }
  }

  const publish = async () => {
    if (!status?.connected)              { setPublishError('Connect the X account first'); return }
    if (selectedDraft.status !== 'ready'){ setPublishError('Selected variant is not ready yet'); return }
    if (!selectedDraft.text.trim())      { setPublishError('Tweet text is empty'); return }
    if (selectedOverLimit)               { setPublishError(`Over ${X_LIMIT} character limit`); return }
    setPublishing(true); setPublishError('')
    try {
      const res  = await apiFetch(`${API}/api/admin/social/x/publish`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postType, tone, briefId: briefId || null,
          finalText: selectedDraft.text,
          draftText: selectedDraft.draftText,
          imageUrl,
          poll: selectedDraft.poll || null,
          sourceMeta: selectedDraft.sourceMeta || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setPublishError(data.message || 'publish failed'); loadPosts(); return }
      setToast('✓ Posted to X')
      setDrafts(Array.from({ length: VARIANT_COUNT }, emptyDraft))
      setSelectedIndex(0)
      setImageUrl(null)
      loadPosts()
    } catch (err) {
      setPublishError(err.message || 'publish failed')
    } finally { setPublishing(false) }
  }

  // Updating a variant's text via its textarea. Uses functional setState so
  // it doesn't race with concurrent draft-resolution writes.
  const updateDraftText = useCallback((idx, value) => {
    setDrafts(d => d.map((slot, i) => i === idx ? { ...slot, text: value } : slot))
  }, [])

  const toggleImageOpen = useCallback((postId) => {
    setOpenImagePostIds(prev => {
      const next = new Set(prev)
      if (next.has(postId)) next.delete(postId); else next.add(postId)
      return next
    })
  }, [])

  // Toggle whether a recent post is marked as deleted from the platform. We
  // optimistically update the row, then reconcile with the server's response
  // (or revert on failure).
  const toggleDeleted = useCallback(async (postId, nextDeleted) => {
    const stamp = nextDeleted ? new Date().toISOString() : null
    setPosts(prev => prev.map(p => p._id === postId ? { ...p, deletedAt: stamp } : p))
    try {
      const res  = await apiFetch(`${API}/api/admin/social/posts/${postId}/deleted`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleted: nextDeleted }),
      })
      const data = await res.json()
      if (!res.ok) {
        setPosts(prev => prev.map(p => p._id === postId ? { ...p, deletedAt: nextDeleted ? null : stamp } : p))
        setToast(`✗ ${data.message || 'failed to update'}`)
        return
      }
      setPosts(prev => prev.map(p => p._id === postId ? data.data : p))
      setToast(nextDeleted ? '✓ Marked as deleted' : '✓ Marked as live')
    } catch (err) {
      setPosts(prev => prev.map(p => p._id === postId ? { ...p, deletedAt: nextDeleted ? null : stamp } : p))
      setToast(`✗ ${err.message || 'failed to update'}`)
    }
  }, [API, apiFetch])

  const selectVariant = useCallback((idx) => {
    setSelectedIndex(idx)
    const card = cardRefs.current[idx]
    if (card?.scrollIntoView) {
      card.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
    }
  }, [])

  // ── render ──
  return (
    <div className="bg-surface rounded-2xl border-2 border-brand-600 overflow-hidden mb-4" data-testid="socials-section">
      {toast && (
        <div className="px-5 py-2 bg-brand-600/10 border-b border-brand-600/20 text-sm text-brand-600">{toast}</div>
      )}

      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-5 py-4 bg-brand-600 hover:bg-brand-700 border-b border-brand-700 flex items-center justify-between text-left transition-colors"
      >
        <h3 className="font-bold text-white">Socials</h3>
        <span className="text-white/80 text-xs ml-2">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-5 py-4">
          <div className="rounded-2xl overflow-hidden mb-4 border-2" style={{ background: '#0c1829', borderColor: '#172236' }}>
            <div className="px-5 py-3 border-b" style={{ background: '#102040', borderColor: '#172236' }}>
              <h4 className="font-bold text-slate-800 flex items-center gap-2">
                <span className="text-lg">𝕏</span>
                X.com
              </h4>
            </div>

            <div className="px-5 py-4 space-y-4">
              {/* Connection status */}
              <div className="flex flex-wrap items-center gap-3 pb-3 border-b border-slate-100">
                {statusBusy ? (
                  <span className="text-xs text-slate-400">Checking connection…</span>
                ) : !status?.configured ? (
                  <span className="text-xs text-amber-300">
                    Not configured — missing env: {(status?.missing || []).join(', ') || 'unknown'}
                  </span>
                ) : status?.connected ? (
                  <>
                    <span className="text-xs text-slate-400">Connected as</span>
                    <span className="text-sm font-bold text-brand-600">@{status.username || '(unknown)'}</span>
                    <button onClick={disconnect}
                            className="ml-auto px-3 py-1.5 rounded-xl text-[11px] font-bold bg-slate-700 hover:bg-slate-800 text-white transition-colors">
                      Disconnect
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-xs text-slate-400">No X account connected.</span>
                    <button onClick={connect}
                            className="ml-auto px-4 py-1.5 rounded-xl text-xs font-bold bg-brand-600 hover:bg-brand-700 text-white transition-colors">
                      Connect X account
                    </button>
                  </>
                )}
              </div>

              {/* Post type */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Post type</label>
                <select
                  data-testid="post-type-select"
                  value={postType}
                  onChange={e => { setPostType(e.target.value); setBriefId(''); setImageSource('none'); setUploadedFileDataUrl(null) }}
                  className="w-full border border-slate-400 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-600/40 bg-surface-raised text-text"
                >
                  {POST_TYPE_OPTIONS.map(opt => {
                    const isLatestIntel = opt.value === 'latest-intel'
                    const fresh = isLatestIntel && latestNews?.isFreshToday
                    return (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}{fresh ? '  · 🟢 fresh news today' : ''}
                      </option>
                    )
                  })}
                </select>
              </div>

              {/* Brief picker (Daily Recon, Daily Recon Info + Latest Intel) */}
              {(postType === 'daily-recon' || postType === 'daily-recon-info' || postType === 'latest-intel') && (
                <div className="space-y-2">
                  {(postType === 'daily-recon' || postType === 'daily-recon-info') && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">
                        Filter by category
                      </label>
                      <select
                        data-testid="brief-category-filter"
                        value={briefCategoryFilter}
                        onChange={e => { setBriefCategoryFilter(e.target.value); setBriefId('') }}
                        className="w-full border border-slate-400 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-600/40 bg-surface-raised text-text"
                      >
                        <option value="">All categories</option>
                        {availableBriefCategories.map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-semibold text-slate-500">
                        {postType === 'latest-intel' ? 'News brief' : 'Source brief'}
                      </label>
                      {(postType === 'daily-recon' || postType === 'daily-recon-info') && (
                        <button onClick={randomBrief}
                                className="text-[11px] font-bold text-brand-600 hover:text-brand-700">
                          🎲 Random
                        </button>
                      )}
                    </div>
                    <select
                      data-testid="brief-select"
                      value={briefId}
                      onChange={e => setBriefId(e.target.value)}
                      className="w-full border border-slate-400 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-600/40 bg-surface-raised text-text"
                    >
                      <option value="">— select —</option>
                      {filteredBriefOptions.map(b => {
                        const isLatestNews = postType === 'latest-intel' && latestNews?._id === b._id
                        const fresh = isLatestNews && latestNews?.isFreshToday
                        return (
                          <option key={b._id} value={b._id}>
                            {b.title}
                            {fresh ? ' · 🟢 today' : ''}
                            {!isLatestNews ? ` (${b.category})` : ''}
                          </option>
                        )
                      })}
                    </select>
                  </div>
                </div>
              )}

              {/* Tone */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-500">Tone</label>
                  <span className="text-xs font-bold text-brand-600">
                    {tone} · {TONE_LABEL[tone]}
                  </span>
                </div>
                <input
                  data-testid="tone-slider"
                  type="range" min={1} max={10} step={1}
                  value={tone}
                  onChange={e => setTone(Number(e.target.value))}
                  className="w-full"
                />
                <div className="flex justify-between mt-0.5 text-[10px] text-slate-400">
                  <span>Military</span><span>Default 7</span><span>Wild</span>
                </div>
              </div>

              {/* Image source — hidden for daily-recon (poll posts can't have media on X) */}
              {postType !== 'daily-recon' && (
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-slate-500">Image</label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => { setImageSource('none'); setUploadedFileDataUrl(null) }}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors ${
                        imageSource === 'none'
                          ? 'bg-brand-600 border-brand-600 text-white'
                          : 'border-slate-600 text-slate-400 hover:border-slate-400'
                      }`}
                    >
                      None
                    </button>
                    {postType !== 'brand-transparency' && (
                      <button
                        type="button"
                        onClick={() => setImageSource('brief')}
                        disabled={!briefImageUrl}
                        title={briefImageUrl ? "Use the selected brief's image" : 'Selected brief has no image'}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors ${
                          imageSource === 'brief'
                            ? 'bg-brand-600 border-brand-600 text-white'
                            : 'border-slate-600 text-slate-400 hover:border-slate-400'
                        } disabled:opacity-40 disabled:cursor-not-allowed`}
                      >
                        Brief image
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setImageSource('upload')}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors ${
                        imageSource === 'upload'
                          ? 'bg-brand-600 border-brand-600 text-white'
                          : 'border-slate-600 text-slate-400 hover:border-slate-400'
                      }`}
                    >
                      Upload
                    </button>
                  </div>
                  {imageSource === 'upload' && (
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleFileChange}
                      className="block w-full text-xs text-slate-400 file:mr-3 file:px-3 file:py-1.5 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-slate-700 file:text-white hover:file:bg-slate-600"
                    />
                  )}
                </div>
              )}

              {/* Image preview — sits between the toggle and Generate so the
                  user can confirm what will be attached before drafting. */}
              {imageUrl && (
                <div className="flex items-start gap-3 p-2 rounded-xl bg-slate-900/50 border border-slate-700">
                  <img src={imageUrl} alt={imageName || ''} className="w-24 h-24 object-cover rounded-lg" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-text break-words" data-testid="image-preview-name">{imageName || '(unnamed)'}</p>
                  </div>
                </div>
              )}

              {/* Generate — fires three parallel /x/draft calls; each card
                  unlocks independently as its response lands. */}
              <button
                onClick={generate}
                disabled={drafting || (postType !== 'brand-transparency' && !briefId)}
                className="w-full px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-40"
              >
                {drafting ? 'Generating 3 variants…' : (anyDraftReady ? '↻ Regenerate 3 variants' : '✦ Generate 3 variants')}
              </button>
              {draftError && <p className="text-xs text-red-400">{draftError}</p>}

              {/* Carousel — three cards, scroll-snap horizontal. On wide
                  admin screens all three sit visible side-by-side; on narrow
                  they snap one at a time. The selected card (ring) is what
                  publish will send. */}
              {drafts.some(d => d.status !== 'idle') && (
                <div className="space-y-2" data-testid="variants-carousel">
                  <div
                    ref={carouselRef}
                    className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-1 -mx-1 px-1"
                    style={{ scrollbarGutter: 'stable' }}
                  >
                    {drafts.map((d, idx) => {
                      const charCount = d.text.length
                      const overLimit = charCount > X_LIMIT
                      const charColor = overLimit ? 'text-red-400' : (charCount > X_LIMIT - 30 ? 'text-amber-300' : 'text-slate-400')
                      const isSelected = idx === selectedIndex
                      const disabled = d.status !== 'ready'
                      return (
                        <div
                          key={idx}
                          ref={el => { cardRefs.current[idx] = el }}
                          data-testid={`variant-card-${idx}`}
                          data-status={d.status}
                          data-selected={isSelected ? 'true' : 'false'}
                          onClick={() => selectVariant(idx)}
                          className={`snap-center shrink-0 w-full rounded-xl border-2 p-3 cursor-pointer transition-colors ${
                            isSelected
                              ? 'border-brand-600 bg-brand-600/5'
                              : 'border-slate-700 bg-surface-raised/40 hover:border-slate-500'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${isSelected ? 'border-brand-600 bg-brand-600' : 'border-slate-500'}`}>
                                {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                              </span>
                              <span className="text-[11px] font-bold text-slate-300">Variant {idx + 1}</span>
                            </div>
                            <span
                              data-testid={`variant-status-${idx}`}
                              className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                                d.status === 'ready'   ? 'bg-emerald-600/20 text-emerald-300'
                                : d.status === 'loading' ? 'bg-slate-600/20 text-slate-300'
                                : d.status === 'error'   ? 'bg-red-600/20 text-red-300'
                                                         : 'bg-slate-600/10 text-slate-400'
                              }`}
                            >
                              {d.status === 'ready'   ? 'Ready'
                              : d.status === 'loading' ? 'Generating…'
                              : d.status === 'error'   ? 'Failed'
                                                       : 'Idle'}
                            </span>
                          </div>

                          <div className="relative rounded-xl bg-surface-raised border border-slate-400 focus-within:ring-2 focus-within:ring-brand-600/40 overflow-hidden">
                            <div
                              ref={el => { mirrorRefs.current[idx] = el }}
                              aria-hidden="true"
                              className="absolute inset-0 px-3 py-2 text-sm leading-5 whitespace-pre-wrap break-words overflow-hidden pointer-events-none select-none"
                            >
                              {d.text ? (
                                <>
                                  <span className="text-text">{d.text.slice(0, X_LIMIT)}</span>
                                  {overLimit && <span data-testid={`overflow-highlight-${idx}`} className="text-red-400 bg-red-400/15">{d.text.slice(X_LIMIT)}</span>}
                                </>
                              ) : d.status === 'loading' ? (
                                <span className="text-slate-500">Generating…</span>
                              ) : d.status === 'error' ? (
                                <span className="text-red-400">{d.error || 'Generation failed'}</span>
                              ) : (
                                <span className="text-slate-500">Drafted tweet appears here…</span>
                              )}
                            </div>
                            <textarea
                              data-testid={`variant-textarea-${idx}`}
                              rows={6}
                              value={d.text}
                              disabled={disabled}
                              onClick={e => e.stopPropagation()}
                              onChange={e => updateDraftText(idx, e.target.value)}
                              onScroll={e => { if (mirrorRefs.current[idx]) mirrorRefs.current[idx].scrollTop = e.target.scrollTop }}
                              className="relative w-full bg-transparent px-3 py-2 text-sm leading-5 resize-none outline-none rounded-xl disabled:cursor-not-allowed"
                              style={{ color: 'transparent', caretColor: '#ddeaf8' }}
                            />
                          </div>
                          <div className="flex items-center justify-between gap-2 text-[11px] mt-1.5">
                            <span className={charColor} data-testid={`variant-char-count-${idx}`}>
                              {charCount} / {X_LIMIT}
                            </span>
                            {overLimit && (
                              <span data-testid={`variant-over-limit-${idx}`} className="text-red-400 font-semibold text-right">
                                +{charCount - X_LIMIT} over
                              </span>
                            )}
                          </div>

                          {d.status === 'error' && (
                            <button
                              onClick={e => { e.stopPropagation(); generateOne(idx) }}
                              data-testid={`variant-retry-${idx}`}
                              className="w-full mt-2 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-[11px] font-bold rounded-lg transition-colors"
                            >
                              ↻ Retry this variant
                            </button>
                          )}

                          {d.poll?.options?.length > 0 && (
                            <div
                              data-testid={`variant-poll-${idx}`}
                              className="mt-2 rounded-lg border border-brand-600/40 bg-brand-600/5 px-2.5 py-2 space-y-1"
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold text-brand-600 uppercase tracking-wide">
                                  Poll preview
                                </span>
                                <span className="text-[9px] text-slate-400">
                                  {Math.round((d.poll.duration_minutes || 1440) / 60)}h
                                </span>
                              </div>
                              <ul className="space-y-0.5">
                                {d.poll.options.map((opt, i) => {
                                  const isCorrect = i === d.sourceMeta?.correctIndex
                                  return (
                                    <li
                                      key={i}
                                      className={`text-[11px] flex items-center gap-1.5 ${isCorrect ? 'text-emerald-300 font-semibold' : 'text-slate-300'}`}
                                    >
                                      <span className="text-slate-500">{i + 1}.</span>
                                      <span className="flex-1 break-words">{opt}</span>
                                      {isCorrect && <span className="text-[9px] text-emerald-400">✓</span>}
                                    </li>
                                  )
                                })}
                              </ul>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {/* Carousel controls — dot indicators + prev/next. */}
                  <div className="flex items-center justify-center gap-3">
                    <button
                      onClick={() => selectVariant(Math.max(0, selectedIndex - 1))}
                      disabled={selectedIndex === 0}
                      data-testid="carousel-prev"
                      className="w-7 h-7 rounded-full bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold flex items-center justify-center transition-colors disabled:opacity-30"
                    >
                      ◀
                    </button>
                    <div className="flex items-center gap-1.5">
                      {drafts.map((d, idx) => {
                        const isSel = idx === selectedIndex
                        // Dot colours mirror the per-card status pill so the
                        // user can see at a glance which variants are ready,
                        // still loading, or failed without scrolling.
                        const dotClass = isSel
                          ? 'bg-brand-600'
                          : d.status === 'ready'   ? 'bg-emerald-500 hover:bg-emerald-400'
                          : d.status === 'loading' ? 'bg-amber-400 animate-pulse'
                          : d.status === 'error'   ? 'bg-red-500 hover:bg-red-400'
                                                   : 'bg-slate-600 hover:bg-slate-500'
                        return (
                          <button
                            key={idx}
                            onClick={() => selectVariant(idx)}
                            data-testid={`carousel-dot-${idx}`}
                            data-status={d.status}
                            aria-label={`Select variant ${idx + 1}`}
                            className={`w-2.5 h-2.5 rounded-full transition-colors ${dotClass} ${isSel ? 'ring-2 ring-brand-600/40 ring-offset-1 ring-offset-surface' : ''}`}
                          />
                        )
                      })}
                    </div>
                    <button
                      onClick={() => selectVariant(Math.min(VARIANT_COUNT - 1, selectedIndex + 1))}
                      disabled={selectedIndex === VARIANT_COUNT - 1}
                      data-testid="carousel-next"
                      className="w-7 h-7 rounded-full bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold flex items-center justify-center transition-colors disabled:opacity-30"
                    >
                      ▶
                    </button>
                  </div>
                </div>
              )}

              {/* Publish — only the selected variant gets posted. */}
              {anyDraftReady && (
                <div className="space-y-1.5">
                  <button
                    onClick={publish}
                    disabled={publishing || selectedOverLimit || !status?.connected || selectedDraft.status !== 'ready'}
                    className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-40"
                    data-testid="publish-button"
                  >
                    {publishing ? 'Posting…' : `Post Variant ${selectedIndex + 1} to X`}
                  </button>
                  {selectedDraft.status !== 'ready' && (
                    <p className="text-[11px] text-amber-300">Selected variant isn't ready yet — pick one that has finished generating.</p>
                  )}
                  {!status?.connected && (
                    <p className="text-[11px] text-slate-400">Connect the X account above before posting.</p>
                  )}
                  {selectedOverLimit && (
                    <p className="text-[11px] text-red-400">Selected variant is {selectedCharCount - X_LIMIT} chars over the {X_LIMIT} limit — trim before posting.</p>
                  )}
                  {publishError && <p className="text-xs text-red-400">{publishError}</p>}
                </div>
              )}
            </div>
          </div>

          {/* Recent posts */}
          <div className="rounded-2xl overflow-hidden mb-2 border-2" style={{ background: '#0c1829', borderColor: '#172236' }}>
            <div className="px-5 py-3 border-b" style={{ background: '#102040', borderColor: '#172236' }}>
              <h4 className="font-bold text-slate-800">Recent posts</h4>
            </div>
            <div className="px-5 py-3 space-y-2">
              {!postsLoaded && <p className="text-xs text-slate-400">Loading…</p>}
              {postsLoaded && posts.length === 0 && <p className="text-xs text-slate-400">No posts yet.</p>}
              {posts.map(p => {
                const isDeleted      = !!p.deletedAt
                const hasImage      = !!p.includedImageUrl
                const hasViewableImage = hasImage && p.includedImageUrl !== '[uploaded]'
                const imageOpen     = openImagePostIds.has(p._id)
                return (
                  <div key={p._id} data-testid={`post-row-${p._id}`} data-deleted={isDeleted ? 'true' : 'false'}
                       className={`py-2 border-b border-slate-800 last:border-0 ${isDeleted ? 'opacity-60' : ''}`}>
                    <div className="flex items-center gap-2 mb-0.5 text-[11px]">
                      <span className={`px-1.5 py-0.5 rounded font-bold ${p.status === 'posted' ? 'bg-emerald-600/20 text-emerald-300' : p.status === 'failed' ? 'bg-red-600/20 text-red-300' : 'bg-slate-600/20 text-slate-300'}`}>
                        {p.status}
                      </span>
                      <span className="text-slate-400">{p.postType}</span>
                      {isDeleted && (
                        <span className="px-1.5 py-0.5 rounded font-bold bg-slate-600/30 text-slate-300"
                              data-testid={`post-deleted-badge-${p._id}`}>
                          deleted
                        </span>
                      )}
                      {hasImage && (
                        <span className="px-1.5 py-0.5 rounded font-bold bg-brand-600/15 text-brand-600"
                              data-testid={`post-has-image-badge-${p._id}`}>
                          📎 image
                        </span>
                      )}
                      <span className="text-slate-500 ml-auto">{p.createdAt && new Date(p.createdAt).toLocaleString()}</span>
                    </div>
                    <p className={`text-sm break-words ${isDeleted ? 'text-slate-500 line-through' : 'text-slate-700'}`}>{p.finalText}</p>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      {p.externalPostUrl && (
                        <a href={p.externalPostUrl} target="_blank" rel="noreferrer"
                           className="text-[11px] text-brand-600 hover:text-brand-700 underline">
                          View on X →
                        </a>
                      )}
                      {hasViewableImage && (
                        <button
                          onClick={() => toggleImageOpen(p._id)}
                          data-testid={`post-toggle-image-${p._id}`}
                          aria-expanded={imageOpen}
                          className="text-[11px] text-slate-400 hover:text-slate-200 underline"
                        >
                          {imageOpen ? 'Hide image ▲' : 'View image ▼'}
                        </button>
                      )}
                      {p.status === 'posted' && (
                        <button
                          onClick={() => toggleDeleted(p._id, !isDeleted)}
                          data-testid={`post-toggle-deleted-${p._id}`}
                          className="text-[11px] text-slate-400 hover:text-slate-200 underline ml-auto"
                        >
                          {isDeleted ? 'Mark as live' : 'Mark as deleted'}
                        </button>
                      )}
                    </div>
                    {hasViewableImage && imageOpen && (
                      <div className="mt-2 rounded-lg border border-slate-700 bg-slate-900/50 p-2 inline-block"
                           data-testid={`post-image-panel-${p._id}`}>
                        <a href={p.includedImageUrl} target="_blank" rel="noreferrer">
                          <img
                            src={p.includedImageUrl}
                            alt="Attached post image"
                            className="max-h-64 max-w-full rounded"
                          />
                        </a>
                      </div>
                    )}
                    {isDeleted && (
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Removed from X · {new Date(p.deletedAt).toLocaleString()}
                      </p>
                    )}
                    {p.error && <p className="text-[11px] text-red-300 mt-0.5">Error: {p.error}</p>}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
