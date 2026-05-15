import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import BriefReelButton from '../BriefReelButton';

describe('BriefReelButton', () => {
  it.each([
    ['idle',    'Generate Brief Reel'],
    ['ready',   'Play Brief Reel'],
    ['playing', 'Close Brief Reel'],
    ['loading', 'Generating Brief Reel…'],
    ['error',   'Brief Reel failed — click to retry'],
  ])('state=%s shows title "%s"', (state, expected) => {
    const { container } = render(<BriefReelButton state={state} onClick={() => {}} />);
    const btn = container.querySelector('[data-brief-reel-button]');
    expect(btn.getAttribute('title')).toBe(expected);
    expect(btn.getAttribute('data-state')).toBe(state);
  });

  it('aria-pressed only when playing', () => {
    const { rerender, container } = render(<BriefReelButton state="ready" onClick={() => {}} />);
    expect(container.querySelector('[data-brief-reel-button]').getAttribute('aria-pressed')).toBeNull();
    rerender(<BriefReelButton state="playing" onClick={() => {}} />);
    expect(container.querySelector('[data-brief-reel-button]').getAttribute('aria-pressed')).toBe('true');
  });

  it('disabled and aria-busy when loading; spinner present', () => {
    const { container } = render(<BriefReelButton state="loading" onClick={() => {}} />);
    const btn = container.querySelector('[data-brief-reel-button]');
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.querySelector('.animate-spin')).toBeTruthy();
  });
});
