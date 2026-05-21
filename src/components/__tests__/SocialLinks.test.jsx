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

  it('renders the live X link with the SkyWatchAcademy href', () => {
    render(<SocialLinks source="landing" />)
    const x = screen.getByLabelText('X')
    expect(x.tagName).toBe('A')
    expect(x.getAttribute('href')).toBe('https://x.com/SkyWatchAcademy')
    expect(x.getAttribute('target')).toBe('_blank')
    expect(x.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('renders the live Discord link with the invite href', () => {
    render(<SocialLinks source="landing" />)
    const discord = screen.getByLabelText('Discord')
    expect(discord.tagName).toBe('A')
    expect(discord.getAttribute('href')).toBe('https://discord.gg/dnZsA3R4qZ')
    expect(discord.getAttribute('target')).toBe('_blank')
    expect(discord.getAttribute('rel')).toBe('noopener noreferrer')
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
})
