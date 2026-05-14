import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
import InstrumentPanel from '../InstrumentPanel'

describe('InstrumentPanel — each dial fires onToggleHighlight with its own key', () => {
  it('Altimeter click fires "altitude" toggle and shows active styling', () => {
    const onToggle = vi.fn()
    const { rerender } = render(
      <InstrumentPanel
        altitude={5000} airspeed={200} heading="N" vs="Level" turn="None"
        durationMs={100}
        highlightedKey={null}
        onToggleHighlight={onToggle}
      />,
    )

    // Find the Altimeter button via its label
    const altimeterLabel = screen.getByText('Altimeter')
    const altimeterBtn = altimeterLabel.closest('button')
    expect(altimeterBtn).not.toBeNull()

    fireEvent.click(altimeterBtn)
    expect(onToggle).toHaveBeenCalledWith('altitude')

    rerender(
      <InstrumentPanel
        altitude={5000} airspeed={200} heading="N" vs="Level" turn="None"
        durationMs={100}
        highlightedKey="altitude"
        onToggleHighlight={onToggle}
      />,
    )
    const activeBtn = screen.getByText('Altimeter').closest('button')
    expect(activeBtn.getAttribute('aria-pressed')).toBe('true')
    expect(activeBtn.className).toMatch(/border-amber-700/)
  })

  it.each([
    ['Attitude',      'attitude'],
    ['Airspeed (kt)', 'airspeed'],
    ['V. Speed',      'vs'],
    ['Heading',       'heading'],
    ['Turn',          'turn'],
  ])('%s click fires "%s" toggle', (label, key) => {
    const onToggle = vi.fn()
    render(
      <InstrumentPanel
        altitude={5000} airspeed={200} heading="N" vs="Level" turn="None"
        durationMs={100}
        highlightedKey={null}
        onToggleHighlight={onToggle}
      />,
    )
    const btn = screen.getByText(label).closest('button')
    expect(btn).not.toBeNull()
    fireEvent.click(btn)
    expect(onToggle).toHaveBeenCalledWith(key)
  })

  it('Attitude active state applies amber border', () => {
    render(
      <InstrumentPanel
        altitude={5000} airspeed={200} heading="N" vs="Ascend" turn="Standard"
        durationMs={100}
        highlightedKey="attitude"
        onToggleHighlight={vi.fn()}
      />,
    )
    const btn = screen.getByText('Attitude').closest('button')
    expect(btn).not.toBeNull()
    expect(btn.getAttribute('aria-pressed')).toBe('true')
    expect(btn.className).toMatch(/border-amber-700/)
  })
})
