import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ReportHeatmap from '../ReportHeatmap'

function emptyGrid() {
  return Array.from({ length: 7 }, () => new Array(24).fill(0))
}

describe('ReportHeatmap', () => {
  it('renders the empty state when there is no activity', () => {
    render(<ReportHeatmap data={{ grid: emptyGrid(), max: 0, total: 0 }} />)
    expect(screen.getByText(/no data in this window/i)).toBeInTheDocument()
  })

  it('renders the empty state when data is missing', () => {
    render(<ReportHeatmap data={undefined} />)
    expect(screen.getByText(/no data in this window/i)).toBeInTheDocument()
  })

  it('renders a 7×24 grid of cells and reveals the exact count on hover', () => {
    const grid = emptyGrid()
    grid[1][14] = 5 // Tuesday 14:00
    render(<ReportHeatmap data={{ grid, max: 5, total: 5, timezone: 'Europe/London' }} />)

    // Placeholder prompt shown until the user hovers a cell.
    expect(screen.getByText(/hover a cell for the exact count/i)).toBeInTheDocument()

    // The busy cell carries an accessible title with day, hour and count.
    const cell = screen.getByTitle('Tuesday 14:00 · 5 starts')
    expect(cell).toBeInTheDocument()

    fireEvent.mouseEnter(cell)
    expect(screen.getByText(/Tuesday 14:00/)).toBeInTheDocument()
    expect(screen.getByText(/5 starts/)).toBeInTheDocument()
  })

  it('singularises a single start', () => {
    const grid = emptyGrid()
    grid[0][9] = 1 // Monday 09:00
    render(<ReportHeatmap data={{ grid, max: 1, total: 1 }} />)
    expect(screen.getByTitle('Monday 09:00 · 1 start')).toBeInTheDocument()
  })
})
