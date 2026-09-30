import { describe, it, expect, afterEach } from 'vitest'
import {
  setActiveMock, getActiveMock, mockIdFor, nextGameKey, mockGamePath, mockGamePathname, hasTutorial,
  breakEndsAt, estimatedFinish, formatDuration, mockSummary, MOCK_CONFIG, MOCK_HTML_ATTR,
} from '../cbatMockSession'

const MIN = 60 * 1000

const mock = (over = {}) => ({
  id: 'm1',
  status: 'active',
  currentStep: 0,
  breakAfter: [],
  breakStartedAt: null,
  steps: [
    { codes: ['FLAG'], gameKeys: ['flag'], minutes: 2, played: [], done: false },
    { codes: ['VISS'], gameKeys: ['visualisation-2d', 'visualisation-3d'], minutes: 4, played: [], done: false },
    { codes: ['CUT'], gameKeys: ['cut'], minutes: 4, played: [], done: false },
  ],
  ...over,
})

afterEach(() => setActiveMock(null))

describe('the active mock', () => {
  it('marks <html> while a mock runs and clears it after', () => {
    setActiveMock(mock())
    expect(document.documentElement.hasAttribute(MOCK_HTML_ATTR)).toBe(true)
    setActiveMock(null)
    expect(document.documentElement.hasAttribute(MOCK_HTML_ATTR)).toBe(false)
  })

  it('only ever holds an ACTIVE mock', () => {
    setActiveMock(mock({ status: 'completed' }))
    expect(getActiveMock()).toBeNull()
  })

  it('stamps the mock id only on the run the mock is waiting for', () => {
    setActiveMock(mock())
    expect(mockIdFor('flag')).toBe('m1')
    expect(mockIdFor('cut')).toBeNull()
    setActiveMock(null)
    expect(mockIdFor('flag')).toBeNull()
  })

  it('works through a two-game step one half at a time', () => {
    const m = mock({ currentStep: 1 })
    expect(nextGameKey(m)).toBe('visualisation-2d')
    m.steps[1].played = ['visualisation-2d']
    expect(nextGameKey(m)).toBe('visualisation-3d')
  })
})

describe('where each test is played', () => {
  it('opens a split game on Hard and a multi-mode page on the right board', () => {
    expect(mockGamePath('flag')).toBe('/cbat/flag?difficulty=hard')
    expect(mockGamePath('ant-hard')).toBe('/cbat/ant?difficulty=hard')
    expect(mockGamePath('trace-1')).toBe('/cbat/trace?mode=trace1')
    expect(mockGamePath('visualisation-3d')).toBe('/cbat/visualisation?mode=3d')
    expect(mockGamePath('instruments')).toBe('/cbat/instruments?mode=reading')
    expect(mockGamePath('instruments-orientation')).toBe('/cbat/instruments?mode=orientation')
  })

  it('adds the tutorial flag on the end of whatever is there', () => {
    expect(mockGamePath('flag', { tutorial: true })).toBe('/cbat/flag?difficulty=hard&tutorial=1')
    expect(mockGamePath('target', { tutorial: true })).toBe('/cbat/target?tutorial=1')
    expect(mockGamePathname('trace-2')).toBe('/cbat/trace')
  })

  it('offers "Tutorial first" only where a tutorial exists', () => {
    expect(hasTutorial('cut')).toBe(true)
    expect(hasTutorial('dpt-hard')).toBe(true)
    expect(hasTutorial('rtt')).toBe(false)
  })
})

describe('the clock', () => {
  const now = new Date('2026-09-27T14:00:00Z')

  it('adds up every test to come and every break still ahead', () => {
    const m = mock({ breakAfter: [0] })
    // 2 + 4 + 4 minutes of tests, one break of breakMinutes.
    const expected = now.getTime() + (10 + MOCK_CONFIG.breakMinutes) * MIN
    expect(estimatedFinish(m, now).getTime()).toBe(expected)
  })

  it('counts only what is left of the break the player is on', () => {
    const started = new Date(now.getTime() - 4 * MIN)
    const m = mock({ currentStep: 1, breakAfter: [0], breakStartedAt: started.toISOString() })
    expect(breakEndsAt(m).getTime()).toBe(started.getTime() + MOCK_CONFIG.breakMinutes * MIN)
    const left = (MOCK_CONFIG.breakMinutes - 4) * MIN
    expect(estimatedFinish(m, now).getTime()).toBe(now.getTime() + left + 8 * MIN)
  })

  it('writes durations the way the start page says them', () => {
    expect(formatDuration(45)).toBe('45 min')
    expect(formatDuration(60)).toBe('1 hr')
    expect(formatDuration(65.4)).toBe('1 hr 5 min')
  })
})

describe('mockSummary (the /cbat card)', () => {
  it('counts a role\'s tests once each, dropping any with no game', () => {
    expect(mockSummary('pilot').tests).toBe(15)
    // Intelligence lists eight tests, all with a game.
    expect(mockSummary('intelligence').tests).toBe(8)
    // WSOP Linguist lists RCOG, which has no game.
    expect(mockSummary('wsop-linguist').tests).toBe(8)
  })

  it('builds a Canadian role from the UK role it borrows', () => {
    // Pilot less DAD (not on the CFAST list), CLAN in place of FLAG.
    expect(mockSummary('rcaf-pilot').tests).toBe(14)
  })

  it('includes the breaks in the time', () => {
    const s = mockSummary('pilot')
    expect(s.minutes).toBeGreaterThan(60)
  })
})
