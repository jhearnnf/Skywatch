import { render, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatVisualisation from '../CbatVisualisation'
import { press, START_SELECTOR, ANSWER_SELECTOR } from '../../components/landingGames/demoDriver'

// A 3D round's prompt panel names each composite, so a report about "the
// pentagon one" can be traced to an actual shape key and a player has a word for
// what they're looking at. The answer options get the same names once the round
// is answered — not while the choice is live. Everyone sees them; the labels
// were admin-only at first and were opened up deliberately.

const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../context/AppSettingsContext', () => ({ useAppSettings: () => ({ settings: {} }) }))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../components/CbatGameOver', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('../../components/VisualisationModeSelector', () => ({ default: () => null }))
// Stand in for the WebGL shape, tagging what it was asked to draw so the test
// can tell prompt shapes from answer-option shapes.
vi.mock('../../components/cbat/Visualisation3DShape', () => ({
  default: ({ composite, accent }) => <div data-shape={composite} data-accent={accent} />,
  VisualisationShapeCanvas: () => null,
}))
vi.mock('../../lib/cbatOutbox', () => ({ submitCbatResult: vi.fn(() => Promise.resolve({ synced: true })) }))
vi.mock('../../utils/cbat/useCbatTracking', () => ({
  useCbatTracking: () => ({ start: vi.fn(), setRound: vi.fn(), markCompleted: vi.fn() }),
}))
vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className, style }) => <div className={className} style={style}>{children}</div>,
    button: ({ children, className, onClick, disabled }) => <button className={className} onClick={onClick} disabled={disabled}>{children}</button>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

function started({ isAdmin }) {
  mockUseAuth.mockReturnValue({
    user: { _id: 'u1', isAdmin },
    API: '',
    apiFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
  })
  const view = render(<CbatVisualisation forcedMode="3d" />)
  act(() => { press(view.container.querySelector(START_SELECTOR)) })
  return view
}

describe('Visualisation 3D — composite name labels', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); localStorage.clear() })

  // Same rules whoever is looking — the labels are not an admin affordance.
  for (const isAdmin of [true, false]) {
    const who = isAdmin ? 'an admin' : 'a normal player'

    it(`names every prompt shape for ${who}`, () => {
      const { container } = started({ isAdmin })

      const prompts = [...container.querySelectorAll('[data-accent="prompt"]')]
      expect(prompts.length).toBeGreaterThan(0)

      const labels = [...container.querySelectorAll('[data-composite-name]')]
      expect(labels).toHaveLength(prompts.length)
      // Each label names the shape it sits under, and says so on screen.
      labels.forEach((el, i) => {
        const key = prompts[i].getAttribute('data-shape')
        expect(el.getAttribute('data-composite-name')).toBe(key)
        expect(el.textContent).toBe(key)
      })
    })

    it(`leaves the answer options unlabelled for ${who} while the choice is live`, () => {
      const { container } = started({ isAdmin })

      // Options render inside the answer buttons; the prompt panel does not.
      expect(container.querySelectorAll('button [data-composite-name]')).toHaveLength(0)
      expect(container.querySelectorAll('[data-accent="option"]').length).toBeGreaterThan(0)
    })

    it(`names the option shapes for ${who} once an answer is pressed`, () => {
      const { container } = started({ isAdmin })
      const optionShapes = container.querySelectorAll('[data-accent="option"]').length

      act(() => { press(container.querySelector(ANSWER_SELECTOR)) })

      const labels = [...container.querySelectorAll('button [data-composite-name]')]
      expect(labels).toHaveLength(optionShapes)
      // Every option draws the same composites, so each tile repeats the round's
      // shape names in order.
      const promptKeys = [...container.querySelectorAll('[data-accent="prompt"]')]
        .map(el => el.getAttribute('data-shape'))
      const perTile = labels.map(el => el.getAttribute('data-composite-name'))
        .reduce((acc, key, i) => {
          const tile = Math.floor(i / promptKeys.length)
          ;(acc[tile] ||= []).push(key)
          return acc
        }, [])
      perTile.forEach(keys => expect(keys).toEqual(promptKeys))
    })
  }
})

// The run's time was recorded and submitted but never shown back. Both modes
// share this results screen, so covering one covers both.
describe('Visualisation — post-game screen shows score and time', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); localStorage.clear() })

  it('reports both headline numbers once the run finishes', () => {
    const { container } = started({ isAdmin: false })

    // Answer all eight rounds. Answering disables every tile and leaves the
    // Next Round control as the only live one, so drive that to advance.
    for (let i = 0; i < 8; i++) {
      act(() => { press(container.querySelector(ANSWER_SELECTOR)) })
      const live = [...container.querySelectorAll(ANSWER_SELECTOR)].filter(b => !b.disabled)
      act(() => { press(live[0]) })
    }

    const text = container.textContent
    expect(text).toContain('Visualisation Complete')
    expect(text).toContain('Score')
    expect(text).toContain('Time')
    // Score is out of the round count, time is a seconds figure.
    expect(text).toMatch(/\d\/8/)
    expect(text).toMatch(/\d+\.\ds/)
  })
})
