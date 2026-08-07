import { useCallback, useEffect, useRef, useState } from 'react'

// Choose which part of a clip plays under a beat.
//
// The problem this exists for: a screen recording opens on the app's loading
// spinner, and a beat only lasts a couple of seconds, so the finished video
// showed a loading screen where the gameplay was meant to be. Stock clips have
// the same issue more mildly — the interesting second is rarely the first one.
//
// ── Why the window is a fixed width ─────────────────────────────────────────
// A beat lasts exactly as long as its narration (clipperTimeline.js), so the
// amount of footage needed is not up for negotiation: it is decided by the
// voice track. Two free handles would let you select four seconds for a
// two-second beat and then quietly discard half of it, or select one second and
// leave a second of frozen frame — neither is a choice worth offering.
//
// So this is a window of the beat's own length that slides along the clip. You
// set where it starts; the end follows. Both ends are shown, because "what will
// actually be on screen" is the question being answered.
//
// Before narration is recorded the beat length is unknown. The window then
// falls back to the estimate the script stage produced, and says so.

const fmt = (ms) => {
  const s = Math.max(0, ms) / 1000;
  return `${s.toFixed(1)}s`;
}

export default function TrimScrubber({ src, clipDurationMs, windowMs, inMs, onChange, estimated, emptyMessage }) {
  const videoRef = useRef(null)
  const trackRef = useRef(null)

  // Metadata duration is the truth about the file. `clipDurationMs` comes from
  // the provider (or ffprobe) and is often rounded, so a window placed against
  // it can run past the real end of a clip.
  const [loadedMs, setLoadedMs] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [failed, setFailed] = useState(false)

  const totalMs = loadedMs ?? clipDurationMs ?? 0
  // A window longer than the clip cannot slide anywhere; clamping it here keeps
  // every position calculation below in range instead of producing negatives.
  const winMs = Math.min(windowMs || 0, totalMs || windowMs || 0)
  const maxInMs = Math.max(0, totalMs - winMs)
  const start = Math.min(Math.max(0, inMs || 0), maxInMs)

  const pct = (ms) => (totalMs > 0 ? (ms / totalMs) * 100 : 0)

  // Seek the preview to wherever the window now starts. This is the whole
  // point of the control: you drag until the loading screen is gone.
  useEffect(() => {
    const video = videoRef.current
    if (!video || playing || totalMs <= 0) return
    const target = start / 1000
    if (Math.abs(video.currentTime - target) > 0.05) video.currentTime = target
  }, [start, playing, totalMs])

  const msAtClientX = useCallback((clientX) => {
    const track = trackRef.current
    if (!track || totalMs <= 0) return 0
    const { left, width } = track.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - left) / width))
    return ratio * totalMs
  }, [totalMs])

  // Grabbing the window moves it by its centre so it does not jump under the
  // pointer; grabbing the empty track places the window's start there.
  const beginDrag = (e, mode) => {
    e.preventDefault()
    setPlaying(false)
    videoRef.current?.pause()
    setDragging(true)

    const grabOffset = mode === 'window' ? msAtClientX(e.clientX) - start : 0

    const move = (ev) => {
      const raw = msAtClientX(ev.clientX) - grabOffset
      onChange(Math.round(Math.min(Math.max(0, raw), maxInMs)))
    }
    const up = () => {
      setDragging(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }

    move(e)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // Play just the selected window, then stop. Checking what you picked should
  // not mean watching the rest of the clip.
  const previewWindow = () => {
    const video = videoRef.current
    if (!video) return
    if (playing) { video.pause(); setPlaying(false); return }
    video.currentTime = start / 1000
    setPlaying(true)
    video.play().catch(() => setPlaying(false))
  }

  const onTimeUpdate = () => {
    const video = videoRef.current
    if (!video || !playing) return
    if (video.currentTime * 1000 >= start + winMs) {
      video.pause()
      video.currentTime = start / 1000
      setPlaying(false)
    }
  }

  const nudge = (deltaMs) => onChange(Math.round(Math.min(Math.max(0, start + deltaMs), maxInMs)))

  // Why there is nothing to scrub differs by provider, and so does the fix, so
  // the caller supplies the sentence rather than this guessing at one.
  if (!src) {
    return <p className="text-xs text-slate-500">{emptyMessage || 'This clip cannot be previewed here.'}</p>
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-3">
        {/* 9:16 to match the composition, kept small: it answers "has the
            loading screen gone yet", not "is this frame well composed". */}
        <div className="w-[72px] h-32 shrink-0 rounded-lg overflow-hidden bg-black">
          <video
            ref={videoRef}
            src={src}
            muted
            playsInline
            preload="metadata"
            onLoadedMetadata={e => {
              setFailed(false)
              setLoadedMs(Number.isFinite(e.target.duration) ? e.target.duration * 1000 : null)
            }}
            onError={() => setFailed(true)}
            onTimeUpdate={onTimeUpdate}
            className="w-full h-full object-cover"
          />
        </div>

        <div className="flex-1 min-w-0 space-y-2">
          {/* The track. Clicking anywhere on it moves the window there, so the
              coarse "somewhere after the loading screen" move is one click. */}
          <div
            ref={trackRef}
            onPointerDown={e => beginDrag(e, 'track')}
            className="relative h-10 rounded-lg bg-slate-100 border border-slate-200 cursor-pointer select-none overflow-hidden touch-none"
          >
            {/* Second markers, so the bar reads as a duration rather than a
                bare slider. */}
            {totalMs > 0 && Array.from({ length: Math.floor(totalMs / 1000) }, (_, i) => (
              <span
                key={i}
                className="absolute top-0 bottom-0 w-px bg-slate-200"
                style={{ left: `${pct((i + 1) * 1000)}%` }}
              />
            ))}

            <div
              onPointerDown={e => { e.stopPropagation(); beginDrag(e, 'window') }}
              className={`absolute top-0 bottom-0 rounded-md border-2 bg-brand-600/25 cursor-grab ${
                dragging ? 'border-brand-500 cursor-grabbing' : 'border-brand-600'
              }`}
              style={{ left: `${pct(start)}%`, width: `${pct(winMs)}%` }}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={previewWindow}
              className="px-2 py-1 rounded-lg border border-brand-200 text-brand-600 text-xs font-semibold hover:bg-brand-100 transition-colors"
            >
              {playing ? 'Stop' : 'Play window'}
            </button>

            {[-500, -100, 100, 500].map(d => (
              <button
                key={d}
                type="button"
                onClick={() => nudge(d)}
                className="px-1.5 py-1 rounded-lg border border-slate-200 text-slate-600 text-[11px] font-mono hover:bg-slate-100 transition-colors"
              >
                {d > 0 ? `+${d}` : d}
              </button>
            ))}

            <button
              type="button"
              onClick={() => onChange(0)}
              disabled={start === 0}
              className="px-2 py-1 rounded-lg text-slate-500 text-xs font-semibold hover:underline disabled:opacity-40 disabled:no-underline"
            >
              Reset
            </button>

            <span className="text-[11px] text-slate-500 font-mono ml-auto">
              {fmt(start)} &rarr; {fmt(start + winMs)} of {fmt(totalMs)}
            </span>
          </div>
        </div>
      </div>

      {failed && (
        <p className="text-xs text-rose-700">
          This clip would not load, so the frame preview is blank. The trim still saves.
        </p>
      )}

      {/* Two honest caveats, shown only when they apply. */}
      {estimated && (
        <p className="text-[11px] text-slate-500">
          Window length is the script&rsquo;s estimate - it becomes exact once the narration is recorded.
        </p>
      )}
      {totalMs > 0 && windowMs > totalMs && (
        <p className="text-[11px] text-amber-700">
          This clip is shorter than the beat ({fmt(totalMs)} of {fmt(windowMs)}), so its last frame
          will hold for the rest.
        </p>
      )}
    </div>
  )
}
