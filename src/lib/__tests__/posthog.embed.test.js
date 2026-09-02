/**
 * PostHog must not boot inside a CBAT guide embed.
 *
 * The guide (public/cbat-guide.html) frames up to nine /embed/cbat/<id> routes
 * at once. Each frame runs this bundle, and because the session cookies are
 * per-domain, a posthog.init() in a frame does not start its own session — it
 * joins the reader's as an extra window. The session replay then flips between
 * the guide and a game close-up every few seconds. See initPostHog().
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('posthog-js', () => ({
  default: { init: vi.fn(), identify: vi.fn(), reset: vi.fn(), capture: vi.fn() },
}))

// KEY is read once at module load, so the env stub has to be in place before
// the import — hence the reset-and-reimport rather than a plain top-level one.
async function loadAt(pathname) {
  window.history.replaceState({}, '', pathname)
  vi.resetModules()
  vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test_key')
  const posthog = (await import('posthog-js')).default
  const lib = await import('../posthog')
  return { posthog, lib }
}

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { vi.unstubAllEnvs() })

describe('initPostHog', () => {
  it('does not initialise inside a guide game embed', async () => {
    const { posthog, lib } = await loadAt('/embed/cbat/flag')
    lib.initPostHog()
    expect(posthog.init).not.toHaveBeenCalled()
  })

  it('still initialises on an ordinary app route', async () => {
    const { posthog, lib } = await loadAt('/cbat')
    lib.initPostHog()
    expect(posthog.init).toHaveBeenCalledTimes(1)
  })

  it('captures nothing from an embed, having never initialised', async () => {
    const { posthog, lib } = await loadAt('/embed/cbat/flag')
    lib.initPostHog()
    lib.captureEvent('cbat_demo_click')
    expect(posthog.capture).not.toHaveBeenCalled()
  })
})
