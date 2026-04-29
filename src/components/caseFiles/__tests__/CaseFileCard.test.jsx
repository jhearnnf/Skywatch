import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
import CaseFileCard from '../CaseFileCard'

const PUBLISHED_CASE = {
  slug:          'russia-ukraine',
  title:         'Russia / Ukraine',
  affairLabel:   'Eastern Europe · Active Conflict',
  summary:       'An ongoing full-scale invasion reshaping European security.',
  coverImageUrl: null,
  status:        'published',
  tags:          ['Russia', 'Ukraine'],
  chapterCount:  3,
}

const LOCKED_CASE = {
  slug:          'israel-iran',
  title:         'Israel / Iran',
  affairLabel:   'Middle East · Emerging Flashpoint',
  summary:       'Rising tension across the Levant and Persian Gulf.',
  coverImageUrl: null,
  status:        'locked',
  tags:          ['Israel', 'Iran'],
  chapterCount:  0,
}

describe('CaseFileCard — published card', () => {
  it('renders title, affair label, summary, and chapter count', () => {
    render(<CaseFileCard caseFile={PUBLISHED_CASE} onClick={vi.fn()} />)

    expect(screen.getByText('Russia / Ukraine')).toBeDefined()
    expect(screen.getByText('Eastern Europe · Active Conflict')).toBeDefined()
    expect(screen.getByText(/An ongoing full-scale invasion/)).toBeDefined()
    expect(screen.getByText(/3 chapters/)).toBeDefined()
  })

  it('calls onClick when clicked', () => {
    const onClick = vi.fn()
    render(<CaseFileCard caseFile={PUBLISHED_CASE} onClick={onClick} />)
    fireEvent.click(screen.getByTestId('case-file-card-russia-ukraine'))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick).toHaveBeenCalledWith(PUBLISHED_CASE)
  })

  it('calls onClick on Enter key', () => {
    const onClick = vi.fn()
    render(<CaseFileCard caseFile={PUBLISHED_CASE} onClick={onClick} />)
    fireEvent.keyDown(screen.getByTestId('case-file-card-russia-ukraine'), { key: 'Enter' })
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not show Coming Soon badge', () => {
    render(<CaseFileCard caseFile={PUBLISHED_CASE} onClick={vi.fn()} />)
    expect(screen.queryByTestId('coming-soon-badge')).toBeNull()
  })
})

describe('CaseFileCard — locked card', () => {
  it('renders title, affair label, summary', () => {
    render(<CaseFileCard caseFile={LOCKED_CASE} onClick={undefined} />)

    expect(screen.getByText('Israel / Iran')).toBeDefined()
    expect(screen.getByText('Middle East · Emerging Flashpoint')).toBeDefined()
    expect(screen.getByText(/Rising tension across the Levant/)).toBeDefined()
  })

  it('shows Coming Soon badge', () => {
    render(<CaseFileCard caseFile={LOCKED_CASE} onClick={undefined} />)
    expect(screen.getByTestId('coming-soon-badge')).toBeDefined()
  })

  it('applies dim opacity class via cursor-not-allowed', () => {
    render(<CaseFileCard caseFile={LOCKED_CASE} onClick={undefined} />)
    const card = screen.getByTestId('case-file-card-israel-iran')
    expect(card.className).toMatch(/cursor-not-allowed/)
    expect(card.className).toMatch(/opacity/)
  })

  it('does not call onClick when clicked', () => {
    const onClick = vi.fn()
    render(<CaseFileCard caseFile={LOCKED_CASE} onClick={onClick} />)
    fireEvent.click(screen.getByTestId('case-file-card-israel-iran'))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('shows 0 chapters', () => {
    render(<CaseFileCard caseFile={LOCKED_CASE} />)
    expect(screen.getByText(/0 chapters/)).toBeDefined()
  })
})
