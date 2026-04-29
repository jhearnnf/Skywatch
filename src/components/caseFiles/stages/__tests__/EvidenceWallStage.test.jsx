import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import EvidenceWallStage from '../EvidenceWallStage.jsx'

// ── Mock framer-motion ────────────────────────────────────────────────────────
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, style, initial, animate, exit, transition, ...rest }) => (
      <div className={className} style={style} {...rest}>{children}</div>
    ),
    p: ({ children, className, style, initial, animate, exit, transition, ...rest }) => (
      <p className={className} style={style} {...rest}>{children}</p>
    ),
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Mock child components ─────────────────────────────────────────────────────
// EvidenceCard: render a simple clickable div so we can drive interactions.
vi.mock('../../../caseFiles/EvidenceCard.jsx', () => ({
  default: ({ item, isSelected, onClick, onPositionChange }) => {
    // Simulate the component reporting its position on mount
    // (jsdom has no real layout so coords are always 0 — good enough for logic tests)
    // We call onPositionChange synchronously so posMapRef is populated immediately.
    if (onPositionChange) onPositionChange(item.id, { x: 50, y: 50 })
    return (
      <div
        data-testid={`evidence-card-${item.id}`}
        data-selected={isSelected ? 'true' : 'false'}
        onClick={onClick}
        role="button"
        aria-label={item.title}
      >
        {item.title}
      </div>
    )
  },
}))

// RedStringConnector: render a minimal sentinel so we can count connections.
vi.mock('../../../caseFiles/RedStringConnector.jsx', () => ({
  default: ({ from, to, committed, onClick }) => {
    if (!from || !to) return null
    return (
      <div
        data-testid={committed ? 'red-string-committed' : 'red-string-progress'}
        onClick={onClick}
        role={onClick ? 'button' : undefined}
        aria-label={committed ? 'connection' : 'in-progress-connection'}
      />
    )
  },
}))

// CorkboardView (mobile path): never rendered in desktop tests, but mocked
// defensively in case matchMedia stubs change in the future.
vi.mock('../../../caseFiles/CorkboardView.jsx', () => ({
  default: () => <div data-testid="corkboard-view-mobile" />,
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────
const ITEMS = [
  { id: 'item-a', title: 'Alpha Doc',  type: 'document',   description: 'Alpha desc',  imageUrl: null, imageCredit: null, sourceUrl: null },
  { id: 'item-b', title: 'Bravo Img',  type: 'photo',      description: 'Bravo desc',  imageUrl: null, imageCredit: null, sourceUrl: null },
  { id: 'item-c', title: 'Charlie TX', type: 'transcript', description: 'Charlie desc', imageUrl: null, imageCredit: null, sourceUrl: null },
]

const STAGE = {
  id:   'ch1-evidence',
  type: 'evidence_wall',
  payload: {
    phaseLabel: 'Phase 1: Analysis',
    items:      ITEMS,
  },
}

const SESSION_CONTEXT = {
  caseSlug:    'test-case',
  chapterSlug: 'ch1',
  sessionId:   'sess-abc',
  priorResults: [],
}

// ── Setup: provide ResizeObserver + matchMedia stubs ─────────────────────────
beforeEach(() => {
  global.ResizeObserver = class {
    observe()    {}
    unobserve()  {}
    disconnect() {}
  }
  // Default: desktop path (matches=false). Tests that exercise the mobile
  // CorkboardView would override this before render().
  if (typeof window !== 'undefined') {
    window.matchMedia = window.matchMedia || ((query) => ({
      matches: false,
      media:   query,
      onchange: null,
      addEventListener:    () => {},
      removeEventListener: () => {},
      addListener:    () => {},
      removeListener: () => {},
      dispatchEvent:  () => false,
    }))
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('EvidenceWallStage', () => {

  it('renders all evidence items', () => {
    render(<EvidenceWallStage stage={STAGE} sessionContext={SESSION_CONTEXT} onSubmit={vi.fn()} />)
    for (const item of ITEMS) {
      expect(screen.getByTestId(`evidence-card-${item.id}`)).toBeDefined()
    }
  })

  it('renders the phaseLabel in the header', () => {
    render(<EvidenceWallStage stage={STAGE} sessionContext={SESSION_CONTEXT} onSubmit={vi.fn()} />)
    expect(screen.getByText('Phase 1: Analysis')).toBeDefined()
  })

  it('renders the Submit Analysis button', () => {
    render(<EvidenceWallStage stage={STAGE} sessionContext={SESSION_CONTEXT} onSubmit={vi.fn()} />)
    expect(screen.getByTestId('submit-analysis-btn')).toBeDefined()
  })

  it('clicking two distinct items creates a connection', async () => {
    render(<EvidenceWallStage stage={STAGE} sessionContext={SESSION_CONTEXT} onSubmit={vi.fn()} />)

    fireEvent.click(screen.getByTestId('evidence-card-item-a'))
    fireEvent.click(screen.getByTestId('evidence-card-item-b'))

    await waitFor(() => {
      expect(screen.getAllByTestId('red-string-committed').length).toBe(1)
    })
  })

  it('clicking the same item twice does not create a connection', async () => {
    render(<EvidenceWallStage stage={STAGE} sessionContext={SESSION_CONTEXT} onSubmit={vi.fn()} />)

    fireEvent.click(screen.getByTestId('evidence-card-item-a'))
    fireEvent.click(screen.getByTestId('evidence-card-item-a'))

    // No committed string should be rendered
    await waitFor(() => {
      const strings = screen.queryAllByTestId('red-string-committed')
      expect(strings.length).toBe(0)
    })
  })

  it('clicking the same pair twice does not create a duplicate connection', async () => {
    render(<EvidenceWallStage stage={STAGE} sessionContext={SESSION_CONTEXT} onSubmit={vi.fn()} />)

    // First connection
    fireEvent.click(screen.getByTestId('evidence-card-item-a'))
    fireEvent.click(screen.getByTestId('evidence-card-item-b'))

    // Attempt duplicate (reversed direction)
    fireEvent.click(screen.getByTestId('evidence-card-item-b'))
    fireEvent.click(screen.getByTestId('evidence-card-item-a'))

    await waitFor(() => {
      expect(screen.getAllByTestId('red-string-committed').length).toBe(1)
    })
  })

  it('clicking a committed string removes the connection', async () => {
    render(<EvidenceWallStage stage={STAGE} sessionContext={SESSION_CONTEXT} onSubmit={vi.fn()} />)

    // Create connection
    fireEvent.click(screen.getByTestId('evidence-card-item-a'))
    fireEvent.click(screen.getByTestId('evidence-card-item-b'))

    await waitFor(() => screen.getByTestId('red-string-committed'))

    // Remove connection by clicking the string
    fireEvent.click(screen.getByTestId('red-string-committed'))

    await waitFor(() => {
      expect(screen.queryAllByTestId('red-string-committed').length).toBe(0)
    })
  })

  it('submitting with 0 connections calls onSubmit with empty array', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<EvidenceWallStage stage={STAGE} sessionContext={SESSION_CONTEXT} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByTestId('submit-analysis-btn'))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ connections: [] })
    })
  })

  it('submitting with connections calls onSubmit with the correct payload', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<EvidenceWallStage stage={STAGE} sessionContext={SESSION_CONTEXT} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByTestId('evidence-card-item-a'))
    fireEvent.click(screen.getByTestId('evidence-card-item-c'))

    await waitFor(() => screen.getByTestId('red-string-committed'))

    fireEvent.click(screen.getByTestId('submit-analysis-btn'))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        connections: [{ fromItemId: 'item-a', toItemId: 'item-c' }],
      })
    })
  })

  it('disables submit button while submitting', async () => {
    let resolveSubmit
    const onSubmit = vi.fn().mockReturnValue(new Promise(res => { resolveSubmit = res }))
    render(<EvidenceWallStage stage={STAGE} sessionContext={SESSION_CONTEXT} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByTestId('submit-analysis-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('submit-analysis-btn').disabled).toBe(true)
    })

    act(() => { resolveSubmit() })
  })

  it('shows inline error and re-enables button when onSubmit rejects', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('server error'))
    render(<EvidenceWallStage stage={STAGE} sessionContext={SESSION_CONTEXT} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByTestId('submit-analysis-btn'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined()
    })
    expect(screen.getByTestId('submit-analysis-btn').disabled).toBe(false)
  })

  it('priorResults are NOT auto-loaded (starts fresh)', () => {
    const stageWithPrior = {
      ...STAGE,
      payload: { ...STAGE.payload },
    }
    const sessionWithPrior = {
      ...SESSION_CONTEXT,
      priorResults: [{ fromItemId: 'item-a', toItemId: 'item-b' }],
    }
    render(<EvidenceWallStage stage={stageWithPrior} sessionContext={sessionWithPrior} onSubmit={vi.fn()} />)

    // Board should start with 0 connections even with priorResults
    const committed = screen.queryAllByTestId('red-string-committed')
    expect(committed.length).toBe(0)
  })

  it('renders the connection count in the header', async () => {
    render(<EvidenceWallStage stage={STAGE} sessionContext={SESSION_CONTEXT} onSubmit={vi.fn()} />)

    fireEvent.click(screen.getByTestId('evidence-card-item-a'))
    fireEvent.click(screen.getByTestId('evidence-card-item-b'))

    await waitFor(() => {
      expect(screen.getByText(/1\s*\/.*connections/i)).toBeDefined()
    })
  })

  it('renders the desktop grid (not the mobile corkboard) when viewport is wide', () => {
    render(<EvidenceWallStage stage={STAGE} sessionContext={SESSION_CONTEXT} onSubmit={vi.fn()} />)
    expect(screen.getByTestId('evidence-wall-board')).toBeDefined()
    expect(screen.queryByTestId('corkboard-view-mobile')).toBeNull()
  })

  it('renders the mobile corkboard when matchMedia reports mobile width', () => {
    // Override matchMedia so the hook reports mobile
    window.matchMedia = (query) => ({
      matches: query.includes('max-width'),
      media:   query,
      onchange: null,
      addEventListener:    () => {},
      removeEventListener: () => {},
      addListener:    () => {},
      removeListener: () => {},
      dispatchEvent:  () => false,
    })
    render(<EvidenceWallStage stage={STAGE} sessionContext={SESSION_CONTEXT} onSubmit={vi.fn()} />)
    expect(screen.getByTestId('corkboard-view-mobile')).toBeDefined()
    expect(screen.queryByTestId('evidence-wall-board')).toBeNull()
  })
})
