import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import MuteButton from '../MuteButton'
import { isMusicMuted, setMusicMuted } from '../../../utils/musicMute'

describe('MuteButton', () => {
  beforeEach(() => {
    localStorage.clear()
    setMusicMuted(false)
  })

  it('toggles the music mute', () => {
    render(<MuteButton />)
    const btn = screen.getByTestId('mute-button')
    expect(btn.getAttribute('aria-label')).toBe('Mute music')
    fireEvent.click(btn)
    expect(isMusicMuted()).toBe(true)
    expect(btn.getAttribute('aria-label')).toBe('Turn music on')
  })

  it('lights up on the first visit only, then stops', () => {
    vi.useFakeTimers()
    const { unmount } = render(<MuteButton />)
    const btn = screen.getByTestId('mute-button')
    expect(btn.className).toContain('mute-button-hint')
    act(() => { vi.advanceTimersByTime(5000) })
    expect(btn.className).not.toContain('mute-button-hint')
    unmount()
    vi.useRealTimers()

    render(<MuteButton />)
    expect(screen.getByTestId('mute-button').className).not.toContain('mute-button-hint')
  })
})
