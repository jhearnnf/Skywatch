import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Landing from '../Landing'

// ── Mocks ─────────────────────────────────────────────────────────────────

// Force slim ("CBAT-only") mode for this whole file.
vi.mock('../../hooks/useSlimMode', () => ({ useSlimMode: () => true }))

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }) => <a href={to}>{children}</a>,
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: null, API: '' }),
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
  afterEach(() => vi.restoreAllMocks())

  it('shows a CBAT-focused hero', () => {
    render(<Landing />)
    expect(screen.getByText('RAF CBAT')).toBeDefined()
    expect(screen.getByText(/Computer-Based Aptitude Test/i)).toBeDefined()
    expect(screen.queryByText('RAF Knowledge')).toBeNull()
  })

  it('shows the CBAT preview window but not the intel-brief window', async () => {
    render(<Landing />)
    await waitFor(() => expect(screen.getByTestId('preview-window-cbat')).toBeDefined())
    expect(screen.queryByTestId('preview-window-intel-brief')).toBeNull()
  })

  it('hides the RAF-learning sections (subjects, features) and Browse Subjects', () => {
    render(<Landing />)
    expect(screen.queryByText('Everything You Need to Know')).toBeNull()
    expect(screen.queryByText('How It Works')).toBeNull()
    expect(screen.queryByText('Browse Subjects')).toBeNull()
  })

  it('points the signup CTAs at register (not the RAF onboarding flow)', () => {
    render(<Landing />)
    const ctas = screen.getAllByText('Start Practising Free →')
    expect(ctas.length).toBeGreaterThan(0)
    for (const cta of ctas) {
      expect(cta.closest('a').getAttribute('href')).toBe('/login?tab=register')
    }
  })
})
