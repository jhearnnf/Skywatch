import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import TraceModeSelector from '../TraceModeSelector'

describe('TraceModeSelector', () => {
  let onChange
  beforeEach(() => { onChange = vi.fn() })

  it('renders all four options under two headings', () => {
    render(<TraceModeSelector value="3d" onChange={onChange} />)
    expect(screen.getByText('Practise')).toBeInTheDocument()
    expect(screen.getByText('Trace')).toBeInTheDocument()
    expect(screen.getByText('2D Practise')).toBeInTheDocument()
    expect(screen.getByText('3D Practise')).toBeInTheDocument()
    expect(screen.getByText('Trace 1')).toBeInTheDocument()
    expect(screen.getByText('Trace 2')).toBeInTheDocument()
  })

  it('marks the active option via aria-selected', () => {
    render(<TraceModeSelector value="trace1" onChange={onChange} />)
    const trace1Btn = screen.getByText('Trace 1').closest('button')
    expect(trace1Btn.getAttribute('aria-selected')).toBe('true')
    const twoDBtn = screen.getByText('2D Practise').closest('button')
    expect(twoDBtn.getAttribute('aria-selected')).toBe('false')
  })

  it('calls onChange with the chosen value when a Practise option is clicked', () => {
    render(<TraceModeSelector value="3d" onChange={onChange} />)
    fireEvent.click(screen.getByText('2D Practise').closest('button'))
    expect(onChange).toHaveBeenCalledWith('2d')
  })

  it('calls onChange with "trace1" when Trace 1 is clicked', () => {
    render(<TraceModeSelector value="3d" onChange={onChange} />)
    fireEvent.click(screen.getByText('Trace 1').closest('button'))
    expect(onChange).toHaveBeenCalledWith('trace1')
  })

  it('does not call onChange when Trace 2 is clicked (disabled)', () => {
    render(<TraceModeSelector value="3d" onChange={onChange} />)
    const trace2Btn = screen.getByText('Trace 2').closest('button')
    expect(trace2Btn.disabled).toBe(true)
    expect(trace2Btn.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(trace2Btn)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('shows a "SOON" badge on the Trace 2 button', () => {
    render(<TraceModeSelector value="3d" onChange={onChange} />)
    expect(screen.getByText('SOON')).toBeInTheDocument()
  })
})
