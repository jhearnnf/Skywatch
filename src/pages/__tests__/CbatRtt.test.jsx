import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatRtt from '../CbatRtt'
import { RTT_LAUNCH_MS, RTT_TUNING } from '../../utils/cbat/rttDifficulty'

const mockUseAuth = vi.hoisted(() => vi.fn())
// Lets a test fly a run in a chosen look (the look is otherwise random).
const forceLook = vi.hoisted(() => ({ value: null }))
vi.mock('../../utils/cbat/rttSim', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    makeRttSim: (...args) => {
      const sim = actual.makeRttSim(...args)
      if (forceLook.value) sim.look = forceLook.value
      return sim
    },
  }
})

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../components/CbatGameOver', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('../../lib/cbatOutbox', () => ({ submitCbatResult: vi.fn(() => Promise.resolve({ synced: true })) }))
vi.mock('../../utils/cbat/useCbatTracking', () => ({
  useCbatTracking: () => ({ start: vi.fn(), setRound: vi.fn(), markCompleted: vi.fn() }),
}))
vi.mock('../../utils/sound', () => ({ playRttShutter: vi.fn(), playRttPerfect: vi.fn() }))
vi.mock('framer-motion', () => ({
  motion: { div: ({ children, className }) => <div className={className}>{children}</div> },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// The scene is WebGL, so it is replaced by a stub exposing what the page
// actually reacts to: a captured frame, the run ending, and the per-frame HUD
// snapshot the real driver pushes.
const HUD_LIVE = {
  reticle: 'lock', stickX: 0.4, stickY: -0.2,
  clock: '1:23', score: '240', az: '043', elev: '-12',
  frames: '2/3', label: 'VEHICLE', count: '3 of 12', window: '55%',
  cueOn: true, cueNext: false, cueAngle: '135.0deg', cueDeg: '32°',
}
const HUD_STANDBY = {
  ...HUD_LIVE, reticle: 'idle', label: 'STAND BY', window: '0%',
  cueOn: true, cueNext: true, cueAngle: '-40.0deg', cueDeg: '61°',
}
const HUD_ON_TARGET = { ...HUD_LIVE, cueOn: false, cueDeg: '3°' }

vi.mock('../../components/RttScene', () => ({
  default: ({ sim, onShot, onEnd, onHud }) => (
    <div data-testid="rtt-scene">
      <button type="button" onClick={() => onShot({ kind: 'hit', points: 40 })}>mock-hit</button>
      <button type="button" onClick={() => onShot({ kind: 'hit', points: 45, errorRad: 0 })}>mock-perfect</button>
      <button type="button" onClick={() => onHud({ ...HUD_LIVE, callout: 'Target 3 of 12: Convoy truck', calloutKey: 2 })}>mock-hud-callout</button>
      <button
        type="button"
        onClick={() => {
          sim.photos.push({ target: 0, centring: 0.9, points: 45, src: 'data:image/jpeg;base64,AAAA' })
          sim.photos.push({ target: 0, centring: 0.3, points: 28, src: 'data:image/jpeg;base64,BBBB' })
          onEnd()
        }}
      >mock-finish-with-photos</button>
      <button type="button" onClick={() => onShot({ kind: 'miss', points: -8 })}>mock-miss</button>
      <button type="button" onClick={onEnd}>mock-end</button>
      <button type="button" onClick={() => onHud(HUD_LIVE)}>mock-hud-live</button>
      <button type="button" onClick={() => onHud(HUD_STANDBY)}>mock-hud-standby</button>
      <button type="button" onClick={() => onHud(HUD_ON_TARGET)}>mock-hud-on-target</button>
    </div>
  ),
}))

function setup({ uiTheme } = {}) {
  const apiFetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: null }) }))
  mockUseAuth.mockReturnValue({ user: { _id: 'u1', uiTheme }, API: '', apiFetch })
  return apiFetch
}

const startBtn = () => screen.getByRole('button', { name: /^start$/i })

async function playTo(phase = 'playing') {
  fireEvent.click(startBtn())
  await act(async () => { vi.advanceTimersByTime(RTT_LAUNCH_MS + 100) })
  if (phase === 'results') {
    fireEvent.click(screen.getByRole('button', { name: /mock-end/i }))
    await act(async () => {})
  }
}

describe('CbatRtt', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear() })
  afterEach(() => vi.useRealTimers())

  it('asks the visitor to sign in when logged out', () => {
    mockUseAuth.mockReturnValue({ user: null, API: '', apiFetch: vi.fn() })
    render(<CbatRtt />)
    expect(screen.getByText(/sign in to play/i)).toBeInTheDocument()
  })

  it('opens on the instructions card with Easier selected', () => {
    setup()
    render(<CbatRtt />)
    expect(screen.getByRole('button', { name: /easier/i }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /hard/i }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByTestId('rtt-arena')).toBeNull()
  })

  it('switching to Hard repoints the leaderboard link and is remembered', () => {
    setup()
    const { unmount } = render(<CbatRtt />)
    expect(screen.getByRole('link', { name: /view leaderboard/i }).getAttribute('href')).toBe('/cbat/rtt-easier/leaderboard')

    fireEvent.click(screen.getByRole('button', { name: /hard/i }))
    expect(screen.getByRole('link', { name: /view leaderboard/i }).getAttribute('href')).toBe('/cbat/rtt/leaderboard')

    unmount()
    render(<CbatRtt />)
    expect(screen.getByRole('button', { name: /hard/i }).getAttribute('aria-pressed')).toBe('true')
  })

  it('reads the personal best from the selected difficulty board', async () => {
    const apiFetch = setup()
    render(<CbatRtt />)
    await waitFor(() => {
      expect(apiFetch.mock.calls.some(([url]) => url.includes('/cbat/rtt-easier/personal-best'))).toBe(true)
    })
    fireEvent.click(screen.getByRole('button', { name: /hard/i }))
    await waitFor(() => {
      expect(apiFetch.mock.calls.some(([url]) => url.endsWith('/cbat/rtt/personal-best'))).toBe(true)
    })
  })

  it('flashes the selected difficulty for 1s before the picture comes up', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setup()
    render(<CbatRtt />)
    fireEvent.click(startBtn())

    expect(screen.queryByTestId('rtt-arena')).toBeNull()
    expect(screen.getByRole('button', { name: /easier/i }).className).toContain('cbat-launch-flash')
    expect(screen.getByRole('button', { name: /hard/i }).className).toContain('cbat-launch-dim')

    await act(async () => { vi.advanceTimersByTime(900) })
    expect(screen.queryByTestId('rtt-arena')).toBeNull()

    await act(async () => { vi.advanceTimersByTime(200) })
    expect(screen.getByTestId('rtt-arena')).toBeInTheDocument()
    expect(screen.getByTestId('rtt-scene')).toBeInTheDocument()
  })

  it('names the difficulty in play beside the page title', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setup()
    render(<CbatRtt />)
    fireEvent.click(screen.getByRole('button', { name: /hard/i }))
    await playTo()

    const marker = document.querySelector('[data-difficulty-marker]')
    expect(marker.getAttribute('data-difficulty-marker')).toBe('hard')
    expect(marker.textContent).toContain('Hard')
  })

  // The reticle is the player's only picture of the capture cone, so its size on
  // screen has to follow the difficulty that is actually being scored. It is
  // expressed as a percentage of the arena height for exactly that reason — an
  // angle over an angle, needing no measurement.
  it('sizes the reticle from the difficulty s capture cone, in percent of the picture', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setup()
    const easierRun = render(<CbatRtt />)
    await playTo()
    const easierHeight = parseFloat(screen.getByTestId('rtt-reticle').style.height)
    easierRun.unmount()

    render(<CbatRtt />)
    fireEvent.click(screen.getByRole('button', { name: /hard/i }))
    await playTo()
    const hardHeight = parseFloat(screen.getByTestId('rtt-reticle').style.height)

    expect(easierHeight).toBeGreaterThan(0)
    expect(easierHeight).toBeLessThan(100)
    expect(easierHeight).toBeGreaterThan(hardHeight)
    expect(easierHeight / hardHeight)
      .toBeCloseTo(RTT_TUNING.easier.captureScale / RTT_TUNING.hard.captureScale, 1)
  })

  // The HUD is written straight into the DOM by the scene's frame loop rather
  // than through React state, so the wiring between the two is worth pinning:
  // a typo in a key here would silently leave a readout frozen all game.
  it('writes the scene s HUD snapshot into the readouts', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setup()
    render(<CbatRtt />)
    await playTo()
    fireEvent.click(screen.getByRole('button', { name: /mock-hud-live/i }))

    expect(screen.getByTestId('rtt-reticle').dataset.state).toBe('lock')
    expect(screen.getByText('VEHICLE')).toBeInTheDocument()
    expect(screen.getByText('3 of 12')).toBeInTheDocument()
    expect(screen.getByText('2/3')).toBeInTheDocument()
    expect(screen.getByText('240')).toBeInTheDocument()
    expect(screen.getByText('1:23')).toBeInTheDocument()
    // The per-pass time-remaining bar.
    expect(document.querySelector('.bg-brand-600.rounded-full').style.width).toBe('55%')
  })

  // Without this the run is spent sweeping 300° of gimbal for a 20px target.
  it('points the cue at the target, and switches colour for the next one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setup()
    render(<CbatRtt />)
    await playTo()
    const cue = () => document.querySelector('.rtt-cue')
    const arm = () => document.querySelector('.rtt-cue-arm')

    fireEvent.click(screen.getByRole('button', { name: /mock-hud-live/i }))
    expect(cue().style.opacity).toBe('1')
    expect(cue().dataset.state).toBe('live')
    expect(arm().style.transform).toBe('rotate(135.0deg)')
    expect(screen.getByText('32°')).toBeInTheDocument()

    // Between passes it points at the NEXT target and goes amber.
    fireEvent.click(screen.getByRole('button', { name: /mock-hud-standby/i }))
    expect(cue().dataset.state).toBe('next')
    expect(arm().style.transform).toBe('rotate(-40.0deg)')

    // And it gets out of the way once the target is on screen.
    fireEvent.click(screen.getByRole('button', { name: /mock-hud-on-target/i }))
    expect(cue().style.opacity).toBe('0')
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('flashes and clicks the shutter when a frame is captured', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { playRttShutter } = await import('../../utils/sound')
    setup()
    render(<CbatRtt />)
    await playTo()

    fireEvent.click(screen.getByRole('button', { name: /mock-hit/i }))
    expect(playRttShutter).toHaveBeenCalledWith('hit')

    fireEvent.click(screen.getByRole('button', { name: /mock-miss/i }))
    expect(playRttShutter).toHaveBeenCalledWith('miss')
  })

  it('submits a finished run to the board it was played on', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { submitCbatResult } = await import('../../lib/cbatOutbox')
    setup()
    render(<CbatRtt />)
    await playTo('results')

    await waitFor(() => expect(submitCbatResult).toHaveBeenCalled())
    const [gameKey, payload] = submitCbatResult.mock.calls[0]
    expect(gameKey).toBe('rtt-easier')
    expect(payload).toEqual(expect.objectContaining({
      totalScore: expect.any(Number),
      totalTime: expect.any(Number),
      framesTaken: expect.any(Number),
      framesOnTarget: expect.any(Number),
      targetsCompleted: expect.any(Number),
      avgCentringErrorDeg: expect.any(Number),
    }))
  })

  it('sends a Hard run to the Hard board', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { submitCbatResult } = await import('../../lib/cbatOutbox')
    setup()
    render(<CbatRtt />)
    fireEvent.click(screen.getByRole('button', { name: /hard/i }))
    await playTo('results')

    await waitFor(() => expect(submitCbatResult).toHaveBeenCalled())
    expect(submitCbatResult.mock.calls[0][0]).toBe('rtt')
  })

  it('shows the grade and the run breakdown on the results screen', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setup()
    render(<CbatRtt />)
    await playTo('results')

    // Nothing was captured, so the run grades out at the bottom.
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText(/targets completed/i)).toBeInTheDocument()
    expect(screen.getByText(/frames on target/i)).toBeInTheDocument()
    expect(screen.getByText(/shutter accuracy/i)).toBeInTheDocument()
    expect(screen.getByText(/average centring/i)).toBeInTheDocument()
  })

  it('remembers the slew sensitivity between visits', () => {
    setup()
    const { unmount } = render(<CbatRtt />)
    const slider = screen.getByLabelText(/slew sensitivity/i)
    fireEvent.change(slider, { target: { value: '1.5' } })
    expect(screen.getByText('1.50×')).toBeInTheDocument()

    unmount()
    render(<CbatRtt />)
    expect(screen.getByText('1.50×')).toBeInTheDocument()
  })

  // Phones get a thumb pad under the picture, like ACT's, so a finger never
  // covers the target. useIsTouch counts a narrow window as touch.
  describe('touch pad', () => {
    const realWidth = window.innerWidth
    afterEach(() => { window.innerWidth = realWidth })

    it('puts the pad under the picture on a phone, and says how to use it', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      window.innerWidth = 390
      setup()
      render(<CbatRtt />)
      expect(screen.getByText(/hold the pad under the picture/i)).toBeInTheDocument()
      await playTo()
      expect(screen.getByTestId('rtt-pad')).toBeInTheDocument()
      expect(screen.getByText(/hold and move to aim/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /capture frame/i })).toBeInTheDocument()
    })

    it('leaves it out on a desktop, where the pointer is the stick', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      window.innerWidth = 1440
      setup()
      render(<CbatRtt />)
      await playTo()
      expect(screen.queryByTestId('rtt-pad')).toBeNull()
    })
  })

  // The SkyWatch theme dresses the run as a targeting pod and rewards each
  // frame. None of it changes scoring, and Real CBAT gets none of it.
  describe('SkyWatch dressing', () => {
    it('frames the picture as a sensor feed with a lock bracket and a range readout', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      setup()
      const { container } = render(<CbatRtt />)
      await playTo()
      expect(container.querySelector('.rtt-pod')).not.toBeNull()
      expect(screen.getByTestId('rtt-bracket')).toBeInTheDocument()
      expect(screen.getByText('Range')).toBeInTheDocument()
    })

    it('pops up how good a frame was, with a chime for a dead-centre one', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const { playRttPerfect } = await import('../../utils/sound')
      setup()
      render(<CbatRtt />)
      await playTo()
      fireEvent.click(screen.getByRole('button', { name: /mock-perfect/i }))
      expect(screen.getByText('Perfect +45')).toBeInTheDocument()
      expect(playRttPerfect).toHaveBeenCalled()
    })

    // Player report: points appeared "for nothing" while turning to the next
    // target. It was the last frame's popup being rebuilt — and its animation
    // replayed — when the next pass's card came up.
    it('never replays an old points popup when the next pass card appears', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      setup()
      render(<CbatRtt />)
      await playTo()
      fireEvent.click(screen.getByRole('button', { name: /mock-perfect/i }))
      const before = screen.getByText('Perfect +45')
      fireEvent.click(screen.getByRole('button', { name: /mock-hud-callout/i }))
      const after = screen.getByText('Perfect +45')
      expect(after).toBe(before)
    })

    it('names each target as its pass goes live', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      setup()
      render(<CbatRtt />)
      await playTo()
      fireEvent.click(screen.getByRole('button', { name: /mock-hud-callout/i }))
      expect(screen.getByTestId('rtt-callout').textContent).toBe('Target 3 of 12: Convoy truck')
    })

    it('shows the frames you captured on the results screen, best one marked', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      setup()
      render(<CbatRtt />)
      await playTo()
      fireEvent.click(screen.getByRole('button', { name: /mock-finish-with-photos/i }))
      await act(async () => {})
      const sheet = screen.getByTestId('rtt-contact-sheet')
      expect(sheet.querySelectorAll('img')).toHaveLength(2)
      expect(screen.getByText('Best')).toBeInTheDocument()
      expect(screen.getByText('Edge')).toBeInTheDocument()
    })

    it.each([
      ['thermal', 'Thermal'],
      ['rain', 'Rainy'],
      ['overcast', 'Cloudy'],
      ['dawn', 'Dawn'],
      ['dusk', 'Dusk'],
    ])('opens a %s run with a banner naming its conditions', async (look, title) => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      forceLook.value = look
      try {
        setup()
        render(<CbatRtt />)
        await playTo()
        const banner = screen.getByTestId('rtt-banner')
        expect(banner.querySelector('.rtt-banner-title').textContent).toBe(title)
      } finally {
        forceLook.value = null
      }
    })

    it('leaves Real CBAT exactly as plain as it was', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const { playRttPerfect } = await import('../../utils/sound')
      setup({ uiTheme: 'cbat' })
      const { container } = render(<CbatRtt />)
      await playTo()
      expect(container.querySelector('.rtt-pod')).toBeNull()
      expect(screen.queryByTestId('rtt-bracket')).toBeNull()
      expect(screen.queryByTestId('rtt-banner')).toBeNull()
      expect(screen.queryByText('Range')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: /mock-perfect/i }))
      expect(screen.queryByText(/Perfect/)).toBeNull()
      expect(playRttPerfect).not.toHaveBeenCalled()
    })
  })
})
