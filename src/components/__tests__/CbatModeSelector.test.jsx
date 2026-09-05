import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { CbatModeRow, ModeButton, ModeMarker } from '../CbatModeSelector'
import { ANT_MODES, antModes } from '../../utils/cbat/antDifficulty'
import { TRACE_MODES, traceModes } from '../../utils/cbat/traceModes'
import { VISUALISATION_MODES, visualisationModes } from '../../utils/cbat/visualisationModes'
import { FLAG_DIFFICULTIES } from '../../pages/CbatFlag/difficulty'

// One row for every CBAT tile that holds more than one board. It replaced three
// separate pieces of chrome (the difficulty pair, TraceModeSelector and
// VisualisationModeSelector), so what matters here is that the one row still
// covers everything all three used to do.

const button = (container, key) => container.querySelector(`[data-mode="${key}"]`)
const barsIn = el => el.querySelectorAll('span[aria-hidden="true"] > span').length

describe('CbatModeRow', () => {
  it('renders one button per mode, in order', () => {
    const { container } = render(
      <CbatModeRow modes={TRACE_MODES} value="trace1" onSelect={() => {}} />,
    )
    const keys = [...container.querySelectorAll('[data-mode]')].map(b => b.dataset.mode)
    expect(keys).toEqual(['2d', '3d', 'trace1', 'trace2'])
  })

  it('reports the mode that was clicked', () => {
    const onSelect = vi.fn()
    const { container } = render(
      <CbatModeRow modes={TRACE_MODES} value="trace1" onSelect={onSelect} />,
    )
    fireEvent.click(button(container, '3d'))
    expect(onSelect).toHaveBeenCalledWith('3d')
  })

  it('marks exactly one button as pressed', () => {
    const { container } = render(
      <CbatModeRow modes={ANT_MODES} value="hard" onSelect={() => {}} />,
    )
    const pressed = [...container.querySelectorAll('[data-mode]')]
      .filter(b => b.getAttribute('aria-pressed') === 'true')
      .map(b => b.dataset.mode)
    expect(pressed).toEqual(['hard'])
  })

  // A tile with one board left has nothing to choose, so the row is absent
  // rather than a single dead button. This is what Visualisation relied on when
  // an admin disabled one of its two modes.
  it('renders nothing when there is only one mode left to pick', () => {
    const { container } = render(
      <CbatModeRow modes={[VISUALISATION_MODES[0]]} value="2d" onSelect={() => {}} />,
    )
    expect(container.querySelector('[data-mode]')).toBeNull()
  })

  it('wraps rather than overflowing — four modes do not fit a phone in one line', () => {
    const { container } = render(
      <CbatModeRow modes={TRACE_MODES} value="2d" onSelect={() => {}} />,
    )
    expect(container.firstChild.className).toContain('flex-wrap')
  })

  it('flashes the chosen mode and dims the rest during a launch', () => {
    const { container } = render(
      <CbatModeRow modes={FLAG_DIFFICULTIES} value="hard" onSelect={() => {}} launching />,
    )
    expect(button(container, 'hard').className).toContain('cbat-launch-flash')
    expect(button(container, 'easier').className).toContain('cbat-launch-dim')
  })

  it('leaves every button alone when nothing is launching', () => {
    const { container } = render(
      <CbatModeRow modes={FLAG_DIFFICULTIES} value="hard" onSelect={() => {}} />,
    )
    for (const m of FLAG_DIFFICULTIES) {
      expect(button(container, m.key).className).not.toContain('cbat-launch')
    }
  })
})

// The meter says "this one is harder". That is only true between the halves of
// a difficulty pair, so a mode gets bars OR a badge and never bars it has not
// earned — a Practise drill is a different exercise, not the easy end of one.
describe('bars belong to difficulties, badges to everything else', () => {
  it('gives a difficulty its bars and no badge', () => {
    const { container } = render(
      <CbatModeRow modes={FLAG_DIFFICULTIES} value="easier" onSelect={() => {}} />,
    )
    expect(barsIn(button(container, 'easier'))).toBe(3)   // 3 slots, 1 lit
    expect(button(container, 'easier').textContent).toBe('Easier')
  })

  it('gives ANT Practise a badge and no bars', () => {
    const { container } = render(
      <CbatModeRow modes={ANT_MODES} value="easier" onSelect={() => {}} />,
    )
    const practise = button(container, 'practise')
    expect(barsIn(practise)).toBe(0)
    expect(practise.textContent).toContain('Practise')
    expect(practise.textContent).toContain('Drill')
  })

  it('tells the two Trace practice modes apart by badge alone', () => {
    const { container } = render(
      <CbatModeRow modes={TRACE_MODES} value="2d" onSelect={() => {}} />,
    )
    expect(button(container, '2d').textContent).toBe('Practise2D')
    expect(button(container, '3d').textContent).toBe('Practise3D')
    expect(barsIn(button(container, '2d'))).toBe(0)
    expect(barsIn(button(container, '3d'))).toBe(0)
  })

  it('never puts bars on a mode that is a different test rather than a harder one', () => {
    for (const mode of [...TRACE_MODES, ...VISUALISATION_MODES, ANT_MODES[2]]) {
      expect([mode.key, mode.bars ?? null]).toEqual([mode.key, null])
    }
    for (const mode of FLAG_DIFFICULTIES) {
      expect([mode.key, typeof mode.bars]).toEqual([mode.key, 'number'])
    }
  })
})

describe('admin toggles drop a mode out of the row', () => {
  it('hides a Trace mode an admin switched off', () => {
    const modes = traceModes(m => m !== '3d')
    expect(modes.map(m => m.key)).toEqual(['2d', 'trace1', 'trace2'])
  })

  it('hides a Visualisation mode an admin switched off, leaving nothing to pick', () => {
    expect(visualisationModes(m => m !== '3d').map(m => m.key)).toEqual(['2d'])
    expect(visualisationModes(() => true)).toHaveLength(2)
  })

  it('hides ANT Practise when the drill is disabled', () => {
    expect(antModes(false).map(m => m.key)).toEqual(['easier', 'hard'])
    expect(antModes(true).map(m => m.key)).toEqual(['easier', 'hard', 'practise'])
  })
})

describe('ModeMarker', () => {
  it('names the mode in play and carries its bars or badge', () => {
    const { rerender } = render(<ModeMarker mode={FLAG_DIFFICULTIES[1]} />)
    expect(screen.getByText('Hard')).toBeTruthy()

    rerender(<ModeMarker mode={ANT_MODES[2]} />)
    expect(screen.getByText('Practise')).toBeTruthy()
    expect(screen.getByText('Drill')).toBeTruthy()
  })
})

// The page tests all query [data-difficulty]; it predates the row and has to
// keep working, so the button carries both names for the same value.
describe('ModeButton keeps the hook the page tests query by', () => {
  it('stamps data-difficulty and data-mode with the same key', () => {
    const { container } = render(
      <ModeButton mode={ANT_MODES[1]} selected onSelect={() => {}} />,
    )
    const el = container.querySelector('button')
    expect(el.dataset.difficulty).toBe('hard')
    expect(el.dataset.mode).toBe('hard')
  })
})
