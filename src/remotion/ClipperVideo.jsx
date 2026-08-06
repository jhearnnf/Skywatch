import {
  AbsoluteFill, Sequence, OffthreadVideo, Audio, staticFile, useCurrentFrame,
  useVideoConfig, interpolate, spring,
} from 'remotion'

// The Clipper composition — one 9:16 short-form video.
//
// This file is the single source of truth for how a video looks. The browser
// preview (@remotion/player) and the agent's renderer (@remotion/renderer) both
// mount this exact component, so what gets fine-tuned is what ships. That
// property is the whole reason for choosing Remotion over hand-built ffmpeg
// filter graphs.
//
// Everything is driven by the `timeline` prop, which the backend assembles from
// the script, its chosen footage, and the narration durations Voicebox reported.
// Timings come from real measured audio, never from estimates.

export const FPS = 30
export const WIDTH = 1080
export const HEIGHT = 1920

// Durations must be at least one frame — a zero-length Sequence renders nothing.
const msToFrames = (ms) => Math.max(1, Math.round((ms / 1000) * FPS))
// Offsets must NOT be clamped: an SFX cued at 0ms belongs on frame 0, and
// pushing it to frame 1 would drift every stinger by a frame.
const msToOffset = (ms) => Math.max(0, Math.round((ms / 1000) * FPS))

// Brand palette, matching the app's dark electric-blue theme.
const INK = '#ddeaf8'
const BRAND = '#5baaff'
const BACKDROP = '#06101e'

// ── Captions ────────────────────────────────────────────────────────────────

// One caption page: a few words at a time, with the spoken word highlighted.
// Short-form captions are read in the periphery, so contrast and weight matter
// far more than typeface personality — hence the heavy stroke.
function CaptionPage({ page, style }) {
  const frame = useCurrentFrame()
  const startMs = (frame / FPS) * 1000

  return (
    <div
      style={{
        position: 'absolute',
        left: 0, right: 0,
        bottom: `${style.bottomPct ?? 22}%`,
        padding: '0 80px',
        textAlign: 'center',
        fontFamily: style.fontFamily ?? 'Inter, Arial, sans-serif',
        fontWeight: 900,
        fontSize: style.fontSize ?? 76,
        lineHeight: 1.15,
        textTransform: style.uppercase ? 'uppercase' : 'none',
        WebkitTextStroke: `${style.strokeWidth ?? 10}px ${style.strokeColor ?? '#000'}`,
        paintOrder: 'stroke fill',
        textShadow: '0 6px 24px rgba(0,0,0,0.65)',
      }}
    >
      {page.words.map((w, i) => {
        const active = startMs >= w.startMs && startMs < w.endMs
        return (
          <span
            key={i}
            style={{
              color: active ? (style.activeColor ?? BRAND) : (style.color ?? '#fff'),
              // A scale bump on the active word is what makes the caption feel
              // locked to the voice rather than merely near it. The margin has
              // to clear the scaled width: a transform does not affect layout,
              // so at 0.16em the grown word visually collided with its
              // neighbour.
              display: 'inline-block',
              transform: active ? 'scale(1.08)' : 'scale(1)',
              transformOrigin: 'center',
              transition: 'none',
              margin: '0 0.26em',
            }}
          >
            {w.text}
          </span>
        )
      })}
    </div>
  )
}

// ── Overlays ────────────────────────────────────────────────────────────────

function Overlay({ overlay, durationInFrames }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 12 })
  const exit = interpolate(
    frame,
    [durationInFrames - 8, durationInFrames],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  )

  const anim = overlay.animation ?? 'pop'
  const y = anim === 'slide' ? interpolate(enter, [0, 1], [60, 0]) : 0
  const scale = anim === 'pop' ? interpolate(enter, [0, 1], [0.8, 1]) : 1

  return (
    <div
      style={{
        position: 'absolute',
        left: 0, right: 0,
        top: `${overlay.topPct ?? 16}%`,
        padding: '0 70px',
        textAlign: 'center',
        opacity: enter * exit,
        transform: `translateY(${y}px) scale(${scale})`,
      }}
    >
      <span
        style={{
          display: 'inline-block',
          padding: '18px 34px',
          borderRadius: 22,
          background: overlay.background ?? 'rgba(6,16,30,0.82)',
          border: `3px solid ${overlay.borderColor ?? BRAND}`,
          color: overlay.color ?? INK,
          fontFamily: overlay.fontFamily ?? 'Inter, Arial, sans-serif',
          fontWeight: 800,
          fontSize: overlay.fontSize ?? 58,
          lineHeight: 1.2,
        }}
      >
        {overlay.text}
      </span>
    </div>
  )
}

// ── Footage ─────────────────────────────────────────────────────────────────

// A slow push-in stops static stock clips reading as a slideshow, and covers
// the common case where a clip is shorter than the line spoken over it.
function Footage({ src, trimInMs, durationInFrames }) {
  const frame = useCurrentFrame()
  const scale = interpolate(frame, [0, durationInFrames], [1.06, 1.14], {
    extrapolateRight: 'clamp',
  })

  if (!src) {
    return <AbsoluteFill style={{ background: `linear-gradient(160deg, ${BACKDROP}, #0c1829)` }} />
  }

  return (
    <AbsoluteFill style={{ overflow: 'hidden', background: BACKDROP }}>
      <OffthreadVideo
        src={src}
        startFrom={msToFrames(trimInMs || 0)}
        muted
        style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${scale})` }}
      />
      {/* Darkened top and bottom so captions and overlays stay legible over
          whatever the clip happens to contain. */}
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(180deg, rgba(6,16,30,0.55) 0%, rgba(6,16,30,0) 28%, rgba(6,16,30,0) 58%, rgba(6,16,30,0.75) 100%)',
        }}
      />
    </AbsoluteFill>
  )
}

// ── End card ────────────────────────────────────────────────────────────────

function EndCard({ text }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 14 })

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(160deg, ${BACKDROP}, #0c1829)`,
        alignItems: 'center', justifyContent: 'center', padding: 90,
        opacity: enter,
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <p style={{
          color: INK, fontFamily: 'Inter, Arial, sans-serif', fontWeight: 900,
          fontSize: 68, lineHeight: 1.25, margin: 0,
          transform: `scale(${interpolate(enter, [0, 1], [0.9, 1])})`,
        }}>
          {text}
        </p>
        <p style={{
          color: BRAND, fontFamily: 'Inter, Arial, sans-serif', fontWeight: 800,
          fontSize: 46, marginTop: 40, letterSpacing: 1,
        }}>
          skywatch.academy
        </p>
      </div>
    </AbsoluteFill>
  )
}

// ── Composition ─────────────────────────────────────────────────────────────

export function ClipperVideo({ timeline }) {
  const beats = timeline?.beats ?? []
  const captionStyle = timeline?.captionStyle ?? {}

  let cursor = 0

  return (
    <AbsoluteFill style={{ background: BACKDROP }}>
      {beats.map((beat) => {
        const durationInFrames = msToFrames(beat.durationMs)
        const from = cursor
        cursor += durationInFrames

        return (
          <Sequence key={beat.id} from={from} durationInFrames={durationInFrames}>
            {beat.isEndCard
              ? <EndCard text={beat.text} />
              : <Footage src={beat.videoUrl} trimInMs={beat.trimInMs} durationInFrames={durationInFrames} />}

            {/* Narration. Each beat carries its own file, so re-recording one
                line does not disturb the timing of any other. */}
            {beat.audioUrl && <Audio src={beat.audioUrl} />}

            {/* Stingers, ducked well under the voice — an SFX that competes
                with the narration costs you the line it was meant to punctuate. */}
            {(beat.sfx ?? []).map((s, i) => (
              <Sequence key={`sfx-${i}`} from={msToOffset(s.atMs)}>
                <Audio src={staticFile(s.src)} volume={s.gain ?? 0.6} />
              </Sequence>
            ))}

            {beat.overlay && (
              <Overlay overlay={beat.overlay} durationInFrames={durationInFrames} />
            )}

            {(beat.captionPages ?? []).map((page, i) => {
              const pageFrom = msToFrames(page.startMs)
              const pageDur = Math.max(1, msToFrames(page.endMs - page.startMs))
              return (
                <Sequence key={i} from={pageFrom} durationInFrames={pageDur}>
                  <CaptionPage page={page} style={captionStyle} />
                </Sequence>
              )
            })}
          </Sequence>
        )
      })}
    </AbsoluteFill>
  )
}

// Total length in frames, so the caller can size the composition without
// duplicating the accumulation logic above.
export function timelineDurationInFrames(timeline) {
  const total = (timeline?.beats ?? []).reduce((n, b) => n + msToFrames(b.durationMs), 0)
  return Math.max(1, total)
}
