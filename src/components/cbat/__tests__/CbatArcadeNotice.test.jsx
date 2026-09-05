import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import CbatArcadeNotice from '../CbatArcadeNotice'

// The cabinet treatment for something a player really ought to do before they
// press Start. ACT's headphones warning used to be a quiet amber note between
// two other boxes, which is a good way to have it skipped straight past on the
// one CBAT game that is unplayable without audio.

describe('CbatArcadeNotice', () => {
  it('renders the marquee, the headline and the explanation', () => {
    render(
      <CbatArcadeNotice title="Audio" headline="Headphones" icon="🎧">
        Audio cues carry the whole test.
      </CbatArcadeNotice>,
    )
    expect(screen.getByText('Audio')).toBeInTheDocument()
    expect(screen.getByText(/headphones/i)).toBeInTheDocument()
    expect(screen.getByText(/audio cues carry the whole test/i)).toBeInTheDocument()
  })

  it('is a cabinet, and it is attracting attention', () => {
    const { container } = render(
      <CbatArcadeNotice title="Audio" headline="Headphones">why</CbatArcadeNotice>,
    )
    expect(container.firstChild.className).toContain('cbat-arcade-panel')
    expect(container.firstChild.className).toContain('cbat-notice-idle')
  })

  // Same rule as the joystick panel's attract mode: the headline may blink, the
  // sentence a player has to READ may not.
  it('blinks the headline and leaves the explanation still', () => {
    const { container } = render(
      <CbatArcadeNotice title="Audio" headline="Headphones">
        Audio cues carry the whole test.
      </CbatArcadeNotice>,
    )
    const headline = screen.getByText(/headphones/i)
    expect(headline.className).toContain('cbat-notice-attract')

    const body = screen.getByText(/audio cues carry the whole test/i)
    expect(body.className).not.toContain('cbat-notice-attract')
    expect(container.querySelectorAll('.cbat-notice-attract')).toHaveLength(1)
  })

  // ACT shows this cabinet and the joystick one at the same time. They must not
  // be the same colour, or at a glance you cannot tell which is talking to you —
  // so this one keeps its own classes and never borrows the stick panel's amber.
  it('uses its own palette, not the joystick cabinet one', () => {
    const { container } = render(
      <CbatArcadeNotice title="Audio" headline="Headphones">why</CbatArcadeNotice>,
    )
    expect(container.firstChild.className).toContain('cbat-notice-idle')
    expect(container.firstChild.className).not.toContain('cbat-arcade-idle')
    expect(screen.getByText(/headphones/i).className).toContain('cbat-notice-attract')
    expect(screen.getByText(/headphones/i).className).not.toContain('cbat-stick-attract')
  })

  it('leaves the icon out of the accessibility tree', () => {
    const { container } = render(
      <CbatArcadeNotice title="Audio" headline="Headphones" icon="🎧">why</CbatArcadeNotice>,
    )
    const icon = [...container.querySelectorAll('span')].find(el => el.textContent === '🎧')
    expect(icon.getAttribute('aria-hidden')).toBe('true')
  })
})
