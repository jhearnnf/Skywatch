import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { vi, describe, it, expect } from 'vitest'
import { GAME_DEMO_POOL } from '../../components/landingGames/gameDemoPool'

const params = vi.hoisted(() => ({ value: {} }))
vi.mock('react-router-dom', () => ({
  useParams: () => params.value,
  Link: ({ children, to }) => <a href={to}>{children}</a>,
}))
// The card itself is covered by the landing page's own tests; here we only care
// that the embed hands it the right entry.
vi.mock('../../components/landingGames/DemoGameCard', () => ({
  default: ({ entry, stage, linkTarget }) => (
    <div data-testid="card" data-entry={entry.id} data-stage={`${stage.w}x${stage.h}`} data-target={linkTarget} />
  ),
}))

import CbatDemoEmbed from '../CbatDemoEmbed'

describe('CbatDemoEmbed', () => {
  it('mounts the pooled demo for the id in the path', () => {
    params.value = { demoId: 'flag' }
    render(<CbatDemoEmbed />)

    const card = screen.getByTestId('card')
    expect(card.dataset.entry).toBe('flag')
    // Square, unlike the landing wall's 3:2 — the guide sets these beside prose.
    expect(card.dataset.stage).toBe('640x640')
  })

  it('opens the game in the top window, not inside the frame', () => {
    // Without this the tap target loads SkyWatch inside the guide's iframe.
    params.value = { demoId: 'cut' }
    render(<CbatDemoEmbed />)
    expect(screen.getByTestId('card').dataset.target).toBe('_top')
  })

  it('renders nothing for an id that is not in the pool', () => {
    // An empty box in the guide beats a broken one.
    params.value = { demoId: 'not-a-game' }
    const { container } = render(<CbatDemoEmbed />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('the CBAT guide\'s simulation boxes', () => {
  // The guide is a static document outside the build, so nothing else would
  // catch a typo in it — the box would just render an empty frame in
  // production. Read the real file and check every id it references.
  const guide = readFileSync('public/cbat-guide.html', 'utf8')

  // Only the SIMS map. The guide's own TESTS array uses the same `id:'…'` shape
  // for its 23 test sections, so a document-wide match would sweep those up too
  // and assert that every CBAT subtest has a game — which is exactly what this
  // feature does NOT claim.
  const simsBlock = guide.slice(guide.indexOf('const SIMS = {'), guide.indexOf('const simHTML'))
  const referencedIds = [...simsBlock.matchAll(/\bid:'([a-z0-9-]+)'/g)].map(m => m[1])

  it('references at least one game, so the regex has not silently stopped matching', () => {
    expect(referencedIds.length).toBeGreaterThan(5)
  })

  it('only embeds games that exist in the landing page demo pool', () => {
    const pooled = new Set(GAME_DEMO_POOL.map(g => g.id))
    for (const id of referencedIds) {
      expect(pooled.has(id), `guide embeds "${id}", which is not in GAME_DEMO_POOL`).toBe(true)
    }
  })

  it('points its frames at the embed route, and loads them lazily', () => {
    expect(guide).toContain('/embed/cbat/${s.id}')
    // data-src, not src: ten frames booting at once would exhaust the browser's
    // WebGL contexts and stall a document meant for twenty minutes of reading.
    expect(guide).toContain('data-src="/embed/cbat/')
    expect(guide).not.toMatch(/<iframe[^>]*\ssrc=/)
  })

  it('says on every box that these are our practice games, not the real test', () => {
    // We do not have the real CBAT subtests and must never imply we do.
    expect(guide).toContain('our practice')
    expect(guide).toContain('not the real test')
  })
})
