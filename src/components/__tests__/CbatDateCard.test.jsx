import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatDateCard from '../CbatDateCard'

// The test-date card at the top of the Profile page. Wording is driven by the
// server's `testName` so a Canadian sees CFAST and never CBAT; the card hides
// itself for anyone who has already passed, and shrinks to a one-liner with
// an Open group link once a date is locked.

const mockUseAuth     = vi.hoisted(() => vi.fn())
const mockUseSettings = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }) => <a href={to}>{children}</a>,
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../context/AppSettingsContext', () => ({ useAppSettings: mockUseSettings }))

const USER = { _id: 'u1', agentNumber: '1234567' }

function mount({ group, user = USER, settings = {} } = {}) {
  const apiFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'success', data: group }) })
  mockUseAuth.mockReturnValue({ user, API: '', apiFetch })
  mockUseSettings.mockReturnValue({ settings, loading: false })
  render(<CbatDateCard />)
  return apiFetch
}

describe('CbatDateCard', () => {
  beforeEach(() => { vi.clearAllMocks() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('asks a UK applicant for a CBAT date and says what the group is for', async () => {
    mount({ group: { configured: false, applicable: true, regionAvailable: true, region: 'GB', testName: 'CBAT' } })
    expect(await screen.findByLabelText('Upcoming CBAT date')).toBeTruthy()
    const card = screen.getByTestId('cbat-date-card')
    expect(card.textContent).toContain('Private CBAT group')
    expect(card.textContent).toMatch(/private group chat with everyone sitting the CBAT on your date/i)
    expect(card.textContent).toMatch(/Nobody else can see it/)
    expect(card.textContent).not.toMatch(/[—–]/)
  })

  it('names the CFAST for a Canadian and never says CBAT', async () => {
    mount({ group: { configured: false, applicable: true, regionAvailable: true, region: 'CA', testName: 'CFAST' } })
    expect(await screen.findByLabelText('Upcoming CFAST date')).toBeTruthy()
    expect(screen.getByTestId('cbat-date-card').textContent).not.toContain('CBAT')
  })

  it('names the MACTS for an Australian', async () => {
    mount({ group: { configured: false, applicable: true, regionAvailable: true, region: 'AU', testName: 'MACTS' } })
    expect(await screen.findByLabelText('Upcoming MACTS date')).toBeTruthy()
  })

  it('uses a plain phrase where the region has no single test name', async () => {
    mount({ group: { configured: false, applicable: true, regionAvailable: true, region: 'NZ', testName: null } })
    expect(await screen.findByLabelText('Upcoming test date')).toBeTruthy()
    expect(screen.getByTestId('cbat-date-card').textContent).not.toContain('CBAT')
  })

  it('renders nothing for someone who has already passed, or when chat is off', async () => {
    const apiFetch = mount({ group: { configured: false, applicable: false, regionAvailable: true, testName: 'CBAT' } })
    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    expect(screen.queryByTestId('cbat-date-card')).toBeNull()

    const off = mount({ group: { configured: false, applicable: true, regionAvailable: true, testName: 'CBAT' }, settings: { chatEnabled: false } })
    expect(off).not.toHaveBeenCalled()
    expect(screen.queryByTestId('cbat-date-card')).toBeNull()
  })

  it('shows the locked date and a link to the group once configured', async () => {
    mount({ group: { configured: true, date: '2099-10-14', region: 'CA', testName: 'CFAST', conversationId: 'c1', memberCount: 4 } })
    expect(await screen.findByText('14 October 2099')).toBeTruthy()
    expect(screen.getByText('Your CFAST date')).toBeTruthy()
    expect(screen.getByText('4 people in your group')).toBeTruthy()
    expect(screen.getByText('Open group').getAttribute('href')).toBe('/chat/c1')
    expect(screen.queryByLabelText(/Upcoming/)).toBeNull()
  })

  it('warns before Continue, confirms, then posts the date and collapses', async () => {
    mount({ group: { configured: false, applicable: true, regionAvailable: true, region: 'GB', testName: 'CBAT' } })
    const posted = []
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url, opts) => {
      posted.push({ url, body: JSON.parse(opts.body) })
      return Promise.resolve({ ok: true, json: async () => ({ data: { configured: true, date: '2099-10-14', region: 'GB', testName: 'CBAT', conversationId: 'c9', memberCount: 1 } }) })
    }))

    const input = await screen.findByLabelText('Upcoming CBAT date')
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.change(input, { target: { value: '2099-10-14' } })
    expect(screen.getByRole('alert').textContent).toContain('Choose carefully. You cannot change this date.')

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText('Confirm your CBAT date')).toBeTruthy()
    expect(screen.getByText('14 October 2099')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm and join' }))
    expect(await screen.findByText('Open group')).toBeTruthy()
    expect(posted).toEqual([{ url: '/api/chat/cbat-group', body: { date: '2099-10-14' } }])
    expect(screen.getByText('1 person in your group')).toBeTruthy()
  })
})
