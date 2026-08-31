import { useState, useEffect, useMemo } from 'react'
import { Player } from '@remotion/player'
import { ClipperVideo, timelineDurationInFrames, FPS, WIDTH, HEIGHT } from '../../remotion/ClipperVideo'
import { previewTimeline, unplayableCaptureCount, mediaUrl } from '../../utils/clipperPreview'

// Stage 7 — preview and export.
//
// The player mounts the same ClipperVideo component the agent renders, so this
// is a true preview rather than an approximation. Anything that looks wrong
// here will look wrong in the MP4.
//
// Screen recordings are the one thing neither end can take as stored: they are
// files on the agent's disk, and both the browser and the Remotion renderer
// speak http only. The preview routes them through the agent's media server
// here; the agent's render handler does the same on its side, so the stored
// timeline stays free of a port number that dies with the agent.

export default function RenderPanel({ script, timeline, job, agentOnline, mediaBaseUrl, onRender, onRefresh, onReveal, onBranding, busy }) {
  const [showJson, setShowJson] = useState(false)
  const [copied, setCopied] = useState(null)

  const copyPath = (p) => {
    if (!p) return
    navigator.clipboard?.writeText(p)
      .then(() => setCopied(p))
      .catch(() => { /* a denied clipboard is not worth an error banner */ })
  }

  // Timelines are rebuilt server-side from the current stage data, so refresh
  // whenever the script changes underneath us.
  useEffect(() => { onRefresh?.() }, [script?.updatedAt, onRefresh])

  const running = job && (job.status === 'queued' || job.status === 'claimed')
  const renders = script?.renders ?? []
  const hasBeats = (timeline?.beats?.length ?? 0) > 0

  const durationInFrames = hasBeats ? timelineDurationInFrames(timeline) : FPS

  const playable = useMemo(() => previewTimeline(timeline, mediaBaseUrl), [timeline, mediaBaseUrl])
  const unreachableCaptures = unplayableCaptureCount(timeline, mediaBaseUrl)

  // Taken from the newest render rather than hard-coded: the agent decides
  // where its output goes, and a path duplicated here would drift from it.
  const renderFolder = renders[0]?.localPath?.replace(/[\\/][^\\/]*$/, '') || null

  return (
    <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
      <div>
        {hasBeats ? (
          <div className="rounded-2xl overflow-hidden border border-slate-200 bg-black">
            <Player
              component={ClipperVideo}
              inputProps={{ timeline: playable }}
              durationInFrames={durationInFrames}
              fps={FPS}
              compositionWidth={WIDTH}
              compositionHeight={HEIGHT}
              style={{ width: '100%' }}
              controls
              loop
            />
          </div>
        ) : (
          <p className="text-sm text-slate-500 py-10 text-center border border-dashed border-slate-200 rounded-2xl">
            Nothing to preview yet.
          </p>
        )}

        {/* Beside the player rather than in a settings tab, because the only
            way to judge a logo is to watch it against the footage it lands on. */}
        <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={script?.branding?.enabled !== false}
            disabled={busy}
            onChange={e => onBranding?.(e.target.checked)}
          />
          SkyWatch mark - top left, names the domain once when the app appears
        </label>

        {unreachableCaptures > 0 && (
          <p className="mt-2 text-xs text-amber-700 bg-amber-100 border border-amber-200 rounded-lg px-2.5 py-1.5">
            {unreachableCaptures} screen {unreachableCaptures === 1 ? 'recording' : 'recordings'} cannot
            be reached - those beats show the backdrop instead of the clip. The agent serves recordings
            to both the preview and the renderer, so start it before rendering.
          </p>
        )}
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onRender}
            disabled={busy || running || !agentOnline || !hasBeats}
            title={agentOnline ? undefined : 'The agent renders the video - start it first'}
            className="px-3 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold hover:bg-brand-500 transition-colors disabled:opacity-40"
          >
            {running ? 'Rendering…' : 'Render MP4'}
          </button>

          {hasBeats && (
            <span className="text-xs text-slate-500">
              {timeline.beats.length} beats &middot; {(timeline.totalDurationMs / 1000).toFixed(1)}s
              &middot; {WIDTH}&times;{HEIGHT}
            </span>
          )}

          <button
            type="button"
            onClick={() => setShowJson(v => !v)}
            className="ml-auto text-xs text-brand-600 font-semibold hover:underline"
          >
            {showJson ? 'Hide' : 'Show'} timeline JSON
          </button>
        </div>

        {running && (
          <div className="space-y-1">
            <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full bg-brand-600 transition-all duration-500" style={{ width: `${job.progress || 0}%` }} />
            </div>
            <p className="text-xs text-slate-500">{job.stepLabel || 'queued'}</p>
          </div>
        )}

        {job?.status === 'failed' && (
          <p className="text-xs text-rose-700 bg-rose-100 border border-rose-200 rounded-lg px-2.5 py-1.5">
            Render failed: {job.error}
          </p>
        )}

        {renders.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Renders</p>

            {/* The folder, spelled out. A render lands in a temp path nobody
                would guess, and the file is the whole point of the stage. */}
            {renderFolder && (
              <p className="text-[11px] text-slate-500 font-mono break-all">{renderFolder}</p>
            )}

            {renders.map((r, i) => {
              const playable = mediaUrl(r.localPath, mediaBaseUrl)
              return (
                <div key={r.jobId || i} className="flex flex-wrap items-center gap-2 border border-slate-200 rounded-lg bg-slate-50 px-3 py-2">
                  <span className="text-xs text-slate-700 font-mono flex-1 min-w-0 truncate" title={r.localPath}>
                    {r.localPath?.split(/[\\/]/).pop() || r.url}
                  </span>
                  {r.bytes ? (
                    <span className="text-xs text-slate-500">{(r.bytes / 1_000_000).toFixed(1)} MB</span>
                  ) : null}
                  {i === 0 && (
                    <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">latest</span>
                  )}

                  {playable && (
                    <a
                      href={playable}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-brand-600 font-semibold hover:underline"
                    >
                      Play
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => onReveal?.(r.localPath)}
                    disabled={!r.localPath}
                    className="text-xs text-brand-600 font-semibold hover:underline disabled:opacity-40 disabled:no-underline"
                  >
                    Show in folder
                  </button>
                  <button
                    type="button"
                    onClick={() => copyPath(r.localPath)}
                    disabled={!r.localPath}
                    className="text-xs text-slate-500 font-semibold hover:underline disabled:opacity-40 disabled:no-underline"
                  >
                    {copied === r.localPath ? 'Copied' : 'Copy path'}
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {showJson && (
          <pre className="text-[11px] bg-slate-100 border border-slate-200 rounded-lg p-3 overflow-auto max-h-96 text-slate-700">
            {JSON.stringify(timeline, null, 2)}
          </pre>
        )}
      </div>
    </div>
  )
}
