import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import BotBadge from '../BotBadge'

// The stroke colours ARE the identity here — the mark is the same crosshair for
// every bot, so a shared palette would leave Guide Bot and Medal Bot looking
// like the same account.
const strokes = (container) =>
  [...container.querySelectorAll('[stroke]')].map(el => el.getAttribute('stroke'))

describe('BotBadge', () => {
  it('draws the SkyWatch crosshair at the requested size', () => {
    const { container } = render(<BotBadge botKey="guide" size={30} />)
    const box = container.firstChild
    expect(box.style.width).toBe('30px')
    expect(box.style.height).toBe('30px')
    expect(container.querySelector('svg').getAttribute('viewBox')).toBe('0 0 40 40')
  })

  it('gives each bot its own accent', () => {
    const guide = render(<BotBadge botKey="guide" />).container
    const medal = render(<BotBadge botKey="medal" />).container
    expect(strokes(guide)).not.toEqual(strokes(medal))
  })

  it('still draws a mark for a bot key it has never heard of', () => {
    // A bot added later must not turn up faceless.
    const { container } = render(<BotBadge botKey="weather" />)
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('labels the mark with the bot name for screen readers', () => {
    const { getByRole } = render(<BotBadge botKey="medal" title="Medal Bot" />)
    expect(getByRole('img', { name: 'Medal Bot' })).toBeTruthy()
  })
})
