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

  it('calls onChange with "trace2" when Trace 2 is clicked', () => {
    render(<TraceModeSelector value="3d" onChange={onChange} />)
    const trace2Btn = screen.getByText('Trace 2').closest('button')
    expect(trace2Btn.disabled).toBe(false)
    fireEvent.click(trace2Btn)
    expect(onChange).toHaveBeenCalledWith('trace2')
  })

  it('shows a "NEW" badge on the Trace 2 button', () => {
    render(<TraceModeSelector value="3d" onChange={onChange} />)
    expect(screen.getByText('NEW')).toBeInTheDocument()
  })

  it('hides a playable mode when isModeEnabled returns false', () => {
    render(<TraceModeSelector value="trace1" onChange={onChange} isModeEnabled={(m) => m !== '3d'} />)
    expect(screen.queryByText('3D Practise')).not.toBeInTheDocument()
    expect(screen.getByText('2D Practise')).toBeInTheDocument()
    expect(screen.getByText('Trace 1')).toBeInTheDocument()
    expect(screen.getByText('Trace 2')).toBeInTheDocument()
  })

  it('hides Trace 2 when disabled by gating', () => {
    render(<TraceModeSelector value="trace1" onChange={onChange} isModeEnabled={(m) => m !== 'trace2'} />)
    expect(screen.queryByText('Trace 2')).not.toBeInTheDocument()
    expect(screen.getByText('Trace 1')).toBeInTheDocument()
  })

  it('drops the Practise group when both practise modes are disabled', () => {
    render(<TraceModeSelector value="trace1" onChange={onChange} isModeEnabled={(m) => m === 'trace1'} />)
    expect(screen.queryByText('Practise')).not.toBeInTheDocument()
    expect(screen.queryByText('2D Practise')).not.toBeInTheDocument()
    expect(screen.queryByText('3D Practise')).not.toBeInTheDocument()
    expect(screen.getByText('Trace 1')).toBeInTheDocument()
  })

  it('hides Trace 1 when disabled but keeps Trace 2', () => {
    render(<TraceModeSelector value="2d" onChange={onChange} isModeEnabled={(m) => m !== 'trace1'} />)
    expect(screen.queryByText('Trace 1')).not.toBeInTheDocument()
    expect(screen.getByText('Trace 2')).toBeInTheDocument()
  })
})
