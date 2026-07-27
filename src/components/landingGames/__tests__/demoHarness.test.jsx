import { render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import DemoHarness from '../demoHarness'
import Overlay from '../../ui/Overlay'
import CbatQuitButton from '../../CbatQuitButton'
import { createDemoApiFetch, DEMO_ROSTER } from '../demoStubs'
import { AuthContext } from '../../../context/AuthContext'
import { GameChromeProvider, useGameChrome } from '../../../context/GameChromeContext'
import { useCbatTracking } from '../../../utils/cbat/useCbatTracking'
import { submitCbatResult } from '../../../lib/cbatOutbox'
import { captureEvent } from '../../../lib/posthog'
import { outboxPut } from '../../../lib/offlineStore'

// A demo game is a *real* game, so the only thing standing between a showcase
// run and a bogus score on the leaderboard is this harness. These are the rails.

vi.mock('../../../lib/posthog', () => ({ captureEvent: vi.fn() }))
vi.mock('../../../utils/cbat/recordStart', () => ({ recordCbatStart: vi.fn() }))
vi.mock('../../../lib/net', () => ({ isOnline: () => true }))
vi.mock('../../../lib/offlineStore', () => ({
  outboxPut: vi.fn(),
  outboxDelete: vi.fn(),
  outboxAll: vi.fn(async () => []),
  outboxCount: vi.fn(async () => 0),
  cacheGet: vi.fn(async () => null),
  cacheSet: vi.fn(async () => {}),
}))

function TrackingProbe() {
  const { start } = useCbatTracking()
  useEffect(() => { start('sat') }, [start])
  return <span>probe</span>
}

const realAuth = {
  user: { _id: 'u1' },
  apiFetch: vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })),
  API: '',
}

describe('DemoHarness — analytics containment', () => {
  beforeEach(() => vi.clearAllMocks())

  it('drops the game lifecycle events a showcase run would otherwise fire', async () => {
    render(<DemoHarness><TrackingProbe /></DemoHarness>)
    await screen.findByText('probe')
    expect(captureEvent).not.toHaveBeenCalled()
  })

  it('still fires them for a real player (guard is demo-only)', async () => {
    render(
      <AuthContext.Provider value={realAuth}>
        <TrackingProbe />
      </AuthContext.Provider>,
    )
    await screen.findByText('probe')
    expect(captureEvent).toHaveBeenCalledWith('game_started', expect.objectContaining({ gameKey: 'sat' }))
  })
})

describe('DemoHarness — immersive containment', () => {
  function Immerse() {
    const { enterImmersive } = useGameChrome()
    useEffect(() => { enterImmersive() }, [enterImmersive])
    return null
  }
  function OuterProbe() {
    const { immersive } = useGameChrome()
    return <span data-testid="outer">{String(immersive)}</span>
  }

  it('keeps a demo’s enterImmersive() out of the surrounding app', async () => {
    render(
      <GameChromeProvider>
        <OuterProbe />
        <DemoHarness><Immerse /></DemoHarness>
      </GameChromeProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('outer').textContent).toBe('false'))
  })
})

describe('DemoHarness — overlay containment', () => {
  function DemoModal() {
    return <Overlay data-testid="demo-overlay"><span>Quit this game?</span></Overlay>
  }

  it('portals a demo game’s overlay into its card, not over the page', () => {
    const stage = document.createElement('div')
    stage.id = 'stage'
    document.body.appendChild(stage)

    render(
      <DemoHarness portalTarget={stage}>
        <DemoModal />
      </DemoHarness>,
    )

    // Anywhere but inside the card means it is covering the landing page.
    expect(stage.contains(screen.getByTestId('demo-overlay'))).toBe(true)
    document.body.removeChild(stage)
  })

  it('still portals to the body for a real player', () => {
    render(<Overlay data-testid="real-overlay"><span>hi</span></Overlay>)
    const el = screen.getByTestId('real-overlay')
    expect(el.parentElement).toBe(document.body)
  })
})

describe('CbatQuitButton in a demo', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does not touch browser history', () => {
    const pushState = vi.spyOn(window.history, 'pushState')
    render(
      <DemoHarness>
        <CbatQuitButton onConfirm={() => {}} confirmNeeded />
      </DemoHarness>,
    )
    // The guard would push an entry per in-progress game — nine cards cycling
    // every few seconds would make the back button useless.
    expect(pushState).not.toHaveBeenCalled()
  })

  it('still guards a real game', () => {
    const pushState = vi.spyOn(window.history, 'pushState')
    render(<CbatQuitButton onConfirm={() => {}} confirmNeeded />)
    expect(pushState).toHaveBeenCalled()
  })
})

describe('demo apiFetch', () => {
  beforeEach(() => vi.clearAllMocks())

  it('serves the bundled-model roster so aircraft-select games can start', async () => {
    const apiFetch = createDemoApiFetch()
    const res = await apiFetch('/api/games/cbat/aircraft-cutouts')
    const body = await res.json()
    expect(body.data).toEqual(DEMO_ROSTER)
    expect(body.data.length).toBeGreaterThan(0)
  })

  it('resolves everything else successfully and empty', async () => {
    const apiFetch = createDemoApiFetch()
    const res = await apiFetch('/api/games/cbat/sat/personal-best')
    expect(res.ok).toBe(true)
    expect(await res.json()).toEqual({})
  })

  it('never lets a demo score reach the outbox', async () => {
    // The rail that matters: submitCbatResult only queues on a failed or 401
    // POST, so an always-ok stub means nothing is stored for a later flush.
    const apiFetch = createDemoApiFetch()
    const result = await submitCbatResult('sat', { score: 18 }, { apiFetch, API: '' })
    expect(result.synced).toBe(true)
    expect(outboxPut).not.toHaveBeenCalled()
  })
})
