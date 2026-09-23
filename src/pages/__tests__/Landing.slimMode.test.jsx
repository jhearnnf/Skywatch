import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Landing from '../Landing'
import { CBAT_GUIDE_HREF } from '../../utils/guideHref'

// ── Mocks ─────────────────────────────────────────────────────────────────

// Force slim ("CBAT-only") mode for this whole file.
vi.mock('../../hooks/useSlimMode', () => ({ useSlimMode: () => true }))

vi.mock('react-router-dom', () => ({
  // Cancels the default like the real Link, so jsdom does not try to navigate.
  Link: ({ children, to, onClick, ...rest }) => (
    <a href={to} data-router-link="" {...rest} onClick={e => { e.preventDefault(); onClick?.(e) }}>{children}</a>
  ),
}))

const hardNavigate = vi.fn()
vi.mock('../../utils/hardNavigate', () => ({ hardNavigate: (...a) => hardNavigate(...a) }))

let mockUser = null
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser, API: '' }),
}))

vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({ settings: { cbatEnabled: true, previewWindowCbatEnabled: true, previewWindowIntelBriefEnabled: true } }),
}))

vi.mock('../../lib/posthog', () => ({ captureEvent: vi.fn() }))
vi.mock('../../components/onboarding/WelcomeAgentFlow', () => ({ default: () => null }))
vi.mock('../../components/SocialLinks', () => ({ default: () => null }))
vi.mock('../../components/SEO', () => ({ default: () => null }))

// Preview window stub — renders eyebrow text + a testid so we can assert which
// window(s) are shown.
vi.mock('../../components/homePreview/PreviewWindow', () => ({
  default: ({ eyebrow, dataTestId }) => <div data-testid={dataTestId}>{eyebrow}</div>,
}))

// The live game wall mounts real games; stub it down to a marker.
vi.mock('../../components/landingGames/LiveGameGrid', () => ({
  default: () => <div data-testid="live-game-grid" />,
}))

// Charts need a measured container, and the real component renders nothing
// until its fetch resolves with qualifying players. Stub it to a marker so the
// section's position on the page can be asserted.
vi.mock('../../components/landingGames/PlayerProgressWall', () => ({
  default: () => <div data-testid="player-progress-wall" />,
}))

// Both registries return a non-empty scene list so each window *would* render
// if not otherwise gated.
vi.mock('../../components/homePreview/registries/intelBriefRegistry', () => ({
  buildIntelBriefScenes: () => [{ id: 'intel-1' }],
}))
vi.mock('../../components/homePreview/registries/cbatRegistry', () => ({
  buildCbatScenes: () => [{ id: 'cbat-1' }],
}))

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => ({ children, ...rest }) => <div {...rest}>{children}</div> }),
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Landing — slim (CBAT-only) mode', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: {} }) })
  })
  afterEach(() => { mockUser = null; vi.restoreAllMocks() })

  it('shows a CBAT-focused hero', () => {
    render(<Landing />)
    expect(screen.getByText('Aircrew CBAT')).toBeDefined()
    expect(screen.getByText(/Computer-Based Aptitude Test/i)).toBeDefined()
    expect(screen.queryByText('Aviation Knowledge')).toBeNull()
  })

  it('never names the RAF — the landing page keeps its wording generic', () => {
    const { container } = render(<Landing />)
    expect(container.textContent).not.toMatch(/\bRAF\b/)
  })

  it('leads with the live game wall instead of the cycling preview window', async () => {
    render(<Landing />)
    await waitFor(() => expect(screen.getByTestId('live-game-grid')).toBeDefined())
    expect(screen.queryByTestId('preview-window-cbat')).toBeNull()
    expect(screen.queryByTestId('preview-window-intel-brief')).toBeNull()
  })

  it('hides the RAF-learning sections (subjects, features) and Browse Subjects', () => {
    render(<Landing />)
    expect(screen.queryByText('Everything You Need to Know')).toBeNull()
    expect(screen.queryByText('How It Works')).toBeNull()
    expect(screen.queryByText('Browse Subjects')).toBeNull()
  })

  // Evidence before the ask. Reversing these two leaves the page making its
  // final request before showing any reason to say yes, and ends the page on
  // charts with no button to press.
  it('puts the proof wall above the closing CTA, not below it', async () => {
    render(<Landing />)
    const wall = await screen.findByTestId('player-progress-wall')
    const cta = screen.getByText("Get on this week's leaderboard.")
    // DOCUMENT_POSITION_FOLLOWING (4) — the CTA comes after the wall.
    expect(wall.compareDocumentPosition(cta) & 4).toBeTruthy()
  })

  // The closing card must stand on its own: the progress wall above it renders
  // nothing when no player qualifies, so copy pointing at "the lines above" can
  // end up pointing at nothing. It also must not restate the hero.
  it('closes with copy that does not depend on the wall above it', async () => {
    render(<Landing />)
    await screen.findByTestId('player-progress-wall')
    const card = screen.getByText("Get on this week's leaderboard.").closest('div')
    expect(card.textContent).toMatch(/every game scores you instantly/i)
    expect(card.textContent).not.toMatch(/above/i)
    expect(screen.queryByText('Sharpen Your Edge.')).toBeNull()
  })

  // The heading should not spend itself on the button's verb — "Start" ran
  // three times in the old card (heading, body, button).
  it('does not repeat the button verb across the closing card', () => {
    render(<Landing />)
    const card = screen.getByText("Get on this week's leaderboard.").closest('div')
    expect(card.textContent.match(/Start/gi) ?? []).toHaveLength(0)
    expect(card.textContent.match(/Sign Up/gi) ?? []).toHaveLength(1)
  })

  it('opens the guest CBAT menu from the primary CTA and keeps the closing signup CTA', () => {
    render(<Landing />)
    const hero = screen.getByTestId('landing-primary-cbat-cta')
    expect(hero.getAttribute('href')).toBe('/cbat')
    expect(hero.hasAttribute('data-router-link')).toBe(true)
    expect(hero.textContent).toBe('Start Practising Free →')
    expect(screen.getByText('Sign Up Free →').closest('a').getAttribute('href')).toBe('/login?tab=register')
  })

  // The two buttons go to different places, so they must not share a label.
  it('labels the hero and closing CTAs differently', () => {
    render(<Landing />)
    expect(screen.getAllByText('Start Practising Free →')).toHaveLength(1)
  })

  // Signed-in players keep the instant in-app route change (a full reload felt
  // wrong), but the change waits on AnimatePresence's exit animation, which
  // Safari could stall under the live game wall. If Landing is still mounted
  // after the grace period, a real page load takes over.
  describe('signed-in CBAT buttons', () => {
    beforeEach(() => { mockUser = { _id: 'u1' }; hardNavigate.mockClear(); vi.useFakeTimers() })
    afterEach(() => vi.useRealTimers())

    it('navigate in-app, without the hover lift that swallows Mac clicks', () => {
      render(<Landing />)
      const hero = screen.getByTestId('landing-primary-cbat-cta')
      expect(hero.textContent).toBe('Play CBAT Games')
      expect(hero.getAttribute('href')).toBe('/cbat')
      expect(hero.hasAttribute('data-router-link')).toBe(true)
      expect(hero.className).not.toMatch(/translate-y/)
      expect(hero.className).toMatch(/touch-manipulation/)
      expect(screen.getByTestId('landing-header-cbat-cta').hasAttribute('data-router-link')).toBe(true)
    })

    it.each(['landing-primary-cbat-cta', 'landing-header-cbat-cta'])(
      '%s falls back to a full page load when the route change stalls',
      testId => {
        render(<Landing />)
        fireEvent.click(screen.getByTestId(testId))
        act(() => vi.advanceTimersByTime(1999))
        expect(hardNavigate).not.toHaveBeenCalled()
        act(() => vi.advanceTimersByTime(1))
        expect(hardNavigate).toHaveBeenCalledWith('/cbat')
      },
    )

    it('does not reload once the route change has unmounted Landing', () => {
      const { unmount } = render(<Landing />)
      fireEvent.click(screen.getByTestId('landing-primary-cbat-cta'))
      unmount()
      act(() => vi.advanceTimersByTime(5000))
      expect(hardNavigate).not.toHaveBeenCalled()
    })
  })
})

// ── Native chrome ─────────────────────────────────────────────────────────
// Two things went wrong on the Android build specifically, both invisible on
// the web because the safe-area insets are 0 there and dev/Vercel rewrite the
// guide's clean URL for us.
describe('Landing — native app', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: {} }) })
  })
  afterEach(() => vi.restoreAllMocks())

  // main.css pushes every `header.fixed` down by env(safe-area-inset-top), so
  // the page's own fixed header is taller than 3.5rem under the status bar. A
  // flat pt-20 hid the CBAT TRAINING / FREE badge row behind it.
  it('clears the status bar as well as the fixed header', () => {
    const { container } = render(<Landing />)
    const hero = container.querySelector('section')
    expect(hero.className).toMatch(/pt-\[calc\(5rem\+env\(safe-area-inset-top\)\)\]/)
    expect(hero.className).toMatch(/sm:pt-\[calc\(9rem\+env\(safe-area-inset-top\)\)\]/)
  })

  // The guide is a static document, so its href has to be one the platform can
  // actually resolve — see utils/guideHref.js.
  it('links the guide through the platform-aware href', () => {
    render(<Landing />)
    expect(screen.getByText('CBAT Guide').getAttribute('href')).toBe(CBAT_GUIDE_HREF)
  })
})
