import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import PushNotificationSettings from '../PushNotificationSettings'

const mockUseAuth = vi.hoisted(() => vi.fn())
const mockPush = vi.hoisted(() => ({
  pushKind:        vi.fn(),
  deviceStatus:    vi.fn(),
  enableOnDevice:  vi.fn(),
  disableOnDevice: vi.fn(),
}))

vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../lib/pushNotifications', () => mockPush)

function setup({ user = { _id: 'u1' }, apiFetch } = {}) {
  const setUser = vi.fn()
  const fetchFn = apiFetch ?? vi.fn()
  mockUseAuth.mockReturnValue({ user, setUser, API: '', apiFetch: fetchFn })
  render(<PushNotificationSettings />)
  return { setUser, apiFetch: fetchFn }
}

const switchFor = (name) => screen.getByRole('switch', { name })

beforeEach(() => {
  vi.clearAllMocks()
  mockPush.pushKind.mockReturnValue('web')
  mockPush.deviceStatus.mockResolvedValue('off')
})

describe('PushNotificationSettings', () => {
  it('defaults personal switches on and rooms off', async () => {
    setup()
    await waitFor(() => expect(mockPush.deviceStatus).toHaveBeenCalled())
    for (const name of ['Direct messages', 'Replies', 'Mentions', 'Emoji reactions']) {
      expect(switchFor(name)).toHaveAttribute('aria-checked', 'true')
    }
    for (const name of ['CBAT Lounge', 'General', 'Updates']) {
      expect(switchFor(name)).toHaveAttribute('aria-checked', 'false')
    }
  })

  it('reads saved choices from the account', () => {
    setup({ user: { _id: 'u1', pushPrefs: { reactions: false, general: true } } })
    expect(switchFor('Emoji reactions')).toHaveAttribute('aria-checked', 'false')
    expect(switchFor('General')).toHaveAttribute('aria-checked', 'true')
  })

  it('saves one switch at a time to the account', async () => {
    const saved = { _id: 'u1', pushPrefs: { lounge: true } }
    const apiFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { user: saved } }) })
    const { setUser } = setup({ apiFetch })

    fireEvent.click(switchFor('CBAT Lounge'))

    await waitFor(() => expect(setUser).toHaveBeenLastCalledWith(saved))
    expect(apiFetch).toHaveBeenCalledWith('/api/users/me/push-prefs', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ lounge: true }),
    }))
  })

  it('puts a switch back when the save fails', async () => {
    const user = { _id: 'u1' }
    const apiFetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) })
    const { setUser } = setup({ user, apiFetch })

    fireEvent.click(switchFor('Direct messages'))

    await waitFor(() => expect(setUser).toHaveBeenLastCalledWith(user))
  })

  it('turns this device on', async () => {
    mockPush.enableOnDevice.mockResolvedValue('on')
    setup()
    const button = await screen.findByRole('button', { name: /turn on for this device/i })
    await waitFor(() => expect(button).not.toBeDisabled())
    fireEvent.click(button)
    expect(await screen.findByText(/on for this device/i)).toBeInTheDocument()
  })

  it('explains when the device has blocked notifications', async () => {
    mockPush.deviceStatus.mockResolvedValue('blocked')
    setup()
    expect(await screen.findByText(/blocked in this device/i)).toBeInTheDocument()
  })

  it('explains when this device cannot get notifications at all', () => {
    mockPush.pushKind.mockReturnValue(null)
    setup()
    expect(screen.getByText(/can't get notifications/i)).toBeInTheDocument()
    expect(mockPush.deviceStatus).not.toHaveBeenCalled()
  })
})
