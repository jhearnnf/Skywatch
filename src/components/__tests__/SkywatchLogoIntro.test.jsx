import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import SkywatchLogoIntro, { SKYWATCH_LOGO_INTRO_MS } from '../SkywatchLogoIntro'

// The test id is not decoration. A game mounts its arena *behind* this curtain
// and only attaches its key listener once the phase leaves 'intro', so "the
// arena is on screen" is true for a full 1.8s before the game accepts input.
// The Clipper capture recipes wait for this element to disappear; without it
// they sent keystrokes into a void and the round-skip silently did nothing.
describe('SkywatchLogoIntro', () => {
  it('is findable while it is covering the screen', () => {
    render(<SkywatchLogoIntro onComplete={vi.fn()} />)
    expect(screen.getByTestId('skywatch-logo-intro')).toBeInTheDocument()
  })

  it('reports completion after the documented duration', () => {
    vi.useFakeTimers()
    try {
      const onComplete = vi.fn()
      render(<SkywatchLogoIntro onComplete={onComplete} />)

      vi.advanceTimersByTime(SKYWATCH_LOGO_INTRO_MS - 1)
      expect(onComplete).not.toHaveBeenCalled()

      vi.advanceTimersByTime(1)
      expect(onComplete).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
