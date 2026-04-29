import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import EvidenceCard from '../EvidenceCard.jsx'

// ── Mock framer-motion ────────────────────────────────────────────────────────
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, onClick, style, className, 'data-testid': testId, ref, ...rest }) => (
      <div
        onClick={onClick}
        style={style}
        className={className}
        data-testid={testId}
        ref={ref}
      >
        {children}
      </div>
    ),
  },
  AnimatePresence: ({ children }) => children,
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────
const BASE_ITEM = {
  id:          'item-001',
  title:       'Satellite Intercept Alpha',
  type:        'satellite',
  description: 'Signal intercept at 14:32 UTC showing anomalous traffic.',
  imageUrl:    null,
  imageCredit: null,
  sourceUrl:   null,
}

describe('EvidenceCard', () => {
  it('renders the item title', () => {
    render(<EvidenceCard item={BASE_ITEM} isSelected={false} onClick={() => {}} />)
    expect(screen.getByText('Satellite Intercept Alpha')).toBeDefined()
  })

  it('renders the description when no imageUrl', () => {
    render(<EvidenceCard item={BASE_ITEM} isSelected={false} onClick={() => {}} />)
    expect(screen.getByText(/anomalous traffic/i)).toBeDefined()
  })

  it('renders the satellite type icon', () => {
    const { container } = render(
      <EvidenceCard item={BASE_ITEM} isSelected={false} onClick={() => {}} />
    )
    // Type icon span should contain 📡
    const iconSpan = container.querySelector('[aria-hidden="true"]')
    expect(iconSpan?.textContent).toBe('📡')
  })

  it('renders document icon for document type', () => {
    const { container } = render(
      <EvidenceCard
        item={{ ...BASE_ITEM, type: 'document' }}
        isSelected={false}
        onClick={() => {}}
      />
    )
    const iconSpan = container.querySelector('[aria-hidden="true"]')
    expect(iconSpan?.textContent).toBe('📄')
  })

  it('renders transcript icon for transcript type', () => {
    const { container } = render(
      <EvidenceCard
        item={{ ...BASE_ITEM, type: 'transcript' }}
        isSelected={false}
        onClick={() => {}}
      />
    )
    const iconSpan = container.querySelector('[aria-hidden="true"]')
    expect(iconSpan?.textContent).toBe('📃')
  })

  it('renders photo icon for photo type', () => {
    const { container } = render(
      <EvidenceCard
        item={{ ...BASE_ITEM, type: 'photo' }}
        isSelected={false}
        onClick={() => {}}
      />
    )
    const iconSpan = container.querySelector('[aria-hidden="true"]')
    expect(iconSpan?.textContent).toBe('📷')
  })

  it('calls onClick when the card is clicked', () => {
    const handler = vi.fn()
    render(<EvidenceCard item={BASE_ITEM} isSelected={false} onClick={handler} />)
    fireEvent.click(screen.getByTestId('evidence-card-item-001'))
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('applies selected ring class when isSelected is true', () => {
    const { container } = render(
      <EvidenceCard item={BASE_ITEM} isSelected={true} onClick={() => {}} />
    )
    const card = container.querySelector('[data-testid="evidence-card-item-001"]')
    expect(card?.className).toMatch(/border-brand-600/)
  })

  it('does not apply selected class when isSelected is false', () => {
    const { container } = render(
      <EvidenceCard item={BASE_ITEM} isSelected={false} onClick={() => {}} />
    )
    const card = container.querySelector('[data-testid="evidence-card-item-001"]')
    expect(card?.className).not.toMatch(/border-brand-600/)
  })

  it('renders image when imageUrl is provided', () => {
    const { container } = render(
      <EvidenceCard
        item={{ ...BASE_ITEM, imageUrl: 'https://example.com/img.jpg' }}
        isSelected={false}
        onClick={() => {}}
      />
    )
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toBe('https://example.com/img.jpg')
  })

  it('renders imageCredit when provided', () => {
    render(
      <EvidenceCard
        item={{ ...BASE_ITEM, imageUrl: 'https://example.com/img.jpg', imageCredit: 'Reuters' }}
        isSelected={false}
        onClick={() => {}}
      />
    )
    expect(screen.getByText('Reuters')).toBeDefined()
  })

  it('renders nothing if item is null', () => {
    const { container } = render(
      <EvidenceCard item={null} isSelected={false} onClick={() => {}} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders the optional category tag when supplied', () => {
    render(
      <EvidenceCard
        item={{ ...BASE_ITEM, category: 'Military build-up' }}
        isSelected={false}
        onClick={() => {}}
      />
    )
    expect(screen.getByTestId('evidence-category-item-001')).toBeDefined()
    expect(screen.getByText('Military build-up')).toBeDefined()
  })

  it('renders the optional whyItMatters line when supplied', () => {
    render(
      <EvidenceCard
        item={{ ...BASE_ITEM, whyItMatters: 'This is what an invasion looks like.' }}
        isSelected={false}
        onClick={() => {}}
      />
    )
    expect(screen.getByTestId('evidence-why-item-001')).toBeDefined()
    expect(screen.getByText(/This is what an invasion looks like/)).toBeDefined()
  })

  it('omits category tag and whyItMatters when not supplied', () => {
    render(<EvidenceCard item={BASE_ITEM} isSelected={false} onClick={() => {}} />)
    expect(screen.queryByTestId('evidence-category-item-001')).toBeNull()
    expect(screen.queryByTestId('evidence-why-item-001')).toBeNull()
  })
})
