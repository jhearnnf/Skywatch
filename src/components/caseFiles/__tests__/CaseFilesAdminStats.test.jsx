import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CaseFilesAdminStats from '../CaseFilesAdminStats'

const daily = Array.from({ length: 14 }, (_, i) => ({
  date: `2026-09-${String(12 + i).padStart(2, '0')}`,
  starts: i === 13 ? 4 : i % 3,
  completions: i === 13 ? 2 : 0,
  players: i === 13 ? 3 : i % 3,
}))

const STATS = {
  generatedAt: '2026-09-25T12:00:00Z',
  days: 14,
  totals: {
    runsStarted: 20, runsCompleted: 12, runsAbandoned: 3, runsInProgress: 5, completionRate: 0.6,
    players: 9, finishers: 7, repeatPlayers: 2, runsLast7d: 8, playersLast7d: 5,
    medianMinutes: 31.5, longRuns: 1, interested: 6,
  },
  daily,
  chapters: [{
    caseSlug: 'russia-ukraine', chapterSlug: 'road-to-invasion', title: 'Road to Invasion',
    starts: 20, completions: 12, players: 9, completionRate: 0.6,
    avgScore: 540, medianScore: 560, bestScore: 665, maxScore: 800, medianMinutes: 31.5, avgQuestions: 4.2,
    funnel: [
      { stageIndex: 0, stageType: 'cold_open', reached: 20 },
      { stageIndex: 1, stageType: 'evidence_wall', reached: 16 },
    ],
    stageScores: [{ stageType: 'evidence_wall', avgPct: 0.72 }],
  }],
  topScores: [
    { userId: 'u1', agentNumber: '1234567', displayName: 'Maverick', caseSlug: 'russia-ukraine', chapterSlug: 'road-to-invasion', score: 665, minutes: 28, completedAt: '2026-09-24T10:00:00Z' },
    { userId: 'u2', agentNumber: '7654321', displayName: null, caseSlug: 'russia-ukraine', chapterSlug: 'road-to-invasion', score: 600, minutes: 35, completedAt: '2026-09-23T10:00:00Z' },
  ],
  interest: [{ caseSlug: 'russia-ukraine', chapterSlug: 'road-to-invasion', teaserTitle: 'Battle of Kyiv', interested: 6, withdrawn: 1 }],
}

beforeEach(() => {
  globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: STATS }) }))
})
afterEach(() => vi.restoreAllMocks())

// The longer sections start folded in the Admin tools window; open one by its heading.
const open = async (title) => fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${title}`) }))

describe('CaseFilesAdminStats', () => {
  it('shows the headline numbers', async () => {
    render(<CaseFilesAdminStats API="" />)
    await waitFor(() => screen.getByTestId('cf-stat-players'))
    expect(screen.getByTestId('cf-stat-players').textContent).toMatch(/9/)
    expect(screen.getByTestId('cf-stat-completion').textContent).toMatch(/60%/)
    expect(screen.getByTestId('cf-stat-playtime').textContent).toMatch(/32 min/)
    expect(screen.getByTestId('cf-stat-interest').textContent).toMatch(/6/)
  })

  it('draws the funnel as a share of runs started', async () => {
    render(<CaseFilesAdminStats API="" />)
    await open('By chapter')
    const block = await screen.findByTestId('cf-stats-chapter-road-to-invasion')
    expect(block.textContent).toMatch(/Evidence Wall/)
    expect(block.textContent).toMatch(/16 · 80%/)
    expect(block.textContent).toMatch(/72%/)
  })

  it('names top runs by display name, falling back to agent number', async () => {
    render(<CaseFilesAdminStats API="" />)
    await open('Top runs')
    const table = await screen.findByTestId('cf-stats-top')
    expect(table.textContent).toMatch(/Maverick/)
    expect(table.textContent).toMatch(/Agent 7654321/)
    // Chapter sits under the name, as the window has no room for it as a column.
    expect(table.textContent).toMatch(/road-to-invasion/)
  })

  it('shows interest per teaser', async () => {
    render(<CaseFilesAdminStats API="" />)
    await open('Interest in the next chapter')
    const box = await screen.findByTestId('cf-stats-interest')
    expect(box.textContent).toMatch(/Battle of Kyiv/)
    expect(box.textContent).toMatch(/6 interested/)
    expect(box.textContent).toMatch(/1 changed their mind/)
  })

  it('explains a day on hover', async () => {
    render(<CaseFilesAdminStats API="" />)
    const chart = await screen.findByTestId('cf-stats-activity')
    const bars = chart.querySelectorAll('[tabindex="0"]')
    fireEvent.mouseEnter(bars[bars.length - 1])
    expect(screen.getByRole('tooltip').textContent).toMatch(/4 started · 2 finished/)
  })

  it('says so when the stats fail to load, and can retry', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500 }))
    render(<CaseFilesAdminStats API="" />)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/could not load/i))
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ data: STATS }) }))
    fireEvent.click(screen.getByTestId('cf-stats-refresh'))
    await waitFor(() => screen.getByTestId('cf-stat-players'))
  })

  it('opens with the headline numbers and the chart showing, and the long sections folded', async () => {
    render(<CaseFilesAdminStats API="" />)
    await screen.findByTestId('cf-stat-players')
    expect(screen.getByTestId('cf-stats-activity')).toBeDefined()
    expect(screen.queryByTestId('cf-stats-chapter-road-to-invasion')).toBeNull()
    expect(screen.queryByTestId('cf-stats-top')).toBeNull()
    expect(screen.queryByTestId('cf-stats-interest')).toBeNull()
  })
})
