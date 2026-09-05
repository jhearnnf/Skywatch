import { StrictMode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { useCbatPersonalBest } from '../useCbatPersonalBest'

// Personal best for whichever board is selected, cached per key so flipping
// mode never blanks the panel or shows one board's score under another's name.

function Probe({ gameKey, apiFetch }) {
  const { best, loading } = useCbatPersonalBest(gameKey, { user: { _id: 'u1' }, apiFetch, API: '' })
  return (
    <p data-testid="out">
      {loading ? 'loading' : best ? `best:${best.bestScore}` : 'none'}
    </p>
  )
}

const out = () => screen.getByTestId('out').textContent

const respond = (byKey) => vi.fn(async (url) => {
  const key = url.split('/cbat/')[1].split('/')[0]
  return { ok: true, json: async () => ({ data: byKey[key] ?? null }) }
})

describe('useCbatPersonalBest', () => {
  it('reports loading, then the board’s best', async () => {
    const apiFetch = respond({ sma: { bestScore: 812, attempts: 4 } })
    render(<Probe gameKey="sma" apiFetch={apiFetch} />)
    expect(out()).toBe('loading')
    await waitFor(() => expect(out()).toBe('best:812'))
  })

  // A board known to be empty is not loading, it is empty. Getting this wrong is
  // what leaves the panel on its placeholder.
  it('settles on "none" for a board with no runs', async () => {
    const apiFetch = respond({})
    render(<Probe gameKey="sma" apiFetch={apiFetch} />)
    await waitFor(() => expect(out()).toBe('none'))
  })

  it('settles rather than spinning when the request fails', async () => {
    const apiFetch = vi.fn(async () => { throw new Error('offline') })
    render(<Probe gameKey="sma" apiFetch={apiFetch} />)
    await waitFor(() => expect(out()).toBe('none'))
  })

  // THE REGRESSION. `aliveRef` was set to false by the unmount cleanup and never
  // back to true on mount, so StrictMode's mount → unmount → mount left it false
  // for good. Every response was then discarded, the key never landed in the
  // cache, and the panel pulsed on its loading placeholder forever.
  it('still resolves under StrictMode’s double mount', async () => {
    const apiFetch = respond({ sma: { bestScore: 640, attempts: 2 } })
    render(
      <StrictMode>
        <Probe gameKey="sma" apiFetch={apiFetch} />
      </StrictMode>,
    )
    await waitFor(() => expect(out()).toBe('best:640'))
  })

  it('asks the board it was given, and only that one', async () => {
    const apiFetch = respond({ sma: { bestScore: 1, attempts: 1 } })
    render(<Probe gameKey="sma-easier" apiFetch={apiFetch} />)
    await waitFor(() => expect(out()).toBe('none'))
    expect(apiFetch).toHaveBeenCalledWith('/api/games/cbat/sma-easier/personal-best')
  })

  it('does not ask at all when there is nobody signed in', async () => {
    const apiFetch = respond({})
    function NoUser() {
      const { loading } = useCbatPersonalBest('sma', { user: null, apiFetch, API: '' })
      return <p data-testid="out">{loading ? 'loading' : 'idle'}</p>
    }
    render(<NoUser />)
    expect(out()).toBe('idle')
    await new Promise(r => setTimeout(r, 30))
    expect(apiFetch).not.toHaveBeenCalled()
  })
})
