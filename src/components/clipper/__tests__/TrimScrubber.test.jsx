import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import TrimScrubber from '../TrimScrubber'

// jsdom's HTMLMediaElement has no duration and no layout, so both are stubbed:
// duration by firing loadedmetadata with a known value, geometry by fixing the
// track's bounding box. Everything the control decides is arithmetic on those
// two, which is exactly the part worth testing.
const CLIP_MS = 10000
const WINDOW_MS = 2000
const TRACK = { left: 0, width: 500 }

function setup(props = {}) {
  const onChange = vi.fn()
  const utils = render(
    <TrimScrubber
      src="http://127.0.0.1:1/file?path=x.mp4"
      clipDurationMs={CLIP_MS}
      windowMs={WINDOW_MS}
      inMs={0}
      onChange={onChange}
      {...props}
    />,
  )

  const track = document.querySelector('.cursor-pointer')
  track.getBoundingClientRect = () => ({ ...TRACK, right: TRACK.width, top: 0, bottom: 40, height: 40 })

  return { onChange, track, ...utils }
}

beforeEach(() => {
  // Not implemented in jsdom; the component calls it to preview the window.
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue()
  window.HTMLMediaElement.prototype.pause = vi.fn()
})

describe('TrimScrubber', () => {
  it('shows the window it will take and the clip it takes it from', () => {
    setup()
    expect(screen.getByText('0.0s → 2.0s of 10.0s')).toBeInTheDocument()
  })

  it('reports the in-point where the track is clicked', () => {
    const { onChange, track } = setup()
    // Half way along a 10s clip.
    fireEvent.pointerDown(track, { clientX: 250 })
    expect(onChange).toHaveBeenCalledWith(5000)
  })

  // The window has to stay inside the clip: a 2s window cannot start at 9s of
  // a 10s clip without running off the end.
  it('will not place the window past the end of the clip', () => {
    const { onChange, track } = setup()
    fireEvent.pointerDown(track, { clientX: 500 })
    expect(onChange).toHaveBeenCalledWith(8000)
  })

  it('nudges by a fixed step', () => {
    const { onChange } = setup({ inMs: 3000 })
    fireEvent.click(screen.getByText('+500'))
    expect(onChange).toHaveBeenCalledWith(3500)
  })

  it('does not nudge below zero', () => {
    const { onChange } = setup({ inMs: 100 })
    fireEvent.click(screen.getByText('-500'))
    expect(onChange).toHaveBeenCalledWith(0)
  })

  it('resets to the start of the clip', () => {
    const { onChange } = setup({ inMs: 4000 })
    fireEvent.click(screen.getByText('Reset'))
    expect(onChange).toHaveBeenCalledWith(0)
  })

  it('disables reset when already at the start', () => {
    setup({ inMs: 0 })
    expect(screen.getByText('Reset')).toBeDisabled()
  })

  // Before the voice stage the window length is a guess, and saying so is the
  // difference between a useful control and a misleading one.
  it('says when the window length is only an estimate', () => {
    setup({ estimated: true })
    expect(screen.getByText(/becomes exact once the narration is recorded/)).toBeInTheDocument()
  })

  it('warns when the clip is shorter than the beat', () => {
    setup({ clipDurationMs: 1200, windowMs: 3000 })
    expect(screen.getByText(/shorter than the beat/)).toBeInTheDocument()
  })

  // The fix differs by provider — start the agent, versus this provider has no
  // file — so the caller supplies the sentence.
  it('shows the caller\'s explanation when there is nothing to scrub', () => {
    render(
      <TrimScrubber src={null} clipDurationMs={CLIP_MS} windowMs={WINDOW_MS} inMs={0}
        onChange={vi.fn()} emptyMessage="Start the agent to preview this recording." />,
    )
    expect(screen.getByText('Start the agent to preview this recording.')).toBeInTheDocument()
  })

  it('falls back to a generic line when the caller gives none', () => {
    render(<TrimScrubber src={null} clipDurationMs={CLIP_MS} windowMs={WINDOW_MS} inMs={0} onChange={vi.fn()} />)
    expect(screen.getByText(/cannot be previewed here/)).toBeInTheDocument()
  })

  it('prefers the real duration from metadata over the reported one', () => {
    setup({ clipDurationMs: 30000 })
    const video = document.querySelector('video')
    Object.defineProperty(video, 'duration', { value: 6, configurable: true })
    fireEvent.loadedMetadata(video)
    expect(screen.getByText('0.0s → 2.0s of 6.0s')).toBeInTheDocument()
  })
})
