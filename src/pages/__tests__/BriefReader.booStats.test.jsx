import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import BriefReader from '../BriefReader'

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../../utils/sound', () => ({ playSound: vi.fn(), stopAllSounds: vi.fn(), playGridRevealTone: vi.fn() }))

vi.mock('react-router-dom', () => ({
  useParams:   () => ({ briefId: 'brief123' }),
  useNavigate: () => vi.fn(), useLocation: () => ({ state: null, pathname: '/', search: '', hash: '' }),
  Link:        ({ children, to, ...rest }) => <a href={to} {...rest}>{children}</a>,
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user:          { _id: 'user1', loginStreak: 0 },
    API: '', apiFetch: (...args) => fetch(...args),
    awardAircoins: vi.fn(),
    setUser:       vi.fn(),
  }),
}))

vi.mock('../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: vi.fn() }),
}))

vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({ settings: { aircoinsPerBriefRead: 5 } }),
}))

vi.mock('../../components/tutorial/TutorialModal', () => ({ default: () => null }))
vi.mock('../../components/UpgradePrompt',          () => ({ default: () => null }))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, style, onClick, onDragEnd, drag }) => {
      if (drag === 'x' && onDragEnd) {
        return (
          <div className={className} style={style} onClick={onClick}>
            {children}
            <button data-testid="swipe-left"  onClick={() => onDragEnd(null, { offset: { x: -150, y: 0 }, velocity: { x: 0, y: 0 } })} />
            <button data-testid="swipe-right" onClick={() => onDragEnd(null, { offset: { x:  150, y: 0 }, velocity: { x: 0, y: 0 } })} />
          </div>
        )
      }
      return <div className={className} style={style} onClick={onClick}>{children}</div>
    },
    button: ({ children, className, onClick }) => <button className={className} onClick={onClick}>{children}</button>,
    p:      ({ children, className })          => <p className={className}>{children}</p>,
  },
  AnimatePresence:      ({ children }) => <>{children}</>,
  LayoutGroup:          ({ children }) => <>{children}</>,
  useMotionValue:       () => ({ set: vi.fn(), get: () => 0 }),
  useTransform:         () => 0,
  useAnimationControls: () => ({ start: vi.fn() }),
}))

// ── Helpers ────────────────────────────────────────────────────────────────

function makeBrief(category, gameData = null) {
  // Four sections so sectionIdx 0–2 are non-last (show SectionCard with stat row),
  // and section 3 is isLast (FlashCard). Aircrafts can have up to 3 stats mapped
  // to stats[0], stats[1], stats[2] — one per section index.
  return {
    _id:                 'brief123',
    title:               'Test Brief',
    subtitle:            '',
    category,
    descriptionSections: ['Section 1.', 'Section 2.', 'Section 3.', 'Flashcard section.'],
    keywords:            [],
    sources:             [],
    media:               [],
    gameData,
  }
}

function setupFetch(brief, readRecord = null) {
  global.fetch = vi.fn().mockImplementation((url) => {
    if (url.includes('battle-of-order/options'))
      return Promise.resolve({ ok: true, json: async () => ({ data: { available: false } }) })
    if (url.includes('quiz/status'))
      return Promise.resolve({ ok: true, json: async () => ({ data: { hasCompleted: false } }) })
    return Promise.resolve({ ok: true, json: async () => ({ data: { brief, readRecord, ammoMax: 3 } }) })
  })
}

// ── Aircrafts ──────────────────────────────────────────────────────────────

describe('BriefReader — BOO stats: Aircrafts', () => {
  beforeEach(() => { sessionStorage.clear(); localStorage.clear() })
  afterEach(() => { vi.restoreAllMocks() })

  it('shows Top Speed (km/h and mph) on section 0', async () => {
    // stats[0] = topSpeed — visible at section 0 (default start)
    setupFetch(makeBrief('Aircrafts', { topSpeedKph: 2200, yearIntroduced: 2003, yearRetired: null }))
    render(<BriefReader />)
    await waitFor(() => screen.getByText('Test Brief'))
    expect(screen.getByText(/2,200 km\/h/)).toBeDefined()
    expect(screen.getByText(/1,366 mph/)).toBeDefined()
  })

  it('shows Introduced year on section 1', async () => {
    // stats[1] = yearIntroduced — pass readRecord.currentSection=1 to start there
    setupFetch(
      makeBrief('Aircrafts', { topSpeedKph: 2200, yearIntroduced: 2003, yearRetired: null }),
      { currentSection: 1, completed: false },
    )
    render(<BriefReader />)
    await waitFor(() => screen.getByText('Test Brief'))
    expect(screen.getByText('2003')).toBeDefined()
  })

  it('shows "In Service" status on section 2', async () => {
    // stats[2] = status — pass readRecord.currentSection=2 to start there
    setupFetch(
      makeBrief('Aircrafts', { topSpeedKph: 2200, yearIntroduced: 2003, yearRetired: null }),
      { currentSection: 2, completed: false },
    )
    render(<BriefReader />)
    await waitFor(() => screen.getByText('Test Brief'))
    expect(screen.getByText('In Service')).toBeDefined()
  })

  it('shows "Retired YEAR" when yearRetired is set', async () => {
    // stats[2] = status — pass readRecord.currentSection=2 to start there
    setupFetch(
      makeBrief('Aircrafts', { topSpeedKph: 1800, yearIntroduced: 1976, yearRetired: 2019 }),
      { currentSection: 2, completed: false },
    )
    render(<BriefReader />)
    await waitFor(() => screen.getByText('Test Brief'))
    expect(screen.getByText('Retired 2019')).toBeDefined()
  })

  it('omits Top Speed row when topSpeedKph is missing', async () => {
    setupFetch(makeBrief('Aircrafts', { yearIntroduced: 2003 }))
    render(<BriefReader />)
    await waitFor(() => screen.getByText('Test Brief'))
    expect(screen.queryByText(/km\/h/)).toBeNull()
    expect(screen.getByText('2003')).toBeDefined()
  })

  it('does not render the panel when gameData is null', async () => {
    setupFetch(makeBrief('Aircrafts', null))
    render(<BriefReader />)
    await waitFor(() => screen.getByText('Test Brief'))
    expect(screen.queryByText(/battle data/i)).toBeNull()
  })

  it('does not render the panel when gameData has no relevant fields', async () => {
    setupFetch(makeBrief('Aircrafts', {}))
    render(<BriefReader />)
    await waitFor(() => screen.getByText('Test Brief'))
    expect(screen.queryByText(/battle data/i)).toBeNull()
  })
})

// ── Ranks ──────────────────────────────────────────────────────────────────

describe('BriefReader — BOO stats: Ranks', () => {
  beforeEach(() => { sessionStorage.clear() })
  afterEach(() => { vi.restoreAllMocks() })

  it('shows seniority rank for a Ranks brief', async () => {
    setupFetch(makeBrief('Ranks', { rankHierarchyOrder: 3 }))
    render(<BriefReader />)
    await waitFor(() => screen.getByText('Test Brief'))
    expect(screen.getByText('#3')).toBeDefined()
  })

  it('appends "Most Senior" label for rank #1', async () => {
    setupFetch(makeBrief('Ranks', { rankHierarchyOrder: 1 }))
    render(<BriefReader />)
    await waitFor(() => screen.getByText('Test Brief'))
    expect(screen.getByText(/#1.*Most Senior/)).toBeDefined()
  })
})

// ── Training ───────────────────────────────────────────────────────────────

describe('BriefReader — BOO stats: Training', () => {
  beforeEach(() => { sessionStorage.clear() })
  afterEach(() => { vi.restoreAllMocks() })

  it('shows week range for a Training brief', async () => {
    setupFetch(makeBrief('Training', { trainingWeekStart: 1, trainingWeekEnd: 12 }))
    render(<BriefReader />)
    await waitFor(() => screen.getByText('Test Brief'))
    expect(screen.getByText('Week 1 – Week 12')).toBeDefined()
  })

  it('does not render the panel when week data is missing', async () => {
    setupFetch(makeBrief('Training', {}))
    render(<BriefReader />)
    await waitFor(() => screen.getByText('Test Brief'))
    expect(screen.queryByText(/battle data/i)).toBeNull()
  })
})

// ── Missions / Tech / Treaties ─────────────────────────────────────────────

describe('BriefReader — BOO stats: Missions / Tech / Treaties', () => {
  beforeEach(() => { sessionStorage.clear() })
  afterEach(() => { vi.restoreAllMocks() })

  it('shows start–end year period for a Missions brief', async () => {
    setupFetch(makeBrief('Missions', { startYear: 2001, endYear: 2014 }))
    render(<BriefReader />)
    await waitFor(() => screen.getByText('Test Brief'))
    expect(screen.getByText('2001 – 2014')).toBeDefined()
  })

  it('shows "Present" when endYear is null (ongoing)', async () => {
    setupFetch(makeBrief('Tech', { startYear: 2010, endYear: null }))
    render(<BriefReader />)
    await waitFor(() => screen.getByText('Test Brief'))
    expect(screen.getByText('2010 – Present')).toBeDefined()
  })

  it('shows period for Treaties category', async () => {
    setupFetch(makeBrief('Treaties', { startYear: 1949, endYear: null }))
    render(<BriefReader />)
    await waitFor(() => screen.getByText('Test Brief'))
    expect(screen.getByText('1949 – Present')).toBeDefined()
  })
})

// ── Non-BOO categories ─────────────────────────────────────────────────────

describe('BriefReader — BOO stats: non-BOO categories', () => {
  beforeEach(() => { sessionStorage.clear() })
  afterEach(() => { vi.restoreAllMocks() })

  it('does not render the panel for a News brief even with gameData', async () => {
    setupFetch(makeBrief('News', { startYear: 2020 }))
    render(<BriefReader />)
    await waitFor(() => screen.getByText('Test Brief'))
    expect(screen.queryByText(/battle data/i)).toBeNull()
  })
})
