import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import LockedCategoryModal from '../LockedCategoryModal'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockNavigate    = vi.hoisted(() => vi.fn())
const mockUseAuth     = vi.hoisted(() => vi.fn())
const mockUseSettings = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

vi.mock('../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../context/AppSettingsContext', () => ({ useAppSettings: mockUseSettings }))
vi.mock('../../context/AppSettingsContext', () => ({ useAppSettings: mockUseSettings }))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className, style, onClick }) => <div className={className} style={style} onClick={onClick}>{children}</div>,
    button: ({ children, className, onClick })        => <button className={className} onClick={onClick}>{children}</button>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function setup() {
  mockUseAuth.mockReturnValue({ setUser: vi.fn(), API: '' })
  mockUseSettings.mockReturnValue({ settings: { freeCategories: ['News'] } })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('LockedCategoryModal — email CTA with pendingBriefId', () => {
  beforeEach(() => {
    setup()
    mockNavigate.mockClear()
    localStorage.clear()
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('navigates to /login?tab=register with pendingBrief param when pendingBriefId is supplied', () => {
    render(
      <LockedCategoryModal
        category="Aircrafts" tier="silver" user={null}
        pendingBriefId="brief42" onClose={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('Continue →'))
    expect(mockNavigate).toHaveBeenCalledWith(
      '/login?tab=register&pendingBrief=brief42'
    )
  })

  it('saves pendingBriefId to localStorage when Continue is clicked', () => {
    render(
      <LockedCategoryModal
        category="Aircrafts" tier="silver" user={null}
        pendingBriefId="brief42" onClose={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('Continue →'))
    expect(localStorage.getItem('sw_pending_brief')).toBe('brief42')
  })

  it('includes email in URL when both pendingBriefId and email are provided', () => {
    render(
      <LockedCategoryModal
        category="Aircrafts" tier="silver" user={null}
        pendingBriefId="brief42" onClose={vi.fn()}
      />
    )
    fireEvent.change(screen.getByPlaceholderText('your@email.com'), {
      target: { value: 'agent@raf.mod.uk' },
    })
    fireEvent.click(screen.getByText('Continue →'))
    expect(mockNavigate).toHaveBeenCalledWith(
      '/login?tab=register&pendingBrief=brief42&email=agent%40raf.mod.uk'
    )
  })

  it('navigates to /login?tab=register WITHOUT pendingBrief param when pendingBriefId is not supplied', () => {
    render(
      <LockedCategoryModal
        category="Aircrafts" tier="silver" user={null}
        onClose={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('Continue →'))
    expect(mockNavigate).toHaveBeenCalledWith('/login?tab=register')
    expect(mockNavigate.mock.calls[0][0]).not.toContain('pendingBrief')
  })

  it('does NOT write to localStorage when no pendingBriefId is supplied', () => {
    render(
      <LockedCategoryModal
        category="Aircrafts" tier="silver" user={null}
        onClose={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('Continue →'))
    expect(localStorage.getItem('sw_pending_brief')).toBeNull()
  })

  it('calls onClose when Continue is clicked', () => {
    const onClose = vi.fn()
    render(
      <LockedCategoryModal
        category="Aircrafts" tier="silver" user={null}
        pendingBriefId="brief42" onClose={onClose}
      />
    )
    fireEvent.click(screen.getByText('Continue →'))
    expect(onClose).toHaveBeenCalled()
  })
})
