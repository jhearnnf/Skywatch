import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
import ActorPortrait from '../ActorPortrait'

const ACTOR = {
  id:      'lavrov',
  name:    'Sergei Lavrov',
  role:    'Minister of Foreign Affairs',
  faction: 'Russia',
}

const ACTOR_NO_PORTRAIT = {
  id:      'biden',
  name:    'Joe Biden',
  role:    'Former President',
  faction: 'USA',
}

describe('ActorPortrait', () => {
  it('renders the actor name', () => {
    render(<ActorPortrait actor={ACTOR} isSelected={false} onClick={vi.fn()} />)
    expect(screen.getByText('Sergei Lavrov')).toBeDefined()
  })

  it('renders the actor role', () => {
    render(<ActorPortrait actor={ACTOR} isSelected={false} onClick={vi.fn()} />)
    expect(screen.getByText('Minister of Foreign Affairs')).toBeDefined()
  })

  it('renders the faction badge', () => {
    render(<ActorPortrait actor={ACTOR} isSelected={false} onClick={vi.fn()} />)
    expect(screen.getByText('Russia')).toBeDefined()
  })

  it('shows initials when no portraitUrl is provided', () => {
    render(<ActorPortrait actor={ACTOR_NO_PORTRAIT} isSelected={false} onClick={vi.fn()} />)
    // Initials: J(oe) B(iden) → "JB"
    expect(screen.getByText('JB')).toBeDefined()
  })

  it('renders portrait image when portraitUrl is provided', () => {
    const actorWithPortrait = { ...ACTOR, portraitUrl: '/portraits/lavrov.jpg' }
    render(<ActorPortrait actor={actorWithPortrait} isSelected={false} onClick={vi.fn()} />)
    const img = screen.getByRole('img')
    expect(img.getAttribute('src')).toBe('/portraits/lavrov.jpg')
  })

  it('calls onClick with the actor object when clicked', () => {
    const onClick = vi.fn()
    render(<ActorPortrait actor={ACTOR} isSelected={false} onClick={onClick} />)
    fireEvent.click(screen.getByTestId('actor-portrait-lavrov'))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick).toHaveBeenCalledWith(ACTOR)
  })

  it('calls onClick on Enter key press', () => {
    const onClick = vi.fn()
    render(<ActorPortrait actor={ACTOR} isSelected={false} onClick={onClick} />)
    fireEvent.keyDown(screen.getByTestId('actor-portrait-lavrov'), { key: 'Enter' })
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('calls onClick on Space key press', () => {
    const onClick = vi.fn()
    render(<ActorPortrait actor={ACTOR} isSelected={false} onClick={onClick} />)
    fireEvent.keyDown(screen.getByTestId('actor-portrait-lavrov'), { key: ' ' })
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('shows selected ring class when isSelected=true', () => {
    render(<ActorPortrait actor={ACTOR} isSelected={true} onClick={vi.fn()} />)
    const el = screen.getByTestId('actor-portrait-lavrov')
    expect(el.className).toMatch(/ring-2/)
  })

  it('does not show selected ring when isSelected=false', () => {
    render(<ActorPortrait actor={ACTOR} isSelected={false} onClick={vi.fn()} />)
    const el = screen.getByTestId('actor-portrait-lavrov')
    expect(el.className).not.toMatch(/ring-2/)
  })

  it('shows selected indicator dot when isSelected=true', () => {
    const { container } = render(
      <ActorPortrait actor={ACTOR} isSelected={true} onClick={vi.fn()} />
    )
    // The dot span is aria-hidden; query by its bg class
    const dot = container.querySelector('[aria-hidden="true"].bg-brand-600')
    expect(dot).not.toBeNull()
  })

  it('has role="button" and aria-pressed reflecting selection state', () => {
    const { rerender } = render(
      <ActorPortrait actor={ACTOR} isSelected={false} onClick={vi.fn()} />
    )
    const el = screen.getByTestId('actor-portrait-lavrov')
    expect(el.getAttribute('role')).toBe('button')
    expect(el.getAttribute('aria-pressed')).toBe('false')

    rerender(<ActorPortrait actor={ACTOR} isSelected={true} onClick={vi.fn()} />)
    expect(el.getAttribute('aria-pressed')).toBe('true')
  })
})
