import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import AdminToolPanel, { AdminToolSection } from '../AdminToolPanel'

const KEY = 'skywatch:adminToolPanel'

function panel() { return screen.getByRole('region', { name: /admin tools: profile/i }) }
function bar()   { return screen.getByRole('button', { name: /admin tools · profile/i }) }

// jsdom has no layout: every element measures 0×0, so positions only clamp
// against the window (1024×768) minus the 8px margin.
function press(el, x, y)  { fireEvent.pointerDown(el, { pointerId: 1, button: 0, clientX: x, clientY: y }) }
function move(el, x, y)   { fireEvent.pointerMove(el, { pointerId: 1, clientX: x, clientY: y }) }
function release(el, x, y) { fireEvent.pointerUp(el, { pointerId: 1, clientX: x, clientY: y }) }

describe('AdminToolPanel', () => {
  beforeEach(() => { localStorage.clear() })

  it('shows the page title and its tools, portalled to <body>', () => {
    const { container } = render(<AdminToolPanel title="Profile"><button>Tool</button></AdminToolPanel>)
    expect(panel()).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tool' })).toBeInTheDocument()
    expect(container.contains(panel())).toBe(false)
  })

  it('a tap on the title bar collapses and expands it, and remembers', () => {
    const { unmount } = render(<AdminToolPanel title="Profile"><button>Tool</button></AdminToolPanel>)
    press(bar(), 100, 100); release(bar(), 100, 100)
    expect(screen.queryByRole('button', { name: 'Tool' })).not.toBeInTheDocument()
    expect(bar()).toHaveAttribute('aria-expanded', 'false')
    unmount()

    render(<AdminToolPanel title="Profile"><button>Tool</button></AdminToolPanel>)
    expect(screen.queryByRole('button', { name: 'Tool' })).not.toBeInTheDocument()
    press(bar(), 100, 100); release(bar(), 100, 100)
    expect(screen.getByRole('button', { name: 'Tool' })).toBeInTheDocument()
  })

  it('drags by the title bar without collapsing, and saves the spot', () => {
    localStorage.setItem(KEY, JSON.stringify({ x: 100, y: 100 }))
    render(<AdminToolPanel title="Profile"><button>Tool</button></AdminToolPanel>)
    expect(panel().style.left).toBe('100px')
    expect(panel().style.top).toBe('100px')

    press(bar(), 50, 50); move(bar(), 110, 90); release(bar(), 110, 90)

    expect(panel().style.left).toBe('160px')
    expect(panel().style.top).toBe('140px')
    expect(screen.getByRole('button', { name: 'Tool' })).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(KEY))).toMatchObject({ x: 160, y: 140 })
  })

  it('keeps the window on screen', () => {
    localStorage.setItem(KEY, JSON.stringify({ x: 5000, y: -300 }))
    render(<AdminToolPanel title="Profile"><button>Tool</button></AdminToolPanel>)
    expect(panel().style.left).toBe(`${window.innerWidth - 8}px`)
    expect(panel().style.top).toBe('8px')
  })

  it('treats a tiny wobble as a tap, not a drag', () => {
    render(<AdminToolPanel title="Profile"><button>Tool</button></AdminToolPanel>)
    press(bar(), 100, 100); move(bar(), 102, 101); release(bar(), 102, 101)
    expect(bar()).toHaveAttribute('aria-expanded', 'false')
  })

  it('works from the keyboard', () => {
    render(<AdminToolPanel title="Profile"><button>Tool</button></AdminToolPanel>)
    fireEvent.keyDown(bar(), { key: 'Enter' })
    expect(bar()).toHaveAttribute('aria-expanded', 'false')
  })

  it('folds a section on its own, closed when asked to start closed', () => {
    render(
      <AdminToolPanel title="Profile">
        <AdminToolSection title="Account"><p>email here</p></AdminToolSection>
        <AdminToolSection title="Badges" defaultOpen={false}><p>badge grid</p></AdminToolSection>
      </AdminToolPanel>,
    )
    expect(screen.getByText('email here')).toBeInTheDocument()
    expect(screen.queryByText('badge grid')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Badges/ }))
    expect(screen.getByText('badge grid')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Account/ }))
    expect(screen.queryByText('email here')).not.toBeInTheDocument()
  })
})
