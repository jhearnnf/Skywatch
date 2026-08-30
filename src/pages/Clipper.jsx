import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import SEO from '../components/SEO'
import { isLocalEnvironment } from '../utils/localEnvironment'
import FactLedger from '../components/clipper/FactLedger'
import IdeaGenerator from '../components/clipper/IdeaGenerator'
import ScriptEditor from '../components/clipper/ScriptEditor'
import AgentStatusPill from '../components/clipper/AgentStatusPill'
import AgentPanel from '../components/clipper/AgentPanel'
import MusicPanel from '../components/clipper/MusicPanel'
import FootagePicker from '../components/clipper/FootagePicker'
import VoicePanel from '../components/clipper/VoicePanel'
import CaptionStyler from '../components/clipper/CaptionStyler'
import OverlayEditor from '../components/clipper/OverlayEditor'
import SfxPanel from '../components/clipper/SfxPanel'
// Lazy: RenderPanel pulls in @remotion/player and the composition, roughly
// 300kB that only an admin on the workstation can ever use. Statically imported
// it lands in the main chunk and ships to every visitor — and pushes the bundle
// past the PWA precache limit.
const RenderPanel = lazy(() => import('../components/clipper/RenderPanel'))

// Clipper — admin-only short-form video pipeline.
//
// This page currently covers the first three stages of the plan in
// APPLICATION_INFO/CLIPPER_PLAN.md: ingesting the reference guide into a graded
// fact ledger, generating deduped ideas from it, and writing a validated
// script. Footage, voice, captions, SFX and render land on the same shell as
// further tabs, driven by the local agent.

const TABS = [
  { id: 'facts',   label: 'Facts'   },
  { id: 'ideas',   label: 'Ideas'   },
  { id: 'scripts', label: 'Scripts' },
  // Everything from here on is per-script, so these are disabled until one is
  // open rather than hidden — the pipeline's shape should be visible from the
  // start, not revealed a stage at a time.
  { id: 'footage', label: 'Footage', needsScript: true },
  { id: 'voice',    label: 'Voice',    needsScript: true },
  { id: 'captions', label: 'Captions', needsScript: true },
  { id: 'sfx',      label: 'Sound FX', needsScript: true },
  { id: 'music',    label: 'Music',    needsScript: true },
  { id: 'overlays', label: 'Overlays', needsScript: true },
  { id: 'render',   label: 'Render',   needsScript: true },
  // Not a pipeline stage — it is the machinery every stage runs on, so it
  // sits at the end and is reachable without a script open.
  { id: 'agent',    label: 'Agent'   },
]

export default function Clipper() {
  const { user, loading: authLoading, API, apiFetch } = useAuth()
  const navigate = useNavigate()

  const isLocal = isLocalEnvironment()
  const [tab, setTab] = useState('facts')

  const [facts,    setFacts]    = useState([])
  const [counts,   setCounts]   = useState({ green: 0, amber: 0, red: 0 })
  const [ingested, setIngested] = useState(false)

  const [ideas,     setIdeas]     = useState([])
  const [scripts,   setScripts]   = useState([])
  const [active,    setActive]    = useState(null)

  // What a video can be about. Served rather than hardcoded so the picker and
  // the guardrail validator can never disagree about which games are filmable.
  const [subjects,    setSubjects]    = useState([])
  const [providers,   setProviders]   = useState({})
  // Keys that are set but rejected. Separate from `providers` because a
  // provider can be configured and still be contributing nothing.
  const [providerErrors, setProviderErrors] = useState({})
  const [voices,      setVoices]      = useState([])
  const [voiceProviders, setVoiceProviders] = useState({})
  const [sfxLibrary,  setSfxLibrary]  = useState([])
  const [sfxDir,      setSfxDir]      = useState('sounds/sound_effects')
  const [agentOnline, setAgentOnline] = useState(false)
  // Where the agent serves its temp files, so the preview can play screen
  // recordings that only exist on this disk. Null when the agent is down.
  const [mediaBaseUrl, setMediaBaseUrl] = useState(null)
  const [activeJob,   setActiveJob]   = useState(null)
  const [refreshingVoices, setRefreshingVoices] = useState(false)
  const [timeline,    setTimeline]    = useState(null)
  const lastDoneJob = useRef(null)
  const [busy,      setBusy]      = useState(false)
  const [pickingId, setPickingId] = useState(null)
  const [error,     setError]     = useState(null)

  useEffect(() => {
    if (authLoading) return
    if (!user || !user.isAdmin) navigate('/home', { replace: true })
  }, [user, authLoading, navigate])

  // The authoring surface is two-column on desktop; AppShell caps every route
  // at max-w-3xl, so the body class is the only way to widen it.
  useEffect(() => {
    document.body.classList.add('clipper-wide')
    return () => document.body.classList.remove('clipper-wide')
  }, [])

  const call = useCallback(async (path, options = {}) => {
    const res = await apiFetch(`${API}/api/clipper${path}`, {
      credentials: 'include',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      ...options,
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.message || `Request failed (${res.status})`)
    return json.data
  }, [API, apiFetch])

  const loadFacts = useCallback(async () => {
    const data = await call('/facts?includeRetired=true')
    setFacts(data.facts)
    setCounts(data.counts)
    setIngested(data.ingested)
  }, [call])

  const loadScripts = useCallback(async () => {
    const data = await call('/scripts')
    setScripts(data.scripts)
  }, [call])

  useEffect(() => {
    if (!user?.isAdmin || !isLocal) return
    Promise.all([
      loadFacts(),
      loadScripts(),
      call('/subjects').then(d => setSubjects(d.subjects)),
      call('/footage/providers').then(d => { setProviders(d.providers); setProviderErrors(d.providerErrors ?? {}) }),
      call('/sfx/library').then(d => { setSfxLibrary(d.sfx); setSfxDir(d.dir) }),
    ]).catch(e => setError(e.message))
  }, [user?.isAdmin, isLocal, loadFacts, loadScripts, call])

  const run = async (fn) => {
    setBusy(true)
    setError(null)
    try { await fn() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const handleIngest = (source) => run(async () => {
    await call('/facts/ingest', {
      method: 'POST',
      body: JSON.stringify(source ? { source } : {}),
    })
    await loadFacts()
  })

  const handleRetire = (factKey, retired) => run(async () => {
    await call(`/facts/${encodeURIComponent(factKey)}`, {
      method: 'PATCH',
      body: JSON.stringify({ retired }),
    })
    await loadFacts()
  })

  const handleGenerateIdeas = ({ mode, count }) => run(async () => {
    const data = await call('/ideas/generate', {
      method: 'POST',
      body: JSON.stringify({ mode, count }),
    })
    setIdeas(data.ideas)
  })

  const handlePickIdea = (idea) => {
    setPickingId(idea.oneLiner)
    run(async () => {
      const data = await call('/scripts', { method: 'POST', body: JSON.stringify({ idea }) })
      await loadScripts()
      setActive(data.script)
      setTab('scripts')
    }).finally(() => setPickingId(null))
  }

  const openScript = (id) => run(async () => {
    const data = await call(`/scripts/${id}`)
    setActive(data.script)
  })

  const handleGenerateScript = ({ subject } = {}) => run(async () => {
    const data = await call(`/scripts/${active._id}/script/generate`, {
      method: 'POST',
      body: JSON.stringify({ subject }),
    })
    setActive(data.script)
    await loadScripts()
  })

  const handleSaveScript = ({ beats, outro, subject }) => run(async () => {
    const data = await call(`/scripts/${active._id}`, {
      method: 'PATCH',
      body: JSON.stringify({ beats, outro: { copy: outro }, subject }),
    })
    setActive(data.script)
  })

  const handleApproveScript = () => run(async () => {
    const data = await call(`/scripts/${active._id}/stages/script/approve`, { method: 'POST' })
    setActive(data.script)
    await Promise.all([loadScripts(), loadFacts()])
    setTab('footage')
  })

  // ── Stage 2: footage ──────────────────────────────────────────────────────
  const handleSearchAllFootage = () => run(async () => {
    const data = await call(`/scripts/${active._id}/footage/search`, {
      method: 'POST', body: JSON.stringify({}),
    })
    setActive(a => ({ ...a, footage: data.footage }))
    setProviders(data.providers)
    setProviderErrors(data.providerErrors ?? {})
  })

  const handleSearchFootage = (beatId, term) => run(async () => {
    const data = await call(`/scripts/${active._id}/footage/search`, {
      method: 'POST', body: JSON.stringify({ beatId, term }),
    })
    setActive(a => ({ ...a, footage: data.footage }))
  })

  const handleChooseFootage = (beatId, clip) => run(async () => {
    const data = await call(`/scripts/${active._id}/footage`, {
      method: 'PATCH', body: JSON.stringify({ beatId, chosen: clip }),
    })
    setActive(a => ({ ...a, footage: data.footage }))
  })

  // Trim changes arrive continuously while the scrubber is dragged, so local
  // state updates on every one and the write is debounced per beat. Routing
  // each pointer move through `run` would flip the whole panel into its busy
  // state dozens of times a second and queue a PATCH behind every frame.
  const trimTimers = useRef({})
  const handleTrimFootage = useCallback((beatId, inMs) => {
    const scriptId = active?._id
    if (!scriptId) return

    setActive(a => {
      if (!a) return a
      const footage = { ...(a.footage || {}) }
      const entry = { ...(footage[beatId] || {}) }
      entry.trim = { ...(entry.trim || {}), inMs }
      footage[beatId] = entry
      return { ...a, footage }
    })

    clearTimeout(trimTimers.current[beatId])
    trimTimers.current[beatId] = setTimeout(() => {
      call(`/scripts/${scriptId}/footage`, {
        method: 'PATCH', body: JSON.stringify({ beatId, trim: { inMs } }),
      }).catch(e => setError(e.message))
    }, 400)
  }, [call, active?._id])

  // Drop pending writes when the script changes, or a debounce from the script
  // you just left would land on it.
  useEffect(() => {
    const timers = trimTimers.current
    return () => { Object.values(timers).forEach(clearTimeout) }
  }, [active?._id])

  // Track choice and levels go through one endpoint: both live on the script,
  // and the levels are meaningless without a track.
  const handleMusicChange = (patch) => run(async () => {
    const data = await call(`/scripts/${active._id}/music`, {
      method: 'PATCH', body: JSON.stringify(patch),
    })
    setActive(a => ({ ...a, music: data.music }))
  })

  const handleRevealRender = (localPath) => run(async () => {
    await call('/renders/reveal', { method: 'POST', body: JSON.stringify({ path: localPath }) })
  })

  const handleCapture = (beatId) => run(async () => {
    const data = await call(`/scripts/${active._id}/capture`, {
      method: 'POST', body: JSON.stringify({ beatId }),
    })
    setActiveJob(data.job)
  })

  // Recordings we already have of a given game. Fetched on demand rather than
  // with the script: it is only ever wanted when somebody opens the list, and
  // it changes whenever any script records anything.
  const listCaptures = useCallback(
    (recipeId) => call(`/captures?recipeId=${encodeURIComponent(recipeId)}`).then(d => d.captures),
    [call],
  )

  const handleReuseCapture = (beatId, captureId) => run(async () => {
    const data = await call(`/scripts/${active._id}/footage/reuse`, {
      method: 'POST', body: JSON.stringify({ beatId, captureId }),
    })
    setActive(a => ({ ...a, footage: data.footage }))
  })

  const handleForgetCapture = (captureId) => run(async () => {
    await call(`/captures/${captureId}`, { method: 'DELETE' })
  })

  const handleApproveFootage = () => run(async () => {
    const data = await call(`/scripts/${active._id}/stages/footage/approve`, { method: 'POST' })
    setActive(data.script)
    setTab('voice')
  })

  const handleRefreshVoices = () => run(async () => {
    setRefreshingVoices(true)
    await call('/voices/refresh', { method: 'POST' })
  })

  // Clear the loading state once the agent reports profiles back.
  useEffect(() => { if (voices.length) setRefreshingVoices(false) }, [voices.length])

  // ── Stage 3: voice ────────────────────────────────────────────────────────
  // beatIds narrows the job to a single line for a redo; omitted it narrates
  // the whole script.
  const handleGenerateVoice = ({ provider, profileId, instruct, beatIds }) => run(async () => {
    const data = await call(`/scripts/${active._id}/voice/generate`, {
      method: 'POST', body: JSON.stringify({ provider, profileId, instruct, beatIds }),
    })
    setActiveJob(data.job)
  })

  const handleApproveVoice = () => run(async () => {
    const data = await call(`/scripts/${active._id}/stages/voice/approve`, { method: 'POST' })
    setActive(data.script)
    setTab('captions')
  })

  // ── Stage 4: captions ─────────────────────────────────────────────────────
  const handleGenerateCaptions = () => run(async () => {
    const data = await call(`/scripts/${active._id}/captions/generate`, { method: 'POST' })
    setActiveJob(data.job)
  })

  const handleSaveCaptionStyle = (style) => run(async () => {
    const data = await call(`/scripts/${active._id}/captions`, {
      method: 'PATCH', body: JSON.stringify({ style }),
    })
    setActive(a => ({ ...a, captions: data.captions }))
  })

  const handleApproveCaptions = () => run(async () => {
    const data = await call(`/scripts/${active._id}/stages/captions/approve`, { method: 'POST' })
    setActive(data.script)
    setTab('sfx')
  })

  // ── Stage 5: SFX ──────────────────────────────────────────────────────────
  const handleSaveSfx = (sfx) => run(async () => {
    const data = await call(`/scripts/${active._id}/sfx`, {
      method: 'PATCH', body: JSON.stringify({ sfx }),
    })
    setActive(a => ({ ...a, sfx: data.sfx }))
  })

  const handleApproveSfx = () => run(async () => {
    const data = await call(`/scripts/${active._id}/stages/sfx/approve`, { method: 'POST' })
    setActive(data.script)
    setTab('overlays')
  })

  // ── Stage 6: overlays ─────────────────────────────────────────────────────
  const handleSaveOverlays = (overlays) => run(async () => {
    const data = await call(`/scripts/${active._id}/overlays`, {
      method: 'PATCH', body: JSON.stringify({ overlays }),
    })
    setActive(a => ({ ...a, overlays: data.overlays }))
  })

  const handleApproveOverlays = () => run(async () => {
    const data = await call(`/scripts/${active._id}/stages/overlays/approve`, { method: 'POST' })
    setActive(data.script)
    setTab('render')
  })

  // ── Stage 7: render ───────────────────────────────────────────────────────
  const loadTimeline = useCallback(async () => {
    if (!active?._id) return
    try {
      const data = await call(`/scripts/${active._id}/timeline`)
      setTimeline(data.timeline)
    } catch { /* the panel shows an empty state */ }
  }, [active?._id, call])

  const handleRender = () => run(async () => {
    const data = await call(`/scripts/${active._id}/render`, { method: 'POST' })
    setActiveJob(data.job)
  })

  // Poll while the agent is working. Job progress is the only feedback during a
  // long narration or render, and stopping when nothing is running keeps this
  // from being a permanent background request.
  useEffect(() => {
    if (!active?._id || !isLocal) return
    let alive = true

    const tick = async () => {
      try {
        const { jobs } = await call(`/scripts/${active._id}/jobs`)
        if (!alive) return
        const latest = jobs[0] ?? null
        setActiveJob(latest)

        // A job that just finished has written its result onto the script, so
        // pull the script back to pick it up.
        if (latest && latest.status === 'done' && latest._id !== lastDoneJob.current) {
          lastDoneJob.current = latest._id
          const { script } = await call(`/scripts/${active._id}`)
          if (alive) setActive(script)
        }
      } catch { /* transient - the next tick retries */ }
    }

    tick()
    const id = setInterval(tick, 3000)
    return () => { alive = false; clearInterval(id) }
  }, [active?._id, isLocal, call])

  useEffect(() => {
    if (!isLocal || !user?.isAdmin) return
    const poll = () => call('/voices')
      .then(d => {
        setVoices(d.voices)
        setAgentOnline(d.online)
        setMediaBaseUrl(d.mediaBaseUrl ?? null)
        setVoiceProviders(d.providers ?? {})
      })
      .catch(() => {})
    poll()
    const id = setInterval(poll, 15000)
    return () => clearInterval(id)
  }, [isLocal, user?.isAdmin, call])

  if (authLoading || !user?.isAdmin) return null

  // The nav entry is already greyed off the workstation, but the route is still
  // reachable by typing the URL. Explain rather than 404 — landing on a blank
  // "not found" for a tool you know exists is the more confusing outcome.
  if (!isLocal) {
    return (
      <>
        <SEO title="Clipper" noIndex />
        <div className="max-w-lg mx-auto py-16 text-center space-y-3">
          <p className="text-4xl">🎬</p>
          <h1 className="text-xl font-bold text-slate-900">Clipper runs on the workstation</h1>
          <p className="text-sm text-slate-600">
            Its video stages need the local agent for footage capture, voice generation and
            rendering - none of which can run on the hosted server. Open SkyWatch from
            <code className="mx-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">localhost</code>
            on the machine running the agent.
          </p>
          <p className="text-xs text-slate-500">
            You are viewing this from <span className="font-mono">{window.location.hostname}</span>.
          </p>
        </div>
      </>
    )
  }

  return (
    <>
      <SEO title="Clipper" noIndex />

      <div className="space-y-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Clipper</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Short-form video pipeline. Reference facts to ideas to scripts.
            </p>
          </div>
          <AgentStatusPill call={call} />
        </div>

        <div className="flex items-center gap-1 border-b border-slate-200">
          {TABS.map(t => {
            const locked = t.needsScript && !active
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => !locked && setTab(t.id)}
                disabled={locked}
                title={locked ? 'Open a script first' : undefined}
                className={`px-3 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                  locked
                    ? 'border-transparent text-slate-300 cursor-not-allowed'
                    : tab === t.id
                      ? 'border-brand-600 text-brand-600'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {t.label}
                {t.id === 'scripts' && scripts.length > 0 && (
                  <span className="ml-1.5 text-xs text-slate-500">{scripts.length}</span>
                )}
              </button>
            )
          })}
        </div>

        {error && (
          <p className="text-sm text-rose-700 bg-rose-100 border border-rose-200 rounded-xl px-3 py-2">
            {error}
          </p>
        )}

        {tab === 'agent' && <AgentPanel call={call} />}

        {tab === 'music' && active && (
          <MusicPanel
            script={active}
            call={call}
            onChanged={handleMusicChange}
            busy={busy}
          />
        )}

        {tab === 'facts' && (
          <FactLedger
            facts={facts}
            counts={counts}
            ingested={ingested}
            onIngest={handleIngest}
            onRetire={handleRetire}
            busy={busy}
          />
        )}

        {tab === 'ideas' && (
          <IdeaGenerator
            ideas={ideas}
            onGenerate={handleGenerateIdeas}
            onPick={handlePickIdea}
            busy={busy}
            pickingId={pickingId}
          />
        )}

        {tab === 'scripts' && (
          <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
            <div className="space-y-1.5">
              {scripts.length === 0 && (
                <p className="text-sm text-slate-500">No scripts yet. Pick an idea to start one.</p>
              )}
              {scripts.map(s => (
                <button
                  key={s._id}
                  type="button"
                  onClick={() => openScript(s._id)}
                  className={`w-full text-left px-3 py-2 rounded-xl border transition-colors ${
                    active?._id === s._id
                      ? 'bg-brand-100 border-brand-200'
                      : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <span className="block text-sm font-semibold text-slate-800 truncate">
                    {s.title || s.idea?.oneLiner || 'Untitled'}
                  </span>
                  <span className="block text-xs text-slate-500 mt-0.5">
                    {s.mode} &middot; {s.stage}
                    {s.validation?.ok && ' · validated'}
                  </span>
                </button>
              ))}
            </div>

            <ScriptEditor
              script={active}
              subjects={subjects}
              onGenerate={handleGenerateScript}
              onSave={handleSaveScript}
              onApprove={handleApproveScript}
              busy={busy}
            />
          </div>
        )}

        {tab === 'footage' && active && (
          <FootagePicker
            script={active}
            footage={active.footage}
            providers={providers}
            providerErrors={providerErrors}
            job={activeJob}
            agentOnline={agentOnline}
            mediaBaseUrl={mediaBaseUrl}
            onSearchAll={handleSearchAllFootage}
            onSearch={handleSearchFootage}
            onChoose={handleChooseFootage}
            onCapture={handleCapture}
            onListCaptures={listCaptures}
            onReuseCapture={handleReuseCapture}
            onForgetCapture={handleForgetCapture}
            onTrim={handleTrimFootage}
            onApprove={handleApproveFootage}
            busy={busy}
          />
        )}

        {tab === 'voice' && active && (
          <VoicePanel
            script={active}
            voices={voices}
            agentOnline={agentOnline}
            providers={voiceProviders}
            refreshingVoices={refreshingVoices}
            onRefreshVoices={handleRefreshVoices}
            job={activeJob?.type === 'voice' ? activeJob : null}
            mediaBaseUrl={mediaBaseUrl}
            onGenerate={handleGenerateVoice}
            onApprove={handleApproveVoice}
            busy={busy}
          />
        )}

        {tab === 'captions' && active && (
          <CaptionStyler
            script={active}
            job={activeJob?.type === 'captions' ? activeJob : null}
            agentOnline={agentOnline}
            onGenerate={handleGenerateCaptions}
            onSaveStyle={handleSaveCaptionStyle}
            onApprove={handleApproveCaptions}
            busy={busy}
          />
        )}

        {tab === 'sfx' && active && (
          <SfxPanel
            script={active}
            library={sfxLibrary}
            sfxDir={sfxDir}
            onSave={handleSaveSfx}
            onApprove={handleApproveSfx}
            busy={busy}
          />
        )}

        {tab === 'overlays' && active && (
          <OverlayEditor
            script={active}
            onSave={handleSaveOverlays}
            onApprove={handleApproveOverlays}
            busy={busy}
          />
        )}

        {tab === 'render' && active && (
          <Suspense fallback={<p className="text-sm text-slate-500 py-10 text-center">Loading preview…</p>}>
            <RenderPanel
              script={active}
              timeline={timeline}
              job={activeJob?.type === 'render' ? activeJob : null}
              agentOnline={agentOnline}
              mediaBaseUrl={mediaBaseUrl}
              onRender={handleRender}
              onRefresh={loadTimeline}
              onReveal={handleRevealRender}
              busy={busy}
            />
          </Suspense>
        )}
      </div>
    </>
  )
}
