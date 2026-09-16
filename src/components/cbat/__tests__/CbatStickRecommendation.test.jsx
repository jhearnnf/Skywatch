import { render, screen, within } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import CbatStickRecommendation from '../CbatStickRecommendation'
import { RECOMMENDED_STICK, RECOMMENDED_PEDALS } from '../../../utils/cbat/recommendedStick'

// Each item is a named row with its own button: a new tab, and the rel
// Amazon's programme and the browser both want (sponsored so crawlers know it
// is paid, noopener so the shop cannot reach back into the game tab).
function expectItem(container, item) {
  const row = container.querySelector(`[data-hardware-item="${item.key}"]`)
  expect(row).toBeInTheDocument()
  expect(within(row).getByText(item.name)).toBeInTheDocument()
  const link = within(row).getByRole('link', { name: /view on amazon/i })
  expect(link).toHaveAttribute('href', item.url)
  expect(link).toHaveAttribute('target', '_blank')
  expect(link.getAttribute('rel').split(' ')).toEqual(expect.arrayContaining(['sponsored', 'noopener']))
}

describe('CbatStickRecommendation', () => {
  it('recommends the stick alone by default, with a disclosed affiliate link', () => {
    const { container } = render(<CbatStickRecommendation />)

    expect(container.querySelector('[data-stick-recommendation]')).toBeInTheDocument()
    expect(screen.getByText(/practise like the real thing/i)).toBeInTheDocument()
    expectItem(container, RECOMMENDED_STICK)
    // ACT and RTT are flown on a stick only; the pedals are SMA's business.
    expect(container.querySelector('[data-hardware-item="pedals"]')).toBeNull()
    expect(screen.queryByText(/pedals/i)).toBeNull()

    // The disclosure is on the same panel as the button, not buried in Terms.
    expect(screen.getByText(/affiliate link/i)).toBeInTheDocument()
  })

  it('adds the pedals when asked, and says where they are set up', () => {
    const { container } = render(<CbatStickRecommendation pedals />)
    expectItem(container, RECOMMENDED_STICK)
    expectItem(container, RECOMMENDED_PEDALS)
    // The stick flies ACT, RTT and SMA; the pedals only SMA, and only after
    // calibration, so the copy points at the panel that does it.
    const copy = screen.getByText(/plug the stick in/i).textContent
    expect(copy).toMatch(/stick in over USB and ACT, RTT and SMA fly on it/i)
    expect(copy).toMatch(/calibrate them in the Pedals panel/i)
  })

  // SMA lists the two independently: whichever is plugged in drops out and
  // the other stays. With both in there is nothing to sell.
  it('lists only the missing item, and nothing once both are plugged in', () => {
    const { container, rerender } = render(<CbatStickRecommendation stick={false} pedals />)
    expect(container.querySelector('[data-hardware-item="stick"]')).toBeNull()
    expectItem(container, RECOMMENDED_PEDALS)
    expect(screen.getByText(/the pedals the official test is flown on/i)).toBeInTheDocument()
    expect(screen.queryByText(/plug the stick in/i)).toBeNull()

    rerender(<CbatStickRecommendation stick pedals={false} />)
    expectItem(container, RECOMMENDED_STICK)
    expect(container.querySelector('[data-hardware-item="pedals"]')).toBeNull()

    rerender(<CbatStickRecommendation stick={false} pedals={false} />)
    expect(container.querySelector('[data-stick-recommendation]')).toBeNull()
  })

  it('borrows the JOYSTICK DETECTED pulse for its headline, not the attract blink', () => {
    render(<CbatStickRecommendation />)
    const headline = screen.getByText(/practise like the real thing/i)
    expect(headline.className).toContain('cbat-stick-recommend')
    expect(headline.className).not.toContain('cbat-stick-attract')
  })
})
