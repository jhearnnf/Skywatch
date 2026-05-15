import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('framer-motion', () => {
  const passthrough = (Tag) => ({ children, initial, animate, exit, transition, layout, ...rest }) => {
    const Component = Tag;
    return <Component {...rest}>{children}</Component>;
  };
  return {
    motion: new Proxy({}, { get: (_, key) => passthrough(key) }),
    AnimatePresence: ({ children }) => <>{children}</>,
  };
});

vi.mock('react-dom', async () => {
  const real = await vi.importActual('react-dom');
  return { ...real, createPortal: (node) => node };
});

import BriefReelSection from '../BriefReelSection.jsx';
import minimalFixture from '../__fixtures__/recruitNumbers.json';

function makeApiFetch(handlers) {
  return vi.fn(async (url, opts) => {
    for (const h of handlers) if (h.match(url, opts)) return h.respond(url, opts);
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

function jsonRes(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

beforeEach(() => {
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation(query => ({
      matches: false, media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    }));
  }
});

afterEach(() => { vi.clearAllMocks(); });

describe('BriefReelSection', () => {
  it('hides the button for a non-admin user when no published reel exists (204)', async () => {
    const apiFetch = makeApiFetch([
      { match: (u) => u.includes('/api/brief-reels/'), respond: () => jsonRes(null, 204) },
    ]);

    const { container } = render(
      <BriefReelSection briefId="b1" sectionIndex={0} isAdmin={false} apiFetch={apiFetch}>
        <p>body text</p>
      </BriefReelSection>
    );

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(container.querySelector('[data-brief-reel-button]')).toBeNull();
  });

  it('shows the button for admin even when no reel exists (idle state)', async () => {
    const apiFetch = makeApiFetch([
      { match: (u) => u.includes('/api/brief-reels/'), respond: () => jsonRes(null, 204) },
    ]);

    const { container } = render(
      <BriefReelSection briefId="b1" sectionIndex={0} isAdmin={true} apiFetch={apiFetch}>
        <p>body text</p>
      </BriefReelSection>
    );

    await waitFor(() => {
      const btn = container.querySelector('[data-brief-reel-button]');
      expect(btn).toBeTruthy();
      expect(btn.getAttribute('data-state')).toBe('idle');
    });
  });

  it('shows the button in ready state when a published reel is cached', async () => {
    const apiFetch = makeApiFetch([
      { match: (u) => u.includes('/api/brief-reels/'), respond: () => jsonRes({
        status: 'success',
        data: { _id: 'r1', status: 'published', timeline: minimalFixture },
      }, 200) },
    ]);

    const { container } = render(
      <BriefReelSection briefId="b1" sectionIndex={0} isAdmin={false} apiFetch={apiFetch}>
        <p>body text</p>
      </BriefReelSection>
    );

    await waitFor(() => {
      const btn = container.querySelector('[data-brief-reel-button]');
      expect(btn).toBeTruthy();
      expect(btn.getAttribute('data-state')).toBe('ready');
    });
  });

  it('admin click on idle button triggers POST /admin/generate and lands in ready state', async () => {
    const generateMock = vi.fn(async () => jsonRes({
      status: 'success',
      data: { reel: { _id: 'r2', status: 'pending', timeline: minimalFixture }, regenerated: true },
    }));

    const apiFetch = makeApiFetch([
      { match: (u, o) => o?.method === 'POST' && u.includes('/admin/generate'), respond: generateMock },
      { match: (u) => u.includes('/api/brief-reels/'), respond: () => jsonRes(null, 204) },
    ]);

    const { container } = render(
      <BriefReelSection briefId="b1" sectionIndex={0} isAdmin={true} apiFetch={apiFetch}>
        <p>body text</p>
      </BriefReelSection>
    );

    await waitFor(() => {
      expect(container.querySelector('[data-brief-reel-button][data-state="idle"]')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(container.querySelector('[data-brief-reel-button]'));
    });

    expect(generateMock).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(container.querySelector('[data-brief-reel-button][data-state="ready"]')).toBeTruthy();
    });
  });

  it('admin sees Pending badge when cached reel is pending', async () => {
    const apiFetch = makeApiFetch([
      { match: (u) => u.includes('/api/brief-reels/'), respond: () => jsonRes({
        status: 'success',
        data: { _id: 'r3', status: 'pending', timeline: minimalFixture },
      }, 200) },
    ]);

    render(
      <BriefReelSection briefId="b1" sectionIndex={0} isAdmin={true} apiFetch={apiFetch}>
        <p>body text</p>
      </BriefReelSection>
    );

    await waitFor(() => expect(screen.getByText('Pending')).toBeInTheDocument());
  });
});
