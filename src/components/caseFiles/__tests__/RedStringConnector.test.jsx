import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
import RedStringConnector from '../RedStringConnector.jsx'

describe('RedStringConnector', () => {
  const from = { x: 10, y: 20 }
  const to   = { x: 200, y: 150 }

  it('renders an SVG element', () => {
    const { container } = render(<RedStringConnector from={from} to={to} />)
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('renders a path element between the two points', () => {
    const { container } = render(<RedStringConnector from={from} to={to} />)
    const paths = container.querySelectorAll('path')
    expect(paths.length).toBeGreaterThan(0)
  })

  it('renders nothing when from is missing', () => {
    const { container } = render(<RedStringConnector from={null} to={to} />)
    expect(container.querySelector('svg')).toBeNull()
  })

  it('renders nothing when to is missing', () => {
    const { container } = render(<RedStringConnector from={from} to={null} />)
    expect(container.querySelector('svg')).toBeNull()
  })

  it('calls onClick when a committed string path is clicked', () => {
    const handler = vi.fn()
    const { container } = render(
      <RedStringConnector from={from} to={to} committed onClick={handler} />
    )
    // The transparent hit-area path fires onClick
    const hitPaths = container.querySelectorAll('path[stroke="transparent"]')
    expect(hitPaths.length).toBeGreaterThan(0)
    fireEvent.click(hitPaths[0])
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('does not attach onClick to uncommitted strings', () => {
    const handler = vi.fn()
    const { container } = render(
      <RedStringConnector from={from} to={to} committed={false} onClick={handler} />
    )
    // No transparent hit-area path should exist for uncommitted strings
    const hitPaths = container.querySelectorAll('path[stroke="transparent"]')
    expect(hitPaths.length).toBe(0)
  })

  it('uncommitted string uses dasharray', () => {
    const { container } = render(
      <RedStringConnector from={from} to={to} committed={false} />
    )
    const paths = container.querySelectorAll('path')
    const dashed = Array.from(paths).some(p => p.getAttribute('stroke-dasharray'))
    expect(dashed).toBe(true)
  })

  it('committed string with onClick renders 3 paths (glow + main + hit)', () => {
    const handler = vi.fn()
    const { container } = render(
      <RedStringConnector from={from} to={to} committed onClick={handler} />
    )
    // committed + onClick = glow path + main path + hit path = 3 paths
    const paths = container.querySelectorAll('path')
    expect(paths.length).toBe(3)
  })

  it('committed string without onClick renders 2 paths (glow + main, no hit area)', () => {
    const { container } = render(
      <RedStringConnector from={from} to={to} committed />
    )
    // committed, no onClick = glow path + main path = 2 paths
    const paths = container.querySelectorAll('path')
    expect(paths.length).toBe(2)
  })
})
