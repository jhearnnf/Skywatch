import { render, screen, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock framer-motion: SVG variants pass through without animation.
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

import BriefReelPlayer from '../BriefReelPlayer.jsx';
import airChiefMarshal from '../__fixtures__/airChiefMarshal.json';
import typhoonIntercept from '../__fixtures__/typhoonIntercept.json';
import natoArticleFive  from '../__fixtures__/natoArticleFive.json';
import recruitNumbers   from '../__fixtures__/recruitNumbers.json';

describe('BriefReelPlayer', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(()  => { vi.useRealTimers(); });

  it('renders without crashing for every fixture', () => {
    for (const fx of [airChiefMarshal, typhoonIntercept, natoArticleFive, recruitNumbers]) {
      const { container, unmount } = render(<BriefReelPlayer timeline={fx} autoPlay={false} />);
      expect(container.querySelector('svg')).toBeTruthy();
      unmount();
    }
  });

  it('emits onBeatStart in beat order at the right times', () => {
    const onBeatStart = vi.fn();
    render(<BriefReelPlayer timeline={airChiefMarshal} onBeatStart={onBeatStart} />);

    // Beat 1 fires synchronously inside the effect.
    expect(onBeatStart).toHaveBeenCalledTimes(1);
    expect(onBeatStart.mock.calls[0][0].id).toBe('b1');

    // Advance through b1 → b2 fires.
    act(() => { vi.advanceTimersByTime(airChiefMarshal.beats[0].durationMs); });
    expect(onBeatStart).toHaveBeenCalledTimes(2);
    expect(onBeatStart.mock.calls[1][0].id).toBe('b2');

    // Advance through the remaining beats.
    for (let i = 1; i < airChiefMarshal.beats.length; i++) {
      act(() => { vi.advanceTimersByTime(airChiefMarshal.beats[i].durationMs); });
    }
    expect(onBeatStart).toHaveBeenCalledTimes(airChiefMarshal.beats.length);
  });

  it('shows the recap after the final beat and does NOT auto-fire onComplete', () => {
    const onComplete = vi.fn();
    const { container } = render(<BriefReelPlayer timeline={typhoonIntercept} onComplete={onComplete} />);

    const total = typhoonIntercept.beats.reduce((s, b) => s + b.durationMs, 0);
    // Advance past every beat and well beyond — the recap should stay
    // visible and onComplete should never fire on its own. The user
    // dismisses via swipe / close button / re-clicking the reel button.
    act(() => { vi.advanceTimersByTime(total + 30000); });
    expect(onComplete).not.toHaveBeenCalled();
    expect(container.textContent).toContain('RECAP');
  });

  it('does not auto-start when autoPlay=false', () => {
    const onBeatStart = vi.fn();
    render(<BriefReelPlayer timeline={airChiefMarshal} onBeatStart={onBeatStart} autoPlay={false} />);
    expect(onBeatStart).not.toHaveBeenCalled();
  });

  it('exposes the active beat id on the wrapper for host dimming', () => {
    const { container } = render(<BriefReelPlayer timeline={airChiefMarshal} />);
    const wrap = container.firstChild;
    expect(wrap.getAttribute('data-active-beat')).toBe('b1');

    act(() => { vi.advanceTimersByTime(airChiefMarshal.beats[0].durationMs); });
    expect(wrap.getAttribute('data-active-beat')).toBe('b2');
  });

  it('renders all actor short labels for the air-chief-marshal fixture', () => {
    render(<BriefReelPlayer timeline={airChiefMarshal} />);
    // Beat 1 has only `smyth` entering; the second actor appears in b3.
    act(() => {
      vi.advanceTimersByTime(
        airChiefMarshal.beats[0].durationMs +
        airChiefMarshal.beats[1].durationMs +
        airChiefMarshal.beats[2].durationMs,
      );
    });
    // Both actors should now be on stage (short labels rendered as <text>).
    expect(screen.getByText('ACM Smyth')).toBeInTheDocument();
    expect(screen.getByText('RAF Planner')).toBeInTheDocument();
  });

  it('tapping the stage pauses and resumes the auto-advance', () => {
    const onBeatStart = vi.fn();
    const { container } = render(<BriefReelPlayer timeline={airChiefMarshal} onBeatStart={onBeatStart} />);
    const wrap = container.firstChild;
    const svg  = container.querySelector('svg');

    expect(wrap.getAttribute('data-paused')).toBeNull();

    // Advance partway into beat 1 and tap to pause.
    act(() => { vi.advanceTimersByTime(800); });
    act(() => { svg.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(wrap.getAttribute('data-paused')).toBe('true');

    // While paused, even advancing past the original beat duration must NOT
    // trigger b2 — the auto-advance timer was cancelled on pause.
    const callsAtPause = onBeatStart.mock.calls.length;
    act(() => { vi.advanceTimersByTime(airChiefMarshal.beats[0].durationMs + 5000); });
    expect(onBeatStart.mock.calls.length).toBe(callsAtPause);

    // Tap again to resume — clock through the remaining time, b2 should fire.
    act(() => { svg.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(wrap.getAttribute('data-paused')).toBeNull();
    act(() => { vi.advanceTimersByTime(airChiefMarshal.beats[0].durationMs); });
    expect(onBeatStart.mock.calls.at(-1)[0].id).toBe('b2');
  });

  it('carries crossed-out callouts into the recap (X stays on the recap cell)', () => {
    const { container } = render(<BriefReelPlayer timeline={airChiefMarshal} />);
    // Advance past every beat to land on the recap. The live in-beat callout
    // (and its overlay) clears at the next beat boundary — so any red lines
    // present at recap-time must come from the recap cell's own overlay.
    const total = airChiefMarshal.beats.reduce((s, b) => s + b.durationMs, 0);
    act(() => { vi.advanceTimersByTime(total + 1000); });
    expect(container.textContent).toContain('RECAP');
    const redLines = container.querySelectorAll('line[stroke="#ef4444"]');
    expect(redLines.length).toBeGreaterThanOrEqual(2);
  });

  it('renders the crossout overlay when a beat fires a crossout action', () => {
    const { container } = render(<BriefReelPlayer timeline={airChiefMarshal} />);
    // airChiefMarshal b2 contains show-text + crossout. Advance past b1
    // (~3s) and well into b2 so the post-headline crossout has fired.
    act(() => {
      vi.advanceTimersByTime(
        airChiefMarshal.beats[0].durationMs +
        Math.floor(airChiefMarshal.beats[1].durationMs * 0.6),
      );
    });
    // The X overlay is the only #ef4444-stroked line drawn by the player.
    const redLines = container.querySelectorAll('line[stroke="#ef4444"]');
    expect(redLines.length).toBeGreaterThanOrEqual(2);
  });

  it('cancels pending timers when timeline changes', () => {
    const onBeatStart = vi.fn();
    const { rerender } = render(
      <BriefReelPlayer timeline={airChiefMarshal} onBeatStart={onBeatStart} />
    );
    expect(onBeatStart).toHaveBeenCalledTimes(1);

    rerender(<BriefReelPlayer timeline={typhoonIntercept} onBeatStart={onBeatStart} />);
    // Now we should see typhoon's first beat fire (b1 of new fixture).
    expect(onBeatStart.mock.calls.at(-1)[0].id).toBe('b1');

    // Advance past airChiefMarshal's b1 duration — its b2 must NOT fire.
    const oldBeatIds = new Set(airChiefMarshal.beats.map(b => b.id));
    const calledBeatIdsBeforeAdvance = new Set(onBeatStart.mock.calls.map(c => c[0].id));
    act(() => { vi.advanceTimersByTime(airChiefMarshal.beats[0].durationMs); });
    const newCalls = onBeatStart.mock.calls.slice(calledBeatIdsBeforeAdvance.size);
    // Any new call must be from the typhoon timeline, not the old one.
    for (const c of newCalls) {
      const id = c[0].id;
      if (oldBeatIds.has(id) && !typhoonIntercept.beats.some(b => b.id === id)) {
        throw new Error(`Stale beat ${id} fired after timeline swap`);
      }
    }
  });
});
