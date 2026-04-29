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

  it('renders no label chip when label is absent', () => {
    render(<RelationshipLine from={FROM} to={TO} />)
    expect(screen.queryByTestId('relationship-line-label')).toBeNull()
  })

  it('renders label chip at midpoint when label is provided', () => {
    render(<RelationshipLine from={FROM} to={TO} label="ally" />)
    expect(screen.getByTestId('relationship-line-label')).toBeDefined()
    expect(screen.getByText('ally')).toBeDefined()
  })

  it('places the label foreignObject near the geometric midpoint', () => {
    const { container } = render(<RelationshipLine from={FROM} to={TO} label="rival" />)
    const fo = container.querySelector('foreignObject')
    expect(fo).not.toBeNull()

    const expectedMx = (FROM.x + TO.x) / 2
    const expectedMy = (FROM.y + TO.y) / 2

    // foreignObject x is centred at midpoint (x = mx - 40)
    expect(Number(fo.getAttribute('x'))).toBeCloseTo(expectedMx - 40, 0)
    expect(Number(fo.getAttribute('y'))).toBeCloseTo(expectedMy - 10, 0)
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
