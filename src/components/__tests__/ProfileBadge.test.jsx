import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ProfileBadge from '../ProfileBadge'

describe('ProfileBadge', () => {
  it('renders the aircraft cutout when user has a selectedBadge', () => {
    const user = {
      rank: { rankNumber: 5, rankAbbreviation: 'Sgt' },
      selectedBadge: { briefId: 'b1', title: 'Typhoon', cutoutUrl: 'https://cdn/typhoon.png' },
    }
    const { container } = render(<ProfileBadge user={user} size={40} />)
    const img = container.querySelector('img.profile-badge-cutout-img')
    expect(img).not.toBeNull()
    expect(img.getAttribute('src')).toBe('https://cdn/typhoon.png')
  })

  it('renders RankBadge SVG when rank > 1 and no cutout', () => {
    const user = { rank: { rankNumber: 5, rankAbbreviation: 'Sgt' } }
    const { container } = render(<ProfileBadge user={user} size={28} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('falls back to abbreviation text for rank 1 with no cutout', () => {
    const user = { rank: { rankNumber: 1, rankAbbreviation: 'AC' } }
    const { container } = render(<ProfileBadge user={user} size={28} />)
    expect(container.textContent).toBe('AC')
  })

  it('defaults to "AC" when user has no rank at all', () => {
    const { container } = render(<ProfileBadge user={{}} size={28} />)
    expect(container.textContent).toBe('AC')
  })

  it('prefers cutout over rank even if both are present', () => {
    const user = {
      rank: { rankNumber: 10, rankAbbreviation: 'Fg Off' },
      selectedBadge: { briefId: 'b1', title: 'F-35', cutoutUrl: 'https://cdn/f35.png' },
    }
    const { container } = render(<ProfileBadge user={user} size={28} />)
    expect(container.querySelector('img.profile-badge-cutout-img')).not.toBeNull()
    expect(container.querySelector('svg')).toBeNull()
  })
})
