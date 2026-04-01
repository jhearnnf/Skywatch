import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import userEvent from '@testing-library/user-event'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockNavigate    = vi.hoisted(() => vi.fn())
const mockUseSettings = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: mockUseSettings,
}))

vi.mock('../../data/mockData', () => ({
  CATEGORY_ICONS:        { News: '📰', Aviation: '✈️' },
  CATEGORY_DESCRIPTIONS: { News: 'Latest intel', Aviation: 'Airpower' },
}))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className, style, ...rest }) => <div className={className} style={style}>{children}</div>,
    button: ({ children, className, onClick, onMouseEnter, onMouseLeave }) => (
      <button className={className} onClick={onClick} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
        {children}
      </button>
    ),
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

import WelcomeAgentFlow from '../onboarding/WelcomeAgentFlow'

// ── Helpers ───────────────────────────────────────────────────────────────────

function setup(freeCategories = ['News', 'Aviation']) {
  mockUseSettings.mockReturnValue({ settings: { freeCategories } })
  const onClose = vi.fn()
  const utils   = render(<WelcomeAgentFlow onClose={onClose} />)
  return { onClose, ...utils }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WelcomeAgentFlow — category selection navigation', () => {
  beforeEach(() => {
    localStorage.clear()
    mockNavigate.mockReset()
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('navigates to /learn-priority with the correct category state when News is clicked', () => {
    const { onClose } = setup()

    fireEvent.click(screen.getByText('News'))

    expect(mockNavigate).toHaveBeenCalledWith(
      '/learn-priority',
      { state: { category: 'News' } }
    )
  })

  it('navigates with the correct category when a non-default category is clicked', () => {
    setup(['Aviation', 'News'])

    fireEvent.click(screen.getByText('Aviation'))

    expect(mockNavigate).toHaveBeenCalledWith(
      '/learn-priority',
      { state: { category: 'Aviation' } }
    )
  })

  it('calls onClose after picking a category', () => {
    const { onClose } = setup()

    fireEvent.click(screen.getByText('News'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('sets skywatch_onboarded in localStorage after picking a category', () => {
    setup()

    fireEvent.click(screen.getByText('News'))

    expect(localStorage.getItem('skywatch_onboarded')).toBe('1')
  })

  it('calls onClose when Escape is pressed', async () => {
    const { onClose } = setup()

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does NOT navigate to learn-priority when Escape is pressed', () => {
    setup()

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(mockNavigate).not.toHaveBeenCalledWith(
      '/learn-priority',
      expect.anything()
    )
  })
})
