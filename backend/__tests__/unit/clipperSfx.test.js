/**
 * Unit tests for the sound-effect catalogue (backend/constants/clipperSfx.js)
 * and how it reaches the render timeline.
 *
 * The catalogue is a closed set on purpose: short-form SFX want consistency,
 * not variety, and a cue that resolves to nothing would silently drop a stinger
 * the script writer asked for.
 */

const fs = require('fs');
const path = require('path');
const { SFX, SFX_BY_ID, SFX_DIR, resolveCue, sfxPath } = require('../../constants/clipperSfx');
const { buildTimeline } = require('../../utils/clipperTimeline');

describe('catalogue', () => {
  it('has a unique id for every entry', () => {
    const ids = SFX.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // The catalogue names real files. If one is renamed or removed, the stinger
  // vanishes from the render with no error, so this fails loudly instead.
  it('points at files that actually exist', () => {
    const dir = path.join(__dirname, '..', '..', '..', 'public', SFX_DIR);
    for (const entry of SFX) {
      expect(fs.existsSync(path.join(dir, entry.file))).toBe(true);
    }
  });

  it('gives every entry a label and a note on when to use it', () => {
    for (const s of SFX) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.use.length).toBeGreaterThan(0);
    }
  });
});

describe('resolveCue', () => {
  it('accepts a catalogue id directly', () => {
    expect(resolveCue('record-scratch')).toBe('record-scratch');
  });

  it.each([
    ['whoosh', 'whoosh'],
    ['woosh', 'whoosh'],
    ['swoosh', 'whoosh'],
    ['transition', 'whoosh'],
    ['boom', 'impact'],
    ['ping', 'notification'],
    ['bell', 'ding'],
    ['typing', 'typewriter'],
  ])('maps the free-text cue %p onto %p', (cue, expected) => {
    expect(resolveCue(cue)).toBe(expected);
  });

  it('finds a cue word inside a longer phrase', () => {
    // The script writer produces prose, not enum values.
    expect(resolveCue('quick whoosh here')).toBe('whoosh');
    expect(resolveCue('record scratch moment')).toBe('record-scratch');
  });

  it('is case insensitive', () => {
    expect(resolveCue('BOOM')).toBe('impact');
  });

  it('returns null for an empty or unrecognisable cue', () => {
    expect(resolveCue('')).toBeNull();
    expect(resolveCue(null)).toBeNull();
    expect(resolveCue('kazoo solo')).toBeNull();
  });
});

describe('sfxPath', () => {
  it('builds a path inside the public sound folder', () => {
    expect(sfxPath('pop')).toBe(`${SFX_DIR}/pop.mp3`);
  });

  it('returns null for an unknown id', () => {
    expect(sfxPath('nope')).toBeNull();
  });
});

describe('timeline integration', () => {
  const script = (over = {}) => ({
    script: { beats: [{ id: 'b1', text: 'One.', visual: { kind: 'stock' }, sfxCue: 'whoosh' }] },
    footage: {},
    voice: { lines: [{ beatId: 'b1', durationMs: 3000, startMs: 0 }] },
    outro: { enabled: false },
    ...over,
  });

  it('falls back to the script writer cue when the stage was skipped', () => {
    const t = buildTimeline(script());
    expect(t.beats[0].sfx).toHaveLength(1);
    expect(t.beats[0].sfx[0].src).toContain('whoosh_small.mp3');
  });

  it('prefers approved rows over the cue', () => {
    const t = buildTimeline(script({ sfx: [{ beatId: 'b1', sfxId: 'impact', atMs: 400, gain: 0.5 }] }));
    expect(t.beats[0].sfx[0].src).toContain('impact.mp3');
    expect(t.beats[0].sfx[0].atMs).toBe(400);
    expect(t.beats[0].sfx[0].gain).toBe(0.5);
  });

  it('drops a row the admin switched off', () => {
    const t = buildTimeline(script({ sfx: [{ beatId: 'b1', sfxId: 'impact', enabled: false }] }));
    expect(t.beats[0].sfx).toHaveLength(0);
  });

  it('emits nothing for an unresolvable cue rather than a broken path', () => {
    const t = buildTimeline(script({
      script: { beats: [{ id: 'b1', text: 'One.', visual: { kind: 'stock' }, sfxCue: 'kazoo' }] },
    }));
    expect(t.beats[0].sfx).toEqual([]);
  });

  it('gives the end card no sound effects', () => {
    const t = buildTimeline(script({ outro: { enabled: true, copy: 'More tips' } }));
    expect(t.beats[t.beats.length - 1].sfx).toEqual([]);
  });
});
