import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockStart  = vi.fn()
const mockReplay = vi.fn()
const mockSteps  = vi.hoisted(() => ({ value: [{ title: 'Step one' }] }))

vi.mock('../../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: mockStart, replay: mockReplay, getSteps: () => mockSteps.value }),
}))

import StageTutorialTrigger from '../StageTutorialTrigger'

beforeEach(() => {
  mockStart.mockClear()
  mockReplay.mockClear()
  mockSteps.value = [{ title: 'Step one' }]
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

  // A "?" that opens nothing reads as broken. Only offer it with steps to show.
  it('hides the ? button when the tutorial has no steps to show', () => {
    mockSteps.value = null
    render(<StageTutorialTrigger stageType="evidence_wall" />)
    expect(screen.queryByRole('button', { name: /replay stage tutorial/i })).toBeNull()
  })
})
