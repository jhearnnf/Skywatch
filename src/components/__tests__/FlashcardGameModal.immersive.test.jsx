import { render } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import FlashcardGameModal from '../FlashcardGameModal'

// Spies on enterImmersive / exitImmersive — the contract we want to verify
// is that the modal does NOT enter immersive while on the count-picker screen,
// only once the player is recalling cards.
const enterImmersive = vi.fn()
const exitImmersive  = vi.fn()

vi.mock('../../context/GameChromeContext', () => ({
  useGameChrome: () => ({ immersive: false, enterImmersive, exitImmersive }),
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { _id: 'u1' }, API: '', apiFetch: (...args) => fetch(...args), awardAirstars: vi.fn() }),
}))

vi.mock('../../context/NewGameUnlockContext', () => ({
  useNewGameUnlock: () => ({ markSeen: vi.fn(), applyUnlocks: vi.fn() }),
}))

vi.mock('../../context/NewCategoryUnlockContext', () => ({
  useNewCategoryUnlock: () => ({ applyUnlocks: vi.fn() }),
}))

vi.mock('../../utils/sound', () => ({ playSound: vi.fn() }))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, ...rest }) => <div {...rest}>{children}</div>,
    button: ({ children, ...rest }) => <button {...rest}>{children}</button>,
    ul:     ({ children, ...rest }) => <ul {...rest}>{children}</ul>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

beforeEach(() => {
  enterImmersive.mockClear()
  exitImmersive.mockClear()
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { count: 10 } }) })
})

afterEach(() => { vi.restoreAllMocks() })

describe('FlashcardGameModal — immersive chrome', () => {
  it('does not enter immersive on the count-picker screen', () => {
    render(<FlashcardGameModal onClose={vi.fn()} />)
    expect(enterImmersive).not.toHaveBeenCalled()
    expect(exitImmersive).toHaveBeenCalled()
  })
})
