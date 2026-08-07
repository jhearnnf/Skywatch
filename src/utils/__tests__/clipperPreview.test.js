import { describe, it, expect } from 'vitest'
import {
  fileUrlToPath, toPreviewUrl, previewTimeline, unplayableCaptureCount,
} from '../clipperPreview'

const MEDIA = 'http://127.0.0.1:52341'
const CAPTURE = 'file:///C:/Users/James/AppData/Local/Temp/skywatch-clipper/capture/abc123.mp4'

describe('fileUrlToPath', () => {
  it('strips the slash before a Windows drive letter', () => {
    expect(fileUrlToPath(CAPTURE))
      .toBe('C:/Users/James/AppData/Local/Temp/skywatch-clipper/capture/abc123.mp4')
  })

  it('keeps a POSIX path absolute', () => {
    expect(fileUrlToPath('file:///tmp/skywatch-clipper/capture/abc.mp4'))
      .toBe('/tmp/skywatch-clipper/capture/abc.mp4')
  })

  it('decodes escaped characters', () => {
    expect(fileUrlToPath('file:///C:/My%20Temp/clip%231.mp4')).toBe('C:/My Temp/clip#1.mp4')
  })

  it('returns null for anything that is not a file URL', () => {
    expect(fileUrlToPath('https://videos.pexels.com/a.mp4')).toBeNull()
    expect(fileUrlToPath(null)).toBeNull()
  })
})

describe('toPreviewUrl', () => {
  it('routes a local recording through the media server', () => {
    expect(toPreviewUrl(CAPTURE, MEDIA)).toBe(
      `${MEDIA}/file?path=${encodeURIComponent('C:/Users/James/AppData/Local/Temp/skywatch-clipper/capture/abc123.mp4')}`,
    )
  })

  it('tolerates a trailing slash on the base URL', () => {
    expect(toPreviewUrl(CAPTURE, `${MEDIA}/`)).toBe(toPreviewUrl(CAPTURE, MEDIA))
  })

  it('leaves remote stock footage alone', () => {
    const url = 'https://videos.pexels.com/video-files/7092133/x.mp4'
    expect(toPreviewUrl(url, MEDIA)).toBe(url)
    // Stock clips must still play when the agent is down — they never needed it.
    expect(toPreviewUrl(url, null)).toBe(url)
  })

  it('drops the URL when there is no media server to serve it', () => {
    expect(toPreviewUrl(CAPTURE, null)).toBeNull()
  })
})

describe('previewTimeline', () => {
  const timeline = {
    totalDurationMs: 4000,
    beats: [
      { id: 'b1', videoUrl: 'https://videos.pexels.com/a.mp4' },
      { id: 'b2', videoUrl: CAPTURE },
      { id: 'b3', videoUrl: null },
    ],
  }

  it('rewrites only the capture beats', () => {
    const out = previewTimeline(timeline, MEDIA)
    expect(out.beats[0].videoUrl).toBe('https://videos.pexels.com/a.mp4')
    expect(out.beats[1].videoUrl).toBe(toPreviewUrl(CAPTURE, MEDIA))
    expect(out.beats[2].videoUrl).toBeNull()
  })

  it('leaves the rest of the timeline intact', () => {
    const out = previewTimeline(timeline, MEDIA)
    expect(out.totalDurationMs).toBe(4000)
    expect(out.beats).toHaveLength(3)
    expect(out.beats[1].id).toBe('b2')
  })

  it('does not mutate the timeline it was given', () => {
    previewTimeline(timeline, MEDIA)
    expect(timeline.beats[1].videoUrl).toBe(CAPTURE)
  })

  // The Player remounts when inputProps change identity, which restarts
  // playback — so a timeline with nothing to rewrite must come back as-is.
  it('returns the same object when no beat is local', () => {
    const stockOnly = { beats: [{ id: 'b1', videoUrl: 'https://videos.pexels.com/a.mp4' }] }
    expect(previewTimeline(stockOnly, MEDIA)).toBe(stockOnly)
    expect(previewTimeline(null, MEDIA)).toBeNull()
  })

  it('blanks captures rather than leaving a URL the browser cannot load', () => {
    const out = previewTimeline(timeline, null)
    expect(out.beats[1].videoUrl).toBeNull()
  })
})

describe('unplayableCaptureCount', () => {
  const timeline = { beats: [{ videoUrl: CAPTURE }, { videoUrl: 'https://x/a.mp4' }, { videoUrl: CAPTURE }] }

  it('counts local beats when there is no media server', () => {
    expect(unplayableCaptureCount(timeline, null)).toBe(2)
  })

  it('counts none once the media server is up', () => {
    expect(unplayableCaptureCount(timeline, MEDIA)).toBe(0)
  })

  it('handles an empty timeline', () => {
    expect(unplayableCaptureCount(null, null)).toBe(0)
  })
})
