import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { DptCbatProjection, DptCbatStrip } from '../DptRealCbat'

const ac = (over = {}) => ({
  id: 'CA-A', kind: 'CA-A', position: { x: 600, y: 940 },
  altitudeFt: 4000, headingDeg: 180, targetHeadingDeg: null, targetAltitudeFt: null, ...over,
})

describe('DPT Real CBAT projection line', () => {
  it('keeps its bearing label on the radar when the aircraft is heading at the edge', () => {
    const { container } = render(<svg><DptCbatProjection aircraft={ac()} /></svg>)
    const label = container.querySelector('[data-dpt-cbat-projection="heading"] text')
    expect(label.textContent).toBe('180')
    expect(Number(label.getAttribute('y'))).toBeLessThanOrEqual(1000 - 46)
  })

  it('runs full length with room to spare', () => {
    const { container } = render(<svg><DptCbatProjection aircraft={ac({ position: { x: 500, y: 200 } })} /></svg>)
    const line = container.querySelector('[data-dpt-cbat-projection="heading"] line')
    expect(Number(line.getAttribute('y2'))).toBe(500)
  })
})

describe('DPT Real CBAT strip', () => {
  const strip = (props) => render(
    <DptCbatStrip roundLabel="Round 1 of 4" aircraftList={[ac({ headingDeg: 40 })]} activeId="CA-A"
      onSelectActive={() => {}} onInputMode={() => {}} turnDir="R" onTurnDir={() => {}} {...props} />,
  )
  const boxes = (c) => [...c.querySelectorAll('.dpt-cbat-field')].map(f => [...f.querySelectorAll('b')].map(b => b.textContent).join(''))

  it('shows the current heading until a digit is typed', () => {
    const { container } = strip({ inputMode: 'BRG', bearingInput: '' })
    expect(boxes(container)).toEqual(['040', '040'])
  })

  it('shows the digits once typing starts', () => {
    const { container } = strip({ inputMode: 'BRG', bearingInput: '1' })
    expect(boxes(container)[0]).toBe('1')
  })
})
