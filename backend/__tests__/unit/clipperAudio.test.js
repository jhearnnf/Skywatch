/**
 * clipperAudio.test.js
 *
 * The Clipper agent's ffmpeg audio helpers. Both of them exist because a
 * finished MP4 was measured rather than watched: every narration wav carried
 * silence at both ends, and the mix shipped at -18.8 LUFS against a platform
 * target of about -14.
 *
 * The contract worth protecting is not that ffmpeg works — it is what happens
 * when it does not. A missing binary or a bad measurement must leave the file
 * alone and say so, never fail the job and never quietly claim success.
 *
 * Lives here rather than in clipper-agent/ for the same reason as
 * clipperMediaServer.test.js: that folder has no runner of its own.
 */

const { EventEmitter } = require('events');

jest.mock('child_process', () => ({ spawn: jest.fn() }));
jest.mock('fs/promises', () => ({
  rm: jest.fn().mockResolvedValue(undefined),
  rename: jest.fn().mockResolvedValue(undefined),
}));

const { spawn } = require('child_process');
const fs = require('fs/promises');
const audio = require('../../../clipper-agent/audio');

// A fake child process that emits the given streams and exit code.
function fakeProc({ stdout = '', stderr = '', code = 0, error = false } = {}) {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();

  process.nextTick(() => {
    if (error) return proc.emit('error', new Error('ENOENT'));
    if (stdout) proc.stdout.emit('data', stdout);
    if (stderr) proc.stderr.emit('data', stderr);
    proc.emit('exit', code);
  });

  return proc;
}

// Queue one fake result per spawn call, in order.
function queue(...results) {
  spawn.mockReset();
  for (const r of results) spawn.mockImplementationOnce(() => fakeProc(r));
}

const LOUDNORM_JSON = JSON.stringify({
  input_i: '-18.8',
  input_tp: '-0.7',
  input_lra: '8.5',
  input_thresh: '-29.2',
  target_offset: '0.4',
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('parseLoudnormJson', () => {
  it('reads the measurement ffmpeg prints on stderr', () => {
    const stats = audio.parseLoudnormJson(`some log noise\n${LOUDNORM_JSON}\n`);
    expect(stats.input_i).toBe('-18.8');
  });

  it('returns null when there is no JSON at all', () => {
    expect(audio.parseLoudnormJson('ffmpeg version 7.0\n')).toBeNull();
  });

  it('returns null for JSON that is not a loudness measurement', () => {
    // A payload without input_i cannot drive a linear correction, and guessing
    // one would be worse than skipping the pass.
    expect(audio.parseLoudnormJson('{"unrelated":1}')).toBeNull();
  });
});

describe('trimFilter', () => {
  it('trims both ends by reversing between passes', () => {
    const f = audio.trimFilter();
    expect(f.match(/silenceremove/g)).toHaveLength(2);
    expect(f.match(/areverse/g)).toHaveLength(2);
    // Leaves a little of each end rather than cutting to the first sample.
    expect(f).toContain(`start_silence=${audio.HEAD_PAD_SEC}`);
    expect(f).toContain(`start_silence=${audio.TAIL_PAD_SEC}`);
  });
});

describe('probeDurationMs', () => {
  it('reports the measured duration in milliseconds', async () => {
    queue({ stdout: '3.412000\n' });
    await expect(audio.probeDurationMs('x.wav')).resolves.toBe(3412);
  });

  it('returns null when ffprobe is not installed', async () => {
    queue({ error: true });
    await expect(audio.probeDurationMs('x.wav')).resolves.toBeNull();
  });

  it('returns null for a duration it cannot read', async () => {
    queue({ stdout: 'N/A\n' });
    await expect(audio.probeDurationMs('x.wav')).resolves.toBeNull();
  });
});

describe('trimSilence', () => {
  it('swaps in the trimmed file and reports the measured duration', async () => {
    // probe before, ffmpeg trim, probe after
    queue({ stdout: '4.220\n' }, { code: 0 }, { stdout: '3.417\n' });

    const res = await audio.trimSilence('C:/tmp/outro.wav');

    expect(res.trimmed).toBe(true);
    expect(res.durationMs).toBe(3417);
    expect(res.removedMs).toBe(803);
    expect(fs.rename).toHaveBeenCalledWith('C:/tmp/outro.wav.trim.wav', 'C:/tmp/outro.wav');
  });

  it('leaves the original alone when ffmpeg is missing', async () => {
    queue({ stdout: '4.220\n' }, { error: true });

    const res = await audio.trimSilence('C:/tmp/b1.wav');

    expect(res.trimmed).toBe(false);
    expect(res.durationMs).toBe(4220);
    expect(res.removedMs).toBe(0);
    expect(res.reason).toMatch(/ffmpeg not on PATH/);
    expect(fs.rename).not.toHaveBeenCalled();
  });

  it('refuses a trim that ate the line', async () => {
    // Silence detection on an unusually quiet read can remove everything. A
    // silent beat is far worse than a padded one, so the original stands.
    queue({ stdout: '4.220\n' }, { code: 0 }, { stdout: '0.050\n' });

    const res = await audio.trimSilence('C:/tmp/b1.wav');

    expect(res.trimmed).toBe(false);
    expect(res.durationMs).toBe(4220);
    expect(fs.rename).not.toHaveBeenCalled();
    expect(fs.rm).toHaveBeenCalledWith('C:/tmp/b1.wav.trim.wav', { force: true });
  });
});

describe('normaliseLoudness', () => {
  it('measures first, then applies the correction it measured', async () => {
    queue({ stderr: LOUDNORM_JSON }, { code: 0 });

    const res = await audio.normaliseLoudness('raw.mp4', 'out.mp4');

    expect(res).toMatchObject({ normalised: true, measuredLufs: -18.8, targetLufs: audio.TARGET.I });

    // Two passes, and the second one carries the first one's numbers — a
    // single-pass loudnorm is a dynamic normaliser and pumps under a ducked bed.
    const applied = spawn.mock.calls[1][1].join(' ');
    expect(applied).toContain('measured_I=-18.8');
    expect(applied).toContain('linear=true');
    // Only the audio is touched.
    expect(applied).toContain('-c:v copy');
  });

  it('skips the pass when ffmpeg is missing', async () => {
    queue({ error: true });

    const res = await audio.normaliseLoudness('raw.mp4', 'out.mp4');

    expect(res.normalised).toBe(false);
    expect(res.reason).toMatch(/ffmpeg not on PATH/);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('skips the pass when the measurement is unreadable', async () => {
    queue({ stderr: 'no json here' });

    const res = await audio.normaliseLoudness('raw.mp4', 'out.mp4');

    expect(res.normalised).toBe(false);
    expect(res.reason).toMatch(/could not read/);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('cleans up a half-written output when the correction fails', async () => {
    queue({ stderr: LOUDNORM_JSON }, { code: 1 });

    const res = await audio.normaliseLoudness('raw.mp4', 'out.mp4');

    expect(res.normalised).toBe(false);
    expect(fs.rm).toHaveBeenCalledWith('out.mp4', { force: true });
  });
});
