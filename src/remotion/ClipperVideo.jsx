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
// The one warm note, reserved for the spoken word. Over unpredictable footage a
// blue highlight repeatedly disappeared into whatever was behind it.
const ACCENT = '#ffd84d'

// ── Captions ────────────────────────────────────────────────────────────────

// One caption page: a few words at a time, with the spoken word highlighted.
// Short-form captions are read in the periphery, so contrast and weight matter
// far more than typeface personality — hence the heavy stroke.
//
// The defaults below were re-set against a measured render. Captions were 76px
// sitting at 22% from the bottom, which is 4% of the frame height where native
// short-form runs 5-6%, and low enough to land in the block where the platform
// draws its own username, caption and call to action. Neither is visible in the
// Remotion preview, because the preview has no platform furniture in it.
// Roughly how many characters fit on one line at the full caption size. Bigger
// type buys legibility right up until the page wraps, and a three-word caption
// broken over two lines is read as a block of text rather than glanced at.
const CHARS_PER_LINE = 14
// Never shrink past this: below it the size gained by going bigger is given
// straight back, and wrapping would be the better trade.
const MIN_FIT = 0.74

// Scale one page down just enough to keep it on a single line.
//
// A heuristic on character count rather than real text measurement, because the
// composition has to lay out identically in the browser preview and in the
// headless render, and measuring text at layout time is the kind of thing that
// differs between the two. Wrapping is still the fallback if the estimate is
// beaten by an unusually wide page, which fails softer than overflowing.
function fitScale(page) {
  const chars = page.words.reduce((n, w) => n + w.text.length, 0)
    + Math.max(0, page.words.length - 1)
  return Math.max(MIN_FIT, Math.min(1, CHARS_PER_LINE / Math.max(1, chars)))
}

function CaptionPage({ page, style }) {
  const frame = useCurrentFrame()
  const startMs = (frame / FPS) * 1000

  return (
    <div
      style={{
        position: 'absolute',
        left: 0, right: 0,
        bottom: `${style.bottomPct ?? 36}%`,
        padding: '0 48px',
        textAlign: 'center',
        fontFamily: style.fontFamily ?? 'Inter, Arial, sans-serif',
        fontWeight: 900,
        fontSize: (style.fontSize ?? 100) * fitScale(page),
        lineHeight: 1.15,
        textTransform: style.uppercase ? 'uppercase' : 'none',
        // Scaled with the type so the outline holds the same weight it had at
        // 76px rather than thinning out as the text grows.
        WebkitTextStroke: `${style.strokeWidth ?? 13}px ${style.strokeColor ?? '#000'}`,
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
              // Amber rather than brand blue. The blue is right on the site,
              // where it sits on a known dark surface; over arbitrary b-roll it
              // is the one hue that keeps landing on something the same value
              // as itself. Amber holds against sky, tarmac and instrument
              // panels alike, and it is already in the app's palette.
              color: active ? (style.activeColor ?? ACCENT) : (style.color ?? '#fff'),
              // A scale bump on the active word is what makes the caption feel
              // locked to the voice rather than merely near it. The margin has
              // to clear the scaled width: a transform does not affect layout,
              // so at 0.16em the grown word visually collided with its
              // neighbour — and the bump is bigger now than the 1.08 it was
              // measured at, so the clearance grew with it.
              display: 'inline-block',
              transform: active ? 'scale(1.15)' : 'scale(1)',
              transformOrigin: 'center',
              transition: 'none',
              margin: '0 0.22em',
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

// Where a clip actually lives.
//
// Stock and screen recordings arrive as absolute URLs. Clips from the curated
// library arrive as a path relative to public/ — the same form the SFX and
// music use — because they are shipped with the app rather than fetched. Those
// go through staticFile(), which resolves correctly in the browser Player and
// in the headless renderer alike; a bare relative path would resolve against
// whatever route the admin happens to be on.
function resolveSrc(src) {
  if (typeof src !== 'string' || !src) return src
  if (/^[a-z]+:/i.test(src) || src.startsWith('/')) return src
  return staticFile(src)
}

// A slow push-in stops static stock clips reading as a slideshow, and covers
// the common case where a clip is shorter than the line spoken over it.
//
// `move` alternates between consecutive shots of the same beat. Two push-ins
// back to back read as one long move interrupted by a glitch; a push followed
// by a pull gives the cut a direction change to land on.
//
// `focus` crops to the part of the frame worth showing, as fractions of the
// frame. Only screen recordings use it, and only where the rect was measured -
// see backend/constants/clipperCapture.js. Applied as a zoom about the rect's
// centre rather than a CSS crop, so it composes with the Ken Burns move instead
// of fighting it.
function Footage({ src, trimInMs, durationInFrames, move = 'in', focus = null }) {
  const frame = useCurrentFrame()
  // A cropped shot is already framed, and every extra percent of zoom eats into
  // the crop and softens a source that has been upscaled once already. So the
  // move is barely there when a focus rect is doing the work.
  const range = focus
    ? (move === 'out' ? [1.05, 1.0] : [1.0, 1.05])
    : (move === 'out' ? [1.16, 1.06] : [1.06, 1.14])
  const ken = interpolate(frame, [0, durationInFrames], range, {
    extrapolateRight: 'clamp',
  })

  if (!src) {
    return <AbsoluteFill style={{ background: `linear-gradient(160deg, ${BACKDROP}, #0c1829)` }} />
  }

  // Filling the frame with the focus rect is a zoom of 1/its size; putting its
  // centre in the middle of the frame is the offset that zoom leaves behind.
  // The translate is written before the scale so its percentages are of the
  // unscaled element, which is exactly the frame.
  const zoom = focus ? ken / Math.max(focus.width, focus.height) : ken
  const cx = focus ? focus.x + focus.width / 2 : 0.5
  const cy = focus ? focus.y + focus.height / 2 : 0.5
  const transform =
    `translate(${-(cx - 0.5) * zoom * 100}%, ${-(cy - 0.5) * zoom * 100}%) scale(${zoom})`

  return (
    <AbsoluteFill style={{ overflow: 'hidden', background: BACKDROP }}>
      <OffthreadVideo
        src={resolveSrc(src)}
        startFrom={msToFrames(trimInMs || 0)}
        muted
        style={{ width: '100%', height: '100%', objectFit: 'cover', transform }}
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

// ── Title card ──────────────────────────────────────────────────────────────

// The hook, on screen in full from the first frame.
//
// Karaoke captions are right for the body of a video and wrong for its opening
// line: they deliver the promise three words at a time, so the reason to keep
// watching is only complete a second or two in — after the moment it was needed.
// This replaces the first beat's captions rather than sitting on top of them
// (the backend drops those pages), so the words are never on screen twice.
//
// Styled off the caption treatment rather than the overlay one: same stroke,
// same weight, so it reads as the same channel and not as a slide.
function TitleCard({ text, style }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  // Fast — a title that is still arriving has the same problem as a caption
  // that is still being typed out.
  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 8 })

  return (
    <AbsoluteFill
      style={{
        alignItems: 'center', justifyContent: 'center', padding: '0 60px',
        opacity: enter,
        transform: `scale(${interpolate(enter, [0, 1], [0.92, 1])})`,
      }}
    >
      <p
        style={{
          margin: 0,
          textAlign: 'center',
          fontFamily: style.fontFamily ?? 'Inter, Arial, sans-serif',
          fontWeight: 900,
          // Smaller than a caption page, because a title card carries a whole
          // sentence rather than three words and still has to fit on a few lines.
          fontSize: 84,
          lineHeight: 1.12,
          color: style.color ?? '#fff',
          textTransform: style.uppercase ? 'uppercase' : 'none',
          WebkitTextStroke: `${style.strokeWidth ?? 13}px ${style.strokeColor ?? '#000'}`,
          paintOrder: 'stroke fill',
          textShadow: '0 6px 24px rgba(0,0,0,0.65)',
        }}
      >
        {text}
      </p>
    </AbsoluteFill>
  )
}

// ── End card ────────────────────────────────────────────────────────────────

// The closing call to action.
//
// It runs over the previous beat's footage rather than cutting to a flat panel.
// A measured render spent its last 4.2 seconds — 12% of the runtime — on a
// static gradient, which is both the least watchable frame in the video and a
// full stop at exactly the moment short-form rewards a rewatch. Keeping the
// picture alive under the text costs nothing: the clip is already downloaded.
//
// The backdrop is still there for a video whose last beat had no footage.
function EndCard({ text, videoUrl, trimInMs, durationInFrames }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 14 })

  // The scripted outro almost always names the site out loud, and the lockup
  // used to print it again underneath — the domain twice on one card, once
  // mid-sentence and once on its own. Show the lockup only when the line has
  // not already said it.
  const namesDomain = /skywatch\.academy/i.test(String(text ?? ''))

  return (
    <AbsoluteFill style={{ background: BACKDROP }}>
      {videoUrl
        ? <Footage src={videoUrl} trimInMs={trimInMs} durationInFrames={durationInFrames} />
        : <AbsoluteFill style={{ background: `linear-gradient(160deg, ${BACKDROP}, #0c1829)` }} />}

      {/* Heavy enough that the copy is never fighting the footage, light
          enough that the footage is still visibly moving behind it. */}
      <AbsoluteFill style={{ background: 'rgba(6,16,30,0.78)' }} />

      <AbsoluteFill
        style={{
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
          {!namesDomain && (
            <p style={{
              color: BRAND, fontFamily: 'Inter, Arial, sans-serif', fontWeight: 800,
              fontSize: 46, marginTop: 40, letterSpacing: 1,
            }}>
              skywatch.academy
            </p>
          )}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

// ── Background music ────────────────────────────────────────────────────────

// How long the level takes to move in or out of a duck. Long enough not to
// click, short enough that the first word is not spoken over full-level music.
const RAMP_MS = 250

// One track under the whole video, ducked while anyone is speaking.
//
// The duck windows come from the timeline rather than being worked out here,
// because the backend is the only place that knows when narration actually
// plays — the same reason beat timing lives there. What this owns is the
// shape of the level change: a short ramp rather than a step, because an
// instant drop is audible as a click and reads as a mistake.
//
// `loop` covers a track shorter than the video. A longer one is simply cut off
// by the composition's length, which is why the fade is anchored to the end of
// the video and not to the end of the track.
function BackgroundMusic({ music, durationInFrames }) {
  const { fps } = useVideoConfig()

  const toFrames = (ms) => (ms / 1000) * fps
  const rampFrames = Math.max(1, toFrames(RAMP_MS))

  const windows = (music.duckWindows ?? []).map(w => ({
    from: toFrames(w.startMs),
    to:   toFrames(w.endMs),
  }))

  const fadeFrames = Math.max(0, toFrames(music.fadeOutMs ?? 0))
  const full = music.volume ?? 0.18
  const ducked = music.duckVolume ?? 0.06

  const volumeAt = (frame) => {
    // Ramp in and out of each duck rather than stepping. interpolate clamps, so
    // a frame outside every window keeps the full level.
    let level = full
    for (const w of windows) {
      if (frame < w.from - rampFrames || frame > w.to + rampFrames) continue
      level = Math.min(level, interpolate(
        frame,
        [w.from - rampFrames, w.from, w.to, w.to + rampFrames],
        [full, ducked, ducked, full],
        { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
      ))
    }

    if (fadeFrames > 0 && frame > durationInFrames - fadeFrames) {
      const out = interpolate(
        frame,
        [durationInFrames - fadeFrames, durationInFrames],
        [1, 0],
        { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
      )
      level *= out
    }

    return Math.max(0, level)
  }

  return <Audio src={staticFile(music.src)} loop volume={volumeAt} />
}

// ── Composition ─────────────────────────────────────────────────────────────

// The pictures that cover one beat.
//
// The backend decides where the cuts fall (utils/clipperTimeline.js) — it is
// the only place that knows how long the narration ran and how much clip is
// left, and preview and render must not disagree about it. A timeline saved
// before shots existed has no `shots` array, so one shot is synthesised from
// the beat's own clip and it renders exactly as it used to.
//
// The last shot is stretched to the beat's own frame count rather than its own:
// rounding each shot independently can leave the beat a frame short, and that
// frame is a flash of the backdrop.
function renderShots(beat, beatFrames) {
  const shots = beat.shots?.length
    ? beat.shots
    : [{ videoUrl: beat.videoUrl, trimInMs: beat.trimInMs, durationMs: beat.durationMs }]

  let at = 0
  return shots.map((shot, i) => {
    const from = at
    const last = i === shots.length - 1
    const dur = last ? Math.max(1, beatFrames - from) : msToFrames(shot.durationMs)
    at += dur

    return (
      <Sequence key={`shot-${i}`} from={from} durationInFrames={dur}>
        <Footage
          src={shot.videoUrl}
          trimInMs={shot.trimInMs}
          durationInFrames={dur}
          move={shot.move}
          focus={shot.focus}
        />
      </Sequence>
    )
  })
}

export function ClipperVideo({ timeline }) {
  const beats = timeline?.beats ?? []
  const captionStyle = timeline?.captionStyle ?? {}
  const music = timeline?.music ?? null

  let cursor = 0

  return (
    <AbsoluteFill style={{ background: BACKDROP }}>
      {/* Outside the beat Sequences, because it runs the length of the video
          rather than belonging to any one beat. */}
      {music?.src && (
        <BackgroundMusic music={music} durationInFrames={timelineDurationInFrames(timeline)} />
      )}

      {beats.map((beat) => {
        const durationInFrames = msToFrames(beat.durationMs)
        const from = cursor
        cursor += durationInFrames

        return (
          <Sequence key={beat.id} from={from} durationInFrames={durationInFrames}>
            {beat.isEndCard
              ? <EndCard
                  text={beat.text}
                  videoUrl={beat.videoUrl}
                  trimInMs={beat.trimInMs}
                  durationInFrames={durationInFrames}
                />
              : renderShots(beat, durationInFrames)}

            {/* Only ever on the first beat, and only when the line is short
                enough to be taken in at a glance. */}
            {beat.isTitleCard && <TitleCard text={beat.text} style={captionStyle} />}

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
