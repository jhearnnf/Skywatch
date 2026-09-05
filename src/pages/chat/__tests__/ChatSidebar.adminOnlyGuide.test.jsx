import { render, screen } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'

// A guide can be staged in the rail for admins before it is released, so a
// draft can be judged where it will actually live. The badge is the only thing
// that tells an admin the card in front of them is not yet public, and it is
// easy to lose in a refactor of the card's title row, so it is pinned here.
//
// The badge is NOT the access control. The backend never sends these rows to a
// non-admin at all, which is covered in the backend guide route tests. What
// this file asserts is that a row which arrives flagged is visibly flagged.
// Marked so a test can tell a react-router Link from a plain anchor. The two
// render identically otherwise, which is exactly how a real bug got past this
// file once: the guides were given extensionless URLs, the rail handed them to
// react-router as app routes, and clicking one landed on the SPA's 404 while
// this test happily reported the right href.
vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className, ...rest }) => (
    <a href={to} className={className} data-router-link="true" {...rest}>{children}</a>
  ),
}))
vi.mock('../components/AdminDmSearch', () => ({ default: () => null }))

import ChatSidebar from '../ChatSidebar'

// The .html is load-bearing. See the navigation test at the bottom of the file.
const GUIDE = {
  _id: 'g1', title: 'Canadian Aircrew Selection', url: '/cbat-guide-canada.html',
  description: 'CFAST at Trenton', emoji: '🇨🇦',
}

const renderRail = (guides) =>
  render(<ChatSidebar guides={guides} viewer={{ displayName: 'Falcon' }} />)

describe('ChatSidebar — admin-only guides', () => {
  it('badges a guide that is not live yet', () => {
    renderRail([{ ...GUIDE, adminOnly: true }])
    expect(screen.getByText('Admin only')).toBeTruthy()
  })

  it('leaves a published guide unbadged', () => {
    renderRail([GUIDE])
    expect(screen.queryByText('Admin only')).toBeNull()
  })

  it('badges only the staged guide when both kinds are in the rail', () => {
    renderRail([
      { _id: 'g0', title: 'CBAT Community Guide', url: '/cbat-guide.html', emoji: '🇬🇧' },
      { ...GUIDE, adminOnly: true },
    ])
    expect(screen.getAllByText('Admin only')).toHaveLength(1)
    // The badge belongs to the staged card, not merely to the rail somewhere.
    const staged = screen.getByText('Canadian Aircrew Selection').closest('a')
    expect(staged.textContent).toContain('Admin only')
    const live = screen.getByText('CBAT Community Guide').closest('a')
    expect(live.textContent).not.toContain('Admin only')
  })

  it('still renders the guide as a readable link, badge or no badge', () => {
    renderRail([{ ...GUIDE, adminOnly: true }])
    const card = screen.getByText('Canadian Aircrew Selection').closest('a')
    expect(card.getAttribute('href')).toBe('/cbat-guide-canada.html')
    expect(screen.getByText('Read')).toBeTruthy()
  })

  // The regression this file missed the first time. A guide is a static
  // document in public/, not an app route: handing it to react-router renders
  // the SPA's 404 instead, and in slim mode redirects to /cbat. The rail picks
  // between the two purely on whether the URL ends in a file extension, so a
  // guide row without one is silently broken.
  it('opens a guide with a full page load, not a client-side route', () => {
    renderRail([{ ...GUIDE, adminOnly: true }])
    const card = screen.getByText('Canadian Aircrew Selection').closest('a')
    expect(card.getAttribute('data-router-link')).toBeNull()
  })

  it('would have caught the extensionless URL that broke this', () => {
    renderRail([{ ...GUIDE, url: '/cbat-guide-canada', adminOnly: true }])
    const card = screen.getByText('Canadian Aircrew Selection').closest('a')
    // Documents the trap rather than endorsing it: an extensionless guide URL
    // becomes a router link, which is why the rows carry .html.
    expect(card.getAttribute('data-router-link')).toBe('true')
  })
})
