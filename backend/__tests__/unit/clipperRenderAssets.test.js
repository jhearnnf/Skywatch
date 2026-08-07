/**
 * clipperRenderAssets.test.js
 *
 * Screen recordings in a render timeline.
 *
 * The Remotion renderer downloads every asset over http/https and throws on any
 * other scheme, so the `file:///…` URL the backend stores for a capture beat
 * has to be rewritten to the agent's media server before the render starts.
 * Getting this wrong does not degrade the video — it fails the whole job, which
 * is what "Can only download URLs starting with http://" was.
 *
 * Lives here because clipper-agent/ has no test runner of its own.
 */

const path = require('path');
const os = require('os');

const mediaServer = require('../../../clipper-agent/mediaServer');
const { resolveLocalAssets } = require('../../../clipper-agent/handlers/render');

const CAPTURE = path.join(mediaServer.ROOT, 'capture', 'abc123.mp4');
const CAPTURE_URL = `file:///${CAPTURE.replace(/\\/g, '/')}`;
const STOCK = 'https://videos.pexels.com/video-files/7092133/x.mp4';

const timelineWith = (...videoUrls) => ({
  totalDurationMs: 4000,
  beats: videoUrls.map((videoUrl, i) => ({ id: `b${i + 1}`, videoUrl, durationMs: 1000 })),
});

describe('with the media server running', () => {
  let close;
  beforeAll(async () => { ({ close } = await mediaServer.start()); });
  afterAll(async () => { await close(); });

  it('rewrites a capture beat to an http URL the renderer can fetch', () => {
    const out = resolveLocalAssets(timelineWith(CAPTURE_URL));
    expect(out.beats[0].videoUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/file\?path=/);
    expect(decodeURIComponent(out.beats[0].videoUrl.split('path=')[1])).toBe(CAPTURE);
  });

  it('leaves stock footage and empty beats alone', () => {
    const out = resolveLocalAssets(timelineWith(STOCK, CAPTURE_URL, null));
    expect(out.beats[0].videoUrl).toBe(STOCK);
    expect(out.beats[1].videoUrl).toMatch(/^http:/);
    expect(out.beats[2].videoUrl).toBeNull();
  });

  it('keeps the rest of the timeline and beat intact', () => {
    const out = resolveLocalAssets(timelineWith(CAPTURE_URL));
    expect(out.totalDurationMs).toBe(4000);
    expect(out.beats[0].id).toBe('b1');
    expect(out.beats[0].durationMs).toBe(1000);
  });

  it('does not mutate the job payload', () => {
    const timeline = timelineWith(CAPTURE_URL);
    resolveLocalAssets(timeline);
    expect(timeline.beats[0].videoUrl).toBe(CAPTURE_URL);
  });

  it('returns the timeline untouched when nothing is local', () => {
    const timeline = timelineWith(STOCK);
    expect(resolveLocalAssets(timeline)).toBe(timeline);
  });

  // The server only serves the Clipper temp folder, so a path from anywhere
  // else has to fail loudly rather than reach the renderer and 403 mid-render.
  it('refuses a recording outside the media root', () => {
    const outside = `file:///${path.join(os.homedir(), 'clip.mp4').replace(/\\/g, '/')}`;
    expect(() => resolveLocalAssets(timelineWith(outside))).toThrow(/will not serve/);
  });
});

// Remotion's <Audio> goes through the same downloader as <OffthreadVideo>, so
// narration written to this machine's disk needs the same treatment.
describe('narration', () => {
  const NARRATION = path.join(mediaServer.ROOT, 's1', 'b1.wav');
  const NARRATION_URL = `file:///${NARRATION.replace(/\\/g, '/')}`;

  let close;
  beforeAll(async () => { ({ close } = await mediaServer.start()); });
  afterAll(async () => { await close(); });

  it('rewrites a narration URL to one the renderer can fetch', () => {
    const timeline = { beats: [{ id: 'b1', videoUrl: STOCK, audioUrl: NARRATION_URL }] };
    const out = resolveLocalAssets(timeline);

    expect(out.beats[0].audioUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/file\?path=/);
    expect(out.beats[0].videoUrl).toBe(STOCK);
  });

  it('rewrites video and narration on the same beat', () => {
    const timeline = { beats: [{ id: 'b1', videoUrl: CAPTURE_URL, audioUrl: NARRATION_URL }] };
    const out = resolveLocalAssets(timeline);

    expect(out.beats[0].videoUrl).toMatch(/^http:/);
    expect(out.beats[0].audioUrl).toMatch(/^http:/);
  });

  it('handles a beat whose only local asset is its narration', () => {
    const timeline = { beats: [{ id: 'b1', videoUrl: null, audioUrl: NARRATION_URL }] };
    expect(resolveLocalAssets(timeline).beats[0].audioUrl).toMatch(/^http:/);
  });

  it('names narration in the error when the file is outside the media root', () => {
    const outside = `file:///${path.join(os.homedir(), 'voice.wav').replace(/\\/g, '/')}`;
    const timeline = { beats: [{ id: 'b1', videoUrl: null, audioUrl: outside }] };
    expect(() => resolveLocalAssets(timeline)).toThrow(/narration file/);
  });
});

describe('with the media server down', () => {
  it('fails with a fix rather than letting Remotion throw its scheme error', () => {
    expect(() => resolveLocalAssets(timelineWith(CAPTURE_URL)))
      .toThrow(/media server is not running.*Restart the agent/s);
  });

  it('still renders a stock-only timeline', () => {
    const timeline = timelineWith(STOCK);
    expect(resolveLocalAssets(timeline)).toBe(timeline);
  });
});
