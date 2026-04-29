import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockStart  = vi.fn()
const mockReplay = vi.fn()

vi.mock('../../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: mockStart, replay: mockReplay }),
}))

import StageTutorialTrigger from '../StageTutorialTrigger'

beforeEach(() => {
  mockStart.mockClear()
  mockReplay.mockClear()
})

describe('StageTutorialTrigger', () => {
  it('auto-calls start with the right key on mount for evidence_wall', () => {
    render(<StageTutorialTrigger stageType="evidence_wall" />)
    expect(mockStart).toHaveBeenCalledTimes(1)
    expect(mockStart).toHaveBeenCalledWith('caseFile_evidenceWall')
  })

  it('clicking the ? button calls replay with the correct tutorial key', () => {
    render(<StageTutorialTrigger stageType="evidence_wall" />)
    const btn = screen.getByRole('button', { name: /replay stage tutorial/i })
    fireEvent.click(btn)
    expect(mockReplay).toHaveBeenCalledTimes(1)
    expect(mockReplay).toHaveBeenCalledWith('caseFile_evidenceWall')
  })

  it('returns null and calls no hooks for an unknown stageType', () => {
    const { container } = render(<StageTutorialTrigger stageType="totally_unknown" />)
    expect(container.firstChild).toBeNull()
    expect(mockStart).not.toHaveBeenCalled()
  })
})
