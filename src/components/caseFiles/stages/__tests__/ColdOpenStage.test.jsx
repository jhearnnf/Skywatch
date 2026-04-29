import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import ColdOpenStage from '../ColdOpenStage.jsx'

// ── Mock framer-motion ────────────────────────────────────────────────────────
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, style, initial, animate, transition, ...rest }) => (
      <div className={className} style={style} {...rest}>{children}</div>
    ),
    p: ({ children, className, style, initial, animate, transition, ...rest }) => (
      <p className={className} style={style} {...rest}>{children}</p>
    ),
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────
const STAGE = {
  id:   'ch1-cold-open',
  type: 'cold_open',
  payload: {
    dateLabel:        '14 APR 2026',
    directorBriefing: 'You have been activated.',
    startingItems: [
      {
        id:           'start-01',
        title:        'Passport Scan',
        thumbnailUrl: null,
        imageCredit:  null,
        oneLineHint:  'Look at the entry stamps',
      },
    ],
  },
}

const SESSION_CONTEXT = {
  caseSlug:    'test-case',
  chapterSlug: 'ch1',
  sessionId:   'sess-abc',
  priorResults: [],
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('ColdOpenStage', () => {

  it('renders the "Begin Briefing" button immediately', () => {
    render(
      <ColdOpenStage stage={STAGE} sessionContext={SESSION_CONTEXT} onSubmit={vi.fn()} />
    )
    expect(screen.getByTestId('begin-briefing-btn')).toBeDefined()
    expect(screen.getByText('Begin Briefing')).toBeDefined()
  })

  it('calls onSubmit with { completed: true } when button is clicked', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <ColdOpenStage stage={STAGE} sessionContext={SESSION_CONTEXT} onSubmit={onSubmit} />
    )
    fireEvent.click(screen.getByTestId('begin-briefing-btn'))
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ completed: true })
    })
  })

  it('disables the button while submitting', async () => {
    let resolveSubmit
    const onSubmit = vi.fn().mockReturnValue(new Promise(res => { resolveSubmit = res }))
    render(
      <ColdOpenStage stage={STAGE} sessionContext={SESSION_CONTEXT} onSubmit={onSubmit} />
    )
    fireEvent.click(screen.getByTestId('begin-briefing-btn'))
    await waitFor(() => {
      expect(screen.getByTestId('begin-briefing-btn').disabled).toBe(true)
    })
    // Clean up the pending promise
    act(() => { resolveSubmit() })
  })

  it('shows inline error and re-enables button when onSubmit rejects', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('server error'))
    render(
      <ColdOpenStage stage={STAGE} sessionContext={SESSION_CONTEXT} onSubmit={onSubmit} />
    )
    fireEvent.click(screen.getByTestId('begin-briefing-btn'))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined()
    })
    expect(screen.getByTestId('begin-briefing-btn').disabled).toBe(false)
  })

  it('renders the DIRECTOR BRIEFING label', () => {
    render(
      <ColdOpenStage stage={STAGE} sessionContext={SESSION_CONTEXT} onSubmit={vi.fn()} />
    )
    // The classified-tag with "DIRECTOR BRIEFING" is always present
    expect(screen.getByText('DIRECTOR BRIEFING')).toBeDefined()
  })

  it('renders starting item title (INITIAL EVIDENCE section)', () => {
    render(
      <ColdOpenStage stage={STAGE} sessionContext={SESSION_CONTEXT} onSubmit={vi.fn()} />
    )
    // The starting item title and section header should be present immediately
    expect(screen.getByText('INITIAL EVIDENCE')).toBeDefined()
    expect(screen.getByText('Passport Scan')).toBeDefined()
  })

  it('handles missing payload gracefully', () => {
    const emptyStage = { id: 'x', type: 'cold_open', payload: {} }
    expect(() =>
      render(<ColdOpenStage stage={emptyStage} sessionContext={SESSION_CONTEXT} onSubmit={vi.fn()} />)
    ).not.toThrow()
  })

  it('handles empty startingItems array', () => {
    const stage = { ...STAGE, payload: { ...STAGE.payload, startingItems: [] } }
    expect(() =>
      render(<ColdOpenStage stage={stage} sessionContext={SESSION_CONTEXT} onSubmit={vi.fn()} />)
    ).not.toThrow()
    // INITIAL EVIDENCE section should not appear
    expect(screen.queryByText('INITIAL EVIDENCE')).toBeNull()
  })
})
