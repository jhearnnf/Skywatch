import { render, screen } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
import RelationshipLine from '../RelationshipLine'

const FROM = { x: 50,  y: 80  }
const TO   = { x: 300, y: 200 }

describe('RelationshipLine', () => {
  it('renders an SVG element', () => {
    const { container } = render(<RelationshipLine from={FROM} to={TO} />)
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('renders a line element between the two points', () => {
    const { container } = render(<RelationshipLine from={FROM} to={TO} />)
    const line = container.querySelector('line')
    expect(line).not.toBeNull()
    expect(line.getAttribute('x1')).toBe(String(FROM.x))
    expect(line.getAttribute('y1')).toBe(String(FROM.y))
    expect(line.getAttribute('x2')).toBe(String(TO.x))
    expect(line.getAttribute('y2')).toBe(String(TO.y))
  })

  it('renders nothing when from is null', () => {
    const { container } = render(<RelationshipLine from={null} to={TO} />)
    expect(container.querySelector('svg')).toBeNull()
  })

  it('renders nothing when to is null', () => {
    const { container } = render(<RelationshipLine from={FROM} to={null} />)
    expect(container.querySelector('svg')).toBeNull()
  })

  // Labels are deliberately NOT drawn on the line. Actors in a pinboard row
  // share a y coordinate, so their lines are horizontal and every chip landed
  // in the same strip, overlapping each other and the cards underneath. The
  // relationship text lives in the connections strip and the interrogation
  // panel instead.
  it('never draws a label on the line, even if one is passed', () => {
    const { container } = render(<RelationshipLine from={FROM} to={TO} label="ally" />)
    expect(screen.queryByTestId('relationship-line-label')).toBeNull()
    expect(container.querySelector('foreignObject')).toBeNull()
    expect(screen.queryByText('ally')).toBeNull()
  })

  it('brightens and thickens the line when highlighted', () => {
    const { container: plain } = render(<RelationshipLine from={FROM} to={TO} />)
    const { container: lit }   = render(<RelationshipLine from={FROM} to={TO} highlighted />)
    const a = plain.querySelector('line')
    const b = lit.querySelector('line')
    expect(parseFloat(b.getAttribute('stroke-opacity'))).toBeGreaterThan(
      parseFloat(a.getAttribute('stroke-opacity'))
    )
    expect(parseFloat(b.getAttribute('stroke-width'))).toBeGreaterThan(
      parseFloat(a.getAttribute('stroke-width'))
    )
  })

  it('passes width and height to SVG canvas', () => {
    const { container } = render(
      <RelationshipLine from={FROM} to={TO} width={800} height={500} />
    )
    const svg = container.querySelector('svg')
    expect(svg.getAttribute('width')).toBe('800')
    expect(svg.getAttribute('height')).toBe('500')
  })

  it('line has low opacity (visual recede)', () => {
    const { container } = render(<RelationshipLine from={FROM} to={TO} />)
    const line = container.querySelector('line')
    const opacity = parseFloat(line.getAttribute('stroke-opacity'))
    expect(opacity).toBeLessThanOrEqual(0.5)
    expect(opacity).toBeGreaterThan(0)
  })
})
