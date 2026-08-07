import { useState, useEffect, useRef, useCallback } from 'react'
import { mediaUrl } from '../../utils/clipperPreview'

// Stage 3 — narrate the script.
//
// The voice profile is chosen per video, not set globally: a tips video and a
// feature demo want different reads, and the whole point of having Bethan,
// Mr House and News Lady available is switching between them.
//
// Takes are listened to here rather than in the render preview. A line is
// judged on its own — is the emphasis right, did it swallow a word — and
// finding out at the render stage means scrubbing a minute of video to hear
// four seconds of audio. Regenerate is per line for the same reason: re-reading
// the whole script to fix one take gives every other line a new delivery.
//
// The wav files live on the agent's disk, so playback goes through its media
// server (utils/clipperPreview.js). No agent, no playback — hence the guard.

const PROVIDERS = [
  { id: 'voicebox',   label: 'Voicebox (local)' },
  { id: 'elevenlabs', label: 'ElevenLabs' },
]

export default function VoicePanel({ script, voices, agentOnline, providers, job, mediaBaseUrl, refreshingVoices, onRefreshVoices, onGenerate, onApprove, busy }) {
  const voice = script?.voice
  const [provider, setProvider]   = useState(voice?.provider ?? 'voicebox')
  const [profileId, setProfileId] = useState(voice?.profileId ?? '')
  const [instruct, setInstruct]   = useState('')

  const availability = providers ?? {}
  const providerOk = (id) => availability[id]?.available !== false

  useEffect(() => {
    if (voice?.profileId) setProfileId(voice.profileId)
  }, [voice?.profileId])

  // Default to the first profile once the agent has reported some.
  useEffect(() => {
    if (!profileId && voices.length > 0) setProfileId(voices[0].id)
  }, [voices, profileId])

  const running = job && (job.status === 'queued' || job.status === 'claimed')
  const lines = voice?.lines ?? []

  const fmt = (ms) => `${(ms / 1000).toFixed(1)}s`

  // ── Playback ──────────────────────────────────────────────────────────────
  // One <audio> element for the whole panel rather than one per line: only ever
  // one take plays at a time, and a dozen elements each holding a wav is a lot
  // of memory for a feature whose job is to play four seconds of speech.
  const audioRef = useRef(null)
  const [playing, setPlaying] = useState(null)   // { index, all } | null

  const srcFor = useCallback(
    (line) => (line?.wavPath ? mediaUrl(line.wavPath, mediaBaseUrl) : null),
    [mediaBaseUrl],
  )
  const canPlay = Boolean(mediaBaseUrl) && lines.some(l => l.wavPath)

  const playFrom = useCallback((index, all) => {
    const el = audioRef.current
    const src = srcFor(lines[index])
    if (!el || !src) return

    el.src = src
    el.play()
      .then(() => setPlaying({ index, all }))
      // Autoplay policy, a swept temp file, an agent that just stopped — none
      // of them are worth an error banner over a preview button.
      .catch(() => setPlaying(null))
  }, [lines, srcFor])

  const stop = useCallback(() => {
    audioRef.current?.pause()
    setPlaying(null)
  }, [])

  // Sequential play walks the lines in order, which is the only way to hear
  // whether the takes sit together as one read.
  //
  // Reads `playing` straight from state rather than through a setState updater:
  // an updater runs during the next render, so anything it schedules is a side
  // effect in the wrong place. The handler is attached in JSX, so React always
  // calls the current closure.
  const handleEnded = useCallback(() => {
    if (!playing) return
    const next = playing.index + 1
    if (playing.all && next < lines.length) playFrom(next, true)
    else setPlaying(null)
  }, [playing, lines.length, playFrom])

  // No effect watches for the agent going away mid-playback: whatever is
  // already buffered plays out (harmless), the next take's play() rejects and
  // clears the state through the catch above, and every button is disabled by
  // `canPlay` the moment the base URL is gone.

  return (
    <div className="space-y-4">
      {agentOnline && voices.length === 0 && (
        <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5">
          No Voicebox profiles loaded yet. Press <strong>Load voices</strong> - the agent starts
          Voicebox and reads your existing profiles. The first run takes a minute while the model
          loads; after that it is instant.
        </p>
      )}

      {!agentOnline && (
        <p className="text-xs text-amber-700 bg-amber-100 border border-amber-200 rounded-lg px-2.5 py-1.5">
          The agent is offline, so narration cannot run. Use{' '}
          <strong>Start agent</strong> next to the page heading.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mr-1">Provider</span>
        {PROVIDERS.map(p => {
          const ok = providerOk(p.id)
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => ok && setProvider(p.id)}
              disabled={!ok}
              title={ok ? undefined : availability[p.id]?.reason || 'not available'}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                !ok
                  ? 'border-slate-200 text-slate-300 cursor-not-allowed'
                  : provider === p.id
                    ? 'bg-brand-100 text-brand-600 border-brand-200'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-100'
              }`}
            >
              {p.label}
              {!ok && <span className="ml-1 font-normal">·  {availability[p.id]?.reason}</span>}
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-600">
          <span className="block font-semibold mb-1">Voice</span>
          <select
            value={profileId}
            onChange={e => setProfileId(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-800 min-w-44"
          >
            {voices.length === 0 && <option value="">no profiles loaded</option>}
            {voices.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>

        <button
          type="button"
          onClick={onRefreshVoices}
          disabled={busy || !agentOnline || refreshingVoices}
          title="Starts Voicebox and reads its profiles - the first run takes a minute while the model loads"
          className="px-3 py-1.5 rounded-lg border border-brand-200 text-brand-600 text-xs font-semibold hover:bg-brand-100 transition-colors disabled:opacity-40"
        >
          {refreshingVoices ? 'Loading…' : voices.length ? 'Reload voices' : 'Load voices'}
        </button>

        <label className="text-xs text-slate-600 flex-1 min-w-52">
          <span className="block font-semibold mb-1">Delivery note (optional)</span>
          <input
            value={instruct}
            onChange={e => setInstruct(e.target.value)}
            placeholder="energetic, punchy, straight to camera"
            className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-800"
          />
        </label>

        <button
          type="button"
          onClick={() => onGenerate({ provider, profileId, instruct })}
          disabled={busy || running || !agentOnline || !profileId || !providerOk(provider)}
          className="px-3 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold hover:bg-brand-500 transition-colors disabled:opacity-40"
        >
          {running ? 'Narrating…' : lines.length ? 'Re-record' : 'Generate voice'}
        </button>

        {lines.length > 0 && !running && (
          <button
            type="button"
            onClick={onApprove}
            disabled={busy}
            className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500 transition-colors disabled:opacity-40"
          >
            Approve voice
          </button>
        )}
      </div>

      {running && (
        <div className="space-y-1">
          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full bg-brand-600 transition-all duration-500"
              style={{ width: `${job.progress || 0}%` }}
            />
          </div>
          <p className="text-xs text-slate-500">{job.stepLabel || 'queued'}</p>
        </div>
      )}

      {job?.status === 'failed' && (
        <p className="text-xs text-rose-700 bg-rose-100 border border-rose-200 rounded-lg px-2.5 py-1.5">
          Narration failed: {job.error}
        </p>
      )}

      {lines.length > 0 && (
        <>
          <audio ref={audioRef} onEnded={handleEnded} className="hidden" />

          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs text-slate-500">
              {lines.length} lines &middot; {fmt(voice.totalDurationMs)} total
              {voice.totalDurationMs > 60000 && (
                <span className="text-amber-700 font-semibold"> &middot; over a minute, consider trimming</span>
              )}
            </p>

            <button
              type="button"
              onClick={() => (playing?.all ? stop() : playFrom(0, true))}
              disabled={!canPlay}
              title={canPlay ? undefined : 'The agent serves the audio - start it first'}
              className="ml-auto px-3 py-1.5 rounded-lg border border-brand-200 text-brand-600 text-xs font-semibold hover:bg-brand-100 transition-colors disabled:opacity-40"
            >
              {playing?.all ? 'Stop' : 'Play all'}
            </button>
          </div>

          <div className="space-y-1.5">
            {lines.map((l, i) => {
              const isPlaying = playing?.index === i
              return (
                <div
                  key={l.beatId}
                  className={`flex items-start gap-3 border rounded-lg px-3 py-2 transition-colors ${
                    isPlaying ? 'border-brand-600 bg-brand-100' : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 shrink-0 mt-0.5">
                    {l.beatId === 'outro' ? 'Outro' : `Beat ${i + 1}`}
                  </span>
                  <p className="text-sm text-slate-700 flex-1">{l.text}</p>
                  <span className="text-xs text-slate-500 font-mono shrink-0">{fmt(l.durationMs)}</span>

                  <button
                    type="button"
                    onClick={() => (isPlaying ? stop() : playFrom(i, false))}
                    disabled={!srcFor(l)}
                    title={srcFor(l) ? undefined : 'The agent serves the audio - start it first'}
                    className="shrink-0 px-2 py-0.5 rounded-lg border border-brand-200 text-brand-600 text-xs font-semibold hover:bg-brand-100 transition-colors disabled:opacity-40"
                  >
                    {isPlaying ? 'Stop' : 'Play'}
                  </button>

                  <button
                    type="button"
                    onClick={() => onGenerate({ provider, profileId, instruct, beatIds: [l.beatId] })}
                    disabled={busy || running || !profileId || !providerOk(provider)}
                    title="Re-record just this line"
                    className="shrink-0 px-2 py-0.5 rounded-lg border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-100 transition-colors disabled:opacity-40"
                  >
                    Redo
                  </button>
                </div>
              )
            })}
          </div>

          {!canPlay && (
            <p className="text-xs text-slate-500">
              Start the agent to play these back &mdash; it serves the audio files from this machine.
            </p>
          )}
        </>
      )}
    </div>
  )
}
