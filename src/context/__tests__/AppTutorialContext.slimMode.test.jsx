import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const slimRef = vi.hoisted(() => ({ value: false }))
vi.mock('../../hooks/useSlimMode', () => ({
  useSlimMode: () => slimRef.value,
}))

vi.mock('../AuthContext', () => ({
  useAuth: () => ({ user: { _id: 'u1' }, loading: false }),
}))

vi.mock('../AppSettingsContext', () => ({
  useAppSettings: () => ({ settings: {} }),
}))

import { AppTutorialProvider, useAppTutorial } from '../AppTutorialContext'

// Renders the tutorial state and starts `profile` on mount — the tutorial new
// users were seeing in slim mode.
function Probe() {
  const { start, step, visible } = useAppTutorial()
  return (
    <div>
      <button onClick={() => start('profile')}>start</button>
      <div data-testid="visible">{String(visible)}</div>
      <div data-testid="title">{step?.title ?? ''}</div>
    </div>
  )
}

function setup() {
  render(
    <MemoryRouter>
      <AppTutorialProvider><Probe /></AppTutorialProvider>
    </MemoryRouter>
  )
}

describe('AppTutorialContext — slim mode', () => {
  beforeEach(() => {
    slimRef.value = false
    localStorage.clear()
    global.fetch = vi.fn(() => Promise.resolve({ ok: false }))
  })

  it('starts the profile tutorial in normal mode', async () => {
    setup()
    await act(async () => { screen.getByText('start').click() })
    expect(screen.getByTestId('visible').textContent).toBe('true')
    expect(screen.getByTestId('title').textContent).toBe('Your Agent Profile')
  })

  it('suppresses tutorials entirely in slim mode', async () => {
    slimRef.value = true
    setup()
    await act(async () => { screen.getByText('start').click() })
    expect(screen.getByTestId('visible').textContent).toBe('false')
    expect(screen.getByTestId('title').textContent).toBe('')
  })
})
