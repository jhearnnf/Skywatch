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

const apiFetchMock = vi.fn();
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ API: '', apiFetch: apiFetchMock }),
}));

import BriefReelReviewPanel from '../admin/BriefReelReviewPanel.jsx';
import minimalFixture from '../__fixtures__/recruitNumbers.json';

function jsonRes(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const PENDING_ROW = {
  _id:          'r1',
  briefId:      'b1',
  briefTitle:   'Pending Brief',
  sectionIndex: 0,
  bodySnapshot: 'Some section body.',
  generatedAt:  new Date('2026-05-01T10:00:00Z').toISOString(),
  timeline:     minimalFixture,
};

beforeEach(() => {
  apiFetchMock.mockReset();
  // Default: pending list returns one row.
  apiFetchMock.mockImplementation(async (url, opts) => {
    if (url.includes('/admin/pending')) return jsonRes({ status: 'success', data: { rows: [PENDING_ROW] } });
    return jsonRes({}, 404);
  });
});

afterEach(() => { vi.clearAllMocks(); });

describe('BriefReelReviewPanel', () => {
  it('shows "No pending reels" empty state when list is empty', async () => {
    apiFetchMock.mockImplementationOnce(async () => jsonRes({ status: 'success', data: { rows: [] } }));
    render(<BriefReelReviewPanel />);
    await waitFor(() => expect(screen.getByText(/No pending reels/i)).toBeInTheDocument());
  });

  it('renders pending rows with brief title and section', async () => {
    render(<BriefReelReviewPanel />);
    await waitFor(() => expect(screen.getByText('Pending Brief')).toBeInTheDocument());
    expect(screen.getByText(/Section 1/)).toBeInTheDocument();
  });

  it('opens the review modal on Review click and renders the player', async () => {
    render(<BriefReelReviewPanel />);
    await waitFor(() => screen.getByRole('button', { name: 'Review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(screen.getByRole('dialog', { name: /Brief Reel review/i })).toBeInTheDocument();
    // BriefReelPlayer renders an svg.
    expect(document.querySelector('[role="dialog"] svg')).toBeTruthy();
  });

  it('Publish posts to /:id/publish and reloads', async () => {
    const calls = [];
    apiFetchMock.mockImplementation(async (url, opts) => {
      calls.push({ url, method: opts?.method });
      if (url.endsWith('/publish')) return jsonRes({ status: 'success', data: { reel: { ...PENDING_ROW, status: 'published' } } });
      if (url.includes('/admin/pending')) return jsonRes({ status: 'success', data: { rows: calls.some(c => c.url.endsWith('/publish')) ? [] : [PENDING_ROW] } });
      return jsonRes({}, 404);
    });

    render(<BriefReelReviewPanel />);
    await waitFor(() => screen.getByRole('button', { name: 'Review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Publish/i }));
    });

    expect(calls.some(c => c.url.endsWith('/admin/r1/publish') && c.method === 'POST')).toBe(true);
    // After publish the modal closes.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Discard sends DELETE after confirmation', async () => {
    const calls = [];
    apiFetchMock.mockImplementation(async (url, opts) => {
      calls.push({ url, method: opts?.method });
      if (opts?.method === 'DELETE') return jsonRes({ status: 'success', data: { id: 'r1' } });
      if (url.includes('/admin/pending')) return jsonRes({ status: 'success', data: { rows: calls.some(c => c.method === 'DELETE') ? [] : [PENDING_ROW] } });
      return jsonRes({}, 404);
    });

    const origConfirm = window.confirm;
    window.confirm = () => true;

    try {
      render(<BriefReelReviewPanel />);
      await waitFor(() => screen.getByRole('button', { name: 'Review' }));
      fireEvent.click(screen.getByRole('button', { name: 'Review' }));

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Discard/i }));
      });

      expect(calls.some(c => c.url.endsWith('/admin/r1') && c.method === 'DELETE')).toBe(true);
    } finally {
      window.confirm = origConfirm;
    }
  });
});
