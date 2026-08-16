import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ActCraftPicker from '../ActCraftPicker'
import { actCraftOptions, ACT_CRAFT_BALL } from '../../../utils/cbat/actCraft'

// The picker preloads the GLB on selection; there is no WebGL in jsdom.
const preload = vi.fn()
vi.mock('@react-three/drei', () => ({ useGLTF: { preload: (...a) => preload(...a) } }))

const roster = [
  { briefId: 'a', title: 'Eurofighter Typhoon FGR4', cutoutUrl: 'https://cdn/typhoon.png' },
  { briefId: 'b', title: 'Hawk T2', cutoutUrl: 'https://cdn/hawk.png' },
]
const options = actCraftOptions(roster)

describe('ActCraftPicker', () => {
  it('shows the ball and every aircraft on offer', () => {
    render(<ActCraftPicker options={options} value={ACT_CRAFT_BALL} onChange={() => {}} />)
    expect(screen.getByText('Ball')).toBeInTheDocument()
    expect(screen.getByText('Eurofighter Typhoon FGR4')).toBeInTheDocument()
    expect(screen.getByText('Hawk T2')).toBeInTheDocument()
  })

  it('marks the selected craft', () => {
    render(<ActCraftPicker options={options} value="hawk t2" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: /Hawk T2/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Ball/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('reports the pick and preloads its model', () => {
    const onChange = vi.fn()
    render(<ActCraftPicker options={options} value={ACT_CRAFT_BALL} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Eurofighter Typhoon FGR4/ }))
    expect(onChange).toHaveBeenCalledWith('eurofighter typhoon fgr4')
    expect(preload).toHaveBeenCalledWith('/models/eurofighter typhoon fgr4.glb')
  })

  it('picking the ball needs no model to preload', () => {
    const onChange = vi.fn()
    preload.mockClear()
    render(<ActCraftPicker options={options} value="hawk t2" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Ball/ }))
    expect(onChange).toHaveBeenCalledWith(ACT_CRAFT_BALL)
    expect(preload).not.toHaveBeenCalled()
  })
})
