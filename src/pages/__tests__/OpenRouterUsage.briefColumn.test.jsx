import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import OpenRouterUsage from '../OpenRouterUsage'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user:     { _id: 'admin1', isAdmin: true },
    loading:  false,
    API:      '',
    apiFetch: (...args) => fetch(...args),
  }),
}))

vi.mock('../../components/SEO', () => ({ default: () => null }))

const MOCK_ROWS = {
  status: 'success',
  data: {
    rows: [
      {
        _id: 'row1',
        createdAt: '2026-04-22T10:00:00Z',
        key: 'main',
        feature: 'generate-quiz',
        briefId: { _id: 'brief-abc', title: 'Typhoon FGR4' },
        model: 'openai/gpt-4o',
        totalTokens: 1234,
        costUsd: 0.012,
      },
      {
        _id: 'row2',
        createdAt: '2026-04-22T09:00:00Z',
        key: 'main',
        feature: 'news-headlines',
        briefId: null,
        model: 'perplexity/sonar',
        totalTokens: 500,
        costUsd: 0.003,
      },
    ],
    totalCost:   0.015,
    totalCalls:  2,
    totalTokens: 1734,
    features:    ['generate-quiz', 'news-headlines'],
    nextCursor:  null,
  },
}

describe('OpenRouterUsage — Brief column', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => MOCK_ROWS,
    })
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('renders a Brief header column', async () => {
    render(<OpenRouterUsage />)
    await screen.findByText('Typhoon FGR4')
    expect(screen.getByRole('columnheader', { name: 'Brief' })).toBeInTheDocument()
  })

  it('renders the populated brief title as a clickable link and em-dash when null', async () => {
    render(<OpenRouterUsage />)
    await waitFor(() => expect(screen.getByText('Typhoon FGR4')).toBeInTheDocument())
    // News row has no brief — rendered as em-dash
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('clicking the brief title navigates to /admin with editBriefId state', async () => {
    render(<OpenRouterUsage />)
    await waitFor(() => expect(screen.getByText('Typhoon FGR4')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Typhoon FGR4'))
    expect(mockNavigate).toHaveBeenCalledWith('/admin', { state: { editBriefId: 'brief-abc' } })
  })
})
