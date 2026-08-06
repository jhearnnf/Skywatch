import { Composition } from 'remotion'
import { ClipperVideo, timelineDurationInFrames, FPS, WIDTH, HEIGHT } from './ClipperVideo.jsx'

// Remotion entry point, bundled by the agent at render time.
//
// The duration is calculated from the timeline rather than fixed, because a
// video's length is whatever the narration turned out to be — Voicebox reports
// the real duration of each line and the composition simply follows it.

const EMPTY = { beats: [], captionStyle: {} }

export function RemotionRoot() {
  return (
    <Composition
      id="ClipperVideo"
      component={ClipperVideo}
      durationInFrames={FPS * 10}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={{ timeline: EMPTY }}
      calculateMetadata={({ props }) => ({
        durationInFrames: timelineDurationInFrames(props.timeline),
      })}
    />
  )
}
