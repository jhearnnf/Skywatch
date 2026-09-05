import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import CbatStickLayout from '../CbatStickLayout'

// The joystick panel used to live inside the instructions card. It is tall
// enough — status, wake hint, axis bars, calibrate, raw readout, plus the
// game's own sensitivity slider — that it pushed Start below the fold on a
// 1080p window while the page had several hundred empty pixels either side of
// the card. It now sits in a rail beside the card, where that height is free.

describe('CbatStickLayout', () => {
  it('renders the card and the stick panel', () => {
    render(
      <CbatStickLayout stick={<p>stick panel</p>}>
        <p>instructions card</p>
      </CbatStickLayout>,
    )
    expect(screen.getByText('stick panel')).toBeInTheDocument()
    expect(screen.getByText('instructions card')).toBeInTheDocument()
  })

  // Below lg the rail is not shown at all. A gamepad is a desktop thing, and on
  // a narrow screen the panel would be back to pushing the card around, which
  // is the problem this component exists to solve.
  it('hides the rail below the lg breakpoint', () => {
    const { container } = render(
      <CbatStickLayout stick={<p>stick panel</p>}><p>card</p></CbatStickLayout>,
    )
    const rail = container.querySelector('aside')
    expect(rail.className).toContain('hidden')
    expect(rail.className).toContain('lg:block')
  })

  // Rail first in the DOM, so it lands to the LEFT of the card.
  it('puts the rail before the card, and stacks them until lg', () => {
    const { container } = render(
      <CbatStickLayout stick={<p>stick panel</p>}><p>card</p></CbatStickLayout>,
    )
    const rail = container.querySelector('aside')
    const card = screen.getByText('card')
    expect(rail.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container.firstChild.className).toContain('flex-col')
    expect(container.firstChild.className).toContain('lg:grid')
  })

  // THE POINT OF THE THIRD COLUMN. A two-item row centres the PAIR, which
  // shunts the instructions card off to the right of the page — the card has to
  // stay exactly where it has always been, with the panel hanging off its left
  // and open space on its right. An empty track the same width as the rail is
  // what holds it there.
  it('keeps the card centred with a matching empty column opposite the rail', () => {
    const { container } = render(
      <CbatStickLayout stick={<p>stick panel</p>}><p>card</p></CbatStickLayout>,
    )
    const row = container.firstChild
    expect(row.className).toContain('lg:grid-cols-[19rem_minmax(0,28rem)_19rem]')

    // Three tracks: rail, card, and the spacer that balances the rail.
    expect(row.children).toHaveLength(3)
    const spacer = row.children[2]
    expect(spacer.getAttribute('aria-hidden')).toBe('true')
    expect(spacer.textContent).toBe('')
    // Same reveal breakpoint as the rail, or the card drifts between sizes.
    expect(spacer.className).toContain('lg:block')
    expect(spacer.className).toContain('hidden')
  })

  it('names the rail for anyone navigating by landmark', () => {
    render(<CbatStickLayout stick={<p>stick panel</p>}><p>card</p></CbatStickLayout>)
    expect(screen.getByLabelText('Joystick setup')).toBeInTheDocument()
  })
})
