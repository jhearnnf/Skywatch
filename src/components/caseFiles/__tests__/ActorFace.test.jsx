import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ActorFace from '../ActorFace'
import { MOODS } from '../../../utils/caseFiles/actorMood'

const ACTOR = {
  id:              'a_scholz',
  name:            'Olaf Scholz',
  faction:         'EU',
  systemPromptKey: 'scholz',
}

function paths(container) {
  return Array.from(container.querySelectorAll('path')).map((p) => p.getAttribute('d'))
}

describe('ActorFace', () => {
  it('renders a labelled portrait for the actor', () => {
    render(<ActorFace actor={ACTOR} />)
    const face = screen.getByTestId('actor-face')
    expect(face.getAttribute('role')).toBe('img')
    expect(face.getAttribute('aria-label')).toBe('Portrait of Olaf Scholz')
  })

  it('draws every mood without throwing, and records which one is on screen', () => {
    for (const mood of MOODS) {
      const { unmount } = render(<ActorFace actor={ACTOR} mood={mood} />)
      expect(screen.getByTestId('actor-face').getAttribute('data-mood')).toBe(mood)
      unmount()
    }
  })

  it('changes the mouth between moods, so the reaction is actually visible', () => {
    const { container: neutral } = render(<ActorFace actor={ACTOR} mood="neutral" />)
    const { container: grave }   = render(<ActorFace actor={ACTOR} mood="grave" />)
    expect(paths(neutral)).not.toEqual(paths(grave))
  })

  it('uses the descriptor for a known figure', () => {
    render(<ActorFace actor={ACTOR} />)
    // Scholz is registered as bald; the hair style is what drives the cap path.
    expect(screen.getByTestId('actor-face').getAttribute('data-hair')).toBe('bald')
  })

  it('still draws someone with no registry entry', () => {
    render(<ActorFace actor={{ id: 'x', name: 'Unknown Envoy' }} />)
    expect(screen.getByTestId('actor-face').getAttribute('data-hair')).toBeTruthy()
  })

  it('opens the mouth while a line is being delivered', () => {
    const { container } = render(<ActorFace actor={ACTOR} talking />)
    expect(container.querySelector('.cf-portrait-mouth-talking')).not.toBeNull()
  })

  it('idles with a blink and a breath, and stops when idle is off', () => {
    const { container: idling } = render(<ActorFace actor={ACTOR} idle />)
    expect(idling.querySelector('.cf-portrait-eye')).not.toBeNull()
    expect(idling.querySelector('.cf-portrait-body')).not.toBeNull()

    const { container: still } = render(<ActorFace actor={ACTOR} idle={false} />)
    expect(still.querySelector('.cf-portrait-eye')).toBeNull()
    expect(still.querySelector('.cf-portrait-body')).toBeNull()
  })

  it('gives two faces on the same page their own clip and gradient ids', () => {
    const { container } = render(
      <div>
        <ActorFace actor={ACTOR} />
        <ActorFace actor={{ ...ACTOR, id: 'a_macron', systemPromptKey: 'macron' }} />
      </div>
    )
    // Every <defs> id in the document has to be unique or the second face
    // silently borrows the first one's clip.
    const ids = Array.from(container.querySelectorAll('clipPath, linearGradient, filter'))
      .map((n) => n.id)
    expect(ids.length).toBeGreaterThan(2)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('draws a distinct head for two different figures', () => {
    const { container: a } = render(<ActorFace actor={{ ...ACTOR, systemPromptKey: 'putin' }} />)
    const { container: b } = render(<ActorFace actor={{ ...ACTOR, systemPromptKey: 'macron' }} />)
    // The first path in the head group is the skull outline itself.
    const headOf = (c) => c.querySelector('clipPath path').getAttribute('d')
    expect(headOf(a)).not.toBe(headOf(b))
  })

  it('scales with the size prop and keeps the bust framing', () => {
    render(<ActorFace actor={ACTOR} size={80} />)
    const face = screen.getByTestId('actor-face')
    expect(face.getAttribute('width')).toBe('80')
    expect(face.getAttribute('height')).toBe('100')
  })
})
