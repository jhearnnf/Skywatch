import { render, screen, act, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import PushOptInPrompt from '../PushOptInPrompt'

const push = vi.hoisted(() => ({
  pushKind:       vi.fn(),
  deviceStatus:   vi.fn(),
  enableOnDevice: vi.fn(),
}))
const chrome = vi.hoisted(() => ({ immersive: false }))

vi.mock('../../lib/pushNotifications', () => push)
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { _id: 'u1' }, API: '', apiFetch: vi.fn() }),
}))
vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({ settings: { chatEnabled: true } }),
}))
vi.mock('../../context/GameChromeContext', () => ({
  useGameChrome: () => ({ immersive: chrome.immersive }),
}))

const prompt = () => screen.queryByText('Get notified about messages?')

async function renderAt(path) {
  render(<MemoryRouter initialEntries={[path]}><PushOptInPrompt /></MemoryRouter>)
  await act(async () => {})                       // device check
  await act(async () => { vi.advanceTimersByTime(4000) })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  localStorage.clear()
  chrome.immersive = false
  push.pushKind.mockReturnValue('native')
  push.deviceStatus.mockResolvedValue('off')
  push.enableOnDevice.mockResolvedValue('on')
})
afterEach(() => {
  vi.useRealTimers()
  document.body.style.position = ''
})

describe('PushOptInPrompt', () => {
  it('asks once on a menu screen', async () => {
    await renderAt('/cbat')
    expect(prompt()).not.toBeNull()
  })

  it('never asks during a game', async () => {
    await renderAt('/cbat/vigilance')
    expect(prompt()).toBeNull()
  })

  it('never asks while immersive', async () => {
    chrome.immersive = true
    await renderAt('/cbat')
    expect(prompt()).toBeNull()
  })

  it('waits for another open dialog to close', async () => {
    document.body.style.position = 'fixed'          // an Overlay has the page locked
    await renderAt('/cbat')
    expect(prompt()).toBeNull()
    document.body.style.position = ''
    await act(async () => { vi.advanceTimersByTime(2000) })
    expect(prompt()).not.toBeNull()
  })

  it('does not ask a device that is already on, blocked or unable', async () => {
    for (const status of ['on', 'blocked', 'unavailable']) {
      push.deviceStatus.mockResolvedValue(status)
      const { unmount } = render(<MemoryRouter initialEntries={['/cbat']}><PushOptInPrompt /></MemoryRouter>)
      await act(async () => {})
      await act(async () => { vi.advanceTimersByTime(4000) })
      expect(prompt()).toBeNull()
      unmount()
    }
  })

  it('"Not now" is remembered on this device', async () => {
    await renderAt('/cbat')
    fireEvent.click(screen.getByText('Not now'))
    expect(prompt()).toBeNull()
    expect(localStorage.getItem('skywatch:pushPromptSeen')).toBe('1')
  })

  it('does not ask again once answered', async () => {
    localStorage.setItem('skywatch:pushPromptSeen', '1')
    await renderAt('/cbat')
    expect(prompt()).toBeNull()
    expect(push.deviceStatus).not.toHaveBeenCalled()
  })

  it('"Turn on" switches the device on and confirms', async () => {
    await renderAt('/cbat')
    await act(async () => { fireEvent.click(screen.getByText('Turn on')) })
    expect(push.enableOnDevice).toHaveBeenCalled()
    expect(screen.getByText('Notifications are on')).toBeInTheDocument()
    fireEvent.click(screen.getByText('OK'))
    expect(screen.queryByText('Notifications are on')).toBeNull()
    expect(localStorage.getItem('skywatch:pushPromptSeen')).toBe('1')
  })

  it('explains a refused permission', async () => {
    push.enableOnDevice.mockResolvedValue('blocked')
    await renderAt('/cbat')
    await act(async () => { fireEvent.click(screen.getByText('Turn on')) })
    expect(screen.getByText('Notifications are blocked')).toBeInTheDocument()
  })
})
