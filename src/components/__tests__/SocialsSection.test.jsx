import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import SocialsSection from '../admin/SocialsSection'

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockSetSearchParams = vi.fn()
let mockSearchParams = new URLSearchParams()

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [mockSearchParams, mockSetSearchParams],
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    apiFetch: (...args) => fetch(...args),
  }),
}))

// ── Fetch helper ───────────────────────────────────────────────────────────

function jsonResp(body, ok = true, status = 200) {
  return Promise.resolve({
    ok, status,
    json: () => Promise.resolve(body),
  })
}

const STATUS_CONNECTED = {
  configured: true, missing: [], connected: true,
  username: 'skywatch_uk', expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  scopes: ['tweet.write'],
}

const STATUS_DISCONNECTED = {
  configured: true, missing: [], connected: false, username: null, expiresAt: null, scopes: [],
}

const STATUS_NOT_CONFIGURED = {
  configured: false, missing: ['X_CLIENT_ID', 'SOCIAL_TOKEN_KEY'], connected: false,
}

const BRIEFS = [
  { _id: 'b1', title: 'Eurofighter Typhoon',  category: 'Aircrafts' },
  { _id: 'b2', title: 'Tornado GR4',          category: 'Aircrafts' },
]

const LATEST_NEWS = { _id: 'n1', title: 'Today News Headline', category: 'News', isFreshToday: true }

// Fixture used by the news-brief ordering test. Three News briefs with mixed
// eventDates plus a non-News brief without one, to verify the dropdown is
// sorted latest event first and undated briefs sink to the bottom.
const NEWS_SORT_BRIEFS = [
  { _id: 'old',    title: 'Older News',  category: 'News',      eventDate: '2026-01-10T00:00:00Z' },
  { _id: 'mid',    title: 'Mid News',    category: 'News',      eventDate: '2026-03-15T00:00:00Z' },
  { _id: 'recent', title: 'Recent News', category: 'News',      eventDate: '2026-04-20T00:00:00Z' },
  { _id: 'plane',  title: 'Some Plane',  category: 'Aircrafts', dateAdded:  '2026-04-25T00:00:00Z' },
]

const LATEST_NEWS_SORT = {
  _id: 'recent', title: 'Recent News', category: 'News',
  eventDate: '2026-04-20T00:00:00Z', isFreshToday: false,
}

// Brief with a populated media URL — used by the include-image preview test.
const BRIEF_WITH_IMAGE = {
  _id: 'withimg', title: 'Imaged News', category: 'News',
  eventDate: '2026-04-22T00:00:00Z',
  media: [{ mediaUrl: 'https://example.com/news.jpg', name: 'F-35 over Akrotiri' }],
}

// Default fetch router for the component's GET requests
function defaultRouter(status = STATUS_CONNECTED, posts = []) {
  return (url, opts) => {
    const u = String(url)
    const method = (opts?.method || 'GET').toUpperCase()
    if (u.endsWith('/api/admin/social/x/status')) return jsonResp(status)
    if (u.endsWith('/api/admin/social/briefs-for-recon')) return jsonResp({ data: BRIEFS })
    if (u.endsWith('/api/admin/social/latest-news-brief')) return jsonResp({ data: LATEST_NEWS })
    if (u.includes('/api/admin/social/posts')) return jsonResp({ data: posts })
    if (method === 'POST' && u.endsWith('/api/admin/social/x/draft')) {
      return jsonResp({ data: { text: 'Drafted tweet!', poll: null, sourceMeta: { briefName: 'Eurofighter Typhoon' }, suggestedImageUrl: 'https://img/x.jpg', briefName: 'Eurofighter Typhoon' } })
    }
    if (method === 'POST' && u.endsWith('/api/admin/social/x/publish')) {
      return jsonResp({ status: 'ok', data: { _id: 'sp1', status: 'posted', externalPostUrl: 'https://x.com/skywatch_uk/status/1' } })
    }
    if (method === 'GET' && u.endsWith('/api/admin/social/x/connect')) {
      return jsonResp({ authorizeUrl: 'https://x.com/i/oauth2/authorize?fake=1' })
    }
    if (method === 'DELETE' && u.endsWith('/api/admin/social/x/disconnect')) {
      return jsonResp({ status: 'ok' })
    }
    return jsonResp({})
  }
}

// ── Setup ──────────────────────────────────────────────────────────────────

const originalFetch = global.fetch

beforeEach(() => {
  mockSearchParams = new URLSearchParams()
  mockSetSearchParams.mockClear()
  global.fetch = vi.fn().mockImplementation(defaultRouter())
})
afterEach(() => {
  // Keep the mock installed across cleanup so any trailing async loadStatus
  // calls scheduled by React's effects still get a mocked response instead of
  // hitting the real network with a relative URL.
  global.fetch = vi.fn().mockImplementation(defaultRouter())
})
afterAll(() => { global.fetch = originalFetch })

// ── Tests ──────────────────────────────────────────────────────────────────

describe('SocialsSection — render + collapse', () => {
  it('renders the Socials heading and starts collapsed', async () => {
    render(<SocialsSection API="" />)
    expect(screen.getByText('Socials')).toBeInTheDocument()
    expect(screen.queryByText('X.com')).toBeNull()
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/admin/social/x/status'),
      expect.anything(),
    ))
  })

  it('expands the X.com panel on click', async () => {
    render(<SocialsSection API="" />)
    fireEvent.click(screen.getByText('Socials'))
    expect(screen.getByText('X.com')).toBeInTheDocument()
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/admin/social/briefs-for-recon'),
      expect.anything(),
    ))
  })
})

describe('SocialsSection — connection states', () => {
  it('shows the Connect CTA when no account is connected', async () => {
    global.fetch = vi.fn().mockImplementation(defaultRouter(STATUS_DISCONNECTED))
    render(<SocialsSection API="" />)
    fireEvent.click(screen.getByText('Socials'))
    await screen.findByText('Connect X account')
  })

  it('shows the username + Disconnect when connected', async () => {
    render(<SocialsSection API="" />)
    fireEvent.click(screen.getByText('Socials'))
    await screen.findByText('@skywatch_uk')
    expect(screen.getByText('Disconnect')).toBeInTheDocument()
  })

  it('shows config error when env is missing', async () => {
    global.fetch = vi.fn().mockImplementation(defaultRouter(STATUS_NOT_CONFIGURED))
    render(<SocialsSection API="" />)
    fireEvent.click(screen.getByText('Socials'))
    await waitFor(() => expect(screen.getByText(/Not configured/)).toBeInTheDocument())
    expect(screen.getByText(/X_CLIENT_ID/)).toBeInTheDocument()
  })
})

describe('SocialsSection — form behaviour', () => {
  it('changing post type to brand-transparency hides the brief picker', async () => {
    render(<SocialsSection API="" />)
    fireEvent.click(screen.getByText('Socials'))
    await screen.findByTestId('post-type-select')
    expect(screen.getByTestId('brief-select')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('post-type-select'), { target: { value: 'brand-transparency' } })
    expect(screen.queryByTestId('brief-select')).toBeNull()
  })

  it('tone slider updates the label', async () => {
    render(<SocialsSection API="" />)
    fireEvent.click(screen.getByText('Socials'))
    await screen.findByTestId('tone-slider')
    expect(screen.getByText(/7 ·/)).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('tone-slider'), { target: { value: '10' } })
    expect(screen.getByText(/10 ·/)).toBeInTheDocument()
    expect(screen.getByText(/Maximum cheeky/)).toBeInTheDocument()
  })
})

describe('SocialsSection — generate flow', () => {
  it('generate fills variant 0 textarea with the draft text', async () => {
    render(<SocialsSection API="" />)
    fireEvent.click(screen.getByText('Socials'))
    await screen.findByTestId('post-type-select')
    // latest-intel is the default so brief gets auto-set from latest news
    await waitFor(() => {
      expect(screen.getByTestId('brief-select').value).toBe('n1')
    })
    fireEvent.click(screen.getByText(/Generate 3 variants/))
    const textarea = await screen.findByTestId('variant-textarea-0')
    await waitFor(() => expect(textarea.value).toBe('Drafted tweet!'))
    expect(screen.getByTestId('variant-char-count-0')).toHaveTextContent('14 / 280')
  })

  it('char counter turns red over 280', async () => {
    render(<SocialsSection API="" />)
    fireEvent.click(screen.getByText('Socials'))
    await screen.findByTestId('post-type-select')
    await waitFor(() => expect(screen.getByTestId('brief-select').value).toBe('n1'))
    fireEvent.click(screen.getByText(/Generate 3 variants/))
    const textarea = await screen.findByTestId('variant-textarea-0')
    await waitFor(() => expect(textarea.value).toBe('Drafted tweet!'))
    fireEvent.change(textarea, { target: { value: 'x'.repeat(285) } })
    const cc = screen.getByTestId('variant-char-count-0')
    expect(cc).toHaveTextContent('285 / 280')
    expect(cc.className).toMatch(/text-red/)
  })

  it('shows the overflow warning and highlights chars past 280 in red', async () => {
    render(<SocialsSection API="" />)
    fireEvent.click(screen.getByText('Socials'))
    await screen.findByTestId('post-type-select')
    await waitFor(() => expect(screen.getByTestId('brief-select').value).toBe('n1'))
    fireEvent.click(screen.getByText(/Generate 3 variants/))
    const textarea = await screen.findByTestId('variant-textarea-0')
    await waitFor(() => expect(textarea.value).toBe('Drafted tweet!'))

    // No warning or highlight when under the limit.
    expect(screen.queryByTestId('variant-over-limit-0')).toBeNull()
    expect(screen.queryByTestId('overflow-highlight-0')).toBeNull()

    // Push over the limit — the trailing 5 chars should be in the highlight.
    fireEvent.change(textarea, { target: { value: 'a'.repeat(285) } })
    const highlight = await screen.findByTestId('overflow-highlight-0')
    expect(highlight).toHaveTextContent('aaaaa')
    expect(highlight.className).toMatch(/bg-red/)

    const warning = screen.getByTestId('variant-over-limit-0')
    expect(warning).toHaveTextContent(/\+5 over/)
  })
})

describe('SocialsSection — publish', () => {
  it('publish sends finalText and shows the toast', async () => {
    render(<SocialsSection API="" />)
    fireEvent.click(screen.getByText('Socials'))
    await screen.findByTestId('post-type-select')
    await waitFor(() => expect(screen.getByTestId('brief-select').value).toBe('n1'))
    fireEvent.click(screen.getByText(/Generate 3 variants/))
    await screen.findByTestId('variant-textarea-0')
    await waitFor(() => expect(screen.getByTestId('variant-textarea-0').value).toBe('Drafted tweet!'))
    fireEvent.click(screen.getByTestId('publish-button'))
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/admin/social/x/publish'),
      expect.objectContaining({ method: 'POST' }),
    ))
    await screen.findByText(/Posted to X/)
  })

  it('publish is disabled when not connected', async () => {
    global.fetch = vi.fn().mockImplementation(defaultRouter(STATUS_DISCONNECTED))
    render(<SocialsSection API="" />)
    fireEvent.click(screen.getByText('Socials'))
    await screen.findByTestId('post-type-select')
    await waitFor(() => expect(screen.getByTestId('brief-select').value).toBe('n1'))
    fireEvent.click(screen.getByText(/Generate 3 variants/))
    const btn = await screen.findByTestId('publish-button')
    expect(btn).toBeDisabled()
  })
})

describe('SocialsSection — news brief ordering', () => {
  it('defaults the news brief selection to the top sorted entry (latest event), not whichever brief the server flagged as latestNews', async () => {
    // latestNews points at 'mid' (which would be the dateAdded-newest News brief
    // server-side), but 'recent' has the later eventDate and so should bubble to
    // the top of the sorted list. The default selection must follow the sorted list.
    const briefs = [
      { _id: 'old',    title: 'Older News',  category: 'News', eventDate: '2026-01-10T00:00:00Z' },
      { _id: 'mid',    title: 'Mid News',    category: 'News', eventDate: '2026-03-15T00:00:00Z' },
      { _id: 'recent', title: 'Recent News', category: 'News', eventDate: '2026-04-20T00:00:00Z' },
    ]
    const latest = { _id: 'mid', title: 'Mid News', category: 'News',
                     eventDate: '2026-03-15T00:00:00Z', isFreshToday: false }
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      const u = String(url)
      if (u.endsWith('/api/admin/social/x/status')) return jsonResp(STATUS_CONNECTED)
      if (u.endsWith('/api/admin/social/briefs-for-recon')) return jsonResp({ data: briefs })
      if (u.endsWith('/api/admin/social/latest-news-brief')) return jsonResp({ data: latest })
      if (u.includes('/api/admin/social/posts')) return jsonResp({ data: [] })
      return defaultRouter()(url, opts)
    })
    render(<SocialsSection API="" />)
    fireEvent.click(screen.getByText('Socials'))
    const select = await screen.findByTestId('brief-select')
    await waitFor(() => expect(select.value).toBe('recent'))
  })

  it('sorts news briefs latest event date first when post type is latest-intel', async () => {
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      const u = String(url)
      if (u.endsWith('/api/admin/social/x/status')) return jsonResp(STATUS_CONNECTED)
      if (u.endsWith('/api/admin/social/briefs-for-recon')) return jsonResp({ data: NEWS_SORT_BRIEFS })
      if (u.endsWith('/api/admin/social/latest-news-brief')) return jsonResp({ data: LATEST_NEWS_SORT })
      if (u.includes('/api/admin/social/posts')) return jsonResp({ data: [] })
      return defaultRouter()(url, opts)
    })
    render(<SocialsSection API="" />)
    fireEvent.click(screen.getByText('Socials'))
    const select = await screen.findByTestId('brief-select')
    // First option is the placeholder "— select —"; assert remaining order.
    const ids = Array.from(select.querySelectorAll('option')).map(o => o.value).slice(1)
    expect(ids).toEqual(['recent', 'mid', 'old', 'plane'])
  })
})

describe('SocialsSection — daily-recon category filter', () => {
  const MULTI_CATEGORY_BRIEFS = [
    { _id: 'a1', title: 'Eurofighter Typhoon', category: 'Aircrafts' },
    { _id: 'a2', title: 'Tornado GR4',         category: 'Aircrafts' },
    { _id: 'b1', title: 'RAF Lossiemouth',     category: 'Bases' },
    { _id: 't1', title: 'METEOR BVRAAM',       category: 'Tech' },
  ]

  function multiCategoryRouter(url, opts) {
    const u = String(url)
    if (u.endsWith('/api/admin/social/x/status')) return jsonResp(STATUS_CONNECTED)
    if (u.endsWith('/api/admin/social/briefs-for-recon')) return jsonResp({ data: MULTI_CATEGORY_BRIEFS })
    if (u.endsWith('/api/admin/social/latest-news-brief')) return jsonResp({ data: null })
    if (u.includes('/api/admin/social/posts')) return jsonResp({ data: [] })
    return defaultRouter()(url, opts)
  }

  it('renders a category filter only for daily-recon, populated with categories present in the loaded briefs', async () => {
    global.fetch = vi.fn().mockImplementation(multiCategoryRouter)
    render(<SocialsSection API="" />)
    fireEvent.click(screen.getByText('Socials'))
    await screen.findByTestId('post-type-select')
    // No filter when post type is the default 'latest-intel'.
    expect(screen.queryByTestId('brief-category-filter')).toBeNull()
    // Switching to daily-recon reveals it.
    fireEvent.change(screen.getByTestId('post-type-select'), { target: { value: 'daily-recon' } })
    const filter = await screen.findByTestId('brief-category-filter')
    const labels = Array.from(filter.querySelectorAll('option')).map(o => o.textContent)
    expect(labels[0]).toBe('All categories')
    // Only categories that actually appear in the loaded briefs should be present,
    // in canonical CATEGORIES order (Aircrafts, Bases, Tech).
    expect(labels.slice(1)).toEqual(['Aircrafts', 'Bases', 'Tech'])
  })

  it('limits the source brief dropdown to the selected category and re-randomises selection', async () => {
    global.fetch = vi.fn().mockImplementation(multiCategoryRouter)
    render(<SocialsSection API="" />)
    fireEvent.click(screen.getByText('Socials'))
    await screen.findByTestId('post-type-select')
    fireEvent.change(screen.getByTestId('post-type-select'), { target: { value: 'daily-recon' } })
    await screen.findByTestId('brief-category-filter')
    fireEvent.change(screen.getByTestId('brief-category-filter'), { target: { value: 'Aircrafts' } })
    const briefSelect = screen.getByTestId('brief-select')
    await waitFor(() => {
      const ids = Array.from(briefSelect.querySelectorAll('option')).map(o => o.value).slice(1)
      expect(ids).toEqual(['a1', 'a2'])
    })
    // The default-selection effect should pick a brief from the filtered pool.
    expect(['a1', 'a2']).toContain(briefSelect.value)
  })
})

describe('SocialsSection — include image preview', () => {
  it('shows the brief image preview as soon as Include image is checked', async () => {
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      const u = String(url)
      if (u.endsWith('/api/admin/social/x/status')) return jsonResp(STATUS_CONNECTED)
      if (u.endsWith('/api/admin/social/briefs-for-recon')) return jsonResp({ data: [BRIEF_WITH_IMAGE] })
      if (u.endsWith('/api/admin/social/latest-news-brief')) return jsonResp({ data: BRIEF_WITH_IMAGE })
      if (u.includes('/api/admin/social/posts')) return jsonResp({ data: [] })
      return defaultRouter()(url, opts)
    })
    render(<SocialsSection API="" />)
    fireEvent.click(screen.getByText('Socials'))
    await screen.findByTestId('brief-select')
    await waitFor(() => expect(screen.getByTestId('brief-select').value).toBe('withimg'))
    // No image preview yet — checkbox is off by default.
    expect(screen.queryByTestId('image-preview-name')).toBeNull()
    // Tick the include-image checkbox.
    const checkbox = screen.getByLabelText('Include brief image')
    fireEvent.click(checkbox)
    // Preview appears immediately, sourced from the selected brief's media.
    const nameEl = await screen.findByTestId('image-preview-name')
    expect(nameEl.textContent).toBe('F-35 over Akrotiri')
    const img = screen.getByAltText('F-35 over Akrotiri')
    expect(img.getAttribute('src')).toBe('https://example.com/news.jpg')
  })
})

describe('SocialsSection — daily-recon poll', () => {
  const POLL_DRAFT_DATA = {
    text: 'Typhoon — what gen is it?',
    poll: { options: ['4', '4.5', '5', '6'], duration_minutes: 1440 },
    sourceMeta: { correctIndex: 1, briefName: 'Eurofighter Typhoon' },
    suggestedImageUrl: null,
    briefName: 'Eurofighter Typhoon',
  }

  function pollRouter(url, opts) {
    const u = String(url)
    const method = (opts?.method || 'GET').toUpperCase()
    if (u.endsWith('/api/admin/social/x/status')) return jsonResp(STATUS_CONNECTED)
    if (u.endsWith('/api/admin/social/briefs-for-recon')) return jsonResp({ data: BRIEFS })
    if (u.endsWith('/api/admin/social/latest-news-brief')) return jsonResp({ data: null })
    if (u.includes('/api/admin/social/posts')) return jsonResp({ data: [] })
    if (method === 'POST' && u.endsWith('/api/admin/social/x/draft')) {
      return jsonResp({ data: POLL_DRAFT_DATA })
    }
    if (method === 'POST' && u.endsWith('/api/admin/social/x/publish')) {
      return jsonResp({ status: 'ok', data: { _id: 'sp1', status: 'posted' } })
    }
    return jsonResp({})
  }

  it('hides the include-image toggle when post type is daily-recon', async () => {
    global.fetch = vi.fn().mockImplementation(pollRouter)
    render(<SocialsSection API="" />)
    fireEvent.click(screen.getByText('Socials'))
    await screen.findByTestId('post-type-select')
    // latest-intel default → toggle visible
    expect(screen.getByLabelText('Include brief image')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('post-type-select'), { target: { value: 'daily-recon' } })
    expect(screen.queryByLabelText('Include brief image')).toBeNull()
  })

  it('shows the poll options + correct answer in the preview after generating a daily-recon draft', async () => {
    global.fetch = vi.fn().mockImplementation(pollRouter)
    render(<SocialsSection API="" />)
    fireEvent.click(screen.getByText('Socials'))
    await screen.findByTestId('post-type-select')
    fireEvent.change(screen.getByTestId('post-type-select'), { target: { value: 'daily-recon' } })
    await waitFor(() => {
      const v = screen.getByTestId('brief-select').value
      expect(['b1', 'b2']).toContain(v)
    })
    fireEvent.click(screen.getByText(/Generate 3 variants/))
    const poll0 = await screen.findByTestId('variant-poll-0')
    const items = poll0.querySelectorAll('li')
    expect(items[0]).toHaveTextContent('4')
    expect(items[1]).toHaveTextContent('4.5')
    expect(items[1]).toHaveTextContent('✓')
    // Non-correct rows should not show the correct badge.
    expect(items[0]).not.toHaveTextContent('✓')
  })

  it('forwards the poll payload to the publish endpoint', async () => {
    global.fetch = vi.fn().mockImplementation(pollRouter)
    render(<SocialsSection API="" />)
    fireEvent.click(screen.getByText('Socials'))
    await screen.findByTestId('post-type-select')
    fireEvent.change(screen.getByTestId('post-type-select'), { target: { value: 'daily-recon' } })
    await waitFor(() => {
      const v = screen.getByTestId('brief-select').value
      expect(['b1', 'b2']).toContain(v)
    })
    fireEvent.click(screen.getByText(/Generate 3 variants/))
    await screen.findByTestId('variant-poll-0')
    fireEvent.click(screen.getByTestId('publish-button'))
    await waitFor(() => {
      const publishCall = global.fetch.mock.calls.find(
        ([u, o]) => String(u).endsWith('/api/admin/social/x/publish') && o?.method === 'POST',
      )
      expect(publishCall).toBeTruthy()
      const body = JSON.parse(publishCall[1].body)
      expect(body.poll).toEqual({ options: ['4', '4.5', '5', '6'], duration_minutes: 1440 })
      expect(body.imageUrl).toBeFalsy()
    })
  })
})

describe('SocialsSection — OAuth callback toast', () => {
  it('shows connected toast when ?socialX=connected is present', async () => {
    mockSearchParams = new URLSearchParams('?socialX=connected')
    render(<SocialsSection API="" />)
    await screen.findByText(/X account connected/)
    // Expands automatically so the user lands inside the panel
    expect(screen.getByText('X.com')).toBeInTheDocument()
    expect(mockSetSearchParams).toHaveBeenCalled()
  })
})

// ─── 3-variant carousel ────────────────────────────────────────────────────

describe('SocialsSection — 3-variant carousel', () => {
  // Per-variant deferred resolver — each call is parked on a promise so the
  // test can resolve them in any order to verify cards unlock independently.
  function deferredDraftRouter(handlers) {
    return (url, opts) => {
      const u = String(url)
      const method = (opts?.method || 'GET').toUpperCase()
      if (u.endsWith('/api/admin/social/x/status')) return jsonResp(STATUS_CONNECTED)
      if (u.endsWith('/api/admin/social/briefs-for-recon')) return jsonResp({ data: BRIEFS })
      if (u.endsWith('/api/admin/social/latest-news-brief')) return jsonResp({ data: LATEST_NEWS })
      if (u.includes('/api/admin/social/posts')) return jsonResp({ data: [] })
      if (method === 'POST' && u.endsWith('/api/admin/social/x/draft')) {
        const body = JSON.parse(opts.body)
        const idx = body.variantIndex
        const handler = handlers[idx]
        if (typeof handler === 'function') return handler(body)
        return jsonResp({ data: { text: `Variant ${idx}`, poll: null, sourceMeta: {}, briefName: 'X' } })
      }
      if (method === 'POST' && u.endsWith('/api/admin/social/x/publish')) {
        return jsonResp({ status: 'ok', data: { _id: 'sp1', status: 'posted' } })
      }
      return jsonResp({})
    }
  }

  it('fires three /x/draft calls (one per variantIndex) when Generate is clicked', async () => {
    render(<SocialsSection API="" />)
    fireEvent.click(screen.getByText('Socials'))
    await screen.findByTestId('post-type-select')
    await waitFor(() => expect(screen.getByTestId('brief-select').value).toBe('n1'))
    fireEvent.click(screen.getByText(/Generate 3 variants/))

    await waitFor(() => {
      const draftCalls = global.fetch.mock.calls.filter(
        ([u, o]) => String(u).endsWith('/api/admin/social/x/draft') && o?.method === 'POST',
      )
      expect(draftCalls).toHaveLength(3)
    })
    const draftCalls = global.fetch.mock.calls.filter(
      ([u, o]) => String(u).endsWith('/api/admin/social/x/draft') && o?.method === 'POST',
    )
    const indices = draftCalls.map(([, o]) => JSON.parse(o.body).variantIndex).sort()
    expect(indices).toEqual([0, 1, 2])
  })

  it('renders 3 cards and each has its own status pill', async () => {
    render(<SocialsSection API="" />)
    fireEvent.click(screen.getByText('Socials'))
    await screen.findByTestId('post-type-select')
    await waitFor(() => expect(screen.getByTestId('brief-select').value).toBe('n1'))
    fireEvent.click(screen.getByText(/Generate 3 variants/))

    await screen.findByTestId('variant-card-0')
    expect(screen.getByTestId('variant-card-0')).toBeInTheDocument()
    expect(screen.getByTestId('variant-card-1')).toBeInTheDocument()
    expect(screen.getByTestId('variant-card-2')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('variant-status-0')).toHaveTextContent(/Ready/)
      expect(screen.getByTestId('variant-status-1')).toHaveTextContent(/Ready/)
      expect(screen.getByTestId('variant-status-2')).toHaveTextContent(/Ready/)
    })
  })

  it('cards unlock independently as each /x/draft response lands', async () => {
    // Park variant 1 indefinitely; variant 0 and 2 resolve immediately so we
    // can assert variant 1 is still loading while the others are ready.
    let resolveOne
    global.fetch = vi.fn().mockImplementation(deferredDraftRouter({
      0: () => jsonResp({ data: { text: 'V0', poll: null, sourceMeta: {}, briefName: 'X' } }),
      1: () => new Promise(resolve => { resolveOne = () => resolve(({
        ok: true, status: 200, json: () => Promise.resolve({ data: { text: 'V1 late', poll: null, sourceMeta: {}, briefName: 'X' } }),
      })) }),
      2: () => jsonResp({ data: { text: 'V2', poll: null, sourceMeta: {}, briefName: 'X' } }),
    }))
    render(<SocialsSection API="" />)
    fireEvent.click(screen.getByText('Socials'))
    await screen.findByTestId('post-type-select')
    await waitFor(() => expect(screen.getByTestId('brief-select').value).toBe('n1'))
    fireEvent.click(screen.getByText(/Generate 3 variants/))

    await waitFor(() => {
      expect(screen.getByTestId('variant-status-0')).toHaveTextContent(/Ready/)
      expect(screen.getByTestId('variant-status-2')).toHaveTextContent(/Ready/)
    })
    // Variant 1 should still be loading.
    expect(screen.getByTestId('variant-status-1')).toHaveTextContent(/Generating/)
    // Variant 1 textarea should be disabled while loading.
    expect(screen.getByTestId('variant-textarea-1')).toBeDisabled()
    expect(screen.getByTestId('variant-textarea-0')).not.toBeDisabled()

    // Now resolve variant 1 — its card unlocks.
    resolveOne()
    await waitFor(() => {
      expect(screen.getByTestId('variant-status-1')).toHaveTextContent(/Ready/)
      expect(screen.getByTestId('variant-textarea-1')).not.toBeDisabled()
    })
  })

  it('clicking a different variant card and publishing posts that variant', async () => {
    global.fetch = vi.fn().mockImplementation(deferredDraftRouter({
      0: () => jsonResp({ data: { text: 'V0 punchy', poll: null, sourceMeta: {}, briefName: 'X' } }),
      1: () => jsonResp({ data: { text: 'V1 hook',   poll: null, sourceMeta: {}, briefName: 'X' } }),
      2: () => jsonResp({ data: { text: 'V2 scene',  poll: null, sourceMeta: {}, briefName: 'X' } }),
    }))
    render(<SocialsSection API="" />)
    fireEvent.click(screen.getByText('Socials'))
    await screen.findByTestId('post-type-select')
    await waitFor(() => expect(screen.getByTestId('brief-select').value).toBe('n1'))
    fireEvent.click(screen.getByText(/Generate 3 variants/))

    await waitFor(() => {
      expect(screen.getByTestId('variant-status-2')).toHaveTextContent(/Ready/)
    })

    // Default selected is variant 0 — switch to variant 2 via the dot.
    fireEvent.click(screen.getByTestId('carousel-dot-2'))
    await waitFor(() => {
      expect(screen.getByTestId('variant-card-2').dataset.selected).toBe('true')
      expect(screen.getByTestId('variant-card-0').dataset.selected).toBe('false')
    })

    fireEvent.click(screen.getByTestId('publish-button'))
    await waitFor(() => {
      const publishCall = global.fetch.mock.calls.find(
        ([u, o]) => String(u).endsWith('/api/admin/social/x/publish') && o?.method === 'POST',
      )
      expect(publishCall).toBeTruthy()
      const body = JSON.parse(publishCall[1].body)
      expect(body.finalText).toBe('V2 scene')
      expect(body.draftText).toBe('V2 scene')
    })
  })

  it('failed variant shows a retry button, others stay usable', async () => {
    global.fetch = vi.fn().mockImplementation(deferredDraftRouter({
      0: () => jsonResp({ data: { text: 'V0', poll: null, sourceMeta: {}, briefName: 'X' } }),
      1: () => jsonResp({ message: 'rate limited' }, false, 429),
      2: () => jsonResp({ data: { text: 'V2', poll: null, sourceMeta: {}, briefName: 'X' } }),
    }))
    render(<SocialsSection API="" />)
    fireEvent.click(screen.getByText('Socials'))
    await screen.findByTestId('post-type-select')
    await waitFor(() => expect(screen.getByTestId('brief-select').value).toBe('n1'))
    fireEvent.click(screen.getByText(/Generate 3 variants/))

    await waitFor(() => {
      expect(screen.getByTestId('variant-status-1')).toHaveTextContent(/Failed/)
    })
    // Variants 0 and 2 still usable.
    expect(screen.getByTestId('variant-status-0')).toHaveTextContent(/Ready/)
    expect(screen.getByTestId('variant-status-2')).toHaveTextContent(/Ready/)
    // Retry button only shows on the failed card.
    expect(screen.getByTestId('variant-retry-1')).toBeInTheDocument()
    expect(screen.queryByTestId('variant-retry-0')).toBeNull()
    expect(screen.queryByTestId('variant-retry-2')).toBeNull()

    // Default-selected (variant 0) can publish.
    fireEvent.click(screen.getByTestId('publish-button'))
    await waitFor(() => {
      const publishCall = global.fetch.mock.calls.find(
        ([u, o]) => String(u).endsWith('/api/admin/social/x/publish') && o?.method === 'POST',
      )
      expect(publishCall).toBeTruthy()
      expect(JSON.parse(publishCall[1].body).finalText).toBe('V0')
    })
  })

  it('selecting a still-loading variant disables the publish button until it lands', async () => {
    let resolveTwo
    global.fetch = vi.fn().mockImplementation(deferredDraftRouter({
      0: () => jsonResp({ data: { text: 'V0', poll: null, sourceMeta: {}, briefName: 'X' } }),
      1: () => jsonResp({ data: { text: 'V1', poll: null, sourceMeta: {}, briefName: 'X' } }),
      2: () => new Promise(resolve => { resolveTwo = () => resolve(({
        ok: true, status: 200, json: () => Promise.resolve({ data: { text: 'V2 late', poll: null, sourceMeta: {}, briefName: 'X' } }),
      })) }),
    }))
    render(<SocialsSection API="" />)
    fireEvent.click(screen.getByText('Socials'))
    await screen.findByTestId('post-type-select')
    await waitFor(() => expect(screen.getByTestId('brief-select').value).toBe('n1'))
    fireEvent.click(screen.getByText(/Generate 3 variants/))

    await waitFor(() => {
      expect(screen.getByTestId('variant-status-0')).toHaveTextContent(/Ready/)
    })
    // Switch to the still-loading variant 2.
    fireEvent.click(screen.getByTestId('carousel-dot-2'))
    expect(screen.getByTestId('publish-button')).toBeDisabled()

    // Resolving variant 2 enables Post.
    resolveTwo()
    await waitFor(() => expect(screen.getByTestId('publish-button')).not.toBeDisabled())
  })
})

describe('SocialsSection — recent posts: mark as deleted + view image', () => {
  const POST_WITH_IMAGE = {
    _id: 'sp-img', platform: 'x', postType: 'latest-intel',
    status: 'posted', finalText: 'Tweet body with image',
    includedImageUrl: 'https://example.com/attached.jpg',
    externalPostUrl: 'https://x.com/skywatch_uk/status/100',
    createdAt: new Date().toISOString(),
    deletedAt: null,
  }
  const POST_NO_IMAGE = {
    _id: 'sp-noimg', platform: 'x', postType: 'brand-transparency',
    status: 'posted', finalText: 'DevLog tweet',
    includedImageUrl: null,
    externalPostUrl: 'https://x.com/skywatch_uk/status/101',
    createdAt: new Date().toISOString(),
    deletedAt: null,
  }

  function postsRouter(initial, { onPatch } = {}) {
    return (url, opts) => {
      const u = String(url)
      const method = (opts?.method || 'GET').toUpperCase()
      if (u.endsWith('/api/admin/social/x/status')) return jsonResp(STATUS_CONNECTED)
      if (u.endsWith('/api/admin/social/briefs-for-recon')) return jsonResp({ data: BRIEFS })
      if (u.endsWith('/api/admin/social/latest-news-brief')) return jsonResp({ data: LATEST_NEWS })
      if (method === 'GET' && u.includes('/api/admin/social/posts')) {
        return jsonResp({ data: initial })
      }
      const patchMatch = u.match(/\/api\/admin\/social\/posts\/([^/]+)\/deleted$/)
      if (method === 'PATCH' && patchMatch) {
        const body = JSON.parse(opts.body)
        const id = patchMatch[1]
        if (onPatch) onPatch(id, body)
        const deletedAt = body.deleted ? new Date().toISOString() : null
        const updated = initial.find(p => p._id === id)
        return jsonResp({ status: 'ok', data: { ...updated, deletedAt } })
      }
      return jsonResp({})
    }
  }

  it('toggles deleted status with optimistic UI and persists via PATCH', async () => {
    const seen = []
    global.fetch = vi.fn().mockImplementation(postsRouter([POST_WITH_IMAGE], {
      onPatch: (id, body) => seen.push({ id, body }),
    }))
    render(<SocialsSection API="" />)
    fireEvent.click(screen.getByText('Socials'))
    await screen.findByTestId('post-row-sp-img')
    expect(screen.getByTestId('post-row-sp-img').getAttribute('data-deleted')).toBe('false')

    fireEvent.click(screen.getByTestId('post-toggle-deleted-sp-img'))
    await waitFor(() => {
      expect(screen.getByTestId('post-row-sp-img').getAttribute('data-deleted')).toBe('true')
    })
    expect(screen.getByTestId('post-deleted-badge-sp-img')).toBeInTheDocument()
    expect(seen).toEqual([{ id: 'sp-img', body: { deleted: true } }])

    // Toggle back to live.
    fireEvent.click(screen.getByTestId('post-toggle-deleted-sp-img'))
    await waitFor(() => {
      expect(screen.getByTestId('post-row-sp-img').getAttribute('data-deleted')).toBe('false')
    })
    expect(seen).toEqual([
      { id: 'sp-img', body: { deleted: true } },
      { id: 'sp-img', body: { deleted: false } },
    ])
  })

  it('shows the View image toggle only when an image is attached, and expands/collapses on click', async () => {
    global.fetch = vi.fn().mockImplementation(postsRouter([POST_WITH_IMAGE, POST_NO_IMAGE]))
    render(<SocialsSection API="" />)
    fireEvent.click(screen.getByText('Socials'))
    await screen.findByTestId('post-row-sp-img')

    // Image post: button visible, panel collapsed.
    const imgToggle = screen.getByTestId('post-toggle-image-sp-img')
    expect(imgToggle).toHaveTextContent(/View image/)
    expect(screen.queryByTestId('post-image-panel-sp-img')).toBeNull()

    // Image-less post: no toggle, no badge.
    expect(screen.queryByTestId('post-toggle-image-sp-noimg')).toBeNull()
    expect(screen.queryByTestId('post-has-image-badge-sp-noimg')).toBeNull()

    // Expand → image visible.
    fireEvent.click(imgToggle)
    const panel = await screen.findByTestId('post-image-panel-sp-img')
    expect(panel.querySelector('img').getAttribute('src')).toBe('https://example.com/attached.jpg')
    expect(screen.getByTestId('post-toggle-image-sp-img')).toHaveTextContent(/Hide image/)

    // Collapse again.
    fireEvent.click(screen.getByTestId('post-toggle-image-sp-img'))
    expect(screen.queryByTestId('post-image-panel-sp-img')).toBeNull()
  })
})
