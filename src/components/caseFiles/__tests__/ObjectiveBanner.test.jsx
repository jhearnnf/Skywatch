import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ObjectiveBanner from '../ObjectiveBanner'

describe('ObjectiveBanner', () => {
  it('renders a plain-English task line for evidence_wall', () => {
    render(<ObjectiveBanner stageType="evidence_wall" />)
    expect(screen.getByTestId('objective-banner')).toBeDefined()
    expect(screen.getByText(/link cards that share a theme/i)).toBeDefined()
  })

  it('renders a task line for each known stage type', () => {
    const types = [
      'cold_open',
      'evidence_wall',
      'map_predictive',
      'actor_interrogations',
      'decision_point',
      'phase_reveal',
      'map_live',
      'debrief',
    ]
    types.forEach((t) => {
      const { unmount } = render(<ObjectiveBanner stageType={t} />)
      expect(screen.getByTestId('objective-banner')).toBeDefined()
      unmount()
    })
  })

  it('renders nothing for an unknown stage type', () => {
    const { container } = render(<ObjectiveBanner stageType="totally_unknown" />)
    expect(container.firstChild).toBeNull()
  })
})
