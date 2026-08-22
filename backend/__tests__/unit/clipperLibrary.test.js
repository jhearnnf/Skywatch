/**
 * The curated b-roll library (backend/utils/clipperLibrary.js).
 *
 * Three stock APIs searched with the same handful of queries return the same
 * handful of results, so after a few videos a channel is visibly drawing from
 * one shallow pool. A folder of clips somebody actually watched and kept is the
 * only source that gets better over time.
 *
 * The manifest is hand-edited, which is the whole reason these tests exist: a
 * filename in it is a claim, not a fact, and a clip that silently fails to load
 * renders as a black beat with no explanation.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('fs');

const lib = require('../../utils/clipperLibrary');

// A fake public/video/broll: the manifest plus whichever files "exist".
function givenLibrary(manifest, files = []) {
  const present = new Set(files.map(f => path.join(lib.LIBRARY_ABS_DIR, f)));

  fs.statSync.mockImplementation((p) => {
    if (p === lib.MANIFEST_PATH) return { mtimeMs: Math.random() };
    throw new Error('ENOENT');
  });
  fs.readFileSync.mockImplementation((p) => {
    if (p === lib.MANIFEST_PATH) {
      return typeof manifest === 'string' ? manifest : JSON.stringify(manifest);
    }
    throw new Error('ENOENT');
  });
  fs.existsSync.mockImplementation((p) => present.has(p));
}

const clip = (over = {}) => ({
  file: 'typhoon-takeoff.mp4',
  title: 'Typhoon takeoff',
  tags: ['typhoon', 'runway', 'afterburner'],
  durationSec: 14,
  licence: 'MOD News Licence',
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  lib._resetCache();
});

describe('loadLibrary', () => {
  // The ordinary state of a fresh checkout, and of the deployed backend, which
  // ships without public/ at all. Not a fault to report.
  it('reports an empty library when there is no manifest', () => {
    fs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });
    expect(lib.loadLibrary()).toEqual({ clips: [], problems: [] });
    expect(lib.libraryConfigured()).toBe(false);
  });

  it('loads a clip that is described and present', () => {
    givenLibrary({ clips: [clip()] }, ['typhoon-takeoff.mp4']);
    const { clips, problems } = lib.loadLibrary();
    expect(problems).toEqual([]);
    expect(clips).toHaveLength(1);
    expect(clips[0].durationSec).toBe(14);
  });

  it('names a clip that is listed but not on disk', () => {
    givenLibrary({ clips: [clip()] }, []);
    const { clips, problems } = lib.loadLibrary();
    expect(clips).toHaveLength(0);
    expect(problems[0]).toMatch(/not in the folder/);
  });

  // Same rule as the stock providers and the music library: these end up under
  // published videos, so every clip has to say what it is.
  it('drops a clip with no licence', () => {
    givenLibrary({ clips: [clip({ licence: '' })] }, ['typhoon-takeoff.mp4']);
    const { clips, problems } = lib.loadLibrary();
    expect(clips).toHaveLength(0);
    expect(problems[0]).toMatch(/licence/);
  });

  // The shot splitter refuses to cut a clip whose length it does not know, so
  // a missing duration quietly costs the clip its sub-shots.
  it('keeps a clip with no duration but says so', () => {
    givenLibrary({ clips: [clip({ durationSec: null })] }, ['typhoon-takeoff.mp4']);
    const { clips, problems } = lib.loadLibrary();
    expect(clips).toHaveLength(1);
    expect(problems[0]).toMatch(/durationSec/);
  });

  it('survives a manifest that is not valid JSON', () => {
    givenLibrary('{ not json');
    const { clips, problems } = lib.loadLibrary();
    expect(clips).toEqual([]);
    expect(problems[0]).toMatch(/not valid JSON/);
  });

  it('re-reads only when the manifest changes', () => {
    givenLibrary({ clips: [clip()] }, ['typhoon-takeoff.mp4']);
    const mtime = 1234;
    fs.statSync.mockImplementation(() => ({ mtimeMs: mtime }));

    lib._resetCache();
    lib.loadLibrary();
    lib.loadLibrary();
    lib.loadLibrary();
    expect(fs.readFileSync).toHaveBeenCalledTimes(1);
  });
});

describe('searchLibrary', () => {
  const many = [
    clip(),
    clip({ file: 'tower.mp4', title: 'Control tower at dusk', tags: ['tower', 'atc', 'airfield'] }),
    clip({ file: 'radar.mp4', title: 'Radar screen sweep', tags: ['radar', 'screen', 'atc'] }),
  ];
  const files = ['typhoon-takeoff.mp4', 'tower.mp4', 'radar.mp4'];

  it('finds a clip by its tags', () => {
    givenLibrary({ clips: many }, files);
    expect(lib.searchLibrary('afterburner').map(c => c.providerId)).toEqual(['typhoon-takeoff.mp4']);
  });

  // Tags are what somebody wrote down deliberately; a title is often the
  // filename tidied up.
  it('ranks a tag match above a title match', () => {
    givenLibrary({ clips: many }, files);
    const hits = lib.searchLibrary('radar screen');
    expect(hits[0].providerId).toBe('radar.mp4');
  });

  it('returns nothing rather than everything for an unrelated query', () => {
    givenLibrary({ clips: many }, files);
    expect(lib.searchLibrary('helicopter winch rescue')).toEqual([]);
    expect(lib.searchLibrary('')).toEqual([]);
  });

  // A path relative to public/, the same form the SFX and music use, so the
  // composition resolves it through staticFile() and nothing is fetched over
  // the network at render time.
  it('gives a clip as a path under public, not a URL', () => {
    givenLibrary({ clips: [clip()] }, ['typhoon-takeoff.mp4']);
    const [hit] = lib.searchLibrary('typhoon');
    expect(hit.downloadUrl).toBe('video/broll/typhoon-takeoff.mp4');
    expect(hit.provider).toBe('library');
    expect(hit.licence).toBe('MOD News Licence');
  });

  it('carries a poster through as a browser-loadable path', () => {
    givenLibrary({ clips: [clip({ poster: 'typhoon.jpg' })] }, ['typhoon-takeoff.mp4']);
    expect(lib.searchLibrary('typhoon')[0].thumbUrl).toBe('/video/broll/typhoon.jpg');
  });
});
