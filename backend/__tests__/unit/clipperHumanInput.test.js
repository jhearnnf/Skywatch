/**
 * clipperHumanInput.test.js
 *
 * The capture bot's hand, and the crop derived from where it went.
 *
 * ── The bug these exist because of ──────────────────────────────────────────
 * `demoPlay` used to press controls from inside the page with
 * `el.dispatchEvent(new PointerEvent('pointerdown', { bubbles, cancelable }))`.
 * That event has clientX/clientY of 0, and the synthetic cursor draws its tap
 * ripple at the event's coordinates - so every ripple in every generic capture
 * landed in the top-left corner, and the cursor dot never moved at all because
 * pointermove was never dispatched. Footage showed a UI reacting to nothing.
 *
 * humanInput.js lives in clipper-agent/, which has no test runner of its own,
 * so it is exercised from here - the same arrangement as clipperMediaServer.
 */

const {
  makeRng, travelPath, aimPoint, isDigitLabel, digitTargets, between,
} = require('../../../clipper-agent/capture/humanInput');

const {
  focusFromInput, INPUT_FOCUS_SIZE, MIN_INPUT_POINTS,
} = require('../../constants/clipperCapture');

const box = (x, y, width = 60, height = 40) => ({ x, y, width, height });

describe('makeRng', () => {
  it('is deterministic for a seed, so a capture can be reproduced', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('gives different streams for different seeds', () => {
    expect(makeRng(1)()).not.toBe(makeRng(2)());
  });

  it('stays inside [0, 1)', () => {
    const rng = makeRng(7);
    for (let i = 0; i < 500; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('travelPath', () => {
  const from = { x: 100, y: 100 };
  const to = { x: 300, y: 400 };

  it('lands exactly on the target however it got there', () => {
    const path = travelPath(from, to, { rng: makeRng(3) });
    expect(path[path.length - 1]).toEqual(to);
  });

  it('overshoots before settling, which is what a tween never does', () => {
    const path = travelPath(from, to, { rng: makeRng(3) });
    // Distance travelled along x at some point exceeds the straight-line gap.
    const maxX = Math.max(...path.map(p => p.x));
    expect(maxX).toBeGreaterThan(to.x);
  });

  it('moves off immediately rather than sitting still', () => {
    const path = travelPath(from, to, { rng: makeRng(3) });
    expect(path[0]).not.toEqual(from);
  });

  it('does not wander backwards past the start', () => {
    const path = travelPath(from, to, { rng: makeRng(9) });
    expect(Math.min(...path.map(p => p.x))).toBeGreaterThanOrEqual(from.x);
  });

  it('handles a target it is already on', () => {
    const path = travelPath(from, from, { rng: makeRng(1) });
    expect(path[path.length - 1]).toEqual(from);
  });
});

describe('aimPoint', () => {
  const b = box(100, 200, 60, 40);

  it('keeps an ordinary aim inside the control', () => {
    const rng = makeRng(11);
    for (let i = 0; i < 300; i++) {
      const p = aimPoint(b, { rng });
      expect(p.x).toBeGreaterThanOrEqual(b.x);
      expect(p.x).toBeLessThanOrEqual(b.x + b.width);
      expect(p.y).toBeGreaterThanOrEqual(b.y);
      expect(p.y).toBeLessThanOrEqual(b.y + b.height);
    }
  });

  it('clusters around the centre rather than spreading evenly', () => {
    const rng = makeRng(5);
    const cx = b.x + b.width / 2;
    const near = Array.from({ length: 400 }, () => aimPoint(b, { rng }))
      .filter(p => Math.abs(p.x - cx) < b.width * 0.15).length;
    // A flat distribution would put ~30% of samples in this band.
    expect(near).toBeGreaterThan(160);
  });

  // The point of a real click at real coordinates: the browser hit-tests it,
  // so a wide enough aim genuinely misses instead of being a scripted "wrong".
  it('can land outside the control when told to miss', () => {
    const rng = makeRng(13);
    const outside = Array.from({ length: 200 }, () => aimPoint(b, { rng, miss: true }))
      .filter(p => p.x < b.x || p.x > b.x + b.width || p.y < b.y || p.y > b.y + b.height);
    expect(outside.length).toBeGreaterThan(0);
  });
});

describe('digit detection', () => {
  it('recognises a single digit and nothing else', () => {
    expect(isDigitLabel('7')).toBe(true);
    expect(isDigitLabel(' 0 ')).toBe(true);
    expect(isDigitLabel('12')).toBe(false);
    expect(isDigitLabel('Start')).toBe(false);
    expect(isDigitLabel('')).toBe(false);
    expect(isDigitLabel(null)).toBe(false);
  });

  // FLAG's numpad is ten single-digit buttons, disabled until a maths question
  // is live. Enabled digit controls are therefore a question waiting to be
  // answered, in any game, with no per-game knowledge.
  it('picks the keypad out of a mixed set of controls', () => {
    const targets = [
      { label: '7', box: box(0, 0) },
      { label: '8', box: box(60, 0) },
      { label: 'Alpha Bravo', box: box(0, 200) },
      { label: '', box: box(0, 400) },
    ];
    expect(digitTargets(targets).map(t => t.label)).toEqual(['7', '8']);
  });
});

describe('between', () => {
  it('stays within the range', () => {
    const rng = makeRng(21);
    for (let i = 0; i < 200; i++) {
      const v = between([120, 250], rng);
      expect(v).toBeGreaterThanOrEqual(120);
      expect(v).toBeLessThanOrEqual(250);
    }
  });
});

/**
 * The crop derived from the input log.
 *
 * Deriving it at render time is the point: a zoom encoded into the recording
 * cannot be retuned or switched off, and would fight the Ken Burns move and the
 * phone frame, both of which are decided in the composition.
 */
describe('focusFromInput', () => {
  const press = (atMs, x, y) => ({ atMs, x, y, kind: 'press' });

  it('centres on a cluster of presses', () => {
    const rect = focusFromInput([
      press(1000, 0.30, 0.80), press(1200, 0.34, 0.82), press(1500, 0.32, 0.78),
      press(1800, 0.31, 0.81),
    ]);
    expect(rect.width).toBe(INPUT_FOCUS_SIZE);
    expect(rect.height).toBe(INPUT_FOCUS_SIZE);
    // The rect wants to sit around (0.32, 0.80) but is clamped so it stays on
    // the frame - the cluster is near the bottom edge.
    expect(rect.x).toBeCloseTo(0, 5);
    expect(rect.y).toBeCloseTo(1 - INPUT_FOCUS_SIZE, 5);
  });

  it('keeps the rect on the frame', () => {
    const rect = focusFromInput([
      press(0, 0.98, 0.02), press(100, 0.97, 0.03), press(200, 0.99, 0.01),
    ]);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(1);
    expect(rect.y + rect.height).toBeLessThanOrEqual(1);
  });

  // FLAG puts the numpad, the play field and the callsign question in different
  // corners. A stretch of play that touches all three has no "where the action
  // is", and cropping to their average centre loses every one of them.
  it('declines to crop when the presses are spread across the screen', () => {
    expect(focusFromInput([
      press(0, 0.10, 0.10), press(500, 0.90, 0.15), press(900, 0.15, 0.85),
      press(1400, 0.85, 0.90), press(1800, 0.50, 0.50),
    ])).toBeNull();
  });

  it('ignores one stray press among a tight cluster', () => {
    const rect = focusFromInput([
      press(0, 0.50, 0.50), press(200, 0.52, 0.51), press(400, 0.49, 0.52),
      press(600, 0.51, 0.49), press(800, 0.02, 0.97),
    ]);
    expect(rect).not.toBeNull();
    expect(rect.x + rect.width / 2).toBeCloseTo(0.5, 1);
  });

  it('only counts presses made while the shot is on screen', () => {
    const log = [
      press(200, 0.10, 0.10), press(400, 0.11, 0.12), press(600, 0.09, 0.11),
      press(9000, 0.80, 0.80), press(9200, 0.82, 0.81), press(9400, 0.79, 0.79),
    ];
    const early = focusFromInput(log, { startMs: 0, endMs: 1000 });
    const late  = focusFromInput(log, { startMs: 8000, endMs: 10000 });

    expect(early.y).toBeCloseTo(0, 5);
    expect(late.y).toBeGreaterThan(early.y);
  });

  it('needs more than a couple of presses to say anything', () => {
    const two = [press(0, 0.5, 0.5), press(100, 0.5, 0.5)];
    expect(two.length).toBeLessThan(MIN_INPUT_POINTS);
    expect(focusFromInput(two)).toBeNull();
  });

  it('is null for a clip with no log at all', () => {
    expect(focusFromInput(undefined)).toBeNull();
    expect(focusFromInput([])).toBeNull();
  });

  it('ignores malformed entries rather than throwing', () => {
    expect(focusFromInput([
      null, { x: 'a', y: 0.5, atMs: 0 }, press(0, 0.5, 0.5),
    ])).toBeNull();
  });
});
