import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import VisualisationModeSelector from '../VisualisationModeSelector'

describe('VisualisationModeSelector', () => {
  let onChange
  beforeEach(() => { onChange = vi.fn() })

  it('renders both 2D and 3D options by default', () => {
    render(<VisualisationModeSelector value="2d" onChange={onChange} />)
    expect(screen.getByText('2D')).toBeInTheDocument()
    expect(screen.getByText('3D')).toBeInTheDocument()
  })

  it('marks the active option via aria-selected', () => {
    render(<VisualisationModeSelector value="3d" onChange={onChange} />)
    expect(screen.getByText('3D').closest('button').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('2D').closest('button').getAttribute('aria-selected')).toBe('false')
  })

  it('calls onChange with the chosen value', () => {
    render(<VisualisationModeSelector value="2d" onChange={onChange} />)
    fireEvent.click(screen.getByText('3D').closest('button'))
    expect(onChange).toHaveBeenCalledWith('3d')
  })

  it('renders nothing when only one mode is enabled (no choice to make)', () => {
    const { container } = render(
      <VisualisationModeSelector value="2d" onChange={onChange} isModeEnabled={(m) => m === '2d'} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('keeps both options when isModeEnabled allows both', () => {
    render(<VisualisationModeSelector value="2d" onChange={onChange} isModeEnabled={() => true} />)
    expect(screen.getByText('2D')).toBeInTheDocument()
    expect(screen.getByText('3D')).toBeInTheDocument()
  })
})
