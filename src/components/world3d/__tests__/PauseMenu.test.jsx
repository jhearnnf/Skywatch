import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const navigate = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }))

let mockSlim = false
vi.mock('../../../hooks/useSlimMode', () => ({ useSlimMode: () => mockSlim }))

let storedVolume = 100
const setHangarMusicVolume = vi.fn(v => { storedVolume = v })
vi.mock('../../../utils/sound', () => ({
  getHangarMusicVolume: () => storedVolume,
  setHangarMusicVolume: (v) => setHangarMusicVolume(v),
}))

const refreshHangarMusicVolume = vi.fn()
vi.mock('../../../utils/world3d/hangarMusic', () => ({
  refreshHangarMusicVolume: () => refreshHangarMusicVolume(),
}))

import { pause } from '../state/pauseStore'
import PauseMenu from '../ui/PauseMenu'

beforeEach(() => {
  navigate.mockClear()
  setHangarMusicVolume.mockClear()
  refreshHangarMusicVolume.mockClear()
  storedVolume = 100
  mockSlim = false
  pause.set(false)
})
afterEach(() => { cleanup(); pause.set(false) })

describe('<PauseMenu>', () => {
  it('renders nothing until the game is paused', () => {
    const { container } = render(<PauseMenu />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the menu once paused', () => {
    pause.set(true)
    render(<PauseMenu />)
    expect(screen.getByText('Paused')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Quit game' })).toBeInTheDocument()
  })

  it('Resume unpauses', () => {
    pause.set(true)
    render(<PauseMenu />)
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(pause.get()).toBe(false)
  })

  it('Quit game leaves the hangar for the home page', () => {
    pause.set(true)
    render(<PauseMenu />)
    fireEvent.click(screen.getByRole('button', { name: 'Quit game' }))
    expect(navigate).toHaveBeenCalledWith('/home')
    expect(pause.get()).toBe(false)
  })

  it('Quit game goes to /cbat in slim mode, which has no /home', () => {
    mockSlim = true
    pause.set(true)
    render(<PauseMenu />)
    fireEvent.click(screen.getByRole('button', { name: 'Quit game' }))
    expect(navigate).toHaveBeenCalledWith('/cbat')
  })

  it('starts the slider at the stored personal volume', () => {
    storedVolume = 35
    pause.set(true)
    render(<PauseMenu />)
    expect(screen.getByLabelText('Hangar music volume')).toHaveValue('35')
    expect(screen.getByText('35%')).toBeInTheDocument()
  })

  it('persists a volume change and applies it to the playing track at once', () => {
    pause.set(true)
    render(<PauseMenu />)
    fireEvent.change(screen.getByLabelText('Hangar music volume'), { target: { value: '20' } })

    expect(setHangarMusicVolume).toHaveBeenCalledWith(20)
    expect(refreshHangarMusicVolume).toHaveBeenCalled()
    expect(screen.getByText('20%')).toBeInTheDocument()
  })
})
