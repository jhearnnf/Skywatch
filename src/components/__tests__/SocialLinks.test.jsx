import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SocialLinks from '../SocialLinks'

const captureMock = vi.fn()
vi.mock('../../lib/posthog', () => ({
  captureEvent: (...args) => captureMock(...args),
}))

describe('SocialLinks', () => {
  beforeEach(() => {
    captureMock.mockClear()
  })

  it('renders the live TikTok link with the @skywatch.academy href', () => {
    render(<SocialLinks source="landing" />)
    const tiktok = screen.getByLabelText('TikTok')
    expect(tiktok.tagName).toBe('A')
    expect(tiktok.getAttribute('href')).toBe('https://www.tiktok.com/@skywatch.academy')
    expect(tiktok.getAttribute('target')).toBe('_blank')
    expect(tiktok.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('renders Discord and X as disabled buttons (no anchor)', () => {
    render(<SocialLinks source="landing" />)
    const discord = screen.getByLabelText(/Discord — launching soon/i)
    const x = screen.getByLabelText(/X — launching soon/i)
    expect(discord.tagName).toBe('BUTTON')
    expect(x.tagName).toBe('BUTTON')
  })

  it('shows a "Launching soon" tooltip on hover and hides it on mouse leave', () => {
    render(<SocialLinks source="landing" />)
    const discord = screen.getByLabelText(/Discord — launching soon/i)
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.mouseEnter(discord)
    expect(screen.getByRole('tooltip')).toHaveTextContent(/launching soon/i)
    fireEvent.mouseLeave(discord)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('toggles the popover on tap (mobile click) and tracks the event', () => {
    render(<SocialLinks source="profile" />)
    const discord = screen.getByLabelText(/Discord — launching soon/i)
    fireEvent.click(discord)
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    expect(captureMock).toHaveBeenCalledWith('social_click', {
      platform: 'discord',
      source: 'profile',
      coming_soon: true,
    })
    fireEvent.click(discord)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('captures social_click for live links with coming_soon=false and the source prop', () => {
    render(<SocialLinks source="landing" />)
    fireEvent.click(screen.getByLabelText('TikTok'))
    expect(captureMock).toHaveBeenCalledWith('social_click', {
      platform: 'tiktok',
      source: 'landing',
      coming_soon: false,
    })
  })

  it('closes an open popover when the user clicks outside', () => {
    render(
      <div>
        <SocialLinks source="landing" />
        <button data-testid="outside">outside</button>
      </div>
    )
    fireEvent.click(screen.getByLabelText(/Discord — launching soon/i))
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('outside'))
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
