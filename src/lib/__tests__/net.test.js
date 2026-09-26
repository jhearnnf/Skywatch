import { expect, it, vi } from 'vitest'

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }))
const network = vi.hoisted(() => ({ getStatus: vi.fn(), addListener: vi.fn() }))
vi.mock('@capacitor/network', () => ({ Network: network }))

it('notifies mounted subscribers when Android initially reports offline', async () => {
  let resolveStatus
  network.getStatus.mockReturnValue(new Promise(resolve => { resolveStatus = resolve }))
  const { isOnline, onNetworkChange } = await import('../net')
  const listener = vi.fn()
  const unsubscribe = onNetworkChange(listener)
  await vi.waitFor(() => expect(network.getStatus).toHaveBeenCalled())
  resolveStatus({ connected: false })
  await vi.waitFor(() => expect(listener).toHaveBeenCalledWith(false))
  expect(isOnline()).toBe(false)
  unsubscribe()
})
