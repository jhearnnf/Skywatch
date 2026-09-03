import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Cbat from '../Cbat'

// ── Mocks ─────────────────────────────────────────────────────────────────
// The whole file runs as the native app. Everything asserted here is invisible
// on the web, where the donation link holds the slot instead.
vi.mock('../../utils/appMode', async (importOriginal) => ({
  ...(await importOriginal()),
  SLIM_APP: true,
}))

const mockUseAuth  = vi.hoisted(() => vi.fn())
const mockNavigate = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, ...rest }) => <a href={to} {...rest}>{children}</a>,
  useNavigate: () => mockNavigate,
}))

vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({ settings: { cbatGameEnabled: {} } }),
}))
vi.mock('../../components/SEO', () => ({ default: () => null }))

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: () => ({ children, ...rest }) => <div {...rest}>{children}</div>,
  }),
}))

function renderNative() {
  const apiFetch = vi.fn().mockResolvedValue({
    ok: true, json: async () => ({ status: 'success', data: { recent: [] } }),
  })
  mockUseAuth.mockReturnValue({ user: { _id: '1', name: 'Test' }, API: '', apiFetch })
  return render(<Cbat />)
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('CBAT menu — native app', () => {
  beforeEach(() => { mockUseAuth.mockReset() })
  afterEach(cleanup)

  // Play only allows donations outside its billing for registered charities, so
  // the app carries no donation link. That left the dead-cell block holding one
  // stretched link instead of the two-up pairing the web gets.
  it('replaces the donation link rather than leaving the cell half empty', () => {
    renderNative()
    expect(screen.queryByTestId('cbat-grid-donate')).toBeNull()

    const pc     = screen.getByTestId('cbat-grid-play-on-pc')
    const report = screen.getByTestId('cbat-grid-report')

    // Same cell, half each, and in the slot the donation link holds on the web.
    expect(pc.closest('div')).toBe(report.closest('div'))
    expect(pc.compareDocumentPosition(report) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    for (const el of [pc, report]) expect(el.className).toContain('flex-1')
  })

  // Labels only at this size — same rule the donation link followed.
  it('keeps the cell to two labels a phone can read', () => {
    renderNative()
    const cell = screen.getByTestId('cbat-grid-report').closest('div')
    expect(cell.textContent).toBe('Play on a PCReport a problem')
  })

  it('opens an in-app note instead of navigating out of the app', () => {
    renderNative()
    const pc = screen.getByTestId('cbat-grid-play-on-pc')
    // An anchor would open a browser on the same phone and land on the same
    // games in a worse container than the app already showing them.
    expect(pc.tagName).toBe('BUTTON')
    expect(pc.getAttribute('href')).toBeNull()

    expect(screen.queryByTestId('play-on-pc-overlay')).toBeNull()
    fireEvent.click(pc)
    expect(screen.getByTestId('play-on-pc-overlay')).toBeInTheDocument()
  })

  it('gives the note a reason and an address to type on a computer', () => {
    renderNative()
    fireEvent.click(screen.getByTestId('cbat-grid-play-on-pc'))
    const note = screen.getByTestId('play-on-pc-overlay')

    // The joystick is the thing a phone cannot do, and the menu says it nowhere
    // else. RTT, ACT and SMA are the three games that read a stick.
    expect(note.textContent).toMatch(/joystick/i)
    for (const game of ['RTT', 'ACT', 'SMA']) expect(note.textContent).toContain(game)
    expect(screen.getByTestId('play-on-pc-url').textContent).toBe('skywatch.academy')

    // Claims nothing about content behind a settings flag.
    expect(note.textContent).not.toMatch(/brief/i)
  })

  it('closes on Got it', () => {
    renderNative()
    fireEvent.click(screen.getByTestId('cbat-grid-play-on-pc'))
    fireEvent.click(screen.getByText('Got it'))
    expect(screen.queryByTestId('play-on-pc-overlay')).toBeNull()
  })
})
