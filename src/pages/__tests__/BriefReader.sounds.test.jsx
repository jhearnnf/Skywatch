import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import BriefReader from '../BriefReader'

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock('../../../utils/sound', () => ({
  playSound: vi.fn(),
}))

vi.mock('react-router-dom', () => ({
  useParams: () => ({ briefId: 'brief123' }),
  useNavigate: () => vi.fn(),
  Link: ({ children }) => children,
}))

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ user: { _id: 'user1' }, API: '' }),
}))

vi.mock('../../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: vi.fn() }),
}))

vi.mock('../../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({ settings: { aircoinsPerBriefRead: 5 } }),
}))

vi.mock('../../../components/tutorial/TutorialModal', () => ({
  default: () => null,
}))

vi.mock('../../../components/UpgradePrompt', () => ({
  default: () => null,
}))

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

// ── Fixtures ──────────────────────────────────────────────────────────────

const MOCK_BRIEF = {
  _id: 'brief123',
  title: 'F-35 Lightning II',
  subtitle: 'Multi-role stealth fighter',
  category: 'Aircrafts',
  subcategory: 'Fighter Jets',
  descriptionSections: [
    'The F-35 Lightning II is a multirole combat aircraft with advanced stealth capabilities.',
    'It serves multiple NATO allies.',
  ],
  keywords: [
    { _id: 'kw1', keyword: 'stealth', generatedDescription: 'Ability to avoid radar detection' },
  ],
  sources: [],
  media: [],
}

function makeFetchOk(brief = MOCK_BRIEF) {
  return vi.fn().mockResolvedValue({
    status: 200,
    ok: true,
    json: async () => ({ data: { brief } }),
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('BriefReader — sound wiring', () => {
  let playSound

  beforeEach(async () => {
    playSound = (await import('../../../utils/sound')).playSound
    playSound.mockClear()
    // Clear session storage so sectionIdx starts at 0
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('plays intel_brief_opened exactly once when brief loads', async () => {
    global.fetch = makeFetchOk()

    render(<BriefReader />)

    await waitFor(() => {
      expect(playSound).toHaveBeenCalledWith('intel_brief_opened')
    })

    expect(playSound.mock.calls.filter(c => c[0] === 'intel_brief_opened')).toHaveLength(1)
  })

  it('does NOT play intel_brief_opened when mounting into completion screen post-login', async () => {
    sessionStorage.setItem('sw_brief_just_completed', 'brief123')
    global.fetch = makeFetchOk()

    render(<BriefReader />)
    await waitFor(() => screen.getByText('Brief Complete'))

    expect(playSound).not.toHaveBeenCalledWith('intel_brief_opened')
    sessionStorage.clear()
  })

  it('does NOT play intel_brief_opened before data arrives', () => {
    // fetch that never resolves
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {}))

    render(<BriefReader />)

    expect(playSound).not.toHaveBeenCalledWith('intel_brief_opened')
  })

  it('plays target_locked_keyword when a keyword is tapped', async () => {
    global.fetch = makeFetchOk()

    render(<BriefReader />)

    // Wait for the keyword button to appear
    await waitFor(() => screen.getByRole('button', { name: 'stealth' }))

    playSound.mockClear()

    // Click the keyword button
    fireEvent.click(screen.getByRole('button', { name: 'stealth' }))

    expect(playSound).toHaveBeenCalledWith('target_locked_keyword')
  })

  it('plays stand_down when keyword sheet is closed via "Got it" button', async () => {
    global.fetch = makeFetchOk()

    render(<BriefReader />)

    await waitFor(() => screen.getByRole('button', { name: 'stealth' }))

    // Open the keyword sheet
    fireEvent.click(screen.getByRole('button', { name: 'stealth' }))

    playSound.mockClear()

    // Close via "Got it" button
    const gotItBtn = screen.getByText(/got it/i)
    fireEvent.click(gotItBtn)

    expect(playSound).toHaveBeenCalledWith('stand_down')
  })

  it('plays stand_down when keyword sheet overlay is clicked', async () => {
    global.fetch = makeFetchOk()

    render(<BriefReader />)

    await waitFor(() => screen.getByRole('button', { name: 'stealth' }))

    // Open the keyword sheet
    fireEvent.click(screen.getByRole('button', { name: 'stealth' }))

    playSound.mockClear()

    // Click the background overlay (first fixed inset-0 div = backdrop)
    const backdrop = document.querySelector('.fixed.inset-0.z-50.bg-slate-900\\/40')
    if (backdrop) fireEvent.click(backdrop)

    expect(playSound).toHaveBeenCalledWith('stand_down')
  })

  it('does NOT play target_locked_keyword when kw is null (sheet close path)', async () => {
    global.fetch = makeFetchOk()

    render(<BriefReader />)

    await waitFor(() => screen.getByRole('button', { name: 'stealth' }))

    // Open then immediately close — closing calls handleKeywordTap with null
    fireEvent.click(screen.getByRole('button', { name: 'stealth' }))

    const callsBefore = playSound.mock.calls.filter(c => c[0] === 'target_locked_keyword').length

    const gotItBtn = screen.getByText(/got it/i)
    fireEvent.click(gotItBtn)

    const callsAfter = playSound.mock.calls.filter(c => c[0] === 'target_locked_keyword').length

    // No additional target_locked_keyword calls during close
    expect(callsAfter).toBe(callsBefore)
  })
})
